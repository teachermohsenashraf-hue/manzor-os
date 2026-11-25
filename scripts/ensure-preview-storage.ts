import { createClient } from '@supabase/supabase-js';
import { assertPreviewIsolation } from '../src/lib/preview-isolation';
import { BUCKET, MAX_FILE_BYTES, MIME_TYPES } from '../src/lib/private-storage-policy';

assertPreviewIsolation({ ...process.env, MANZOOR_ENV: process.env.MANZOOR_ENV ?? 'preview' });
if (process.env.MANZOOR_ENV !== 'preview' || BUCKET !== 'manzoor-test')
  throw new Error('هذا الأمر يعمل في بيئة المعاينة فقط');
if (!process.env.SUPABASE_SECRET_KEY) throw new Error('مفتاح تخزين المعاينة غير متاح في هذه البيئة');

const storage = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
}).storage;
const existing = await storage.getBucket(BUCKET);
if (existing.data) {
  if (existing.data.public) throw new Error('Bucket المعاينة عامة، يلزم مراجعتها');
  console.log('Bucket المعاينة موجودة وخاصة');
} else if (existing.error?.status === 404) {
  const result = await storage.createBucket(BUCKET, {
    public: false, fileSizeLimit: MAX_FILE_BYTES, allowedMimeTypes: [...MIME_TYPES],
  });
  if (result.error) throw new Error('تعذر إنشاء Bucket المعاينة الخاصة');
  console.log('أُنشئت Bucket المعاينة الخاصة');
} else throw new Error('تعذر فحص Bucket المعاينة');
