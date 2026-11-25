'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { phoneNorm } from '@/lib/crm';
import { runOnce, RequestConflict, InvalidRequestId } from '@/lib/idempotency';
import { amountToMinor } from '@/lib/operational-money';
import { validSaudiSubscriptionOffer } from '@/lib/saudi-subscription-offer';
import { confirmReceipt } from './finance-actions';
import type { ActionState } from './actions';

const input = z.object({
  clientMode: z.enum(['existing', 'new']),
  clientId: z.string().default(''),
  teamId: z.string().default(''),
  clientName: z.string().trim().max(160).default(''),
  contact: z.string().trim().max(40).default(''),
  priceId: z.string().min(1),
  title: z.string().trim().max(150).default(''),
  scope: z.string().trim().min(3).max(10000),
  requirements: z.string().trim().max(10000).default(''),
  dueAt: z.string().default(''),
  agreementRef: z.string().trim().max(500).default(''),
  accepted: z.string().default(''),
});

export async function createOperationalOrder(_: ActionState, form: FormData): Promise<ActionState> {
  const actor = await requireUser();
  if (!['OWNER', 'COMMUNICATION'].includes(actor.role)) return { error: 'غير مصرح بإنشاء الطلبات' };
  const parsed = input.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: 'راجع بيانات الطلب والعميل' };
  const data = parsed.data;
  const dueAt = data.dueAt ? new Date(data.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) return { error: 'موعد التسليم غير صالح' };
  if (data.clientMode === 'new' && (data.clientName.length < 2 || !phoneNorm(data.contact) || data.accepted !== 'yes'))
    return { error: 'أدخل اسم العميل ووسيلة تواصل صحيحة وأكد موافقته على الطلب' };
  if (data.clientMode === 'existing' && !data.clientId) return { error: 'اختر العميل' };
  let result: { id: string };
  try {
    result = await runOnce({
      requestId: String(form.get('requestId') ?? ''), actorId: actor.id, action: 'OPERATIONAL_ORDER_CREATE', payload: data,
      execute: async tx => {
        const price = await tx.priceVersion.findUnique({ where: { id: data.priceId }, include: { service: { include: { components: { include: { child: true } } } } } });
        const now = new Date();
        if (!price || !price.service.active || price.effectiveFrom > now || price.effectiveTo && price.effectiveTo <= now)
          throw new Error('سعر الخدمة غير متاح الآن، حدّث الصفحة');
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'PRICE:' + price.serviceId + ':' + price.marketCode}, 0))`;
        const current = await tx.priceVersion.findFirst({ where: { serviceId: price.serviceId, marketCode: price.marketCode, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, orderBy: { effectiveFrom: 'desc' }, select: { id: true } });
        if (current?.id !== price.id) throw new Error('سعر الخدمة غير متاح الآن، حدّث الصفحة');
        const service = price.service;
        if (service.kind !== 'SINGLE' && !service.components.length) throw new Error('الباقة غير مكتملة في الكتالوج');
        if (service.kind === 'SUBSCRIPTION') {
          const parts = service.components;
          if (!validSaudiSubscriptionOffer(price, parts))
            throw new Error('الاشتراك السعودي المعتمد 1300 ريال لثلاثة فيديوهات وثلاثة بوسترات');
        }
        let clientId = data.clientId;
        let clientName = data.clientName;
        let teamId = data.teamId;
        if (data.clientMode === 'existing') {
          const client = await tx.client.findUnique({ where: { id: clientId }, include: { lead: { include: { team: true } } } });
          if (!client || !client.lead.team.active) throw new Error('العميل غير متاح');
          teamId = client.lead.teamId;
          clientName = client.lead.name;
          if (actor.role === 'COMMUNICATION' && client.lead.team.communicatorId !== actor.id) throw new Error('العميل خارج فريقك');
        } else {
          const team = await tx.team.findUnique({ where: { id: teamId } });
          if (!team?.active || actor.role === 'COMMUNICATION' && team.communicatorId !== actor.id) throw new Error('الفريق غير متاح');
          const contact = phoneNorm(data.contact)!;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'CLIENT:' + contact}, 0))`;
          const duplicate = await tx.lead.findFirst({ where: { OR: [{ phoneNorm: contact }, { whatsappNorm: contact }] }, select: { id: true } });
          if (duplicate) throw new Error('وسيلة التواصل مسجلة بالفعل، اختر العميل من قائمتك أو اطلب مراجعتها من المالك');
          const lead = await tx.lead.create({ data: { name: data.clientName, phone: data.contact, phoneNorm: contact, teamId, status: 'CLIENT', convertedAt: now } });
          await tx.leadAssignment.create({ data: { leadId: lead.id, teamId, actorId: actor.id } });
          await tx.contactActivity.create({ data: { leadId: lead.id, actorId: actor.id, kind: 'STATUS', statusBefore: 'NEW', statusAfter: 'ACCEPTED', note: 'موافقة العميل على الطلب عند إنشائه' } });
          await tx.contactActivity.create({ data: { leadId: lead.id, actorId: actor.id, kind: 'CONVERSION', statusBefore: 'ACCEPTED', statusAfter: 'CLIENT' } });
          const client = await tx.client.create({ data: { leadId: lead.id } });
          clientId = client.id;
          await tx.auditLog.create({ data: { actorId: actor.id, action: 'LEAD_CONVERTED_WITH_ORDER', subjectId: lead.id, detail: { clientId, teamId } } });
        }
        const order = await tx.customerOrder.create({ data: { clientId, teamId, createdById: actor.id, marketCode: price.marketCode, currency: price.currency, title: data.title || `${service.name} — ${clientName}`, scope: data.scope, requirements: data.requirements || 'في انتظار استكمال المتطلبات', dueAt, agreementRef: data.agreementRef || null, status: 'PROPOSED', version: 2, proposedAt: now } });
        await tx.orderItem.create({ data: { orderId: order.id, serviceId: service.id, priceVersionId: price.id, serviceNameSnapshot: service.name, serviceKindSnapshot: service.kind, productionTypeSnapshot: service.productionType, componentSnapshot: service.components.map(x => ({ serviceId: x.childId, quantity: x.quantity, productionType: x.child.productionType, name: x.child.name })), quantity: 1, unitMinor: price.amountMinor, currency: price.currency, scope: data.scope, dueAt } });
        await tx.orderDecision.create({ data: { orderId: order.id, kind: 'SUBMITTED', actorId: actor.id, orderVersion: 2 } });
        await tx.auditLog.create({ data: { actorId: actor.id, action: 'OPERATIONAL_ORDER_CREATED', subjectId: order.id, detail: { clientId, teamId, serviceId: service.id, priceVersionId: price.id } } });
        return { id: order.id };
      },
    });
  } catch (e) {
    if (e instanceof Error && (e instanceof RequestConflict || e instanceof InvalidRequestId || ['سعر الخدمة غير متاح الآن، حدّث الصفحة', 'الباقة غير مكتملة في الكتالوج', 'الاشتراك السعودي المعتمد 1300 ريال لثلاثة فيديوهات وثلاثة بوسترات', 'العميل غير متاح', 'العميل خارج فريقك', 'الفريق غير متاح'].includes(e.message) || e.message.startsWith('وسيلة التواصل مسجلة')))
      return { error: e.message };
    return { error: 'تعذر إنشاء الطلب، حاول مرة أخرى' };
  }
  revalidatePath('/orders');
  revalidatePath('/clients');
  revalidatePath('/dashboard');
  redirect(`/orders/${result.id}`);
}

export async function confirmOperationalReceipt(state: ActionState, form: FormData): Promise<ActionState> {
  const gross = amountToMinor(String(form.get('grossAmount') ?? ''));
  const fee = amountToMinor(String(form.get('feeAmount') ?? '0'));
  if (gross === null || fee === null) return { error: 'اكتب المبلغ والرسوم بالأرقام مثل 100 أو 100.50' };
  form.set('grossMinor', gross);
  form.set('feeMinor', fee);
  return confirmReceipt(state, form);
}
