'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { runOnce, RequestConflict, InvalidRequestId, type Tx } from '@/lib/idempotency';
import { confirmedOrderPaidMinor, validateFxAmounts, validateFxRate } from '@/lib/finance';
import type { ActionState } from './actions';

class FinanceError extends Error {}
const field = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
const money = (raw: string) => /^\d{1,15}$/.test(raw) ? BigInt(raw) : null;
const failure = (error: unknown): ActionState => ({ error: error instanceof FinanceError || error instanceof RequestConflict || error instanceof InvalidRequestId ? error.message : 'تعذر حفظ العملية المالية' });
async function lockOrder(tx: Tx, id: string) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'FINANCE_ORDER:' + id}, 0))`; }
async function account(tx: Tx, code: string, currency: string, name: string) {
  return tx.ledgerAccount.upsert({ where: { code_currency: { code, currency } }, create: { code, currency, name }, update: {} });
}
async function orderFor(tx: Tx, id: string) {
  const order = await tx.customerOrder.findUnique({ where: { id }, include: { team: true, client: { include: { lead: true } } } });
  if (!order || order.status !== 'APPROVED') throw new FinanceError('يلزم اتفاق معتمد');
  return order;
}
function refresh(id: string) { revalidatePath(`/orders/${id}`); revalidatePath('/subscriptions'); revalidatePath('/finance'); }

export async function submitPaymentClaim(_: ActionState, form: FormData): Promise<ActionState> {
  const orderId = field(form, 'orderId'), claimedMinor = money(field(form, 'claimedMinor'));
  const proofRef = field(form, 'proofRef'), note = field(form, 'note');
  if (!claimedMinor || claimedMinor <= 0n || proofRef.length < 3 || proofRef.length > 500 || note.length > 2000) return { error: 'أدخل مبلغ المطالبة ومرجع الإثبات الصحيحين' };
  const actor = await requireUser();
  try {
    await runOnce({ requestId: field(form, 'requestId'), actorId: actor.id, action: 'PAYMENT_CLAIM', payload: { orderId, claimedMinor: String(claimedMinor), proofRef, note }, execute: async tx => {
      await lockOrder(tx, orderId);
      const order = await orderFor(tx, orderId);
      if (actor.role !== 'OWNER' && (actor.role !== 'COMMUNICATION' || order.team.communicatorId !== actor.id || order.client.lead.teamId !== order.teamId)) throw new FinanceError('ليس لك حق تسجيل مطالبة هذا العميل');
      const claim = await tx.paymentClaim.create({ data: { orderId, claimedMinor, currency: order.currency, proofRef, note: note || null, submittedById: actor.id } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: 'PAYMENT_CLAIMED', subjectId: claim.id, detail: { orderId, claimedMinor: String(claimedMinor), currency: order.currency, proofRef } } });
      return { id: claim.id };
    } });
  } catch (error) { return failure(error); }
  refresh(orderId);
  return { success: 'سُجل إثبات الدفع للمراجعة، ولم يُعتمد التحصيل بعد' };
}

export async function confirmReceipt(_: ActionState, form: FormData): Promise<ActionState> {
  const orderId = field(form, 'orderId'), claimId = field(form, 'claimId');
  const grossMinor = money(field(form, 'grossMinor')), feeMinor = money(field(form, 'feeMinor'));
  const settlementRef = field(form, 'settlementRef'), settlementCurrency = field(form, 'settlementCurrency').toUpperCase(), receivedAt = new Date(field(form, 'receivedAt'));
  if (!grossMinor || grossMinor <= 0n || feeMinor === null || feeMinor >= grossMinor || settlementRef.length < 3 || settlementRef.length > 500 || Number.isNaN(receivedAt.getTime()) || receivedAt > new Date()) return { error: 'راجع المبلغ والرسوم ومرجع التحويل وتاريخه' };
  const actor = await requireUser();
  try {
    await runOnce({ requestId: field(form, 'requestId'), actorId: actor.id, action: 'RECEIPT_CONFIRM', payload: { orderId, claimId, grossMinor: String(grossMinor), feeMinor: String(feeMinor), settlementCurrency, settlementRef, receivedAt: receivedAt.toISOString() }, execute: async tx => {
      if (actor.role !== 'OWNER') throw new FinanceError('المالك فقط يعتمد وصول الأموال');
      await lockOrder(tx, orderId);
      const order = await orderFor(tx, orderId);
      if (settlementCurrency !== order.currency) throw new FinanceError('وصل المال بعملة مختلفة، استخدم تسوية تحويل عملة بعد تجهيز مسارها المحاسبي');
      const claim = claimId ? await tx.paymentClaim.findUnique({ where: { id: claimId } }) : null;
      if (claimId && (!claim || claim.orderId !== orderId || claim.status !== 'PENDING')) throw new FinanceError('المطالبة غير متاحة أو سبق البت فيها');
      if (await confirmedOrderPaidMinor(tx, orderId) + grossMinor > order.totalMinor) throw new FinanceError('المبلغ يتجاوز قيمة الاتفاق، سجّل تسوية منفصلة قبل الاعتماد');
      const netMinor = grossMinor - feeMinor;
      const cash = await account(tx, 'CASH', order.currency, 'نقدية متحصلة');
      const fees = feeMinor > 0n ? await account(tx, 'COLLECTION_FEES', order.currency, 'رسوم تحصيل') : null;
      const advance = await account(tx, 'CUSTOMER_ADVANCES', order.currency, 'مبالغ عملاء بانتظار الاعتراف بالإيراد');
      const journal = await tx.journalEntry.create({ data: { currency: order.currency, kind: 'RECEIPT', reference: `RECEIPT:${settlementRef}`, description: `تحصيل مرتبط بالطلب ${orderId}`, createdById: actor.id } });
      await tx.ledgerPosting.create({ data: { journalId: journal.id, accountId: cash.id, debitMinor: netMinor } });
      if (fees) await tx.ledgerPosting.create({ data: { journalId: journal.id, accountId: fees.id, debitMinor: feeMinor } });
      await tx.ledgerPosting.create({ data: { journalId: journal.id, accountId: advance.id, creditMinor: grossMinor } });
      const receipt = await tx.receipt.create({ data: { orderId, claimId: claimId || null, grossMinor, feeMinor, netMinor, currency: order.currency, settlementCurrency, settlementRef, receivedAt, confirmedById: actor.id, journalId: journal.id } });
      if (claim) await tx.paymentClaim.update({ where: { id: claim.id }, data: { status: 'VERIFIED', decidedById: actor.id, decidedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: 'RECEIPT_CONFIRMED', subjectId: receipt.id, detail: { orderId, claimId: claimId || null, grossMinor: String(grossMinor), feeMinor: String(feeMinor), netMinor: String(netMinor), currency: order.currency, settlementRef, journalId: journal.id } } });
      return { id: receipt.id };
    } });
  } catch (error) { return failure(error); }
  refresh(orderId);
  return { success: 'اعتمد التحصيل وسُجل قيد متوازن، والمبلغ ما زال دفعة عميل حتى قرار الاعتراف بالإيراد' };
}

export async function confirmFxReceipt(_: ActionState, form: FormData): Promise<ActionState> {
  const orderId = field(form, 'orderId'), claimId = field(form, 'claimId');
  const paidSarMinor = money(field(form, 'paidSarMinor')), netEgpMinor = money(field(form, 'netEgpMinor'));
  const grossEgpMinor = money(field(form, 'grossEgpMinor')), feeEgpMinor = money(field(form, 'feeEgpMinor'));
  const rate = field(form, 'rate'), rateSource = field(form, 'rateSource');
  const convertedAt = new Date(field(form, 'convertedAt')), receivedAt = new Date(field(form, 'receivedAt'));
  const bankAccountRef = field(form, 'bankAccountRef'), transferRef = field(form, 'transferRef');
  if (paidSarMinor === null || netEgpMinor === null || !/^\d{1,6}(\.\d{1,12})?$/.test(rate) || !/[1-9]/.test(rate) || rateSource.length < 3 || rateSource.length > 200 || bankAccountRef.length < 3 || bankAccountRef.length > 200 || transferRef.length < 3 || transferRef.length > 500 || Number.isNaN(convertedAt.getTime()) || Number.isNaN(receivedAt.getTime()) || convertedAt > new Date() || receivedAt > new Date()) return { error: 'راجع بيانات التحويل ومرجعه وسعره وتواريخه' };
  try { validateFxAmounts({ paidSarMinor, netEgpMinor, grossEgpMinor, feeEgpMinor }); validateFxRate(rate, paidSarMinor, grossEgpMinor ?? netEgpMinor); }
  catch (error) { return { error: error instanceof Error ? error.message : 'مبالغ التحويل غير صالحة' }; }
  const actor = await requireUser();
  try {
    await runOnce({ requestId: field(form, 'requestId'), actorId: actor.id, action: 'FX_RECEIPT_CONFIRM', payload: { orderId, claimId, paidSarMinor: String(paidSarMinor), grossEgpMinor: grossEgpMinor?.toString() ?? null, feeEgpMinor: feeEgpMinor?.toString() ?? null, netEgpMinor: String(netEgpMinor), rate, rateSource, convertedAt: convertedAt.toISOString(), receivedAt: receivedAt.toISOString(), bankAccountRef, transferRef }, execute: async tx => {
      if (actor.role !== 'OWNER') throw new FinanceError('المالك فقط يعتمد تحصيل التحويل');
      await lockOrder(tx, orderId);
      const order = await orderFor(tx, orderId);
      if (order.marketCode !== 'SA' || order.currency !== 'SAR') throw new FinanceError('التحويل السعودي يحتاج اتفاقًا سعوديًا بالريال');
      if (await confirmedOrderPaidMinor(tx, orderId) + paidSarMinor > order.totalMinor) throw new FinanceError('المبلغ المسدد بالريال يتجاوز المتبقي من الاتفاق');
      const claim = claimId ? await tx.paymentClaim.findUnique({ where: { id: claimId } }) : null;
      if (claimId && (!claim || claim.orderId !== orderId || claim.status !== 'PENDING')) throw new FinanceError('مطالبة الدفع غير متاحة');
      const sarClearing = await account(tx, 'FX_CLEARING', 'SAR', 'ريال محول قيد التسوية');
      const sarAdvance = await account(tx, 'CUSTOMER_ADVANCES', 'SAR', 'دفعات عملاء بانتظار الاعتراف بالإيراد');
      const egpCash = await account(tx, 'CASH', 'EGP', 'نقدية مستلمة بالجنيه');
      const egpClearing = await account(tx, 'FX_CLEARING', 'EGP', 'مقابل التحويل بالجنيه');
      const egpFees = feeEgpMinor && feeEgpMinor > 0n ? await account(tx, 'COLLECTION_FEES', 'EGP', 'رسوم تحويل فعلية') : null;
      const sarJournal = await tx.journalEntry.create({ data: { currency: 'SAR', kind: 'FX_CUSTOMER_SETTLEMENT', reference: `RECEIPT:${transferRef}`, description: `تسوية ذمة الطلب ${orderId} بالريال`, createdById: actor.id } });
      await tx.ledgerPosting.create({ data: { journalId: sarJournal.id, accountId: sarClearing.id, debitMinor: paidSarMinor } });
      await tx.ledgerPosting.create({ data: { journalId: sarJournal.id, accountId: sarAdvance.id, creditMinor: paidSarMinor } });
      const egpJournal = await tx.journalEntry.create({ data: { currency: 'EGP', kind: 'FX_CASH_RECEIPT', reference: `FX_EGP:${transferRef}`, description: `صافي جنيه وصل للحساب ${bankAccountRef}`, createdById: actor.id } });
      await tx.ledgerPosting.create({ data: { journalId: egpJournal.id, accountId: egpCash.id, debitMinor: netEgpMinor } });
      if (egpFees) await tx.ledgerPosting.create({ data: { journalId: egpJournal.id, accountId: egpFees.id, debitMinor: feeEgpMinor! } });
      await tx.ledgerPosting.create({ data: { journalId: egpJournal.id, accountId: egpClearing.id, creditMinor: grossEgpMinor ?? netEgpMinor } });
      const fx = await tx.fxReceipt.create({ data: { orderId, claimId: claimId || null, paidSarMinor, grossEgpMinor, feeEgpMinor, netEgpMinor, rate, rateBasis: grossEgpMinor === null ? 'NET_EFFECTIVE' : 'GROSS_CONVERSION', rateSource, convertedAt, receivedAt, bankAccountRef, transferRef, confirmedById: actor.id, sarJournalId: sarJournal.id, egpJournalId: egpJournal.id } });
      if (claim) await tx.paymentClaim.update({ where: { id: claim.id }, data: { status: 'VERIFIED', decidedById: actor.id, decidedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: 'FX_RECEIPT_CONFIRMED', subjectId: fx.id, detail: { orderId, paidSarMinor: String(paidSarMinor), netEgpMinor: String(netEgpMinor), grossEgpMinor: grossEgpMinor?.toString() ?? null, feeEgpMinor: feeEgpMinor?.toString() ?? null, rate, rateSource, bankAccountRef, transferRef, sarJournalId: sarJournal.id, egpJournalId: egpJournal.id } } });
      return { id: fx.id };
    } });
  } catch (error) { return failure(error); }
  refresh(orderId);
  return { success: 'اعتمد وصول صافي الجنيه وسُويت ذمة العميل بالريال في قيدين متوازنين، دون خصم الرسوم مرتين' };
}

export async function rejectPaymentClaim(_: ActionState, form: FormData): Promise<ActionState> {
  const orderId = field(form, 'orderId'), claimId = field(form, 'claimId'), reason = field(form, 'reason');
  if (reason.length < 3 || reason.length > 2000) return { error: 'اكتب سبب رفض واضحًا' };
  const actor = await requireUser();
  try {
    await runOnce({ requestId: field(form, 'requestId'), actorId: actor.id, action: 'PAYMENT_CLAIM_REJECT', payload: { orderId, claimId, reason }, execute: async tx => {
      if (actor.role !== 'OWNER') throw new FinanceError('المالك فقط يقرر إثبات الدفع');
      await lockOrder(tx, orderId);
      const claim = await tx.paymentClaim.findUnique({ where: { id: claimId } });
      if (!claim || claim.orderId !== orderId || claim.status !== 'PENDING') throw new FinanceError('الإثبات غير متاح أو سبق البت فيه');
      await tx.paymentClaim.update({ where: { id: claimId }, data: { status: 'REJECTED', decidedById: actor.id, decidedAt: new Date(), decisionNote: reason } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: 'PAYMENT_CLAIM_REJECTED', subjectId: claimId, detail: { orderId, reason } } });
      return { id: claimId };
    } });
  } catch (error) { return failure(error); }
  refresh(orderId);
  return { success: 'رُفض إثبات الدفع مع حفظ السبب' };
}

export async function activatePaidSubscription(_: ActionState, form: FormData): Promise<ActionState> {
  const orderId = field(form, 'orderId');
  const actor = await requireUser();
  try {
    await runOnce({ requestId: field(form, 'requestId'), actorId: actor.id, action: 'SUBSCRIPTION_ACTIVATE_PAID', payload: { orderId }, execute: async tx => {
      if (actor.role !== 'OWNER') throw new FinanceError('المالك فقط يفعل الدورة المدفوعة');
      await lockOrder(tx, orderId);
      const order = await orderFor(tx, orderId);
      if (order.marketCode !== 'SA' || order.currency !== 'SAR' || order.totalMinor <= 0n) throw new FinanceError('يلزم اشتراك سعودي معتمد بالريال بقيمة موجبة');
      const subscription = await tx.subscription.findUnique({ where: { orderId }, include: { cycles: true } });
      if (!subscription || subscription.status !== 'PENDING' || subscription.cycles.length !== 1 || subscription.cycles[0].status !== 'PLANNED') throw new FinanceError('الدورة ليست بانتظار التفعيل');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'ACTIVE_SUBSCRIPTIONS:' + order.team.executorId}, 0))`;
      const activeForExecutor = await tx.subscription.count({ where: { status: 'ACTIVE', order: { team: { executorId: order.team.executorId } } } });
      if (activeForExecutor >= 5) throw new FinanceError('بلغ المنفذ حد خمسة اشتراكات نشطة، يلزم استثناء إداري موثق');
      if (await confirmedOrderPaidMinor(tx, orderId) !== order.totalMinor) throw new FinanceError('لا يُفعّل الاشتراك قبل اعتماد تحصيل القيمة كاملة');
      await tx.subscription.update({ where: { id: subscription.id }, data: { status: 'ACTIVE' } });
      await tx.subscriptionCycle.update({ where: { id: subscription.cycles[0].id }, data: { status: 'ACTIVE' } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: 'PAID_SUBSCRIPTION_ACTIVATED', subjectId: subscription.id, detail: { orderId, cycleId: subscription.cycles[0].id, confirmedMinor: String(order.totalMinor), currency: order.currency } } });
      return { id: subscription.id };
    } });
  } catch (error) { return failure(error); }
  refresh(orderId);
  return { success: 'فُعّلت الدورة بعد تحقق التحصيل الكامل' };
}
