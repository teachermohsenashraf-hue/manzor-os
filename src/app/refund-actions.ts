'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { runOnce, RequestConflict, InvalidRequestId } from '@/lib/idempotency';
import { approveRefundTx, markRefundSentTx, confirmRefundTx, RefundError } from '@/lib/refund-workflow';
import type { ActionState } from './actions';

const field = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const fail = (error: unknown): ActionState => ({ error: error instanceof RefundError || error instanceof RequestConflict || error instanceof InvalidRequestId
  ? error.message : 'تعذر حفظ عملية الاسترداد' });
const refresh = (orderId: string) => { revalidatePath(`/orders/${orderId}`); revalidatePath('/finance'); };

export async function approveRefund(_: ActionState, form: FormData): Promise<ActionState> {
  const orderId = field(form,'orderId'), destinationRef = field(form,'destinationRef'), decisionRef = field(form,'decisionRef');
  if (!orderId || destinationRef.length < 3 || destinationRef.length > 500 || decisionRef.length < 3 || decisionRef.length > 500)
    return { error: 'أدخل وجهة الرد ومرجع قرار المالك' };
  const actor = await requireUser();
  try {
    await runOnce({ requestId: field(form,'requestId'), actorId: actor.id, action: 'REFUND_APPROVE',
      payload: { orderId, destinationRef, decisionRef },
      execute: tx => approveRefundTx(tx,orderId,actor.id,destinationRef,decisionRef) });
  } catch (error) { return fail(error); }
  refresh(orderId);
  return { success: 'اعتُمد أمر الاسترداد دون تنفيذ تحويل أو خصم نقدية' };
}

export async function markRefundSent(_: ActionState, form: FormData): Promise<ActionState> {
  const orderId = field(form,'orderId'), transferRef = field(form,'transferRef');
  if (!orderId || transferRef.length < 3 || transferRef.length > 500) return { error: 'أدخل مرجع التحويل البنكي المرسل' };
  const actor = await requireUser();
  try {
    await runOnce({ requestId: field(form,'requestId'), actorId: actor.id, action: 'REFUND_MARK_SENT',
      payload: { orderId, transferRef }, execute: tx => markRefundSentTx(tx,orderId,actor.id,transferRef) });
  } catch (error) { return fail(error); }
  refresh(orderId);
  return { success: 'سُجل إرسال التحويل وبقي الاسترداد بانتظار تأكيد البنك' };
}

export async function confirmRefund(_: ActionState, form: FormData): Promise<ActionState> {
  const orderId = field(form,'orderId'), bankConfirmationRef = field(form,'bankConfirmationRef');
  const confirmedAt = new Date(field(form,'confirmedAt'));
  if (!orderId || bankConfirmationRef.length < 3 || bankConfirmationRef.length > 500 ||
      Number.isNaN(confirmedAt.getTime()) || confirmedAt > new Date())
    return { error: 'أدخل مرجع تأكيد البنك وتاريخه الصحيح' };
  const actor = await requireUser();
  try {
    await runOnce({ requestId: field(form,'requestId'), actorId: actor.id, action: 'REFUND_CONFIRM',
      payload: { orderId, bankConfirmationRef, confirmedAt: confirmedAt.toISOString() },
      execute: tx => confirmRefundTx(tx,orderId,actor.id,bankConfirmationRef,confirmedAt) });
  } catch (error) { return fail(error); }
  refresh(orderId);
  return { success: 'تأكد رد المبلغ من البنك وسُجل قيد خفض دفعات العملاء والنقدية مرة واحدة' };
}
