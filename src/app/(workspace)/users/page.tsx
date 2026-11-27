import Link from 'next/link';
import { requirePermission } from '@/lib/auth';
import { db } from '@/lib/db';
import { roleLabels } from '@/lib/permissions';
import { NewUserForm, UserAccessForm } from '@/components/forms';
export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requirePermission('users:manage');
  const params = await searchParams;
  const q = (params.q ?? '').slice(0, 120);
  const page = Math.min(10000, Math.max(1, Number.parseInt(params.page ?? '1') || 1));
  const where = { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { username: { contains: q, mode: 'insensitive' as const } }] };
  const [users, count] = await Promise.all([db.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page-1)*20, take: 20, select: { id:true,name:true,username:true,role:true,active:true } }), db.user.count({ where })]);
  return <><div className="page-heading"><div><span className="eyebrow">الفريق</span><h1>الحسابات والصلاحيات</h1><p className="muted">حسابات فردية ومسؤوليات واضحة</p></div><span className="badge">{count.toLocaleString('en-US')} حساب</span></div><form className="search-form"><input name="q" defaultValue={q} placeholder="ابحث بالاسم أو اسم المستخدم" aria-label="البحث في الحسابات"/><button className="secondary">بحث</button></form><div className="users-grid"><section><div className="card table-card table-wrap"><table><thead><tr><th>عضو الفريق</th><th>الدور</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{users.map(user=><tr key={user.id}><td><strong>{user.name}</strong><small dir="ltr">{user.username}</small></td><td>{roleLabels[user.role]}</td><td><span className="badge">{user.active?'نشط':'موقوف'}</span></td><td>{user.role==='OWNER'?<small>حساب المالك محمي</small>:<UserAccessForm id={user.id} role={user.role} active={user.active}/>}</td></tr>)}</tbody></table>{!users.length&&<p className="empty">لا توجد حسابات مطابقة للبحث</p>}</div><div className="pagination">{page>1&&<Link href={`/users?q=${encodeURIComponent(q)}&page=${page-1}`}>السابق</Link>}<span>صفحة {page}</span>{page*20<count&&<Link href={`/users?q=${encodeURIComponent(q)}&page=${page+1}`}>التالي</Link>}</div></section><aside className="card"><h2>إضافة عضو للفريق</h2><p className="muted">يُنشأ الحساب بواسطة المالك فقط</p><NewUserForm/></aside></div></>;
}
