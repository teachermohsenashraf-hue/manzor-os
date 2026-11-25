import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url))
  throw new Error('ضع SUPABASE_URL وSUPABASE_SECRET_KEY في .env محليًا دون طباعتهما');
const storage = createClient(url, key, { auth: { persistSession: false } }).storage;
const bucket = 'manzoor-production';
const mime = [
  'application/pdf','image/png','image/jpeg','image/webp','image/svg+xml',
  'video/mp4','video/quicktime','application/zip','text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const existing = await storage.getBucket(bucket);
if (existing.data) {
  if (existing.data.public) throw new Error('Bucket موجودة لكنها عامة، أوقفها وراجع محتواها قبل الاستخدام');
  console.log('Bucket الإنتاج موجودة وخاصة');
} else if (existing.error?.status === 404) {
  const result = await storage.createBucket(bucket, { public: false, fileSizeLimit: 50 * 1024 * 1024, allowedMimeTypes: mime });
  if (result.error) throw new Error('تعذر إنشاء Bucket الخاصة');
  console.log('أُنشئت Bucket الإنتاج الخاصة بقيود الحجم والنوع');
} else throw new Error('تعذر فحص Bucket الإنتاج');
