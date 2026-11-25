import Link from 'next/link';
import { LayoutDashboard, Users, ShieldCheck, Settings, LogOut, LockKeyhole, UsersRound, ContactRound, BriefcaseBusiness, Clapperboard, Package, FileText, CalendarDays, Wallet } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { can, roleLabels } from '@/lib/permissions';
import { logout } from '@/app/actions';
import { ThemeToggle } from '@/components/theme-toggle';
import { Brand } from '@/components/brand';

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const owner = user.role === 'OWNER';
  const communication = user.role === 'COMMUNICATION';
  const execution = user.role === 'EXECUTION';
  return <div className="workspace"><a className="skip" href="#main">تخطي إلى المحتوى</a><aside className="sidebar">
    <Link href="/dashboard" aria-label="منظور الرئيسية"><Brand /></Link><span className="nav-label">العمل اليومي</span>
    <nav aria-label="التنقل الرئيسي">
      <Link href="/dashboard"><LayoutDashboard size={20} />الرئيسية</Link>
      {(owner || communication) && <><Link href="/orders"><FileText size={20} />الطلبات</Link><Link href="/clients"><BriefcaseBusiness size={20} />العملاء</Link></>}
      {(owner || communication || execution) && <Link href="/projects"><Clapperboard size={20} />الأعمال</Link>}
      {(owner || communication || execution) && <Link href="/finance/earnings"><Wallet size={20} />{owner ? 'مستحقات الفريق' : 'مستحقاتي'}</Link>}
      {owner && <Link href="/finance/expenses"><Wallet size={20} />المصروفات</Link>}
      {(owner || communication) && <details><summary>أدوات إضافية</summary><div className="stack">
        <Link href="/crm-overview"><ContactRound size={18} />متابعة العملاء</Link>
        <Link href="/leads"><ContactRound size={18} />العملاء المحتملون</Link>
        {owner && <><Link href="/teams"><UsersRound size={18} />الفرق</Link><Link href="/services"><Package size={18} />الخدمات والأسعار</Link><Link href="/subscriptions"><CalendarDays size={18} />الاشتراكات</Link><Link href="/commerce-overview"><LayoutDashboard size={18} />تقارير الطلبات</Link><Link href="/finance"><Wallet size={18} />التفاصيل المالية</Link><Link href="/production-overview"><LayoutDashboard size={18} />تقارير الإنتاج</Link></>}
      </div></details>}
      {can(user.role, 'users:manage') && <Link href="/users"><Users size={20} />حسابات الفريق</Link>}
      {can(user.role, 'audit:read') && <details><summary>إدارة النظام</summary><div className="stack">
        <Link href="/audit"><ShieldCheck size={18} />سجل التدقيق</Link>
        <Link href="/settings"><Settings size={18} />الإعدادات</Link>
      </div></details>}
      <Link href="/change-password"><LockKeyhole size={20} />كلمة المرور</Link>
    </nav>
    <div className="sidebar-bottom"><div className="avatar">{user.name.slice(0, 1)}</div><div><strong>{user.name}</strong><small>{roleLabels[user.role]}</small></div><form action={logout}><button className="icon-button" aria-label="تسجيل الخروج"><LogOut size={18} /></button></form></div>
  </aside><div className="workspace-body"><header className="topbar"><span>مساحة العمل <span className="slash">/</span> استوديو منظور</span><div><span className="private-label"><LockKeyhole size={14} />وصول داخلي</span><ThemeToggle /></div></header><main id="main" className="content">{children}</main><footer className="workspace-footer">منظور نرى التفاصيل التي تصنع الفرق<span>إدارة العلاقات والطلبات والإنتاج</span></footer></div></div>;
}
