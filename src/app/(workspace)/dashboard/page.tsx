import Link from 'next/link';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { formatMinor } from '@/lib/commerce';
import { stageLabels } from '@/lib/production';
import { nextOrderStep, remainingSubscriptionWork } from '@/lib/operational-next-step';
import { ActionLink, MetricCard, StatusRow } from '@/components/ui-elements';

const today = () => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'long', timeZone: 'Africa/Cairo' }).format(new Date());
const heading = (name: string) => <div className="page-heading"><div><span className="eyebrow">مساحة العمل</span><h1>أهلًا {name.split(' ')[0]}</h1><p className="muted">الأعمال التي تحتاج متابعة اليوم</p></div><span className="date-pill">{today()}</span></div>;

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ forbidden?: string }> }) {
  const user = await requireUser();
  const { forbidden } = await searchParams;
  const alert = forbidden ? <p role="alert" className="message error">هذه الصفحة غير متاحة لصلاحيات حسابك</p> : null;
  if (user.role === 'OWNER') {
    const [orders, projects, receipts, fxReceipts, earnings, expenses, paymentClaims] = await Promise.all([
      db.customerOrder.findMany({ where: { status: { in: ['PROPOSED', 'APPROVED'] } }, include: { client: { include: { lead: { select: { name: true } } } }, items: { select: { id: true, serviceKindSnapshot: true } }, receipts: { select: { grossMinor: true } }, fxReceipts: { select: { paidSarMinor: true } }, subscription: { select: { status: true, cycles: { select: { status: true, items: { select: { plannedQuantity: true, assignedQuantity: true } } } } } }, projects: { select: { id: true, stage: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }),
      db.project.findMany({ where: { cancelledAt: null, stage: { not: 'COMPLETED' } }, select: { id: true, title: true, dueAt: true, productionStartedAt: true, paused: true, stage: true }, orderBy: { dueAt: 'asc' }, take: 100 }),
      db.receipt.findMany({ select: { grossMinor: true, currency: true } }),
      db.fxReceipt.findMany({ select: { paidSarMinor: true, netEgpMinor: true } }),
      db.employeeEarning.findMany({ where: { status: { in: ['EARNED', 'PAYABLE'] } }, include: { payoutLines: { include: { payout: { select: { status: true } } } } } }),
      db.expense.findMany({ where: { status: 'PAID' }, select: { amountMinor: true, currency: true } }),
      db.paymentClaim.count({ where: { status: 'PENDING' } }),
    ]);
    const overdue = projects.filter(project => project.productionStartedAt && project.dueAt && project.dueAt < new Date() && !project.paused);
    const due = earnings.reduce((sum, earning) => sum + earning.amountMinor - earning.payoutLines.filter(line => line.payout.status === 'CONFIRMED').reduce((part, line) => part + line.amountMinor, 0n), 0n);
    const egpCollected = receipts.filter(receipt => receipt.currency === 'EGP').reduce((sum, receipt) => sum + receipt.grossMinor, 0n);
    const sarCollected = receipts.filter(receipt => receipt.currency === 'SAR').reduce((sum, receipt) => sum + receipt.grossMinor, 0n) + fxReceipts.reduce((sum, receipt) => sum + receipt.paidSarMinor, 0n);
    const egpExpenses = expenses.filter(expense => expense.currency === 'EGP').reduce((sum, expense) => sum + expense.amountMinor, 0n);
    const openOrders = orders.filter(order => {
      if (order.status === 'PROPOSED') return true;
      const collected = order.receipts.reduce((sum, receipt) => sum + receipt.grossMinor, 0n) + order.fxReceipts.reduce((sum, receipt) => sum + receipt.paidSarMinor, 0n);
      return collected < order.totalMinor || order.subscription?.status === 'PENDING' || remainingSubscriptionWork(order) > 0 || !order.projects.length || order.projects.some(project => project.stage !== 'COMPLETED');
    });
    return <>{alert}{heading(user.name)}<p><Link data-tour="start-order" className="button" href="/orders#new-order">إضافة عميل وطلب</Link></p>
      <div className="stats"><MetricCard label="تحصيل مؤكد" value={formatMinor(egpCollected, 'EGP')} note={`${formatMinor(sarCollected, 'SAR')} محصل من اتفاقات سعودية`} quiet={egpCollected === 0n && sarCollected === 0n}/><MetricCard label="مستحقات فريق معتمدة لم تؤكد كاملة" value={formatMinor(due, 'EGP')} quiet={due === 0n}/><MetricCard label="مصروفات مدفوعة" value={formatMinor(egpExpenses, 'EGP')} quiet={egpExpenses === 0n}/><MetricCard label="أعمال متأخرة" value={overdue.length} quiet={!overdue.length} attention={overdue.length > 0}/></div>
      <div className="dashboard-grid"><section className="card"><h2>طلبات تحتاج خطوة</h2>{openOrders.slice(0, 10).map(order => { const collected = order.receipts.reduce((sum, receipt) => sum + receipt.grossMinor, 0n) + order.fxReceipts.reduce((sum, receipt) => sum + receipt.paidSarMinor, 0n); return <div className="setting-row" key={order.id}><Link href={`/orders/${order.id}`}><strong>{order.title}</strong></Link><p>{order.client.lead.name}</p><small>{nextOrderStep(order, collected, user.role)}</small></div>; })}{!openOrders.length && <p className="empty">لا توجد طلبات تنتظر إجراء الآن <Link href="/orders#new-order">سجل عميلًا وطلبًا جديدًا</Link></p>}</section><aside className="stack"><section className="card" data-tour="owner-approvals"><h2>موافقات المالك</h2><div className="status-list"><StatusRow label="طلبات بانتظار الاعتماد" value={orders.filter(order => order.status === 'PROPOSED').length} href="/orders?status=PROPOSED"/><StatusRow label="إثباتات دفع بانتظار التحقق" value={paymentClaims} href="/orders"/><StatusRow label="أعمال بانتظار مراجعة" value={projects.filter(project => ['WAITING_APPROVAL', 'INTERNAL_REVIEW', 'CLIENT_PREVIEW'].includes(project.stage)).length} href="/projects"/></div><ActionLink href="/projects">متابعة الإنتاج</ActionLink></section><section className="card"><h2>المالية اليومية</h2><p className="muted">الأرقام أعلاه من سجلات التحصيل والصرف الفعلية، ولا تمثل ربحًا متاحًا للتوزيع</p><div className="action-links"><ActionLink href="/finance/earnings">مستحقات الفريق</ActionLink><ActionLink href="/finance/expenses">المصروفات</ActionLink></div></section></aside></div>
      {overdue.length > 0 && <section className="card"><h2>أعمال متأخرة</h2>{overdue.slice(0, 10).map(project => <p key={project.id}><Link href={`/projects/${project.id}`}>{project.title}</Link> · {stageLabels[project.stage]}</p>)}</section>}
    </>;
  }
  if (user.role === 'COMMUNICATION') {
    const [orders, leads] = await Promise.all([
      db.customerOrder.findMany({ where: { team: { communicatorId: user.id }, client: { lead: { team: { communicatorId: user.id } } }, status: { in: ['DRAFT', 'PROPOSED', 'APPROVED'] } }, include: { client: { include: { lead: { select: { name: true } } } }, items: { select: { id: true, serviceKindSnapshot: true } }, receipts: { select: { grossMinor: true } }, fxReceipts: { select: { paidSarMinor: true } }, subscription: { select: { status: true, cycles: { select: { status: true, items: { select: { plannedQuantity: true, assignedQuantity: true } } } } } }, projects: { select: { id: true, stage: true } } }, orderBy: { createdAt: 'desc' }, take: 30 }),
      db.lead.findMany({ where: { team: { communicatorId: user.id }, nextFollowUpAt: { lte: new Date() }, status: { notIn: ['CLIENT', 'DECLINED'] } }, select: { id: true, name: true }, take: 20 }),
    ]);
    return <>{alert}{heading(user.name)}<p><Link data-tour="start-order" className="button" href="/orders#new-order">تسجيل عميل وطلب</Link></p><div className="dashboard-grid"><section className="card"><h2>طلباتي والخطوة التالية</h2>{orders.map(order => { const collected = order.receipts.reduce((sum, receipt) => sum + receipt.grossMinor, 0n) + order.fxReceipts.reduce((sum, receipt) => sum + receipt.paidSarMinor, 0n); return <div className="setting-row" key={order.id}><Link href={`/orders/${order.id}`}><strong>{order.title}</strong></Link><p>{order.client.lead.name}</p><small>{nextOrderStep(order, collected, user.role)}</small></div>; })}{!orders.length && <p className="empty">لا توجد طلبات مفتوحة لفريقك <Link href="/orders#new-order">سجل أول عميل وطلب</Link></p>}</section><aside className="card"><h2>متابعات العملاء المستحقة</h2>{leads.map(lead => <p key={lead.id}><Link href={`/leads/${lead.id}`}>{lead.name}</Link></p>)}{!leads.length && <p className="empty">لا توجد متابعات مستحقة الآن <Link href="/leads">عرض العملاء المحتملين</Link></p>}<ActionLink href="/clients">عملاء فريقي</ActionLink></aside></div></>;
  }
  if (user.role === 'EXECUTION') {
    const [projects, earnings] = await Promise.all([
      db.project.findMany({ where: { executorId: user.id, cancelledAt: null, stage: { not: 'COMPLETED' } }, include: { revisions: { where: { status: { in: ['OPEN', 'IN_PROGRESS'] } }, select: { id: true } } }, orderBy: { dueAt: 'asc' }, take: 50 }),
      db.employeeEarning.findMany({ where: { recipientId: user.id, status: { in: ['EARNED', 'PAYABLE'] } }, include: { payoutLines: { include: { payout: { select: { status: true } } } } } }),
    ]);
    const due = earnings.reduce((sum, earning) => sum + earning.amountMinor - earning.payoutLines.filter(line => line.payout.status === 'CONFIRMED').reduce((part, line) => part + line.amountMinor, 0n), 0n);
    return <>{alert}{heading(user.name)}{!projects.length&&<p className="notice">لا توجد أعمال مسندة إليك الآن، ستظهر هنا فور تكليفك <Link href="/projects">عرض كل أعمالي</Link></p>}<div className="stats"><MetricCard label="أعمال مسندة" value={projects.length} quiet={!projects.length}/><MetricCard label="تعديلات مفتوحة" value={projects.reduce((sum, project) => sum + project.revisions.length, 0)} quiet={!projects.some(project => project.revisions.length)} attention={projects.some(project => project.revisions.length > 0)}/><MetricCard label="مستحقات معتمدة متبقية" value={formatMinor(due, 'EGP')} quiet={due === 0n} tour="executor-earnings"/></div><section className="card" data-tour="assigned-work"><h2>أعمالي</h2>{projects.map(project => <div className="setting-row" key={project.id}><Link href={`/projects/${project.id}`}><strong>{project.title}</strong></Link><p>{stageLabels[project.stage]}{project.revisions.length ? ` · ${project.revisions.length} تعديل مطلوب` : ''}</p><small>التسليم {project.dueAt ? project.dueAt.toLocaleDateString('ar-EG-u-nu-latn') : 'غير محدد'}</small></div>)}{!projects.length && <p className="empty">بانتظار تكليف جديد من المالك</p>}<ActionLink href="/finance/earnings">تفاصيل مستحقاتي</ActionLink></section></>;
  }
  return <>{alert}{heading(user.name)}<section className="card"><h2>مساحة العمل</h2><p>لا توجد إجراءات تشغيلية مخصصة لهذا الدور</p></section></>;
}
