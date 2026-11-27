import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { requireTestDatabaseUrl } from './test-db';
import { approveRefundTx, markRefundSentTx, confirmRefundTx, RefundError } from '../../src/lib/refund-workflow';

const { url, schema } = requireTestDatabaseUrl();
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }, { schema }) });

test('EGP refund requires owner approval and bank confirmation before the cash journal', async () => {
  const before = { receipts: await db.receipt.count(), journals: await db.journalEntry.count(),
    postings: await db.ledgerPosting.count(), accounts: await db.ledgerAccount.count(), refunds: await db.refundOrder.count() };
  const rollback = new Error('rollback isolated refund fixture');
  await assert.rejects(db.$transaction(async outer => {
  const inTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => fn(outer);
  const tag = randomUUID().slice(0, 8), now = new Date();
  const fixture = await inTx(async tx => {
    const owner = await tx.user.create({ data: { name: 'refund owner', username: `fo_${tag}`, passwordHash: 'test', role: 'OWNER' } });
    const comm = await tx.user.create({ data: { name: 'refund communicator', username: `fc_${tag}`, passwordHash: 'test', role: 'COMMUNICATION' } });
    const executor = await tx.user.create({ data: { name: 'refund executor', username: `fe_${tag}`, passwordHash: 'test', role: 'EXECUTION' } });
    const team = await tx.team.create({ data: { name: `refund ${tag}`, communicatorId: comm.id, executorId: executor.id } });
    const lead = await tx.lead.create({ data: { name: `refund ${tag}`, teamId: team.id, status: 'CLIENT' } });
    const client = await tx.client.create({ data: { leadId: lead.id } });
    const order = await tx.customerOrder.create({ data: { clientId: client.id, teamId: team.id, createdById: owner.id,
      status: 'CANCELLED', marketCode: 'EG', currency: 'EGP', title: 'refund test', scope: 'poster',
      requirements: 'poster', totalMinor: 10000n } });
    const cash = await tx.ledgerAccount.upsert({ where: { code_currency: { code: 'CASH', currency: 'EGP' } },
      create: { code: 'CASH', currency: 'EGP', name: 'cash' }, update: {} });
    const advance = await tx.ledgerAccount.upsert({ where: { code_currency: { code: 'CUSTOMER_ADVANCES', currency: 'EGP' } },
      create: { code: 'CUSTOMER_ADVANCES', currency: 'EGP', name: 'advances' }, update: {} });
    const journal = await tx.journalEntry.create({ data: { currency: 'EGP', kind: 'RECEIPT',
      reference: `REFUND_RECEIPT:${tag}`, description: 'test receipt', createdById: owner.id } });
    await tx.ledgerPosting.create({ data: { journalId: journal.id, accountId: cash.id, debitMinor: 10000n } });
    await tx.ledgerPosting.create({ data: { journalId: journal.id, accountId: advance.id, creditMinor: 10000n } });
    await tx.receipt.create({ data: { orderId: order.id, grossMinor: 10000n, feeMinor: 0n, netMinor: 10000n,
      currency: 'EGP', settlementCurrency: 'EGP', settlementRef: `REFUND_RECEIPT:${tag}`,
      receivedAt: now, confirmedById: owner.id, journalId: journal.id } });
    const project = await tx.project.create({ data: { clientId: client.id, teamId: team.id, executorId: executor.id,
      createdById: owner.id, title: 'partly accepted work', serviceType: 'POSTER', brief: 'poster',
      requirements: 'poster', orderId: order.id, stage: 'CLIENT_PREVIEW', productionStartedAt: now, cancelledAt: now } });
    const deliverable = await tx.deliverable.create({ data: { projectId: project.id, version: 1, title: 'accepted preview', submittedById: executor.id, deliveredAt: now } });
    await tx.qualityReview.create({ data: { projectId: project.id, deliverableId: deliverable.id, reviewerId: owner.id, checklist: ['preview'], passed: true } });
    await tx.approval.create({ data: { projectId: project.id, kind: 'PREVIEW', deliverableId: deliverable.id, approvedById: owner.id, approvedAt: now } });
    await tx.attachment.create({ data: { projectId: project.id, deliverableId: deliverable.id, kind: 'PREVIEW',
      storageKey: `refund/${tag}/preview.png`, fileName: 'preview.png', mimeType: 'image/png', sizeBytes: 100,
      verifiedAt: now, uploadedById: executor.id } });
    await tx.cancellationAssessment.create({ data: { orderId: order.id, currency: 'EGP', paidMinor: 10000n,
      workValueMinor: 4000n, employeeDueMinor: 0n, documentedCostMinor: 0n, retainedMinor: 4000n,
      returnFeeMinor: 0n, refundMinor: 6000n, agreementRef: 'signed agreement', workEvidenceRef: 'accepted preview',
      reason: 'partial refund after accepted work', assessedById: owner.id } });
    return { orderId: order.id, ownerId: owner.id, commId: comm.id };
  });
  await assert.rejects(inTx(tx => approveRefundTx(tx,fixture.orderId,fixture.commId,'client destination','owner decision')), RefundError);
  const approved = await inTx(tx => approveRefundTx(tx,fixture.orderId,fixture.ownerId,'client destination','owner decision'));
  assert.equal(await outer.journalEntry.count({ where: { kind: 'CLIENT_REFUND', reference: `REFUND:${approved.id}` } }), 0);
  await assert.rejects(inTx(tx => approveRefundTx(tx,fixture.orderId,fixture.ownerId,'client destination','second decision')), RefundError);
  await inTx(tx => markRefundSentTx(tx,fixture.orderId,fixture.ownerId,`TRANSFER:${tag}`));
  assert.equal(await outer.journalEntry.count({ where: { kind: 'CLIENT_REFUND', reference: `REFUND:${approved.id}` } }), 0);
  // All liquidity below exists only inside this outer transaction and is rolled back.
  const accountCodes = ['CASH','CUSTOMER_ADVANCES','EARNINGS_PAYABLE','ACCOUNTS_PAYABLE','DEVELOPMENT_RESERVE','DEVELOPMENT_CASH'];
  const accounts = await outer.ledgerAccount.findMany({ where: { currency: 'EGP', code: { in: accountCodes } }, select: { id: true, code: true } });
  const totals = await outer.ledgerPosting.groupBy({ by: ['accountId'], where: { accountId: { in: accounts.map(a => a.id) } }, _sum: { debitMinor: true, creditMinor: true } });
  const balance = (code: string, creditSide: boolean) => {
    const id = accounts.find(a => a.code === code)?.id;
    const sum = totals.find(t => t.accountId === id)?._sum;
    return creditSide ? (sum?.creditMinor ?? 0n)-(sum?.debitMinor ?? 0n) : (sum?.debitMinor ?? 0n)-(sum?.creditMinor ?? 0n);
  };
  const positive = (value: bigint) => value > 0n ? value : 0n;
  const advance = await outer.ledgerAccount.findUniqueOrThrow({ where: { code_currency: { code: 'CUSTOMER_ADVANCES', currency: 'EGP' } } });
  const cash = await outer.ledgerAccount.findUniqueOrThrow({ where: { code_currency: { code: 'CASH', currency: 'EGP' } } });
  const advanceTopUp = positive(6000n-balance('CUSTOMER_ADVANCES',true));
  if (advanceTopUp) {
    const seed = await outer.journalEntry.create({ data: { currency: 'EGP', kind: 'TEST', reference: `REFUND_ADVANCE:${tag}`, description: 'rolled-back advance fixture', createdById: fixture.ownerId } });
    await outer.ledgerPosting.create({ data: { journalId: seed.id, accountId: cash.id, debitMinor: advanceTopUp } });
    await outer.ledgerPosting.create({ data: { journalId: seed.id, accountId: advance.id, creditMinor: advanceTopUp } });
  }
  const protectedLiabilities = positive(balance('EARNINGS_PAYABLE',true)) + positive(balance('ACCOUNTS_PAYABLE',true)) +
    positive(balance('DEVELOPMENT_RESERVE',true)-balance('DEVELOPMENT_CASH',false));
  const requiredCash = balance('CUSTOMER_ADVANCES',true)+advanceTopUp+protectedLiabilities;
  const cashTopUp = positive(requiredCash-balance('CASH',false)) + 10000n;
  const fundingAccount = await outer.ledgerAccount.create({ data: { code: `TEST_LIQUIDITY_${tag}`, currency: 'EGP', name: 'rolled-back liquidity fixture' } });
  const funding = await outer.journalEntry.create({ data: { currency: 'EGP', kind: 'TEST', reference: `REFUND_LIQUIDITY:${tag}`, description: 'rolled-back liquidity fixture', createdById: fixture.ownerId } });
  await outer.ledgerPosting.create({ data: { journalId: funding.id, accountId: cash.id, debitMinor: cashTopUp } });
  await outer.ledgerPosting.create({ data: { journalId: funding.id, accountId: fundingAccount.id, creditMinor: cashTopUp } });
  await outer.$executeRawUnsafe('SAVEPOINT refund_hold');
  await assert.rejects(inTx(async tx => {
    const advance = await tx.ledgerAccount.findUniqueOrThrow({ where: { code_currency: { code: 'CUSTOMER_ADVANCES', currency: 'EGP' } } });
    const asset = await tx.ledgerAccount.upsert({ where: { code_currency: { code: `TEST_ASSET_${tag}`, currency: 'EGP' } },
      create: { code: `TEST_ASSET_${tag}`, currency: 'EGP', name: 'isolated test asset' }, update: {} });
    const journal = await tx.journalEntry.create({ data: { currency: 'EGP', kind: 'TEST', reference: `REFUND_HOLD:${tag}`,
      description: 'temporary extra liability', createdById: fixture.ownerId } });
    await tx.ledgerPosting.create({ data: { journalId: journal.id, accountId: asset.id, debitMinor: 1_000_000_000_000n } });
    await tx.ledgerPosting.create({ data: { journalId: journal.id, accountId: advance.id, creditMinor: 1_000_000_000_000n } });
    await confirmRefundTx(tx,fixture.orderId,fixture.ownerId,`BANK_BLOCKED:${tag}`,new Date());
  }), RefundError);
  await outer.$executeRawUnsafe('ROLLBACK TO SAVEPOINT refund_hold');
  await outer.$executeRawUnsafe('RELEASE SAVEPOINT refund_hold');
  await inTx(tx => confirmRefundTx(tx,fixture.orderId,fixture.ownerId,`BANK:${tag}`,new Date()));
  const confirmed = await outer.refundOrder.findUniqueOrThrow({ where: { id: approved.id }, include: { journal: { include: { postings: true } } } });
  assert.equal(confirmed.status,'CONFIRMED');
  assert.equal(confirmed.journal?.postings.reduce((sum,row) => sum+row.debitMinor-row.creditMinor,0n),0n);
  assert.equal(await outer.journalEntry.count({ where: { kind: 'CLIENT_REFUND', reference: `REFUND:${approved.id}` } }), 1);
  await assert.rejects(inTx(tx => confirmRefundTx(tx,fixture.orderId,fixture.ownerId,`BANK2:${tag}`,new Date())), RefundError);
  await assert.rejects(outer.refundOrder.update({ where: { id: approved.id }, data: { status: 'APPROVED' } }));
  throw rollback;
  }, { timeout: 120_000 }), error => error === rollback);
  assert.deepEqual({ receipts: await db.receipt.count(), journals: await db.journalEntry.count(),
    postings: await db.ledgerPosting.count(), accounts: await db.ledgerAccount.count(), refunds: await db.refundOrder.count() }, before,
    'The refund fixture and temporary liquidity journals must leave no lasting rows');
});

test('refund orders deny direct Supabase roles', async () => {
  const flags = await db.$queryRaw<Array<{ rowsecurity: boolean; anon: boolean; authenticated: boolean }>>`SELECT c.relrowsecurity AS rowsecurity, CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN has_table_privilege('anon',c.oid,'SELECT') ELSE false END AS anon, CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN has_table_privilege('authenticated',c.oid,'SELECT') ELSE false END AS authenticated FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema} AND c.relname='RefundOrder'`;
  assert.deepEqual(flags,[{ rowsecurity: true, anon: false, authenticated: false }]);
});

test.after(async () => db.$disconnect());
