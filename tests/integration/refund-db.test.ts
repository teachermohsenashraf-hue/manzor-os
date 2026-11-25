import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { requireTestDatabaseUrl } from './test-db';
import { approveRefundTx, markRefundSentTx, confirmRefundTx, RefundError } from '../../src/lib/refund-workflow';

const { url, schema } = requireTestDatabaseUrl();
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }, { schema }) });

test('EGP refund requires owner approval and bank confirmation before the cash journal', async () => {
  const tag = randomUUID().slice(0, 8), now = new Date();
  const fixture = await db.$transaction(async tx => {
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
  }, { timeout: 30_000 });
  await assert.rejects(db.$transaction(tx => approveRefundTx(tx,fixture.orderId,fixture.commId,'client destination','owner decision')), RefundError);
  const approved = await db.$transaction(tx => approveRefundTx(tx,fixture.orderId,fixture.ownerId,'client destination','owner decision'));
  assert.equal(await db.journalEntry.count({ where: { kind: 'CLIENT_REFUND', reference: `REFUND:${approved.id}` } }), 0);
  await assert.rejects(db.$transaction(tx => approveRefundTx(tx,fixture.orderId,fixture.ownerId,'client destination','second decision')), RefundError);
  await db.$transaction(tx => markRefundSentTx(tx,fixture.orderId,fixture.ownerId,`TRANSFER:${tag}`));
  assert.equal(await db.journalEntry.count({ where: { kind: 'CLIENT_REFUND', reference: `REFUND:${approved.id}` } }), 0);
  await assert.rejects(db.$transaction(async tx => {
    const advance = await tx.ledgerAccount.findUniqueOrThrow({ where: { code_currency: { code: 'CUSTOMER_ADVANCES', currency: 'EGP' } } });
    const asset = await tx.ledgerAccount.upsert({ where: { code_currency: { code: `TEST_ASSET_${tag}`, currency: 'EGP' } },
      create: { code: `TEST_ASSET_${tag}`, currency: 'EGP', name: 'isolated test asset' }, update: {} });
    const journal = await tx.journalEntry.create({ data: { currency: 'EGP', kind: 'TEST', reference: `REFUND_HOLD:${tag}`,
      description: 'temporary extra liability', createdById: fixture.ownerId } });
    await tx.ledgerPosting.create({ data: { journalId: journal.id, accountId: asset.id, debitMinor: 1_000_000_000_000n } });
    await tx.ledgerPosting.create({ data: { journalId: journal.id, accountId: advance.id, creditMinor: 1_000_000_000_000n } });
    await confirmRefundTx(tx,fixture.orderId,fixture.ownerId,`BANK_BLOCKED:${tag}`,new Date());
  }), RefundError);
  await db.$transaction(tx => confirmRefundTx(tx,fixture.orderId,fixture.ownerId,`BANK:${tag}`,new Date()));
  const confirmed = await db.refundOrder.findUniqueOrThrow({ where: { id: approved.id }, include: { journal: { include: { postings: true } } } });
  assert.equal(confirmed.status,'CONFIRMED');
  assert.equal(confirmed.journal?.postings.reduce((sum,row) => sum+row.debitMinor-row.creditMinor,0n),0n);
  assert.equal(await db.journalEntry.count({ where: { kind: 'CLIENT_REFUND', reference: `REFUND:${approved.id}` } }), 1);
  await assert.rejects(db.$transaction(tx => confirmRefundTx(tx,fixture.orderId,fixture.ownerId,`BANK2:${tag}`,new Date())), RefundError);
  await assert.rejects(db.refundOrder.update({ where: { id: approved.id }, data: { status: 'APPROVED' } }));
});

test('refund orders deny direct Supabase roles', async () => {
  const flags = await db.$queryRaw<Array<{ rowsecurity: boolean; anon: boolean; authenticated: boolean }>>`SELECT c.relrowsecurity AS rowsecurity, CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN has_table_privilege('anon',c.oid,'SELECT') ELSE false END AS anon, CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN has_table_privilege('authenticated',c.oid,'SELECT') ELSE false END AS authenticated FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema} AND c.relname='RefundOrder'`;
  assert.deepEqual(flags,[{ rowsecurity: true, anon: false, authenticated: false }]);
});

test.after(async () => db.$disconnect());
