import type { Prisma } from '@/generated/prisma/client';
import { confirmedOrderPaidMinor } from './finance';

type Tx = Prisma.TransactionClient;
export class RefundError extends Error {}
async function lock(tx: Tx, orderId: string) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`REFUND:${orderId}`},0))`; }
async function owner(tx: Tx, actorId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorId } });
  if (!actor?.active || actor.role !== 'OWNER') throw new RefundError('المالك فقط يعتمد الاسترداد');
}

export async function approveRefundTx(tx: Tx, orderId: string, actorId: string, destinationRef: string, decisionRef: string) {
  await owner(tx,actorId);
  await lock(tx,orderId);
  const order = await tx.customerOrder.findUnique({ where: { id: orderId }, include: {
    cancellationAssessment: true, refundOrder: true, fxReceipts: true, revenueRecognitions: true } });
  const assessment = order?.cancellationAssessment;
  if (!order || order.status !== 'CANCELLED' || order.currency !== 'EGP' || order.marketCode !== 'EG' ||
      order.fxReceipts.length || !assessment || order.refundOrder || assessment.refundMinor <= 0n ||
      assessment.returnFeeMinor !== 0n)
    throw new RefundError('الاسترداد الحالي متاح للطلب المصري الملغى بالجنيه ودون رسوم رد فقط');
  const paid = await confirmedOrderPaidMinor(tx,orderId);
  const recognized = order.revenueRecognitions.reduce((sum,row) => sum+row.amountMinor,0n);
  if (assessment.paidMinor !== paid || assessment.refundMinor > paid-recognized ||
      assessment.retainedMinor < assessment.employeeDueMinor+assessment.documentedCostMinor ||
      assessment.retainedMinor > assessment.workValueMinor+assessment.employeeDueMinor+assessment.documentedCostMinor)
    throw new RefundError('تقييم الإلغاء لا يغطي الإيراد المسجل أو حقوق المنفذين والتكاليف');
  if (assessment.workValueMinor > 0n) {
    const projects = await tx.project.findMany({ where: { orderId }, include: { approvals: true, qualityReviews: true, attachments: true } });
    const accepted = projects.some(project => project.approvals.some(approval =>
      ['PREVIEW','FINAL_DELIVERY'].includes(approval.kind) && approval.deliverableId &&
      project.qualityReviews.some(review => review.deliverableId === approval.deliverableId && review.passed) &&
      project.attachments.some(file => file.deliverableId === approval.deliverableId && file.verifiedAt)));
    if (!accepted) throw new RefundError('العمل المحتفظ بقيمته يحتاج قبولًا وجودة وملفًا موثقًا');
  }
  if (assessment.employeeDueMinor > 0n) {
    const earned = await tx.employeeEarning.aggregate({ where: { orderId, kind: 'EXECUTION', status: { in: ['EARNED','PAYABLE','PAID'] } }, _sum: { amountMinor: true } });
    if ((earned._sum.amountMinor??0n) < assessment.employeeDueMinor)
      throw new RefundError('مستحقات المنفذين في التقييم لم تُعتمد كالتزام بعد');
  }
  if (assessment.documentedCostMinor > 0n) {
    const projects = await tx.project.findMany({ where: { orderId }, select: { id: true } });
    const costs = await tx.expense.aggregate({ where: { projectId: { in: projects.map(project => project.id) }, status: { in: ['APPROVED','PAID'] } }, _sum: { amountMinor: true } });
    if ((costs._sum.amountMinor??0n) < assessment.documentedCostMinor)
      throw new RefundError('التكاليف والأضرار في التقييم لم تُعتمد كمصروفات بعد');
  }
  const refund = await tx.refundOrder.create({ data: { orderId, assessmentId: assessment.id,
    amountMinor: assessment.refundMinor, currency: 'EGP', destinationRef, decisionRef, approvedById: actorId } });
  await tx.auditLog.create({ data: { actorId, action: 'REFUND_APPROVED', subjectId: refund.id,
    detail: { orderId, amountMinor: String(refund.amountMinor), destinationRef, decisionRef,
      note: 'No bank transfer or cash journal at approval' } } });
  return { id: refund.id };
}

export async function markRefundSentTx(tx: Tx, orderId: string, actorId: string, transferRef: string) {
  await owner(tx,actorId);
  await lock(tx,orderId);
  const refund = await tx.refundOrder.findUnique({ where: { orderId } });
  if (!refund || refund.status !== 'APPROVED') throw new RefundError('أمر الاسترداد غير متاح للإرسال');
  await tx.refundOrder.update({ where: { id: refund.id }, data: { status: 'EXECUTED', transferRef, executedAt: new Date() } });
  await tx.auditLog.create({ data: { actorId, action: 'REFUND_SENT', subjectId: refund.id,
    detail: { orderId, transferRef, note: 'Awaiting bank confirmation; no cash journal yet' } } });
  return { id: refund.id };
}

export async function confirmRefundTx(tx: Tx, orderId: string, actorId: string, bankConfirmationRef: string, confirmedAt: Date) {
  await owner(tx,actorId);
  await lock(tx,orderId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'CASH:EGP'},0))`;
  const refund = await tx.refundOrder.findUnique({ where: { orderId } });
  if (!refund || refund.status !== 'EXECUTED') throw new RefundError('أمر الاسترداد لم يرسل أو سبق تأكيده');
  const cash = await tx.ledgerAccount.findUnique({ where: { code_currency: { code: 'CASH', currency: 'EGP' } } });
  const advance = await tx.ledgerAccount.findUnique({ where: { code_currency: { code: 'CUSTOMER_ADVANCES', currency: 'EGP' } } });
  if (!cash || !advance) throw new RefundError('حسابا النقدية ودفعات العملاء غير موجودين');
  const cashTotal = await tx.ledgerPosting.aggregate({ where: { accountId: cash.id }, _sum: { debitMinor: true, creditMinor: true } });
  const advanceTotal = await tx.ledgerPosting.aggregate({ where: { accountId: advance.id }, _sum: { debitMinor: true, creditMinor: true } });
  const cashBalance = (cashTotal._sum.debitMinor??0n)-(cashTotal._sum.creditMinor??0n);
  const advanceBalance = (advanceTotal._sum.creditMinor??0n)-(advanceTotal._sum.debitMinor??0n);
  if (cashBalance < refund.amountMinor || advanceBalance < refund.amountMinor)
    throw new RefundError('النقدية أو رصيد دفعات العملاء لا يغطيان الاسترداد');
  const protectedAccounts = await tx.ledgerAccount.findMany({ where: { currency: 'EGP', code: { in: ['EARNINGS_PAYABLE','ACCOUNTS_PAYABLE','DEVELOPMENT_RESERVE','DEVELOPMENT_CASH'] } }, select: { id: true, code: true } });
  const protectedTotals = protectedAccounts.length ? await tx.ledgerPosting.groupBy({ by: ['accountId'], where: { accountId: { in: protectedAccounts.map(row => row.id) } }, _sum: { debitMinor: true, creditMinor: true } }) : [];
  const balance = (code: string, creditSide: boolean) => { const id = protectedAccounts.find(row => row.code === code)?.id;
    const sum = protectedTotals.find(row => row.accountId === id)?._sum;
    return creditSide ? (sum?.creditMinor??0n)-(sum?.debitMinor??0n) : (sum?.debitMinor??0n)-(sum?.creditMinor??0n); };
  const positive = (value: bigint) => value > 0n ? value : 0n;
  const developmentUnfunded = balance('DEVELOPMENT_RESERVE',true)-balance('DEVELOPMENT_CASH',false);
  const protectedBalance = advanceBalance-refund.amountMinor+positive(balance('EARNINGS_PAYABLE',true))+
    positive(balance('ACCOUNTS_PAYABLE',true))+positive(developmentUnfunded);
  if (cashBalance-refund.amountMinor < protectedBalance)
    throw new RefundError('النقدية بعد الرد لا تغطي دفعات العملاء والالتزامات والمخصصات غير الممولة');
  const journal = await tx.journalEntry.create({ data: { currency: 'EGP', kind: 'CLIENT_REFUND',
    reference: `REFUND:${refund.id}`, description: `رد عميل مؤكد ${bankConfirmationRef}`, createdById: actorId } });
  await tx.ledgerPosting.create({ data: { journalId: journal.id, accountId: advance.id, debitMinor: refund.amountMinor } });
  await tx.ledgerPosting.create({ data: { journalId: journal.id, accountId: cash.id, creditMinor: refund.amountMinor } });
  await tx.refundOrder.update({ where: { id: refund.id }, data: {
    status: 'CONFIRMED', bankConfirmationRef, confirmedAt, journalId: journal.id } });
  await tx.auditLog.create({ data: { actorId, action: 'REFUND_CONFIRMED', subjectId: refund.id,
    detail: { orderId, amountMinor: String(refund.amountMinor), transferRef: refund.transferRef,
      bankConfirmationRef, confirmedAt: confirmedAt.toISOString(), journalId: journal.id } } });
  return { id: refund.id };
}
