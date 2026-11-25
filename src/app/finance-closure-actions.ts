'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { runOnce, RequestConflict, InvalidRequestId } from '@/lib/idempotency';
import { recognizeIndividualRevenue, RevenueRecognitionError } from '@/lib/revenue-recognition';
import type { ActionState } from './actions';

const field = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

export async function recognizeRevenue(_: ActionState, form: FormData): Promise<ActionState> {
  const projectId = field(form, 'projectId'), orderId = field(form, 'orderId'), basisRef = field(form, 'basisRef');
  if (!projectId || !orderId || basisRef.length < 3 || basisRef.length > 500) return { error: 'أدخل العمل ومرجع اعتماد الإيراد' };
  const actor = await requireUser();
  try {
    await runOnce({ requestId: field(form, 'requestId'), actorId: actor.id, action: 'REVENUE_RECOGNIZE',
      payload: { orderId, projectId, basisRef }, execute: tx => recognizeIndividualRevenue(tx, projectId, actor.id, basisRef) });
  } catch (error) {
    return { error: error instanceof RevenueRecognitionError || error instanceof RequestConflict || error instanceof InvalidRequestId
      ? error.message : 'تعذر اعتماد الإيراد' };
  }
  revalidatePath(`/orders/${orderId}`);
  revalidatePath('/finance');
  return { success: 'سُجل الإيراد المكتسب بقيد متوازن منفصل عن التحصيل، ولم يُعتمد توزيع أرباح' };
}
