import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { csvDocument } from '@/lib/csv';

function dateFilter(from: string | null, to: string | null) {
  const valid = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : null;
  const start = valid(from), end = valid(to);
  if (from && !start || to && !end) return null;
  if (start && Number.isNaN(start.getTime()) || end && Number.isNaN(end.getTime())) return null;
  if (end) end.setUTCDate(end.getUTCDate()+1);
  if (start && end && start >= end) return null;
  return { gte: start ?? undefined, lt: end ?? undefined };
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user || user.mustChangePassword) return new Response('Unauthorized', { status: 401 });
  const url = new URL(request.url), type = url.searchParams.get('type') ?? '';
  if (!['receipts','earnings','payouts','expenses','development','cashflow'].includes(type)) return new Response('Unsupported report', { status: 400 });
  if (user.role !== 'OWNER' && (!['earnings','payouts'].includes(type) || !['COMMUNICATION','EXECUTION'].includes(user.role))) return new Response('Forbidden', { status: 403 });
  const range = dateFilter(url.searchParams.get('from'), url.searchParams.get('to'));
  if (!range) return new Response('Invalid date range', { status: 400 });
  const currency = url.searchParams.get('currency') || undefined, market = url.searchParams.get('market') || undefined;
  const clientId = url.searchParams.get('clientId') || undefined, teamId = url.searchParams.get('teamId') || undefined;
  if (type === 'cashflow' && (market || clientId || teamId || url.searchParams.get('employeeId'))) return new Response('Cashflow supports date and currency filters only', { status: 400 });
  if (type === 'payouts' && (market || clientId || teamId)) return new Response('Payouts support date, currency and employee filters only', { status: 400 });
  let rows: unknown[][] = [];
  if (type === 'receipts') {
    const native = await db.receipt.findMany({ where: { receivedAt: range, currency, order: { marketCode: market, clientId, teamId } }, include: { order: { include: { client: { include: { lead: true } } } } }, orderBy: { receivedAt: 'asc' }, take: 5001 });
    const fx = currency && !['SAR','EGP'].includes(currency) ? [] : await db.fxReceipt.findMany({ where: { receivedAt: range, order: { marketCode: market, clientId, teamId } }, include: { order: { include: { client: { include: { lead: true } } } } }, orderBy: { receivedAt: 'asc' }, take: 5001 });
    if (native.length + fx.length > 5000) return new Response('Narrow the date range to export 5000 rows or fewer', { status: 413 });
    rows = [['النوع','تاريخ الوصول','العميل','الطلب','السوق','عملة الاتفاق','المسدد بعملة الاتفاق أصغر وحدة','النقدية المستلمة EGP أصغر وحدة','الرسوم EGP أصغر وحدة','مرجع العملية','مصدر السعر']];
    for (const r of native) rows.push(['تحصيل مباشر',r.receivedAt.toISOString(),r.order.client.lead.name,r.order.title,r.order.marketCode,r.currency,r.grossMinor.toString(),r.currency==='EGP'?r.netMinor.toString():'',r.currency==='EGP'?r.feeMinor.toString():'',r.settlementRef,'']);
    for (const r of fx) rows.push(['تحويل سعودي',r.receivedAt.toISOString(),r.order.client.lead.name,r.order.title,r.order.marketCode,'SAR',r.paidSarMinor.toString(),r.netEgpMinor.toString(),r.feeEgpMinor?.toString()??'غير معروف',r.transferRef,r.rateSource]);
  } else if (type === 'earnings') {
    const recipientId = user.role === 'OWNER' ? url.searchParams.get('employeeId') || undefined : user.id;
    const earnings = await db.employeeEarning.findMany({ where: { recipientId, currency, createdAt: range, order: { marketCode: market, clientId, teamId } }, include: { recipient: { select: { name: true } }, order: { select: { title: true } }, payoutLines: { include: { payout: { select: { status: true } } } } }, orderBy: { createdAt: 'asc' }, take: 5001 });
    if (earnings.length > 5000) return new Response('Narrow the date range to export 5000 rows or fewer', { status: 413 });
    rows = [['الموظف','النوع','الطلب','قاعدة الخدمة','الحالة','المستحق EGP أصغر وحدة','المصروف المؤكد EGP أصغر وحدة','المتبقي EGP أصغر وحدة','مرجع الاستحقاق']];
    for (const e of earnings) { const paid=e.payoutLines.filter(l=>l.payout.status==='CONFIRMED').reduce((sum,l)=>sum+l.amountMinor,0n); rows.push([e.recipient.name,e.kind,e.order.title,e.policyCode,e.status,e.amountMinor.toString(),paid.toString(),(e.amountMinor-paid).toString(),e.basisRef]); }
  } else if (type === 'payouts') {
    const recipientId = user.role === 'OWNER' ? url.searchParams.get('employeeId') || undefined : user.id;
    const payouts = await db.employeePayout.findMany({ where: { recipientId, currency, approvedAt: range }, include: { recipient: { select: { name: true } } }, orderBy: { approvedAt: 'asc' }, take: 5001 });
    if (payouts.length > 5000) return new Response('Narrow the date range to export 5000 rows or fewer', { status: 413 });
    rows = [['الموظف','الحالة','العملة','المبلغ أصغر وحدة','تاريخ الاعتماد','تاريخ التنفيذ','تاريخ تأكيد خروج المال','مرجع التحويل','مرجع التأكيد']];
    for (const p of payouts) rows.push([p.recipient.name,p.status,p.currency,p.amountMinor.toString(),p.approvedAt.toISOString(),p.executedAt?.toISOString()??'',p.confirmedAt?.toISOString()??'',p.transferRef??'',p.confirmationRef??'']);
  } else if (type === 'expenses') {
    const expenses = await db.expense.findMany({ where: { createdAt: range, currency, project: teamId || market || clientId ? { teamId, clientId, order: market ? { marketCode: market } : undefined } : undefined }, include: { project: { select: { title: true } } }, orderBy: { createdAt: 'asc' }, take: 5001 });
    if (expenses.length > 5000) return new Response('Narrow the date range to export 5000 rows or fewer', { status: 413 });
    rows = [['الفئة','الوصف','الحالة','العملة','المبلغ أصغر وحدة','المشروع','الاستحقاق','تاريخ الدفع','مرجع الدفع']];
    for (const e of expenses) rows.push([e.category,e.description,e.status,e.currency,e.amountMinor.toString(),e.project?.title??'على مستوى الاستوديو',e.dueAt?.toISOString()??'',e.paidAt?.toISOString()??'',e.paymentRef??'']);
  } else if (type === 'development') {
    const allocations = await db.developmentAllocation.findMany({ where: { currency, approvedAt: range, order: { marketCode: market, clientId, teamId } }, include: { order: { select: { title: true } }, expenses: { where: { status: 'PAID' }, select: { amountMinor: true } } }, orderBy: { approvedAt: 'asc' }, take: 5001 });
    if (allocations.length > 5000) return new Response('Narrow the date range to export 5000 rows or fewer', { status: 413 });
    rows = [['الطلب','القاعدة','الحالة','المخصص EGP أصغر وحدة','الإنفاق المؤكد EGP أصغر وحدة','المتبقي EGP أصغر وحدة','تاريخ الاعتماد']];
    for (const a of allocations) { const spent=a.expenses.reduce((sum,e)=>sum+e.amountMinor,0n); rows.push([a.order.title,a.policyCode,a.status,a.amountMinor.toString(),spent.toString(),(a.amountMinor-spent).toString(),a.approvedAt.toISOString()]); }
  } else {
    const movements = await db.ledgerPosting.findMany({ where: { createdAt: range, account: { code: { in: ['CASH','DEVELOPMENT_CASH'] }, currency } }, include: { account: { select: { code: true, currency: true } }, journal: { select: { kind: true, reference: true } } }, orderBy: { createdAt: 'asc' }, take: 5001 });
    if (movements.length > 5000) return new Response('Narrow the date range to export 5000 rows or fewer', { status: 413 });
    rows = [['تاريخ القيد','الحساب','العملة','داخل أصغر وحدة','خارج أصغر وحدة','نوع الحركة','مرجع القيد']];
    for (const m of movements) rows.push([m.createdAt.toISOString(),m.account.code,m.account.currency,m.debitMinor.toString(),m.creditMinor.toString(),m.journal.kind,m.journal.reference]);
  }
  return new Response(csvDocument(rows), { headers: { 'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':`attachment; filename="manzoor-${type}.csv"`, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' } });
}
