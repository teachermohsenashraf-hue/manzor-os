import Link from 'next/link';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { stageLabels } from '@/lib/production';
import { createProject } from '@/app/production-actions';
import { ProductionForm } from '@/components/production-form';
import type { Prisma, ProjectStage } from '@/generated/prisma/client';

export default async function Projects({searchParams}:{searchParams:Promise<{stage?:string;team?:string;executor?:string;client?:string}>}) {
  const user=await requireUser(), filters=await searchParams;
  const scope:Prisma.ProjectWhereInput=user.role==='OWNER'?{}:user.role==='COMMUNICATION'?{team:{communicatorId:user.id}}:user.role==='EXECUTION'?{executorId:user.id}:{id:'none'};
  const where:Prisma.ProjectWhereInput={AND:[scope,filters.stage&&filters.stage in stageLabels?{stage:filters.stage as ProjectStage}:{},filters.team?{teamId:filters.team}:{},filters.executor?{executorId:filters.executor}:{},filters.client?{clientId:filters.client}:{}]};
  const [projects,teams,clients,executors]=await Promise.all([
    db.project.findMany({where,include:{client:{include:{lead:{select:{name:true}}}},team:{select:{name:true}},executor:{select:{name:true}}},orderBy:{createdAt:'desc'},take:150}),
    db.team.findMany({where:user.role==='OWNER'?{}:{OR:[{communicatorId:user.id},{executorId:user.id}]},select:{id:true,name:true,executorId:true},orderBy:{name:'asc'}}),
    ['OWNER','COMMUNICATION'].includes(user.role)?db.client.findMany({where:user.role==='OWNER'?{}:{lead:{team:{communicatorId:user.id}}},include:{lead:{select:{name:true,teamId:true}}},take:200}):Promise.resolve([]),
    user.role==='OWNER'?db.user.findMany({where:{role:'EXECUTION',active:true},select:{id:true,name:true}}):Promise.resolve([])
  ]);
  const active=projects.filter(p=>!p.cancelledAt&&p.stage!=='COMPLETED');
  const now=new Date();
  return <><div className="page-heading"><div><span className="eyebrow">الإنتاج</span><h1>التكليفات والمشاريع</h1><p className="muted">متابعة العمل من المتطلبات حتى القبول النهائي</p></div></div>
    <div className="stats"><section className="card stat"><small>أعمال جارية</small><strong>{active.length}</strong></section><section className="card stat"><small>بانتظار اعتماد</small><strong>{active.filter(p=>['WAITING_APPROVAL','CLIENT_PREVIEW'].includes(p.stage)).length}</strong></section><section className="card stat"><small>متأخرة</small><strong>{active.filter(p=>p.productionStartedAt&&p.dueAt&&p.dueAt<now&&!p.paused).length}</strong></section></div>
    <form className="search-form crm-filters" action="/projects"><label>المرحلة<select name="stage" defaultValue={filters.stage??''}><option value="">الكل</option>{Object.entries(stageLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>الفريق<select name="team" defaultValue={filters.team??''}><option value="">الكل</option>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>{user.role==='OWNER'&&<label>المنفذ<select name="executor" defaultValue={filters.executor??''}><option value="">الكل</option>{executors.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>}<label>العميل<select name="client" defaultValue={filters.client??''}><option value="">الكل</option>{clients.map(c=><option key={c.id} value={c.id}>{c.lead.name}</option>)}</select></label><button>تطبيق الفلاتر</button></form>
    <div className="dashboard-grid"><section className="card"><h2>قائمة العمل</h2>{projects.length?projects.map(p=><div className="setting-row" key={p.id}><Link href={`/projects/${p.id}`}><strong>{p.title}</strong></Link><p>{p.client.lead.name} · {p.team.name} · {p.executor.name}</p><small>{p.cancelledAt?'ملغى':p.paused?'متوقف':stageLabels[p.stage]}{p.dueAt?` · ${p.dueAt.toLocaleDateString('ar-EG')}`:''}</small></div>):<p className="empty">لا توجد مشاريع في هذا النطاق</p>}</section>
    {['OWNER','COMMUNICATION'].includes(user.role)&&<aside className="card"><h2>تكليف جديد</h2><ProductionForm action={createProject} label="إنشاء التكليف"><label>اسم العمل<input name="title" required minLength={2}/></label><label>العميل الفعلي<select name="clientId" required><option value="">اختر العميل</option>{clients.map(c=><option key={c.id} value={c.id}>{c.lead.name}</option>)}</select></label><label>الفريق<select name="teamId" required><option value="">اختر الفريق</option>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>نوع الخدمة<select name="serviceType"><option value="POSTER">بوستر</option><option value="VIDEO">فيديو</option><option value="VIDEO_POSTER">فيديو وبوستر</option><option value="VIDEO_3_POSTERS">فيديو وثلاثة بوسترات</option><option value="SCRIPT_TREATMENT">سكريبت وتصور</option><option value="OTHER">أخرى</option></select></label><label>وصف المطلوب<textarea name="brief" required rows={3}/></label><label>المتطلبات<textarea name="requirements" required rows={3}/></label><label>موعد التسليم<input type="datetime-local" name="dueAt" required/></label><label>الأولوية<select name="priority"><option value="NORMAL">عادية</option><option value="HIGH">عالية</option><option value="LOW">منخفضة</option></select></label><label>ملاحظات<textarea name="notes" rows={2}/></label><label className="check"><input type="checkbox" name="requirementsComplete"/>المتطلبات مكتملة</label></ProductionForm></aside>}</div>
  </>;
}
