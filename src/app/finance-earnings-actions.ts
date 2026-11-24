'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { confirmedOrderPaidMinor } from '@/lib/finance';
import { approvedEarningAmount, type ApprovedService } from '@/lib/finance-policy';
import { runOnce, RequestConflict, InvalidRequestId, type Tx } from '@/lib/idempotency';
import type { ActionState } from './actions';

class EarningError extends Error {}
const f = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const amount = (raw: string) => /^\d{1,15}$/.test(raw) ? BigInt(raw) : null;
const fail = (error: unknown): ActionState => ({ error: error instanceof EarningError || error instanceof RequestConflict || error instanceof InvalidRequestId ? error.message : 'تعذر حفظ المستحق أو الصرف' });
const refresh = () => { revalidatePath('/finance'); revalidatePath('/finance/earnings'); };
const serviceTypes: ApprovedService[] = ['EG_POSTER','EG_MOTION','EG_VIDEO_3_POSTERS','SA_POSTER','SA_MOTION','SA_VIDEO_POSTER','SA_SUBSCRIPTION'];
async function lock(tx: Tx, key: string) { await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`; }
async function account(tx: Tx, code: string, name: string) { return tx.ledgerAccount.upsert({ where: { code_currency: { code, currency: 'EGP' } }, create: { code, currency: 'EGP', name }, update: {} }); }

export async function proposeEarning(_: ActionState, form: FormData): Promise<ActionState> {
  const kind = f(form,'kind'), service = f(form,'service') as ApprovedService, orderId = f(form,'orderId'), projectId = f(form,'projectId'), assignmentId = f(form,'assignmentId'), recipientId = f(form,'recipientId'), basisRef = f(form,'basisRef'), note = f(form,'note');
  const proposedMinor = amount(f(form,'amountMinor'));
  if (!['COMMUNICATION','EXECUTION'].includes(kind) || !serviceTypes.includes(service) || !proposedMinor || proposedMinor <= 0n || basisRef.length < 3 || basisRef.length > 500 || note.length > 2000) return { error: 'راجع بيانات المستحق ومرجع استحقاقه' };
  const actor = await requireUser();
  try {
    await runOnce({ requestId: f(form,'requestId'), actorId: actor.id, action: 'EARNING_PROPOSE', payload: { kind,service,orderId,projectId,assignmentId,recipientId,basisRef,note,amountMinor:String(proposedMinor) }, execute: async tx => {
      if (actor.role !== 'OWNER') throw new EarningError('المالك فقط يسجل مقترح المستحق');
      await lock(tx,`EARNING_ORDER:${orderId}`);
      const order = await tx.customerOrder.findUnique({ where: { id: orderId }, include: { items: true } });
      if (!order || order.status !== 'APPROVED' || order.items.length !== 1 || order.items[0].quantity !== 1) throw new EarningError('يلزم اتفاق معتمد ببند واحد وكمية واحدة لتحديد المستحق دون افتراض');
      if ((service.startsWith('EG_') ? 'EG' : 'SA') !== order.marketCode) throw new EarningError('جدول الخدمة لا يطابق سوق الاتفاق');
      const item = order.items[0];
      const expectedType = service === 'EG_POSTER' || service === 'SA_POSTER' ? 'POSTER' : service === 'EG_MOTION' || service === 'SA_MOTION' ? 'VIDEO' : service === 'EG_VIDEO_3_POSTERS' ? 'VIDEO_3_POSTERS' : service === 'SA_VIDEO_POSTER' ? 'VIDEO_POSTER' : null;
      if (expectedType && item.productionTypeSnapshot !== expectedType || service === 'SA_SUBSCRIPTION' && item.serviceKindSnapshot !== 'SUBSCRIPTION') throw new EarningError('نوع الخدمة لا يطابق نسخة الاتفاق');
      const fixedMinor = approvedEarningAmount(service, kind as 'COMMUNICATION'|'EXECUTION');
      if (proposedMinor > fixedMinor) throw new EarningError('المبلغ يتجاوز أجر أو عمولة السياسة المعتمدة');
      const recipient = await tx.user.findUnique({ where: { id: recipientId } });
      if (!recipient || recipient.role !== kind) throw new EarningError('المستفيد لا يطابق دور المستحق');
      let entitlementKey: string;
      if (kind === 'COMMUNICATION') {
        if (projectId || assignmentId || proposedMinor !== fixedMinor) throw new EarningError('العمولة الكاملة مرتبطة بالاتفاق مرة واحدة، والتقسيم يحتاج تسوية معتمدة');
        if (await confirmedOrderPaidMinor(tx, orderId) !== order.totalMinor) throw new EarningError('العمولة المعلقة تحتاج تحصيل الاتفاق كاملًا؛ التحصيل الجزئي يحتاج قرارًا');
        entitlementKey = `COMM:ORDER:${orderId}`;
      } else {
        if (service === 'SA_SUBSCRIPTION') throw new EarningError('أجر دورة الاشتراك يحتاج إغلاق الدورة وقبول جميع أعمالها قبل الاستحقاق');
        const project = await tx.project.findUnique({ where: { id: projectId } });
        const assignment = await tx.projectAssignment.findUnique({ where: { id: assignmentId } });
        if (!project || project.orderId !== orderId || project.orderItemId !== item.id || !project.completedAt || !assignment || assignment.projectId !== projectId || assignment.executorId !== recipientId || !assignment.acceptedAt) throw new EarningError('يلزم مشروع مكتمل وتكليف مقبول للمنفذ نفسه');
        if (!await tx.approval.findFirst({ where: { projectId, kind: 'FINAL_DELIVERY' } })) throw new EarningError('يلزم اعتماد التسليم النهائي');
        const prior = await tx.employeeEarning.aggregate({ where: { projectId, kind: 'EXECUTION' }, _sum: { amountMinor: true } });
        if ((prior._sum.amountMinor ?? 0n) + proposedMinor > fixedMinor) throw new EarningError('مجموع أجور المنفذين يتجاوز أجر العمل المعتمد');
        entitlementKey = `EXEC:ASSIGN:${assignmentId}`;
      }
      const earning = await tx.employeeEarning.create({ data: { entitlementKey, kind: kind as 'COMMUNICATION'|'EXECUTION', recipientId, orderId, projectId: projectId || null, assignmentId: assignmentId || null, amountMinor: proposedMinor, policyCode: service, policyVersion: 1, basisRef, note: note || null, proposedById: actor.id } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: 'EARNING_PROPOSED', subjectId: earning.id, detail: { entitlementKey, recipientId, orderId, projectId, assignmentId, amountMinor: String(proposedMinor), policyCode: service, basisRef } } });
      return { id: earning.id };
    } });
  } catch (error) { return fail(error); }
  refresh(); return { success: 'سُجل المستحق بانتظار اعتماد الاستحقاق، ولم يُصرف مال' };
}

export async function approveEarning(_: ActionState, form: FormData): Promise<ActionState> {
  const earningId = f(form,'earningId'), decisionRef = f(form,'decisionRef');
  if (decisionRef.length < 3 || decisionRef.length > 500) return { error: 'أدخل مرجع قرار الاستحقاق' };
  const actor = await requireUser();
  try {
    await runOnce({ requestId: f(form,'requestId'), actorId: actor.id, action: 'EARNING_APPROVE', payload: { earningId, decisionRef }, execute: async tx => {
      if (actor.role !== 'OWNER') throw new EarningError('المالك فقط يعتمد الاستحقاق');
      await lock(tx,`EARNING:${earningId}`);
      const earning = await tx.employeeEarning.findUnique({ where: { id: earningId } });
      if (!earning || earning.status !== 'PENDING' || earning.recipientId === actor.id) throw new EarningError('المستحق غير متاح للاعتماد');
      if (earning.kind === 'COMMUNICATION') {
        const order = await tx.customerOrder.findUnique({ where: { id: earning.orderId } });
        if (!order || await confirmedOrderPaidMinor(tx, earning.orderId) !== order.totalMinor) throw new EarningError('لم يكتمل التحصيل بعد');
      } else {
        const project = await tx.project.findUnique({ where: { id: earning.projectId ?? '' } });
        if (!project?.completedAt || !await tx.approval.findFirst({ where: { projectId: project.id, kind: 'FINAL_DELIVERY' } })) throw new EarningError('العمل لم يُقبل نهائيًا');
      }
      const cost = await account(tx, earning.kind === 'COMMUNICATION' ? 'COMMUNICATION_COST' : 'EXECUTION_COST', earning.kind === 'COMMUNICATION' ? 'عمولات مكتسبة' : 'أجور تنفيذ مكتسبة');
      const payable = await account(tx, 'EARNINGS_PAYABLE', 'مستحقات العاملين');
      const journal = await tx.journalEntry.create({ data: { currency: 'EGP', kind: 'EARNING_ACCRUAL', reference: `EARNING:${earningId}`, description: `استحقاق بموجب ${decisionRef}`, createdById: actor.id } });
      await tx.ledgerPosting.create({ data: { journalId: journal.id, accountId: cost.id, debitMinor: earning.amountMinor } });
      await tx.ledgerPosting.create({ data: { journalId: journal.id, accountId: payable.id, creditMinor: earning.amountMinor } });
      await tx.employeeEarning.update({ where: { id: earningId }, data: { status: 'EARNED', earnedAt: new Date(), approvedById: actor.id, journalId: journal.id } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: 'EARNING_APPROVED', subjectId: earningId, detail: { decisionRef, journalId: journal.id, amountMinor: String(earning.amountMinor) } } });
      return { id: earningId };
    } });
  } catch (error) { return fail(error); }
  refresh(); return { success: 'اعتُمد الاستحقاق وسُجل التزام، ولم يُصرف بعد' };
}

export async function markEarningPayable(_: ActionState, form: FormData): Promise<ActionState> {
  const earningId = f(form,'earningId'), decisionRef = f(form,'decisionRef');
  if (decisionRef.length < 3) return { error: 'أدخل مرجع دورة الصرف' };
  const actor = await requireUser();
  try { await runOnce({ requestId: f(form,'requestId'), actorId: actor.id, action: 'EARNING_PAYABLE', payload: { earningId, decisionRef }, execute: async tx => {
    if (actor.role !== 'OWNER') throw new EarningError('المالك فقط يحدد موعد الصرف');
    await lock(tx,`EARNING:${earningId}`);
    const earning = await tx.employeeEarning.findUnique({ where: { id: earningId } });
    if (!earning || earning.status !== 'EARNED') throw new EarningError('المستحق لم يُكتسب أو تحدد موعده سابقًا');
    await tx.employeeEarning.update({ where: { id: earningId }, data: { status: 'PAYABLE', payableAt: new Date() } });
    await tx.auditLog.create({ data: { actorId: actor.id, action: 'EARNING_PAYABLE', subjectId: earningId, detail: { decisionRef } } });
    return { id: earningId };
  } }); } catch (error) { return fail(error); }
  refresh(); return { success: 'أصبح المستحق جاهزًا لدورة الصرف دون إنشاء مستحق جديد' };
}

export async function approvePayout(_: ActionState, form: FormData): Promise<ActionState> {
  const earningIds = form.getAll('earningId').map(String), amounts = form.getAll('amountMinor').map(String), note = f(form,'note');
  if (!earningIds.length || earningIds.length !== amounts.length || new Set(earningIds).size !== earningIds.length || amounts.some(raw => !amount(raw) || amount(raw)! <= 0n) || note.length > 2000) return { error: 'اختر مستحقات ومبالغ صرف صحيحة' };
  const lines = earningIds.map((earningId,i) => ({ earningId, amountMinor: amount(amounts[i])! })).sort((a,b) => a.earningId.localeCompare(b.earningId));
  const actor = await requireUser();
  try { await runOnce({ requestId: f(form,'requestId'), actorId: actor.id, action: 'PAYOUT_APPROVE', payload: { lines: lines.map(l => ({ earningId:l.earningId, amountMinor:String(l.amountMinor) })), note }, execute: async tx => {
    if (actor.role !== 'OWNER') throw new EarningError('المالك فقط يعتمد أمر الصرف');
    let recipientId = '';
    for (const line of lines) {
      await lock(tx,`EARNING:${line.earningId}`);
      const earning = await tx.employeeEarning.findUnique({ where: { id: line.earningId } });
      if (!earning || earning.status !== 'PAYABLE' || earning.recipientId === actor.id) throw new EarningError('المستحق غير متاح للصرف');
      if (recipientId && recipientId !== earning.recipientId) throw new EarningError('الدفعة المجمعة يجب أن تخص موظفًا واحدًا');
      recipientId = earning.recipientId;
      const reserved = await tx.payoutLine.aggregate({ where: { earningId: earning.id, payout: { status: { in: ['APPROVED','EXECUTED','CONFIRMED'] } } }, _sum: { amountMinor: true } });
      if ((reserved._sum.amountMinor ?? 0n) + line.amountMinor > earning.amountMinor) throw new EarningError('مبلغ الصرف يتجاوز المتبقي من المستحق');
    }
    const total = lines.reduce((sum,l) => sum+l.amountMinor,0n);
    const payout = await tx.employeePayout.create({ data: { recipientId, amountMinor: total, approvedById: actor.id, note: note || null, lines: { create: lines } } });
    await tx.auditLog.create({ data: { actorId: actor.id, action: 'PAYOUT_APPROVED', subjectId: payout.id, detail: { recipientId, totalMinor:String(total), lines: lines.map(l => ({ earningId:l.earningId, amountMinor:String(l.amountMinor) })) } } });
    return { id: payout.id };
  } }); } catch (error) { return fail(error); }
  refresh(); return { success: 'اعتُمد أمر الصرف وحُجز من المستحقات، ولم يُسجل خروج مال' };
}

export async function executePayout(_: ActionState, form: FormData): Promise<ActionState> {
  const payoutId = f(form,'payoutId'), transferRef = f(form,'transferRef'), accountRef = f(form,'accountRef');
  if (transferRef.length < 3 || transferRef.length > 500 || accountRef.length < 3 || accountRef.length > 200) return { error: 'أدخل مرجع التحويل والوسيلة' };
  const actor = await requireUser();
  try { await runOnce({ requestId: f(form,'requestId'), actorId: actor.id, action: 'PAYOUT_EXECUTE', payload: { payoutId,transferRef,accountRef }, execute: async tx => {
    if (actor.role !== 'OWNER') throw new EarningError('المالك فقط يسجل تنفيذ أمر الصرف');
    await lock(tx,`PAYOUT:${payoutId}`);
    const payout = await tx.employeePayout.findUnique({ where: { id: payoutId } });
    if (!payout || payout.status !== 'APPROVED') throw new EarningError('أمر الصرف ليس بانتظار التنفيذ');
    await tx.employeePayout.update({ where: { id: payoutId }, data: { status:'EXECUTED', executedById:actor.id, executedAt:new Date(), transferRef, accountRef } });
    await tx.auditLog.create({ data: { actorId:actor.id, action:'PAYOUT_EXECUTED', subjectId:payoutId, detail:{transferRef,accountRef} } });
    return { id:payoutId };
  } }); } catch (error) { return fail(error); }
  refresh(); return { success: 'سُجل تنفيذ التحويل بانتظار تأكيد خروجه الفعلي' };
}

export async function confirmPayout(_: ActionState, form: FormData): Promise<ActionState> {
  const payoutId = f(form,'payoutId'), confirmationRef = f(form,'confirmationRef');
  if (confirmationRef.length < 3 || confirmationRef.length > 500) return { error: 'أدخل مرجع تأكيد خروج المال' };
  const actor = await requireUser();
  try { await runOnce({ requestId: f(form,'requestId'), actorId: actor.id, action: 'PAYOUT_CONFIRM', payload: { payoutId,confirmationRef }, execute: async tx => {
    if (actor.role !== 'OWNER') throw new EarningError('المالك فقط يؤكد خروج المال');
    await lock(tx,`PAYOUT:${payoutId}`);
    await lock(tx,'CASH:EGP');
    const payout = await tx.employeePayout.findUnique({ where: { id:payoutId }, include: { lines:true } });
    if (!payout || payout.status !== 'EXECUTED' || !payout.transferRef || !payout.lines.length) throw new EarningError('أمر الصرف لم ينفذ أو لا يحتوي مستحقات');
    const cash = await account(tx,'CASH','نقدية مستلمة بالجنيه');
    const balance = await tx.ledgerPosting.aggregate({ where: { accountId:cash.id }, _sum:{debitMinor:true,creditMinor:true} });
    if ((balance._sum.debitMinor??0n)-(balance._sum.creditMinor??0n)<payout.amountMinor) throw new EarningError('الرصيد النقدي المسجل غير كاف لتأكيد الصرف');
    const payable = await account(tx,'EARNINGS_PAYABLE','مستحقات العاملين');
    const journal = await tx.journalEntry.create({ data:{currency:'EGP',kind:'EARNING_PAYOUT',reference:`PAYOUT:${payoutId}`,description:`صرف مؤكد ${confirmationRef}`,createdById:actor.id} });
    await tx.ledgerPosting.create({data:{journalId:journal.id,accountId:payable.id,debitMinor:payout.amountMinor}});
    await tx.ledgerPosting.create({data:{journalId:journal.id,accountId:cash.id,creditMinor:payout.amountMinor}});
    await tx.employeePayout.update({where:{id:payoutId},data:{status:'CONFIRMED',confirmedById:actor.id,confirmedAt:new Date(),confirmationRef,journalId:journal.id}});
    for (const line of payout.lines) {
      await lock(tx,`EARNING:${line.earningId}`);
      const earning = await tx.employeeEarning.findUniqueOrThrow({where:{id:line.earningId}});
      const confirmed = await tx.payoutLine.aggregate({where:{earningId:line.earningId,payout:{status:'CONFIRMED'}},_sum:{amountMinor:true}});
      if ((confirmed._sum.amountMinor??0n)===earning.amountMinor) await tx.employeeEarning.update({where:{id:earning.id},data:{status:'PAID'}});
    }
    await tx.auditLog.create({data:{actorId:actor.id,action:'PAYOUT_CONFIRMED',subjectId:payoutId,detail:{confirmationRef,journalId:journal.id,amountMinor:String(payout.amountMinor)}}});
    return {id:payoutId};
  } }); } catch (error) { return fail(error); }
  refresh(); return { success: 'تأكد خروج المال وسُجل القيد النقدي، وبقيت المستحقات الجزئية مفتوحة' };
}

export async function cancelApprovedPayout(_: ActionState, form: FormData): Promise<ActionState> {
  const payoutId = f(form,'payoutId'), reason = f(form,'reason');
  if (reason.length < 3 || reason.length > 2000) return { error: 'أدخل سبب إلغاء أمر الصرف' };
  const actor = await requireUser();
  try { await runOnce({ requestId:f(form,'requestId'),actorId:actor.id,action:'PAYOUT_CANCEL',payload:{payoutId,reason},execute:async tx=>{
    if(actor.role!=='OWNER')throw new EarningError('المالك فقط يلغي أمر الصرف');
    await lock(tx,`PAYOUT:${payoutId}`);
    const payout=await tx.employeePayout.findUnique({where:{id:payoutId}});
    if(!payout||payout.status!=='APPROVED')throw new EarningError('لا يُلغى بعد تسجيل التنفيذ إلا بتسوية موثقة');
    await tx.employeePayout.update({where:{id:payoutId},data:{status:'CANCELLED',note:reason}});
    await tx.auditLog.create({data:{actorId:actor.id,action:'PAYOUT_CANCELLED',subjectId:payoutId,detail:{reason}}});
    return {id:payoutId};
  }}); } catch(error){return fail(error)}
  refresh();return {success:'أُلغي أمر الصرف قبل التنفيذ وتحرر المبلغ المحجوز'};
}
