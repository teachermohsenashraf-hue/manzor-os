import { OwnNameForm, PasswordForm } from '@/components/forms';
import { requireUser } from '@/lib/auth';
export default async function ChangePassword() {
  const user = await requireUser(true);
  const canEditName = !user.mustChangePassword && ['OWNER', 'MANAGER'].includes(user.role);
  return <main className="standalone card"><span className="eyebrow">حسابي</span><h1>{canEditName ? 'الاسم وكلمة المرور' : 'تحديث كلمة المرور'}</h1>
    {canEditName && <section className="account-section"><h2>الاسم المعروض</h2><p className="muted">يظهر لفريقك داخل النظام، ولا يغيّر اسم المستخدم الذي تدخل به</p><OwnNameForm name={user.name}/></section>}
    <section className="account-section"><h2>كلمة المرور</h2><p className="muted">عند تغييرها تُغلق جلساتك السابقة</p><PasswordForm/></section>
  </main>;
}
