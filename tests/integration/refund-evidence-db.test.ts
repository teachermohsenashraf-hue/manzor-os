import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { requireTestDatabaseUrl } from './test-db';
import { approveRefundTx } from '../../src/lib/refund-workflow';

const { url, schema } = requireTestDatabaseUrl();
if (schema !== 'manzoor_test' || !new URL(url).username.startsWith('manzoor_preview_app'))
  throw new Error('اختبار دليل الإلغاء يتطلب الدور المحدود ومخطط manzoor_test');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }, { schema }) });
class RollbackFixture extends Error {}

test('cancellation accepts documented local preview without uploaded production file', async () => {
  const tag = randomUUID().slice(0, 8), now = new Date();
  await assert.rejects(db.$transaction(async tx => {
    const owner = await tx.user.create({ data: { name: 'refund evidence owner', username: `eo_${tag}`, passwordHash: 'test', role: 'OWNER' } });
    const comm = await tx.user.create({ data: { name: 'refund evidence comm', username: `ec_${tag}`, passwordHash: 'test', role: 'COMMUNICATION' } });
    const executor = await tx.user.create({ data: { name: 'refund evidence executor', username: `ee_${tag}`, passwordHash: 'test', role: 'EXECUTION' } });
    const team = await tx.team.create({ data: { name: `refund evidence ${tag}`, communicatorId: comm.id, executorId: executor.id } });
    const lead = await tx.lead.create({ data: { name: `refund evidence ${tag}`, teamId: team.id, status: 'CLIENT' } });
    const client = await tx.client.create({ data: { leadId: lead.id } });
    const order = await tx.customerOrder.create({ data: { clientId: client.id, teamId: team.id, createdById: owner.id,
      status: 'CANCELLED', marketCode: 'EG', currency: 'EGP', title: 'refund evidence',
      scope: 'poster', requirements: 'poster', totalMinor: 10000n } });
    const cash = await tx.ledgerAccount.upsert({ where: { code_currency: { code: 'CASH', currency: 'EGP' } },
      create: { code: 'CASH', currency: 'EGP', name: 'cash' }, update: {} });
    const advance = await tx.ledgerAccount.upsert({ where: { code_currency: { code: 'CUSTOMER_ADVANCES', currency: 'EGP' } },
      create: { code: 'CUSTOMER_ADVANCES', currency: 'EGP', name: 'advances' }, update: {} });
    const reference = `REFUND_EVIDENCE:${tag}`;
    const journal = await tx.journalEntry.create({ data: { currency: 'EGP', kind: 'RECEIPT', reference,
      description: 'isolated test receipt', createdById: owner.id } });
    await tx.ledgerPosting.create({ data: { journalId: journal.id, accountId: cash.id, debitMinor: 10000n } });
    await tx.ledgerPosting.create({ data: { journalId: journal.id, accountId: advance.id, creditMinor: 10000n } });
    await tx.receipt.create({ data: { orderId: order.id, grossMinor: 10000n, feeMinor: 0n, netMinor: 10000n,
      currency: 'EGP', settlementCurrency: 'EGP', settlementRef: reference,
      receivedAt: now, confirmedById: owner.id, journalId: journal.id } });
    const project = await tx.project.create({ data: { clientId: client.id, teamId: team.id, executorId: executor.id,
      createdById: owner.id, title: 'local accepted preview', serviceType: 'POSTER', brief: 'poster',
      requirements: 'poster', orderId: order.id, stage: 'CLIENT_PREVIEW', productionStartedAt: now, cancelledAt: now } });
    const output = await tx.deliverable.create({ data: { projectId: project.id, version: 1, title: 'local preview', submittedById: executor.id } });
    await tx.qualityReview.create({ data: { projectId: project.id, deliverableId: output.id, reviewerId: owner.id, checklist: ['poster'], passed: true } });
    await tx.approval.create({ data: { projectId: project.id, kind: 'PREVIEW', deliverableId: output.id, approvedById: comm.id, approvedAt: now } });
    for (const [kind, actorId] of [['OwnerPreviewApproved', owner.id], ['ProtectedPreviewSentToClient', comm.id]])
      await tx.productionEvent.create({ data: { projectId: project.id, kind, actorId, detail: { deliverableId: output.id, simulated: true } } });
    await tx.cancellationAssessment.create({ data: { orderId: order.id, currency: 'EGP', paidMinor: 10000n,
      workValueMinor: 4000n, employeeDueMinor: 0n, documentedCostMinor: 0n, retainedMinor: 4000n,
      returnFeeMinor: 0n, refundMinor: 6000n, agreementRef: 'test agreement', workEvidenceRef: 'test preview',
      reason: 'isolated cancellation evidence test', assessedById: owner.id } });
    const approved = await approveRefundTx(tx, order.id, owner.id, 'test destination', 'test owner decision');
    assert.equal((await tx.refundOrder.findUniqueOrThrow({ where: { id: approved.id } })).status, 'APPROVED');
    assert.equal(await tx.attachment.count({ where: { projectId: project.id } }), 0);
    throw new RollbackFixture();
  }, { timeout: 60_000 }), RollbackFixture);
  assert.equal(await db.user.count({ where: { username: `eo_${tag}` } }), 0);
});

test.after(async () => db.$disconnect());
