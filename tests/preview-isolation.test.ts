import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPreviewIsolation } from '../src/lib/preview-isolation';

const ref = 'qepccducwytxchzstgsh';
const preview = {
  VERCEL_ENV: 'preview', MANZOOR_ENV: 'preview',
  SUPABASE_URL: `https://${ref}.supabase.co`, SUPABASE_SECRET_KEY: 'test-only',
  DATABASE_URL: `postgresql://manzoor_preview_app:secret@db.${ref}.supabase.co:5432/postgres?schema=manzoor_test`,
  DIRECT_URL: `postgresql://manzoor_preview_app:secret@db.${ref}.supabase.co:5432/postgres?schema=manzoor_test`,
  APP_ORIGIN: 'https://manzor-os-preview.vercel.app',
};

test('preview accepts only its own project, schema and origin', () => {
  assert.doesNotThrow(() => assertPreviewIsolation(preview));
  assert.throws(() => assertPreviewIsolation({ ...preview, MANZOOR_ENV: '' }), /غير مضبوطة/);
  assert.throws(() => assertPreviewIsolation({ ...preview, SUPABASE_URL: 'https://anotherproject123456.supabase.co' }), /الحالي/);
  assert.throws(() => assertPreviewIsolation({ ...preview, DATABASE_URL: preview.DATABASE_URL.replace('manzoor_test', 'public') }), /manzoor_test/);
  assert.throws(() => assertPreviewIsolation({ ...preview, DIRECT_URL: preview.DIRECT_URL.replace(ref, 'anotherproject123456') }), /الدور المحدود/);
  assert.throws(() => assertPreviewIsolation({ ...preview, DATABASE_URL: preview.DATABASE_URL.replace('manzoor_preview_app', 'postgres') }), /الدور المحدود/);
  assert.throws(() => assertPreviewIsolation({ ...preview, DIRECT_URL: preview.DIRECT_URL.replace('manzoor_preview_app', 'postgres') }), /الدور المحدود/);
  assert.throws(() => assertPreviewIsolation({ ...preview, APP_ORIGIN: 'https://manzor-os.vercel.app' }), /عنوانها المستقل/);
});

test('Vercel preview fails closed when configuration is missing', () => {
  assert.throws(() => assertPreviewIsolation({ VERCEL_ENV: 'preview' }), /غير مضبوطة/);
  assert.throws(() => assertPreviewIsolation({ ...preview, SUPABASE_SECRET_KEY: '' }), /تخزين خاص/);
  assert.doesNotThrow(() => assertPreviewIsolation({ ...preview, VERCEL_ENV: undefined, APP_ORIGIN: 'http://localhost:3000', SUPABASE_SECRET_KEY: undefined }));
});
