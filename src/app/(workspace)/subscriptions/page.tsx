import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import type { Prisma } from '@/generated/prisma/client';

const labels={PENDING:'بانتظار التفعيل',ACTIVE:'نشط',PAUSED:'موقوف',ENDED:'منتهٍ'};
export default async function Subscriptions(){const user=await requireUser();if(!['OWNER','COMMUNICATION'].includes(user.role))notFound();const where:Prisma.SubscriptionWhereInput=user.role==='OWNER'?{}:{order:{team:{communicatorId:user.id},client:{lead:{team:{communicatorId:user.id}}}}};const subscriptions=await db.subscription.findMany({where,include:{order:{include:{client:{include:{lead:{select:{name:true}}}},team:{select:{name:true}}}},cycles:{include:{items:true}}},orderBy:{createdAt:'desc'},take:200});return <><div className="page-heading"><div><span className="eyebrow">التجارة</span><h1>الاشتراكات والدورات</h1><p className="muted">التجديد يدوي عبر اتفاق جديد، ولا يبدأ إنتاج الدورة قبل التفعيل المعتمد</p></div></div><section className="card"><h2>السجل</h2>{subscriptions.length?subscriptions.map(s=><div className="setting-row" key={s.id}><Link href={`/subscriptions/${s.id}`}><strong>{s.order.title}</strong></Link><p>{s.order.client.lead.name} · {s.order.team.name}</p><small>{labels[s.status]} · {s.startsAt.toLocaleDateString('ar-EG-u-nu-latn')} إلى {s.endsAt.toLocaleDateString('ar-EG-u-nu-latn')} · {s.cycles.length} دورة</small></div>):<p className="empty">لا توجد اشتراكات بعد</p>}</section></>}
