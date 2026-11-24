import { PasswordForm } from '@/components/forms';
import { requireUser } from '@/lib/auth';
export default async function ChangePassword() {
  await requireUser(true);
  return <main className="standalone card"><span className="eyebrow">حماية حسابك</span><h1>تحديث كلمة المرور</h1><p className="muted">اختر كلمة مرور خاصة بك ستُغلق جلساتك السابقة عند الحفظ</p><PasswordForm/></main>;
}
