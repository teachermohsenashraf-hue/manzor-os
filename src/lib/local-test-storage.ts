import 'server-only';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertPreviewIsolation } from './preview-isolation';

export function localTestStorageEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (env.MANZOOR_LOCAL_STORAGE !== '1') return false;
  if (env.NODE_ENV !== 'development' || env.MANZOOR_ENV !== 'preview' || env.VERCEL_ENV ||
      !/^http:\/\/localhost:\d+$/.test(env.APP_ORIGIN ?? '') ||
      env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('محاكي الملفات متاح للاختبار المحلي المعزول فقط');
  assertPreviewIsolation(env);
  return true;
}

function filePath(storageKey: string) {
  if (!/^[a-z0-9]+\/[0-9a-f-]{36}\.[a-z0-9]+$/.test(storageKey))
    throw new Error('مسار ملف الاختبار غير صالح');
  return path.join(process.cwd(), '.local-storage', ...storageKey.split('/'));
}

export async function putLocalTestFile(storageKey: string, bytes: Uint8Array, mimeType: string) {
  if (!localTestStorageEnabled()) throw new Error('محاكي الملفات غير متاح');
  const target = filePath(storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: 'wx' });
  await writeFile(`${target}.json`, JSON.stringify({ mimeType, sizeBytes: bytes.length }), { flag: 'wx' });
}

export async function localTestFileInfo(storageKey: string) {
  if (!localTestStorageEnabled()) throw new Error('محاكي الملفات غير متاح');
  const target = filePath(storageKey);
  const [metadata, details] = await Promise.all([readFile(`${target}.json`, 'utf8'), stat(target)]);
  const parsed = JSON.parse(metadata) as { mimeType: string; sizeBytes: number };
  if (details.size !== parsed.sizeBytes) throw new Error('حجم ملف الاختبار تغير');
  return { size: details.size, contentType: parsed.mimeType };
}

export async function readLocalTestFile(storageKey: string) {
  if (!localTestStorageEnabled()) throw new Error('محاكي الملفات غير متاح');
  return readFile(filePath(storageKey));
}
