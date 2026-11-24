import { z } from 'zod';
export const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{3,64}$/, 'اسم المستخدم: 3–64 حرفًا إنجليزيًا أو رقمًا');
export const passwordSchema = z.string().min(12, 'استخدم 12 حرفًا على الأقل').max(128, 'الحد الأقصى 128 حرفًا');
export const userSchema = z.object({
  name: z.string().trim().min(2, 'أدخل الاسم الكامل').max(120),
  username: usernameSchema,
  password: passwordSchema,
  role: z.enum(['MANAGER', 'COMMUNICATION', 'EXECUTION']),
  contact: z.string().trim().max(160)
});
