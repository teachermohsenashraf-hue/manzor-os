import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const url = process.env.TEST_DATABASE_URL;
if (url && (!/test/i.test(new URL(url).pathname) || process.env.DATABASE_URL && process.env.DATABASE_URL !== url)) throw new Error('استخدم قاعدة اختبار منفصلة باسم يحتوي test واجعل DATABASE_URL مساويًا لها');
if (!url) {
  test('finance PostgreSQL integration requires TEST_DATABASE_URL', { skip: true }, () => {});
} else {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
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
    const flags = await db.$queryRaw<Array<{ relname: string; relrowsecurity: boolean }>>`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('FxReceipt','EmployeeEarning','EmployeePayout','PayoutLine','DevelopmentAllocation','Expense')`;
    assert.deepEqual(flags.map(row => row.relname).sort(), [...tables].sort());
    assert.ok(flags.every(row => row.relrowsecurity));
    const grants = await db.$queryRaw<Array<{ name: string; anon: boolean; authenticated: boolean }>>`SELECT c.relname AS name, CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN has_table_privilege('anon', c.oid, 'SELECT') ELSE false END AS anon, CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN has_table_privilege('authenticated', c.oid, 'SELECT') ELSE false END AS authenticated FROM pg_class c WHERE c.relname IN ('FxReceipt','EmployeeEarning','EmployeePayout','PayoutLine','DevelopmentAllocation','Expense')`;
    assert.ok(grants.every(row => !row.anon && !row.authenticated));
  });

  test.after(async () => db.$disconnect());
}
