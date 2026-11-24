import Link from 'next/link';
import { requirePermission } from '@/lib/auth';
import { db } from '@/lib/db';
const labels:Record<string,string>={LOGIN:'تسجيل دخول',USER_CREATED:'إنشاء حساب',USER_ACCESS_CHANGED:'تغيير الصلاحيات',PASSWORD_CHANGED:'تغيير كلمة المرور',PASSWORD_RESET:'إعادة تعيين كلمة المرور',OWNER_CREATED:'تهيئة حساب المالك'};
export default async function AuditPage({searchParams}:{searchParams:Promise<{page?:string}>}) {
  await requirePermission('audit:read');
  const params=await searchParams;
  const page=Math.min(10000,Math.max(1,Number.parseInt(params.page??'1')||1));
  const [logs,count]=await Promise.all([db.auditLog.findMany({orderBy:{createdAt:'desc'},take:30,skip:(page-1)*30,include:{actor:{select:{name:true}}}}),db.auditLog.count()]);
  return <><div className="page-heading"><div><span className="eyebrow">الرقابة والشفافية</span><h1>سجل التدقيق</h1><p className="muted">من قام بالتغيير ومتى وما الذي تغيّر</p></div></div><div className="card table-card table-wrap"><table><thead><tr><th>الحدث</th><th>المستخدم</th><th>التاريخ</th><th>التفاصيل</th></tr></thead><tbody>{logs.map(log=><tr key={log.id}><td>{labels[log.action]??log.action}</td><td>{log.actor?.name??'تهيئة النظام'}</td><td>{new Intl.DateTimeFormat('ar-EG',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Cairo'}).format(log.createdAt)}</td><td><details><summary>عرض التفاصيل</summary><pre dir="ltr" style={{whiteSpace:'pre-wrap',maxWidth:400,fontSize:14}}>{JSON.stringify({subjectId:log.subjectId,detail:log.detail},null,2)}</pre></details></td></tr>)}</tbody></table>{!logs.length&&<p className="empty">لا توجد أحداث مسجلة بعد</p>}</div><div className="pagination">{page>1&&<Link href={`/audit?page=${page-1}`}>السابق</Link>}<span>صفحة {page}</span>{page*30<count&&<Link href={`/audit?page=${page+1}`}>التالي</Link>}</div></>;
}
