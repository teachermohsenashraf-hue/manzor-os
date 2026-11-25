import type { Prisma } from '@/generated/prisma/client';
import { confirmedOrderPaidMinor } from './finance';

type Tx = Prisma.TransactionClient;
export class RevenueRecognitionError extends Error {}

export async function recognizeIndividualRevenue(tx: Tx, projectId: string, actorId: string, basisRef: string) {
  if (basisRef.length < 3 || basisRef.length > 500) throw new RevenueRecognitionError('مرجع اعتماد الإيراد غير صالح');
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { orderId: true } });
  if (!project?.orderId) throw new RevenueRecognitionError('المشروع غير مرتبط بطلب مالي');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`REVENUE:${project.orderId}`}, 0))`;
  const actor = await tx.user.findUnique({ where: { id: actorId } });
  if (!actor?.active || actor.role !== 'OWNER') throw new RevenueRecognitionError('المالك فقط يعتمد الاعتراف بالإيراد');
  const rule = await tx.financialRule.findUnique({ where: { code_version: { code: 'INDIVIDUAL_REVENUE_RECOGNITION', version: 1 } } });
  if (rule?.status !== 'APPROVED') throw new RevenueRecognitionError('سياسة إيراد الخدمات الفردية لم تُعتمد');
  const order = await tx.customerOrder.findUnique({ where: { id: project.orderId }, include: {
    items: true, changes: { where: { status: 'APPROVED' } }, revenueRecognitions: true,
    projects: { where: { id: projectId }, include: { deliverables: true, approvals: true, qualityReviews: true, attachments: true } },
  } });
  if (!order || order.status !== 'APPROVED' || order.totalMinor <= 0n || order.changes.length)
    throw new RevenueRecognitionError('الطلب غير معتمد أو تغير نطاقه ويحتاج تسوية منفصلة');
  const work = order.projects[0], item = order.items.find(row => row.id === work?.orderItemId);
  if (!work || !item || item.serviceKindSnapshot === 'SUBSCRIPTION' || !work.orderItemId ||
      work.cancelledAt || work.stage !== 'COMPLETED' || !work.completedAt || !work.deliveredAt || item.unitMinor <= 0n)
    throw new RevenueRecognitionError('العمل الفردي لم يكتمل تسليمه أو يحتاج تسوية إلغاء');
  if (order.revenueRecognitions.some(row => row.projectId === projectId))
    throw new RevenueRecognitionError('سبق الاعتراف بإيراد هذا العمل');
  const latest = [...work.deliverables].sort((a,b) => b.version-a.version)[0];
  const approval = work.approvals.filter(row => row.kind === 'FINAL_DELIVERY' && row.deliverableId === latest?.id)
    .sort((a,b) => b.approvedAt.getTime()-a.approvedAt.getTime())[0];
  const quality = work.qualityReviews.filter(row => row.deliverableId === latest?.id)
    .sort((a,b) => b.createdAt.getTime()-a.createdAt.getTime())[0];
  if (!latest?.deliveredAt || !approval || !quality?.passed ||
      !work.attachments.some(file => file.kind === 'FINAL' && file.deliverableId === latest.id && file.verifiedAt))
    throw new RevenueRecognitionError('اعتماد التسليم والجودة والملف النهائي الموثق مطلوبة');
  const recognizedMinor = order.revenueRecognitions.reduce((sum,row) => sum+row.amountMinor,0n);
  const paidMinor = await confirmedOrderPaidMinor(tx, order.id);
  if (recognizedMinor + item.unitMinor > paidMinor || recognizedMinor + item.unitMinor > order.totalMinor)
    throw new RevenueRecognitionError('التحصيل المؤكد لا يغطي قيمة هذا العمل بعد الإيرادات المعتمدة');
  const advance = await tx.ledgerAccount.upsert({ where: { code_currency: { code: 'CUSTOMER_ADVANCES', currency: order.currency } },
    create: { code: 'CUSTOMER_ADVANCES', currency: order.currency, name: 'دفعات عملاء بانتظار الاعتراف' }, update: {} });
  const revenue = await tx.ledgerAccount.upsert({ where: { code_currency: { code: 'SERVICE_REVENUE', currency: order.currency } },
    create: { code: 'SERVICE_REVENUE', currency: order.currency, name: 'إيراد خدمات مكتسب' }, update: {} });
  const journal = await tx.journalEntry.create({ data: { currency: order.currency, kind: 'REVENUE_RECOGNITION',
    reference: `REVENUE:${projectId}`, description: `إيراد عمل مقبول بموجب ${basisRef}`, createdById: actorId } });
  await tx.ledgerPosting.create({ data: { journalId: journal.id, accountId: advance.id, debitMinor: item.unitMinor } });
  await tx.ledgerPosting.create({ data: { journalId: journal.id, accountId: revenue.id, creditMinor: item.unitMinor } });
  const record = await tx.revenueRecognition.create({ data: { orderId: order.id, projectId, currency: order.currency,
    amountMinor: item.unitMinor, basisRef, evidence: { approvalId: approval.id, deliverableId: latest.id,
      qualityReviewId: quality.id, paidMinor: String(paidMinor), ruleVersion: 1 },
    recognizedAt: new Date(), approvedById: actorId, journalId: journal.id } });
  await tx.auditLog.create({ data: { actorId, action: 'INDIVIDUAL_REVENUE_RECOGNIZED', subjectId: projectId,
    detail: { recognitionId: record.id, journalId: journal.id, orderId: order.id,
      amountMinor: String(item.unitMinor), currency: order.currency, basisRef } } });
  return { id: record.id };
}
