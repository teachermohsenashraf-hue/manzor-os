import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { BUCKET } from './private-storage-policy';
import { assertPreviewIsolation } from './preview-isolation';

export * from './private-storage-policy';

export async function privateStorage() {
  assertPreviewIsolation(process.env);
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url))
    throw new Error('التخزين الخاص غير معد');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.storage.getBucket(BUCKET);
  if (error || !data || data.public) throw new Error('Bucket التخزين المطلوبة غير موجودة أو ليست خاصة');
  return client.storage.from(BUCKET);
}
