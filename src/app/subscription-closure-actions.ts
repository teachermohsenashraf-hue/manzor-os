'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { confirmedOrderPaidMinor } from '@/lib/finance';
import { runOnce, RequestConflict, InvalidRequestId } from '@/lib/idempotency';
import { validateCycleClosure } from '@/lib/subscription-closure';
import type { ActionState } from './actions';

const field = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

export async function closeSubscriptionCycle(_: ActionState, form: FormData): Promise<ActionState> {
  const cycleId = field(form, 'cycleId');
  const evidenceRef = field(form, 'evidenceRef');
  if (!cycleId || evidenceRef.length < 3 || evidenceRef.length > 500) return { error: 'أدخل مرجع اعتماد إغلاق الدورة' };
  const actor = await requireUser();
  try {
    await runOnce({
      requestId: field(form, 'requestId'), actorId: actor.id, action: 'SUBSCRIPTION_CYCLE_CLOSE',
      payload: { cycleId, evidenceRef }, execute: async tx => {
        if (actor.role !== 'OWNER') throw new Error('المالك فقط يغلق الدورة');
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`CYCLE:${cycleId}`}, 0))`;
        const cycle = await tx.subscriptionCycle.findUnique({
          where: { id: cycleId },
          include: {
            subscription: { include: { order: true } },
            items: { include: { service: true } },
            projects: { include: { assignments: true, deliverables: true, approvals: true, qualityReviews: true } },
            closure: true,
          },
        });
        if (!cycle || cycle.status !== 'ACTIVE' || cycle.subscription.status !== 'ACTIVE' || cycle.closure)
          throw new Error('الدورة غير نشطة أو أُغلقت سابقًا');
        const order = cycle.subscription.order;
        if (order.marketCode !== 'SA' || order.status !== 'APPROVED' || order.currency !== 'SAR' || order.totalMinor !== 130000n ||
            await confirmedOrderPaidMinor(tx, order.id) !== order.totalMinor)
          throw new Error('يلزم اشتراك سعودي معتمد ومحصل بالكامل');
        const result = validateCycleClosure(cycle.items, cycle.projects);
        const recipient = await tx.user.findUnique({ where: { id: result.executorId } });
        if (!recipient || !recipient.active || !['OWNER', 'EXECUTION'].includes(recipient.role))
          throw new Error('منفذ الدورة غير نشط أو غير مصرح');
        const closure = await tx.subscriptionCycleClosure.create({ data: {
          cycleId, executorId: result.executorId, projectIds: result.projectIds,
          evidence: { reference: evidenceRef, orderId: order.id, paidMinor: String(order.totalMinor) },
          closedById: actor.id,
        } });
        await tx.subscriptionCycle.update({ where: { id: cycleId }, data: { status: 'CLOSED' } });
        await tx.auditLog.create({ data: { actorId: actor.id, action: 'SUBSCRIPTION_CYCLE_CLOSED', subjectId: cycleId,
          detail: { closureId: closure.id, executorId: result.executorId, projectIds: result.projectIds, evidenceRef } } });
        return { id: closure.id };
      },
    });
  } catch (error) {
    return { error: error instanceof Error &&
      (error instanceof RequestConflict || error instanceof InvalidRequestId ||
       ['المالك فقط يغلق الدورة', 'الدورة غير نشطة أو أُغلقت سابقًا', 'يلزم اشتراك سعودي معتمد ومحصل بالكامل',
        'منفذ الدورة غير نشط أو غير مصرح', 'مكونات دورة الاشتراك لا تطابق ثلاث فيديوهات وثلاثة بوسترات',
        'يجب تكليف الأعمال الستة في الدورة دون نقص أو زيادة',
        'عمل ملغى بعد بدء التنفيذ يحتاج تسوية قبل إغلاق الدورة',
        'جميع الأعمال يجب أن تكون مكتملة ومجتازة للجودة ومعتمدة التسليم للمنفذ نفسه'].includes(error.message))
      ? error.message : 'تعذر إغلاق الدورة' };
  }
  revalidatePath(`/subscriptions/${cycleId}`);
  revalidatePath('/subscriptions');
  revalidatePath('/finance/earnings');
  return { success: 'أُغلقت الدورة بعد التحقق من الأعمال الستة، ولم يُنشأ مستحق أو يُصرف مال' };
}
