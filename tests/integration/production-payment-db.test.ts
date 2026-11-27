import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { requireTestDatabaseUrl } from './test-db';
import { confirmedOrderPaidMinor } from '../../src/lib/finance';
import { individualPrepaymentCovered, finalPaymentCovered } from '../../src/lib/production';

const { url, schema } = requireTestDatabaseUrl();
if (schema !== 'manzoor_test' || !new URL(url).username.startsWith('manzoor_preview_app'))
  throw new Error('اختبار الدفع يتطلب الدور المحدود ومخطط manzoor_test');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }, { schema }) });
class RollbackFixture extends Error {}

test('verified 50 percent receipt starts individual work but blocks delivery until full receipt', async () => {
  const tag = randomUUID().slice(0, 8);
  await assert.rejects(db.$transaction(async tx => {
    const owner = await tx.user.create({ data: { name: 'payment test owner', username: `po_${tag}`, passwordHash: 'test', role: 'OWNER' } });
    const comm = await tx.user.create({ data: { name: 'payment test comm', username: `pc_${tag}`, passwordHash: 'test', role: 'COMMUNICATION' } });
    const exec = await tx.user.create({ data: { name: 'payment test exec', username: `pe_${tag}`, passwordHash: 'test', role: 'EXECUTION' } });
    const team = await tx.team.create({ data: { name: `payment ${tag}`, communicatorId: comm.id, executorId: exec.id } });
    const lead = await tx.lead.create({ data: { name: `payment ${tag}`, teamId: team.id, status: 'CLIENT' } });
    const client = await tx.client.create({ data: { leadId: lead.id } });
    const order = await tx.customerOrder.create({ data: { clientId: client.id, teamId: team.id, createdById: owner.id,
      approvedById: owner.id, status: 'APPROVED', marketCode: 'EG', currency: 'EGP', title: 'payment test',
      scope: 'poster', requirements: 'poster', totalMinor: 10000n, approvedAt: new Date() } });
    const cash = await tx.ledgerAccount.upsert({ where: { code_currency: { code: 'CASH', currency: 'EGP' } },
      create: { code: 'CASH', currency: 'EGP', name: 'cash' }, update: {} });
    const advance = await tx.ledgerAccount.upsert({ where: { code_currency: { code: 'CUSTOMER_ADVANCES', currency: 'EGP' } },
      create: { code: 'CUSTOMER_ADVANCES', currency: 'EGP', name: 'advances' }, update: {} });
    const addReceipt = async (number: number) => {
      const reference = `PAYMENT_TEST:${tag}:${number}`;
      const journal = await tx.journalEntry.create({ data: { currency: 'EGP', kind: 'RECEIPT', reference,
        description: 'isolated test receipt', createdById: owner.id } });
      await tx.ledgerPosting.create({ data: { journalId: journal.id, accountId: cash.id, debitMinor: 5000n } });
      await tx.ledgerPosting.create({ data: { journalId: journal.id, accountId: advance.id, creditMinor: 5000n } });
      await tx.receipt.create({ data: { orderId: order.id, grossMinor: 5000n, feeMinor: 0n, netMinor: 5000n,
        currency: 'EGP', settlementCurrency: 'EGP', settlementRef: reference, receivedAt: new Date(),
        confirmedById: owner.id, journalId: journal.id } });
    };
    assert.equal(individualPrepaymentCovered(order.totalMinor, await confirmedOrderPaidMinor(tx, order.id)), false);
    await addReceipt(1);
    let paid = await confirmedOrderPaidMinor(tx, order.id);
    assert.equal(paid, 5000n);
    assert.equal(individualPrepaymentCovered(order.totalMinor, paid), true);
    assert.equal(finalPaymentCovered(order.totalMinor, paid), false);
    await addReceipt(2);
    paid = await confirmedOrderPaidMinor(tx, order.id);
    assert.equal(paid, 10000n);
    assert.equal(finalPaymentCovered(order.totalMinor, paid), true);
    throw new RollbackFixture();
  }, { timeout: 60_000 }), RollbackFixture);
  assert.equal(await db.user.count({ where: { username: `po_${tag}` } }), 0);
});

test.after(async () => db.$disconnect());
