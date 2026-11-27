import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { requireTestDatabaseUrl } from './test-db';
import { recognizeIndividualRevenue, RevenueRecognitionError } from '../../src/lib/revenue-recognition';

const { url, schema } = requireTestDatabaseUrl();
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }, { schema }) });

test('individual revenue needs accepted delivery and collection, then posts once', async () => {
  const tag = randomUUID().slice(0, 8), now = new Date();
  const result = await db.$transaction(async tx => {
    const owner = await tx.user.create({ data: { name: 'revenue owner', username: `ro_${tag}`, passwordHash: 'test', role: 'OWNER' } });
    const comm = await tx.user.create({ data: { name: 'revenue communicator', username: `rc_${tag}`, passwordHash: 'test', role: 'COMMUNICATION' } });
    const executor = await tx.user.create({ data: { name: 'revenue executor', username: `re_${tag}`, passwordHash: 'test', role: 'EXECUTION' } });
    const team = await tx.team.create({ data: { name: `revenue ${tag}`, communicatorId: comm.id, executorId: executor.id } });
    const lead = await tx.lead.create({ data: { name: `revenue ${tag}`, teamId: team.id, status: 'CLIENT' } });
    const client = await tx.client.create({ data: { leadId: lead.id } });
    const service = await tx.service.create({ data: { code: `REV_${tag}`, name: 'Test poster', kind: 'SINGLE', productionType: 'POSTER', active: true } });
    const price = await tx.priceVersion.create({ data: { serviceId: service.id, marketCode: 'EG', currency: 'EGP', amountMinor: 10000n, effectiveFrom: now, createdById: owner.id } });
    const order = await tx.customerOrder.create({ data: { clientId: client.id, teamId: team.id, createdById: owner.id, approvedById: owner.id,
      status: 'APPROVED', marketCode: 'EG', currency: 'EGP', title: 'revenue test', scope: 'poster', requirements: 'poster',
      totalMinor: 10000n, approvedAt: now } });
    const item = await tx.orderItem.create({ data: { orderId: order.id, serviceId: service.id, priceVersionId: price.id,
      serviceNameSnapshot: service.name, serviceKindSnapshot: 'SINGLE', productionTypeSnapshot: 'POSTER',
      componentSnapshot: [], quantity: 1, assignedQuantity: 1, unitMinor: 10000n, currency: 'EGP', scope: 'poster' } });
    const project = await tx.project.create({ data: { clientId: client.id, teamId: team.id, executorId: executor.id,
      createdById: owner.id, title: 'revenue project', serviceType: 'POSTER', brief: 'poster', requirements: 'poster',
      orderId: order.id, orderItemId: item.id, stage: 'IN_PROGRESS' } });
    await assert.rejects(recognizeIndividualRevenue(tx, project.id, owner.id, 'test-approval'), RevenueRecognitionError);
    await tx.project.update({ where: { id: project.id }, data: { stage: 'COMPLETED', completedAt: now, deliveredAt: now } });
    const deliverable = await tx.deliverable.create({ data: { projectId: project.id, version: 1, title: 'poster final', submittedById: executor.id, deliveredAt: now } });
    await tx.qualityReview.create({ data: { projectId: project.id, deliverableId: deliverable.id, reviewerId: owner.id, checklist: ['poster'], passed: true } });
    await tx.approval.create({ data: { projectId: project.id, kind: 'PREVIEW', deliverableId: deliverable.id, approvedById: comm.id, approvedAt: now } });
    await tx.approval.create({ data: { projectId: project.id, kind: 'FINAL_DELIVERY', deliverableId: deliverable.id, approvedById: comm.id, approvedAt: now } });
    for (const [kind, actorId] of [
      ['OwnerPreviewApproved', owner.id], ['ProtectedPreviewSentToClient', comm.id],
      ['FinalSentToClient', comm.id], ['ClientReceiptConfirmed', comm.id],
    ]) await tx.productionEvent.create({ data: { projectId: project.id, kind, actorId, detail: { deliverableId: deliverable.id, simulated: true } } });
    await assert.rejects(recognizeIndividualRevenue(tx, project.id, owner.id, 'test-approval'), RevenueRecognitionError);
    const cash = await tx.ledgerAccount.upsert({ where: { code_currency: { code: 'CASH', currency: 'EGP' } },
      create: { code: 'CASH', currency: 'EGP', name: 'cash' }, update: {} });
    const advance = await tx.ledgerAccount.upsert({ where: { code_currency: { code: 'CUSTOMER_ADVANCES', currency: 'EGP' } },
      create: { code: 'CUSTOMER_ADVANCES', currency: 'EGP', name: 'advances' }, update: {} });
    const receiptJournal = await tx.journalEntry.create({ data: { currency: 'EGP', kind: 'RECEIPT',
      reference: `REV_RECEIPT:${tag}`, description: 'test receipt', createdById: owner.id } });
    await tx.ledgerPosting.create({ data: { journalId: receiptJournal.id, accountId: cash.id, debitMinor: 10000n } });
    await tx.ledgerPosting.create({ data: { journalId: receiptJournal.id, accountId: advance.id, creditMinor: 10000n } });
    await tx.receipt.create({ data: { orderId: order.id, grossMinor: 10000n, feeMinor: 0n, netMinor: 10000n,
      currency: 'EGP', settlementCurrency: 'EGP', settlementRef: `REV_RECEIPT:${tag}`,
      receivedAt: now, confirmedById: owner.id, journalId: receiptJournal.id } });
    const recognized = await recognizeIndividualRevenue(tx, project.id, owner.id, 'test-approval');
    return { ...recognized, projectId: project.id, ownerId: owner.id, commId: comm.id };
  }, { timeout: 30_000 });
  const record = await db.revenueRecognition.findUniqueOrThrow({ where: { id: result.id }, include: { journal: { include: { postings: true } } } });
  assert.equal(record.amountMinor, 10000n);
  assert.equal(record.journal.postings.reduce((sum,row) => sum + row.debitMinor - row.creditMinor, 0n), 0n);
  await assert.rejects(db.$transaction(tx => recognizeIndividualRevenue(tx, result.projectId, result.ownerId, 'test-approval')), RevenueRecognitionError);
  await assert.rejects(db.$transaction(tx => recognizeIndividualRevenue(tx, result.projectId, result.commId, 'test-approval')), RevenueRecognitionError);
  assert.equal(await db.revenueRecognition.count({ where: { projectId: result.projectId } }), 1);
});

test.after(async () => db.$disconnect());
