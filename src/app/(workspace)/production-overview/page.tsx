import Link from 'next/link';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { stageLabels } from '@/lib/production';
import type { Prisma } from '@/generated/prisma/client';

export default async function ProductionOverview({searchParams}:{searchParams:Promise<{team?:string;executor?:string;client?:string;from?:string;to?:string}>}) {
  const user=await requireUser();
  if(user.role!=='OWNER')return <section className="card"><h1>لوحة الإدارة</h1><p>هذه الصفحة للإدارة فقط</p></section>;
  const f=await searchParams,from=f.from?new Date(`${f.from}T00:00:00`):null,to=f.to?new Date(`${f.to}T23:59:59`):null;
  const where:Prisma.ProjectWhereInput={...(f.team?{teamId:f.team}:{}),...(f.executor?{executorId:f.executor}:{}),...(f.client?{clientId:f.client}:{}),...(from&&!isNaN(from.getTime())||to&&!isNaN(to.getTime())?{createdAt:{...(from&&!isNaN(from.getTime())?{gte:from}:{}),...(to&&!isNaN(to.getTime())?{lte:to}:{})}}:{})};
  const [projects,teams,executors,clients]=await Promise.all([
    db.project.findMany({where,select:{id:true,title:true,stage:true,teamId:true,executorId:true,clientId:true,paused:true,cancelledAt:true,dueAt:true,productionStartedAt:true,completedAt:true,deliveredAt:true,pauses:{select:{reason:true,justified:true,startedAt:true,endedAt:true}},revisions:{select:{kind:true}},client:{include:{lead:{select:{name:true}}}}},orderBy:{createdAt:'desc'}}),
    db.team.findMany({select:{id:true,name:true}}),db.user.findMany({where:{role:'EXECUTION'},select:{id:true,name:true}}),db.client.findMany({include:{lead:{select:{name:true}}}})
  ]);
  const now=new Date(),active=projects.filter(p=>!p.cancelledAt&&p.stage!=='COMPLETED');
  const late=active.filter(p=>p.productionStartedAt&&p.dueAt&&p.dueAt<now&&!p.paused);
  const complete=projects.filter(p=>p.completedAt);
  const withDue=complete.filter(p=>p.dueAt);
  const onTime=withDue.filter(p=>p.completedAt!.getTime()<=p.dueAt!.getTime()+p.pauses.filter(x=>x.justified).reduce((sum,x)=>sum+Math.max(0,(x.endedAt??p.completedAt!).getTime()-x.startedAt.getTime()),0));
  const reasonCount=new Map<string,number>();for(const p of projects)for(const pause of p.pauses)reasonCount.set(pause.reason,(reasonCount.get(pause.reason)??0)+1);
  return <><div className="page-heading"><div><span className="eyebrow">الإنتاج</span><h1>لوحة الإدارة</h1><p className="muted">كل رقم محسوب من المشاريع التي تطابق الفلاتر</p></div></div>
    <form action="/production-overview" className="search-form crm-filters"><label>من<input type="date" name="from" defaultValue={f.from}/></label><label>إلى<input type="date" name="to" defaultValue={f.to}/></label><label>الفريق<select name="team" defaultValue={f.team??''}><option value="">الكل</option>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>المنفذ<select name="executor" defaultValue={f.executor??''}><option value="">الكل</option>{executors.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label><label>العميل<select name="client" defaultValue={f.client??''}><option value="">الكل</option>{clients.map(c=><option key={c.id} value={c.id}>{c.lead.name}</option>)}</select></label><button>تطبيق</button></form>
    <div className="stats"><section className="card stat"><small>كل المشاريع</small><strong>{projects.length}</strong></section><section className="card stat"><small>مكتملة ومقبولة</small><strong>{complete.length}</strong></section><section className="card stat"><small>الالتزام بالموعد</small><strong>{withDue.length?Math.round(onTime.length/withDue.length*100):0}٪</strong><small>{onTime.length} من {withDue.length} مشروع مكتمل له موعد</small></section></div>
    <div className="dashboard-grid"><section className="card"><h2>توزيع المراحل</h2>{Object.entries(stageLabels).map(([stage,label])=><div className="setting-row" key={stage}><Link href={`/projects?stage=${stage}`}>{label}</Link><strong>{projects.filter(p=>p.stage===stage&&!p.cancelledAt).length}</strong></div>)}<h2>أعمال متأخرة</h2>{late.map(p=><div className="setting-row" key={p.id}><Link href={`/projects/${p.id}`}>{p.title}</Link><small>{p.client.lead.name} · {p.dueAt?.toLocaleDateString('ar-EG-u-nu-latn')}</small></div>)}{!late.length&&<p className="empty">لا توجد أعمال متأخرة</p>}<h2>سجل التسليم</h2>{projects.filter(p=>p.deliveredAt).map(p=><p key={p.id}><Link href={`/projects/${p.id}`}>{p.title}</Link> · {p.deliveredAt?.toLocaleDateString('ar-EG-u-nu-latn')}</p>)}</section>
    <aside className="stack"><section className="card"><h2>أداء الفرق</h2>{teams.map(t=><p key={t.id}>{t.name} · {projects.filter(p=>p.teamId===t.id).length} مشروع</p>)}</section><section className="card"><h2>حجم العمل لكل منفذ</h2>{executors.map(e=><p key={e.id}>{e.name} · {active.filter(p=>p.executorId===e.id).length} جارٍ</p>)}</section><section className="card"><h2>إعادة العمل</h2><strong>{projects.reduce((n,p)=>n+p.revisions.filter(r=>r.kind==='CORRECTION').length,0)}</strong><small>جولات تصحيح أخطاء فقط</small></section><section className="card"><h2>أسباب التوقف</h2>{[...reasonCount].map(([reason,count])=><p key={reason}>{reason} · {count}</p>)}</section><section className="card"><h2>بانتظار الاعتماد</h2>{active.filter(p=>['WAITING_APPROVAL','CLIENT_PREVIEW'].includes(p.stage)).map(p=><p key={p.id}><Link href={`/projects/${p.id}`}>{p.title}</Link></p>)}</section></aside></div>
  </>;
}
