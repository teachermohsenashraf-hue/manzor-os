'use client';
import { useActionState } from 'react';
import { login, changePassword, createUser, updateUser, resetPassword, type ActionState } from '@/app/actions';
function Feedback({ state }: { state: ActionState }) {
  return <>{state.error && <p className="message error" role="alert">{state.error}</p>}{state.success && <p className="message success" role="status">{state.success}</p>}</>;
}
export function LoginForm() {
  const [state, action, pending] = useActionState(login, {});
  return <form action={action} className="stack"><label>اسم المستخدم<input name="username" autoComplete="username" dir="ltr" required maxLength={64}/></label><label>كلمة المرور<input type="password" name="password" autoComplete="current-password" required maxLength={128}/></label><Feedback state={state}/><button disabled={pending}>{pending ? 'جارٍ التحقق' : 'دخول إلى مساحة العمل'}</button></form>;
}
export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, {});
  return <form action={action} className="stack"><label>كلمة المرور الحالية<input type="password" name="current" autoComplete="current-password" required maxLength={128}/></label><label>كلمة المرور الجديدة<input type="password" name="password" autoComplete="new-password" dir="ltr" required minLength={8} maxLength={128} pattern="[A-Za-z0-9]{8,128}"/><small>8 أحرف أو أرقام إنجليزية على الأقل</small></label><label>تأكيد كلمة المرور<input type="password" name="confirm" autoComplete="new-password" dir="ltr" required minLength={8} maxLength={128} pattern="[A-Za-z0-9]{8,128}"/></label><Feedback state={state}/><button disabled={pending}>{pending ? 'جارٍ الحفظ' : 'حفظ ومتابعة'}</button></form>;
}
function Roles({ value = 'COMMUNICATION' }: { value?: string }) {
  return <label>الدور<select name="role" defaultValue={value}><option value="COMMUNICATION">مسؤول التواصل</option><option value="EXECUTION">مسؤول التنفيذ</option><option value="MANAGER">مشرف صلاحيات محدودة</option></select></label>;
}
export function NewUserForm() {
  const [state, action, pending] = useActionState(createUser, {});
  return <form action={action} className="stack"><label>الاسم الكامل<input name="name" required minLength={2} maxLength={120}/></label><label>اسم المستخدم<input name="username" dir="ltr" required pattern="[a-zA-Z0-9_.-]{3,64}" maxLength={64} autoComplete="off"/></label><Roles/><label>بيانات التواصل المهنية<input name="contact" maxLength={160}/></label><label>كلمة مرور أولية<input name="password" type="password" dir="ltr" required minLength={8} maxLength={128} pattern="[A-Za-z0-9]{8,128}" autoComplete="new-password"/><small>8 أحرف أو أرقام إنجليزية على الأقل وسيغيرها المستخدم عند أول دخول</small></label><Feedback state={state}/><button disabled={pending}>{pending ? 'جارٍ الإنشاء' : 'إنشاء الحساب'}</button></form>;
}
export function UserAccessForm({ id, role, active }: { id: string; role: string; active: boolean }) {
  const [state, action, pending] = useActionState(updateUser, {});
  const [reset, resetAction, resetting] = useActionState(resetPassword, {});
  return <details><summary>إدارة الحساب</summary><form action={action} className="stack"><input type="hidden" name="id" value={id}/><Roles value={role}/><label className="check"><input name="active" type="checkbox" defaultChecked={active}/>حساب نشط</label><Feedback state={state}/><button disabled={pending}>حفظ الصلاحيات</button></form><form action={resetAction} className="stack reset"><input type="hidden" name="id" value={id}/><label>كلمة مرور أولية جديدة<input name="password" type="password" dir="ltr" minLength={8} maxLength={128} pattern="[A-Za-z0-9]{8,128}" required autoComplete="new-password"/></label><Feedback state={reset}/><button className="secondary" disabled={resetting}>إعادة تعيين كلمة المرور</button></form></details>;
}
