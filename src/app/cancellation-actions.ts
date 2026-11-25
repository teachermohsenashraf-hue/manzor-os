'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { confirmedOrderPaidMinor } from '@/lib/finance';
import { calculateCancellationSettlement } from '@/lib/finance-settlement';
import { runOnce, InvalidRequestId, RequestConflict } from '@/lib/idempotency';
import type { ActionState } from './actions';

class CancellationError extends Error {}
const field = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const amount = (raw: string) => /^\d{1,15}$/.test(raw) ? BigInt(raw) : null;

export async function assessCancellation(_: ActionState, form: FormData): Promise<ActionState> {
  const orderId = field(form, 'orderId');
  const values = {
    workValueMinor: amount(field(form, 'workValueMinor')),
    employeeDueMinor: amount(field(form, 'employeeDueMinor')),
    documentedCostMinor: amount(field(form, 'documentedCostMinor')),
    retainedMinor: amount(field(form, 'retainedMinor')),
    returnFeeMinor: amount(field(form, 'returnFeeMinor')),
    refundMinor: amount(field(form, 'refundMinor')),
  };
  const refs = {
    agreementRef: field(form, 'agreementRef'), workEvidenceRef: field(form, 'workEvidenceRef'),
    employeeEvidenceRef: field(form, 'employeeEvidenceRef'), costEvidenceRef: field(form, 'costEvidenceRef'),
    feeEvidenceRef: field(form, 'feeEvidenceRef'), reason: field(form, 'reason'),
  };
  if (!orderId || Object.values(values).some(value => value === null) ||
      refs.agreementRef.length < 3 || refs.workEvidenceRef.length < 3 || refs.reason.length < 10 ||
      values.employeeDueMinor! > 0n && refs.employeeEvidenceRef.length < 3 ||
      values.documentedCostMinor! > 0n && refs.costEvidenceRef.length < 3 ||
      values.returnFeeMinor! > 0n && refs.feeEvidenceRef.length < 3 ||
      Object.values(refs).some(value => value.length > 500))
    return { error: 'أكمل مبالغ التقييم ومراجع الاتفاق والعمل والالتزامات والسبب' };
  const actor = await requireUser();
  try {
    await runOnce({ requestId: field(form, 'requestId'), actorId: actor.id, action: 'CANCELLATION_ASSESS',
      payload: { orderId, values: Object.fromEntries(Object.entries(values).map(([key,value]) => [key, String(value)])), refs },
      execute: async tx => {
        if (actor.role !== 'OWNER') throw new CancellationError('المالك فقط يسجل تقييم الإلغاء');
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`CANCEL:${orderId}`},0))`;
        const order = await tx.customerOrder.findUnique({ where: { id: orderId }, include: { cancellationAssessment: true } });
        if (!order || order.status !== 'CANCELLED' || order.cancellationAssessment)
          throw new CancellationError('الطلب غير ملغى أو سبق تسجيل تقييمه');
        const paidMinor = await confirmedOrderPaidMinor(tx, orderId);
        if (paidMinor === 0n) throw new CancellationError('لا يوجد تحصيل مؤكد لهذا الطلب');
        const settlement = calculateCancellationSettlement({ paidMinor,
          workValueMinor: values.workValueMinor!, employeeDueMinor: values.employeeDueMinor!,
          documentedCostMinor: values.documentedCostMinor!, retainedMinor: values.retainedMinor!,
          returnFeeMinor: values.returnFeeMinor!, refundMinor: values.refundMinor! });
        const record = await tx.cancellationAssessment.create({ data: { orderId, currency: order.currency,
          ...settlement, ...refs, employeeEvidenceRef: refs.employeeEvidenceRef || null,
          costEvidenceRef: refs.costEvidenceRef || null, feeEvidenceRef: refs.feeEvidenceRef || null,
          assessedById: actor.id } });
        await tx.auditLog.create({ data: { actorId: actor.id, action: 'CANCELLATION_ASSESSED', subjectId: orderId,
          detail: { assessmentId: record.id, paidMinor: String(paidMinor), currency: order.currency,
            retainedMinor: String(settlement.retainedMinor), refundMinor: String(settlement.refundMinor), refs } } });
        return { id: record.id };
      } });
  } catch (error) {
    return { error: error instanceof CancellationError || error instanceof RequestConflict || error instanceof InvalidRequestId || error instanceof Error && /مبالغ التسوية|رسوم الرد|المبلغ المحتفظ/.test(error.message)
      ? error.message : 'تعذر تسجيل تقييم الإلغاء' };
  }
  revalidatePath(`/orders/${orderId}`);
  revalidatePath('/finance');
  return { success: 'حُفظ تقييم الإلغاء للمراجعة دون استرداد بنكي أو قيد أرباح' };
}
