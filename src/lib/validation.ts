import { z } from 'zod';
export const displayNameSchema = z.string().trim().min(2, 'أدخل الاسم الكامل').max(120, 'الاسم طويل جدًا');
export const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{3,64}$/, 'اسم المستخدم: 3–64 حرفًا إنجليزيًا أو رقمًا');
export const passwordSchema = z.string()
  .min(8, 'استخدم 8 أحرف أو أرقام إنجليزية على الأقل')
  .max(128, 'الحد الأقصى 128 حرفًا')
  .regex(/^[A-Za-z0-9]+$/, 'استخدم أحرفًا أو أرقامًا إنجليزية فقط');
export const userSchema = z.object({
  name: displayNameSchema,
  username: usernameSchema,
  password: passwordSchema,
  role: z.enum(['MANAGER', 'COMMUNICATION', 'EXECUTION']),
  contact: z.string().trim().max(160)
});
