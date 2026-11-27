import Link from 'next/link';
import { LayoutDashboard, Users, ShieldCheck, Settings, LogOut, LockKeyhole, UsersRound, ContactRound, BriefcaseBusiness, Clapperboard, Package, FileText, CalendarDays, Wallet } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { can, roleLabels } from '@/lib/permissions';
import { logout } from '@/app/actions';
import { ThemeToggle } from '@/components/theme-toggle';
import { Brand } from '@/components/brand';
import { NavLink } from '@/components/nav-link';
import { QuickTour } from '@/components/quick-tour';
import { MobileSidebar } from '@/components/mobile-sidebar';

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const owner = user.role === 'OWNER';
  const communication = user.role === 'COMMUNICATION';
  const execution = user.role === 'EXECUTION';
  return <div className="workspace"><a className="skip" href="#main">تخطي إلى المحتوى</a><MobileSidebar>
    <Link href="/dashboard" aria-label="منظور الرئيسية"><Brand /></Link><span className="nav-label">العمل اليومي</span>
    <nav aria-label="التنقل الرئيسي">
      <div className="nav-main">
        <NavLink href="/dashboard"><LayoutDashboard size={20} />الرئيسية</NavLink>
        {(owner || communication) && <><NavLink href="/orders"><FileText size={20} />الطلبات</NavLink><NavLink href="/clients"><BriefcaseBusiness size={20} />العملاء</NavLink></>}
        {(owner || communication || execution) && <NavLink href="/projects"><Clapperboard size={20} />الأعمال</NavLink>}
        {(owner || communication || execution) && <NavLink href="/finance/earnings"><Wallet size={20} />{owner ? 'مستحقات الفريق' : 'مستحقاتي'}</NavLink>}
        {owner && <NavLink href="/finance/expenses"><Wallet size={20} />المصروفات</NavLink>}
      </div>
      <div className="nav-extra">
        {(owner || communication) && <details><summary>أدوات إضافية</summary><div className="stack">
          <NavLink href="/crm-overview"><ContactRound size={18} />متابعة العملاء</NavLink>
          <NavLink href="/leads"><ContactRound size={18} />العملاء المحتملون</NavLink>
          {owner && <><NavLink href="/teams"><UsersRound size={18} />الفرق</NavLink><NavLink href="/services"><Package size={18} />الخدمات والأسعار</NavLink><NavLink href="/subscriptions"><CalendarDays size={18} />الاشتراكات</NavLink><NavLink href="/commerce-overview"><LayoutDashboard size={18} />تقارير الطلبات</NavLink><NavLink href="/finance"><Wallet size={18} />التفاصيل المالية</NavLink><NavLink href="/production-overview"><LayoutDashboard size={18} />تقارير الإنتاج</NavLink></>}
        </div></details>}
        {can(user.role, 'users:manage') && <NavLink href="/users"><Users size={20} />حسابات الفريق</NavLink>}
        {can(user.role, 'audit:read') && <details><summary>إدارة النظام</summary><div className="stack">
          <NavLink href="/audit"><ShieldCheck size={18} />سجل التدقيق</NavLink>
          <NavLink href="/settings"><Settings size={18} />الإعدادات</NavLink>
        </div></details>}
        <NavLink href="/change-password"><LockKeyhole size={20} />{owner || user.role === 'MANAGER' ? 'حسابي' : 'كلمة المرور'}</NavLink>
      </div>
    </nav>
    <div className="sidebar-bottom"><div className="avatar">{user.name.slice(0, 1)}</div><div><strong>{user.name}</strong><small>{roleLabels[user.role]}</small></div><form action={logout}><button className="icon-button" aria-label="تسجيل الخروج"><LogOut size={18} /></button></form></div>
  </MobileSidebar><div className="workspace-body"><header className="topbar"><span>مساحة العمل <span className="slash">/</span> استوديو منظور</span><div><span className="private-label"><LockKeyhole size={14} />وصول داخلي</span><QuickTour role={user.role} /><ThemeToggle /></div></header><main id="main" className="content">{children}</main><footer className="workspace-footer">منظور نرى التفاصيل التي تصنع الفرق<span>إدارة العلاقات والطلبات والإنتاج</span></footer></div></div>;
}
