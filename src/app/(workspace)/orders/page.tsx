import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { formatMinor, orderStatusLabels } from '@/lib/commerce';
import { OperationalOrderForm } from '@/components/operational-order-form';
import { nextOrderStep } from '@/lib/operational-next-step';
import { validSaudiSubscriptionOffer } from '@/lib/saudi-subscription-offer';
import type { OrderStatus, Prisma } from '@/generated/prisma/client';

export default async function Orders({ searchParams }: { searchParams: Promise<{ status?: string; team?: string }> }) {
  const user = await requireUser();
  if (!['OWNER', 'COMMUNICATION'].includes(user.role)) notFound();
  const f = await searchParams;
  const where: Prisma.CustomerOrderWhereInput = {
    ...(user.role === 'COMMUNICATION' ? { team: { communicatorId: user.id }, client: { lead: { team: { communicatorId: user.id } } } } : {}),
    ...(f.status && f.status in orderStatusLabels ? { status: f.status as OrderStatus } : {}),
    ...(f.team ? { teamId: f.team } : {}),
  };
  const now = new Date();
  const [orders, teams, clients, prices] = await Promise.all([
    db.customerOrder.findMany({ where, include: { client: { include: { lead: { select: { name: true } } } }, team: { select: { name: true } }, items: { select: { id: true, serviceKindSnapshot: true } }, receipts: { select: { grossMinor: true } }, fxReceipts: { select: { paidSarMinor: true } }, subscription: { select: { status: true } }, projects: { select: { id: true, stage: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }),
    db.team.findMany({ where: { active: true, ...(user.role === 'OWNER' ? {} : { communicatorId: user.id }) }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.client.findMany({ where: user.role === 'OWNER' ? {} : { lead: { team: { communicatorId: user.id } } }, include: { lead: { select: { name: true } } }, take: 200 }),
    db.priceVersion.findMany({ where: { effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }], service: { active: true } }, include: { service: { include: { components: { include: { child: true } } } } }, orderBy: { service: { name: 'asc' } } }),
  ]);
  const offers = prices.filter(price => price.service.kind === 'SINGLE' || price.service.components.length > 0).filter(price => price.service.kind !== 'SUBSCRIPTION' || validSaudiSubscriptionOffer(price, price.service.components)).map(price => ({ id: price.id, name: price.service.name, kind: price.service.kind, amountMinor: price.amountMinor, marketCode: price.marketCode, currency: price.currency }));
  return <>
    <div className="page-heading"><div><span className="eyebrow">طلبات العملاء</span><h1>الطلبات</h1><p className="muted">سجل العميل والخدمة والطلب من هنا، ثم تابع الخطوة التالية من القائمة</p></div></div>
    <form className="search-form crm-filters" action="/orders"><label>الحالة<select name="status" defaultValue={f.status ?? ''}><option value="">الكل</option>{Object.entries(orderStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>الفريق<select name="team" defaultValue={f.team ?? ''}><option value="">الكل</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><button>تطبيق</button></form>
    <div className="dashboard-grid"><section className="card"><h2>قائمة الطلبات</h2>{orders.length ? orders.map(order => {
      const collected = order.receipts.reduce((sum, receipt) => sum + receipt.grossMinor, 0n) + order.fxReceipts.reduce((sum, receipt) => sum + receipt.paidSarMinor, 0n);
      return <div className="setting-row" key={order.id}><Link href={`/orders/${order.id}`}><strong>{order.title}</strong></Link><p>{order.client.lead.name} · {order.team.name}</p><small>{orderStatusLabels[order.status]} · {order.status === 'APPROVED' ? formatMinor(order.totalMinor, order.currency) : 'بانتظار اعتماد السعر'}</small><p><strong>الخطوة التالية</strong> {nextOrderStep(order, collected, user.role)}</p></div>;
    }) : <p className="empty">لا توجد طلبات</p>}</section><aside className="card"><h2>عميل وطلب جديد</h2><OperationalOrderForm clients={clients.map(client => ({ id: client.id, name: client.lead.name }))} teams={teams} offers={offers} /></aside></div>
  </>;
}
