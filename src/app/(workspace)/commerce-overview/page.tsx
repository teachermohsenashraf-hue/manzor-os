import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { formatMinor, orderStatusLabels } from '@/lib/commerce';

export default async function CommerceOverview(){
  const user=await requireUser();if(user.role!=='OWNER')notFound();
  const [orders,services,subscriptions,changes,teams]=await Promise.all([
    db.customerOrder.findMany({select:{id:true,title:true,status:true,marketCode:true,currency:true,totalMinor:true,teamId:true,items:{select:{quantity:true,assignedQuantity:true}}},orderBy:{createdAt:'desc'}}),
    db.service.count({where:{active:true}}),db.subscription.groupBy({by:['status'],_count:{_all:true}}),db.orderChange.count({where:{status:'PENDING'}}),db.team.findMany({select:{id:true,name:true}})
  ]);
  const agreed=new Map<string,bigint>();for(const o of orders.filter(x=>x.status==='APPROVED'))agreed.set(o.currency,(agreed.get(o.currency)??0n)+o.totalMinor);
  return <><div className="page-heading"><div><span className="eyebrow">الإدارة</span><h1>ملخص الخدمات والطلبات</h1><p className="muted">قيم الاتفاقات المعتمدة ليست تحصيلًا أو إيرادًا</p></div></div><div className="stats"><section className="card stat"><small>خدمات معروضة</small><strong>{services}</strong></section><section className="card stat"><small>طلبات تنتظر الاعتماد</small><strong>{orders.filter(o=>o.status==='PROPOSED').length}</strong></section><section className="card stat"><small>تغييرات تنتظر قرارًا</small><strong>{changes}</strong></section></div><div className="dashboard-grid"><section className="card"><h2>الطلبات حسب الحالة</h2>{Object.entries(orderStatusLabels).map(([status,label])=><p key={status}>{label} · {orders.filter(o=>o.status===status).length}</p>)}<h2>قيمة الاتفاقات حسب العملة</h2>{[...agreed].map(([currency,total])=><p key={currency}>{formatMinor(total,currency)}</p>)}{!agreed.size&&<p className="empty">لا توجد اتفاقات معتمدة</p>}<h2>أحدث الطلبات</h2>{orders.slice(0,20).map(o=><p key={o.id}><Link href={`/orders/${o.id}`}>{o.title}</Link> · {orderStatusLabels[o.status]}</p>)}</section><aside className="stack"><section className="card"><h2>الاشتراكات</h2>{subscriptions.map(s=><p key={s.status}>{s.status} · {s._count._all}</p>)}</section><section className="card"><h2>الفرق</h2>{teams.map(t=><p key={t.id}>{t.name} · {orders.filter(o=>o.teamId===t.id).length} طلب</p>)}</section><section className="card"><h2>الكميات المكلفة</h2><strong>{orders.reduce((n,o)=>n+o.items.reduce((m,i)=>m+i.assignedQuantity,0),0)}</strong><small>من بنود الطلبات غير الاشتراكية، والدورات تظهر في صفحة الاشتراكات</small></section></aside></div></>;
}
