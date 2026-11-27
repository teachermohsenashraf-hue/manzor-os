'use server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { cookieName, createSession, digest, requirePermission, requireUser } from '@/lib/auth';
import { hashPassword, verifyPassword } from '@/lib/password';
import { displayNameSchema, passwordSchema, userSchema, usernameSchema } from '@/lib/validation';
import { consumeLoginThrottle } from '@/lib/login-throttle';
import { appOrigin } from '@/lib/preview-isolation';

export type ActionState = { error?: string; success?: string };
async function verifyOrigin() {
  const h = await headers();
  const expected = appOrigin(process.env);
  if (!expected || h.get('origin') !== new URL(expected).origin) throw new Error('مصدر الطلب غير مسموح');
}
export async function login(_: ActionState, form: FormData): Promise<ActionState> {
  await verifyOrigin();
  const parsed = usernameSchema.safeParse(form.get('username'));
  const password = form.get('password');
  if (!parsed.success || typeof password !== 'string' || password.length > 128) return { error: 'بيانات الدخول غير صحيحة' };
  // Account throttle is DB-backed and atomic. Never trust forwarded IP headers by default.
  const key = digest(parsed.data);
  let allowed: boolean;
  try { allowed = await consumeLoginThrottle(key); }
  catch (error) {
    const failure = error as { name?: string; code?: string; meta?: { code?: string } };
    console.error('Login throttle database failure', {
      name: failure.name,
      code: failure.code,
      databaseCode: failure.meta?.code,
    });
    return { error: 'تعذر الاتصال بقاعدة البيانات راجع إعداد الخادم' };
  }
  if (!allowed) return { error: 'محاولات كثيرة حاول بعد 15 دقيقة' };
  const user = await db.user.findUnique({ where: { username: parsed.data } });
  const dummy = 'scrypt-v1:' + '0'.repeat(64) + ':' + '0'.repeat(128);
  const valid = await verifyPassword(password, user?.passwordHash ?? dummy);
  if (!user || !user.active || !valid) return { error: 'بيانات الدخول غير صحيحة' };
  await db.auditLog.create({ data: { actorId: user.id, action: 'LOGIN', subjectId: user.id, detail: {} } });
  await createSession(user.id);
  redirect(user.mustChangePassword ? '/change-password' : '/dashboard');
}
export async function logout() {
  await verifyOrigin();
  const jar = await cookies();
  const token = jar.get(cookieName)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: digest(token) } });
  jar.delete(cookieName);
  redirect('/login');
}
export async function changePassword(_: ActionState, form: FormData): Promise<ActionState> {
  await verifyOrigin();
  const user = await requireUser(true);
  const password = passwordSchema.safeParse(form.get('password'));
  if (!password.success) return { error: password.error.issues[0].message };
  if (password.data !== form.get('confirm')) return { error: 'كلمتا المرور غير متطابقتين' };
  const old = form.get('current');
  if (typeof old !== 'string' || old.length > 128 || !await verifyPassword(old, user.passwordHash)) return { error: 'كلمة المرور الحالية غير صحيحة' };
  if (old === password.data) return { error: 'اختر كلمة مرور مختلفة عن الحالية' };
  const passwordHash = await hashPassword(password.data);
  await db.$transaction(async tx => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.auditLog.create({ data: { actorId: user.id, action: 'PASSWORD_CHANGED', subjectId: user.id, detail: {} } });
  });
  await createSession(user.id);
  redirect('/dashboard');
}
export async function updateOwnName(_: ActionState, form: FormData): Promise<ActionState> {
  await verifyOrigin();
  const user = await requireUser();
  if (!['OWNER', 'MANAGER'].includes(user.role)) return { error: 'تعديل الاسم متاح للمالك والمدير فقط' };
  const parsed = displayNameSchema.safeParse(form.get('name'));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (parsed.data === user.name) return { success: 'الاسم المعروض كما هو' };
  await db.$transaction(async tx => {
    await tx.user.update({ where: { id: user.id }, data: { name: parsed.data } });
    await tx.auditLog.create({ data: { actorId: user.id, action: 'OWN_NAME_CHANGED', subjectId: user.id, detail: { before: user.name, after: parsed.data } } });
  });
  revalidatePath('/dashboard');
  revalidatePath('/change-password');
  return { success: 'حُفظ الاسم المعروض' };
}
export async function createUser(_: ActionState, form: FormData): Promise<ActionState> {
  await verifyOrigin();
  const actor = await requirePermission('users:manage');
  const data = userSchema.safeParse(Object.fromEntries(form));
  if (!data.success) return { error: data.error.issues[0].message };
  const { password, ...fields } = data.data;
  const passwordHash = await hashPassword(password);
  try {
    await db.$transaction(async tx => {
      const user = await tx.user.create({ data: { ...fields, passwordHash } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: 'USER_CREATED', subjectId: user.id, detail: { role: user.role, username: user.username } } });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { error: 'اسم المستخدم مستخدم بالفعل' };
    throw e;
  }
  revalidatePath('/users');
  return { success: 'أُنشئ الحساب سيُطلب تغيير كلمة المرور عند أول دخول' };
}
export async function updateUser(_: ActionState, form: FormData): Promise<ActionState> {
  await verifyOrigin();
  const actor = await requirePermission('users:manage');
  const id = String(form.get('id') ?? '');
  const role = String(form.get('role') ?? '');
  if (!['MANAGER', 'COMMUNICATION', 'EXECUTION'].includes(String(role))) return { error: 'دور غير صالح' };
  const result = await db.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { id } });
    if (!user || user.role === 'OWNER' || user.id === actor.id) return { error: 'لا يمكن تعديل حساب المالك من هذه الشاشة' };
    const active = form.get('active') === 'on';
    await tx.user.update({ where: { id }, data: { role: role as 'MANAGER' | 'COMMUNICATION' | 'EXECUTION', active } });
    await tx.session.deleteMany({ where: { userId: id } });
    await tx.auditLog.create({ data: { actorId: actor.id, action: 'USER_ACCESS_CHANGED', subjectId: id, detail: { before: { role: user.role, active: user.active }, after: { role, active } } } });
    return { success: 'حُدّثت الصلاحيات وأُغلقت جلسات المستخدم السابقة' };
  });
  revalidatePath('/users');
  return result;
}
export async function resetPassword(_: ActionState, form: FormData): Promise<ActionState> {
  await verifyOrigin();
  const actor = await requirePermission('users:manage');
  const id = String(form.get('id') ?? '');
  const parsed = passwordSchema.safeParse(form.get('password'));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const target = await db.user.findUnique({ where: { id } });
  if (!target || target.role === 'OWNER') return { error: 'الحساب غير متاح لإعادة التعيين' };
  const passwordHash = await hashPassword(parsed.data);
  await db.$transaction(async tx => {
    await tx.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true } });
    await tx.session.deleteMany({ where: { userId: id } });
    await tx.auditLog.create({ data: { actorId: actor.id, action: 'PASSWORD_RESET', subjectId: id, detail: {} } });
  });
  return { success: 'أُعيد تعيين كلمة المرور وأُغلقت الجلسات السابقة' };
}
