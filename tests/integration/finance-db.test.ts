import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { requireTestDatabaseUrl } from './test-db';
import { recognizeIndividualRevenue, RevenueRecognitionError } from '../../src/lib/revenue-recognition';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  test('finance PostgreSQL integration requires TEST_DATABASE_URL', { skip: true }, () => {});
} else {
  const {url: testUrl, schema}=requireTestDatabaseUrl();
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: testUrl }, {schema}) });
  test('a balanced receipt journal commits and posted rows cannot be edited', async () => {
    const marker = randomUUID();
    const cash = await db.ledgerAccount.upsert({ where: { code_currency: { code: 'TEST_CASH', currency: 'EGP' } }, create: { code: 'TEST_CASH', currency: 'EGP', name: 'test cash' }, update: {} });
    const advance = await db.ledgerAccount.upsert({ where: { code_currency: { code: 'TEST_ADVANCE', currency: 'EGP' } }, create: { code: 'TEST_ADVANCE', currency: 'EGP', name: 'test advance' }, update: {} });
    const journal = await db.$transaction(async tx => {
      const entry = await tx.journalEntry.create({ data: { currency: 'EGP', kind: 'TEST', reference: `TEST:${marker}`, description: 'balanced test', createdById: 'integration-test' } });
      await tx.ledgerPosting.create({ data: { journalId: entry.id, accountId: cash.id, debitMinor: 100n } });
      await tx.ledgerPosting.create({ data: { journalId: entry.id, accountId: advance.id, creditMinor: 100n } });
      return entry;
    });
    await assert.rejects(db.journalEntry.update({ where: { id: journal.id }, data: { description: 'changed' } }));
    await assert.rejects(db.ledgerPosting.deleteMany({ where: { journalId: journal.id } }));
  });

  test('database rejects an unbalanced journal at transaction commit', async () => {
    const account = await db.ledgerAccount.findUniqueOrThrow({ where: { code_currency: { code: 'TEST_CASH', currency: 'EGP' } } });
    await assert.rejects(db.$transaction(async tx => {
      const journal = await tx.journalEntry.create({ data: { currency: 'EGP', kind: 'TEST', reference: `TEST:${randomUUID()}`, description: 'unbalanced test', createdById: 'integration-test' } });
      await tx.ledgerPosting.create({ data: { journalId: journal.id, accountId: account.id, debitMinor: 100n } });
    }));
  });

  test('database rejects a posting in a different currency', async () => {
    const sar = await db.ledgerAccount.upsert({ where: { code_currency: { code: 'TEST_SAR', currency: 'SAR' } }, create: { code: 'TEST_SAR', currency: 'SAR', name: 'test SAR' }, update: {} });
    await assert.rejects(db.$transaction(async tx => {
      const journal = await tx.journalEntry.create({ data: { currency: 'EGP', kind: 'TEST', reference: `TEST:${randomUUID()}`, description: 'currency test', createdById: 'integration-test' } });
      await tx.ledgerPosting.create({ data: { journalId: journal.id, accountId: sar.id, debitMinor: 100n } });
    }));
  });

  test('finance tables use RLS and deny direct Supabase roles when present', async () => {
    const tables = ['FxReceipt','EmployeeEarning','EmployeePayout','PayoutLine','DevelopmentAllocation','Expense'];
    const flags = await db.$queryRaw<Array<{ relname: string; relrowsecurity: boolean }>>`SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema} AND c.relname IN ('FxReceipt','EmployeeEarning','EmployeePayout','PayoutLine','DevelopmentAllocation','Expense')`;
    assert.deepEqual(flags.map(row => row.relname).sort(), [...tables].sort());
    assert.ok(flags.every(row => row.relrowsecurity));
    const grants = await db.$queryRaw<Array<{ name: string; anon: boolean; authenticated: boolean }>>`SELECT c.relname AS name, CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN has_table_privilege('anon', c.oid, 'SELECT') ELSE false END AS anon, CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN has_table_privilege('authenticated', c.oid, 'SELECT') ELSE false END AS authenticated FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema} AND c.relname IN ('FxReceipt','EmployeeEarning','EmployeePayout','PayoutLine','DevelopmentAllocation','Expense')`;
    assert.ok(grants.every(row => !row.anon && !row.authenticated));
  });

  test('unsettled closing policies remain explicitly pending', async () => {
    const rules = await db.financialRule.findMany({ where: { code: { in: ['REVENUE_RECOGNITION','FX_CLEARING','REFUND_SETTLEMENT','PROFIT_DISTRIBUTION'] }, version: 1 } });
    assert.equal(rules.length,4);
    assert.ok(rules.every(rule => rule.status === 'PENDING' && !rule.approvedById));
  });

  test('subscription revenue policy remains pending and recognition records stay private', async () => {
    const rule = await db.financialRule.findUniqueOrThrow({ where: { code_version: { code: 'REVENUE_RECOGNITION', version: 2 } } });
    assert.equal(rule.status, 'PENDING');
    const allocation = await db.financialRule.findUniqueOrThrow({ where: { code_version: { code: 'SUBSCRIPTION_REVENUE_ALLOCATION', version: 1 } } });
    assert.equal(allocation.status, 'PENDING');
    const tables = await db.$queryRaw<Array<{ rowsecurity: boolean; anon: boolean; authenticated: boolean }>>`SELECT c.relrowsecurity AS rowsecurity, CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN has_table_privilege('anon',c.oid,'SELECT') ELSE false END AS anon, CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN has_table_privilege('authenticated',c.oid,'SELECT') ELSE false END AS authenticated FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema} AND c.relname='RevenueRecognition'`;
    assert.deepEqual(tables, [{ rowsecurity: true, anon: false, authenticated: false }]);
    const marker = randomUUID().slice(0, 8);
    const owner = await db.user.create({ data: { name: 'revenue policy test', username: `rev_${marker}`, passwordHash: 'test', role: 'OWNER' } });
    try {
      const before = await db.journalEntry.count({ where: { kind: 'REVENUE_RECOGNITION' } });
      await assert.rejects(db.$transaction(tx => recognizeIndividualRevenue(tx, randomUUID(), owner.id, 'policy test')), RevenueRecognitionError);
      assert.equal(await db.journalEntry.count({ where: { kind: 'REVENUE_RECOGNITION' } }), before);
    } finally {
      await db.user.delete({ where: { id: owner.id } });
    }
  });

  test('one expense proof cannot be accrued twice across studio categories', async () => {
    const proof = `TEST-INVOICE-${randomUUID()}`;
    await assert.rejects(db.$transaction(async tx => {
      await tx.expense.create({ data: { category: 'GENERAL', description: 'shared invoice', amountMinor: 100n,
        currency: 'EGP', proofRef: proof, createdById: 'integration-test' } });
      await tx.expense.create({ data: { category: 'SOFTWARE', description: 'same invoice duplicate', amountMinor: 100n,
        currency: 'EGP', proofRef: proof.toLowerCase(), createdById: 'integration-test' } });
    }));
    assert.equal(await db.expense.count({ where: { proofRef: proof } }), 0);
  });

  test('cancellation assessments are private, unique and balanced by database constraints', async () => {
    const table = await db.$queryRaw<Array<{ rowsecurity: boolean; anon: boolean; authenticated: boolean }>>`SELECT c.relrowsecurity AS rowsecurity, CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN has_table_privilege('anon',c.oid,'SELECT') ELSE false END AS anon, CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN has_table_privilege('authenticated',c.oid,'SELECT') ELSE false END AS authenticated FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema} AND c.relname='CancellationAssessment'`;
    assert.deepEqual(table, [{ rowsecurity: true, anon: false, authenticated: false }]);
    const constraints = await db.$queryRaw<Array<{ conname: string }>>`SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=${schema} AND conname IN ('CancellationAssessment_amounts','CancellationAssessment_orderId_fkey')`;
    assert.deepEqual(constraints.map(row => row.conname).sort(), ['CancellationAssessment_amounts','CancellationAssessment_orderId_fkey']);
    const indexes = await db.$queryRaw<Array<{ indexname: string }>>`SELECT indexname FROM pg_indexes WHERE schemaname=${schema} AND indexname='CancellationAssessment_orderId_key'`;
    assert.equal(indexes.length, 1);
  });

  test('database rejects a cancellation assessment whose retention and refund exceed collection', async () => {
    const tag = randomUUID().slice(0, 8);
    await assert.rejects(db.$transaction(async tx => {
      const owner = await tx.user.create({ data: { name: 'assessment owner', username: `ao_${tag}`, passwordHash: 'test', role: 'OWNER' } });
      const comm = await tx.user.create({ data: { name: 'assessment communicator', username: `ac_${tag}`, passwordHash: 'test', role: 'COMMUNICATION' } });
      const executor = await tx.user.create({ data: { name: 'assessment executor', username: `ae_${tag}`, passwordHash: 'test', role: 'EXECUTION' } });
      const team = await tx.team.create({ data: { name: `assessment ${tag}`, communicatorId: comm.id, executorId: executor.id } });
      const lead = await tx.lead.create({ data: { name: `assessment ${tag}`, teamId: team.id, status: 'CLIENT' } });
      const client = await tx.client.create({ data: { leadId: lead.id } });
      const order = await tx.customerOrder.create({ data: { clientId: client.id, teamId: team.id, createdById: owner.id,
        status: 'CANCELLED', marketCode: 'EG', currency: 'EGP', title: 'assessment test', scope: 'test', requirements: 'test' } });
      await tx.cancellationAssessment.create({ data: { orderId: order.id, currency: 'EGP', paidMinor: 100n,
        workValueMinor: 20n, employeeDueMinor: 10n, documentedCostMinor: 0n, retainedMinor: 80n,
        returnFeeMinor: 0n, refundMinor: 30n, agreementRef: 'contract-test', workEvidenceRef: 'work-test',
        reason: 'constraint test', assessedById: owner.id } });
    }), /CancellationAssessment_amounts/);
  });

  test.after(async () => db.$disconnect());
}
