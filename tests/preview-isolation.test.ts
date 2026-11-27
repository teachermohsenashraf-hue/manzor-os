import test from 'node:test';
import assert from 'node:assert/strict';
import { appOrigin, assertPreviewIsolation } from '../src/lib/preview-isolation';

const ref = 'qepccducwytxchzstgsh';
const preview = {
  VERCEL_ENV: 'preview', MANZOOR_ENV: 'preview',
  SUPABASE_URL: `https://${ref}.supabase.co`, SUPABASE_SECRET_KEY: '',
  DATABASE_URL: `postgresql://manzoor_preview_app:secret@db.${ref}.supabase.co:5432/postgres?schema=manzoor_test`,
  DIRECT_URL: `postgresql://manzoor_preview_app:secret@db.${ref}.supabase.co:5432/postgres?schema=manzoor_test`,
  APP_ORIGIN: 'https://manzor-os-preview.vercel.app',
};

test('preview accepts only its own project, schema and origin', () => {
  assert.doesNotThrow(() => assertPreviewIsolation(preview));
  assert.throws(() => assertPreviewIsolation({ ...preview, MANZOOR_ENV: '' }), /غير مضبوطة/);
  assert.throws(() => assertPreviewIsolation({ ...preview, SUPABASE_URL: 'https://anotherproject123456.supabase.co' }), /المعتمد/);
  assert.throws(() => assertPreviewIsolation({ ...preview, DATABASE_URL: preview.DATABASE_URL.replace('manzoor_test', 'public') }), /manzoor_test/);
  assert.throws(() => assertPreviewIsolation({ ...preview, DIRECT_URL: preview.DIRECT_URL.replace(ref, 'anotherproject123456') }), /الدور المحدود/);
  assert.throws(() => assertPreviewIsolation({ ...preview, DATABASE_URL: preview.DATABASE_URL.replace('manzoor_preview_app', 'postgres') }), /الدور المحدود/);
  assert.throws(() => assertPreviewIsolation({ ...preview, DIRECT_URL: preview.DIRECT_URL.replace('manzoor_preview_app', 'postgres') }), /الدور المحدود/);
  assert.throws(() => assertPreviewIsolation({ ...preview, APP_ORIGIN: 'https://manzor-os.vercel.app' }), /عنوانها المستقل/);
});

test('Vercel preview fails closed when configuration is missing', () => {
  assert.throws(() => assertPreviewIsolation({ VERCEL_ENV: 'preview' }), /غير مضبوطة/);
  assert.throws(() => assertPreviewIsolation({ ...preview, SUPABASE_SECRET_KEY: 'test-only' }), /لا تستخدم مفتاح/);
  assert.throws(() => assertPreviewIsolation({ ...preview, SUPABASE_SERVICE_ROLE_KEY: 'test-only' }), /لا تستخدم مفتاح/);
  assert.doesNotThrow(() => assertPreviewIsolation({ ...preview, VERCEL_ENV: undefined, APP_ORIGIN: 'http://localhost:3000' }));
});

test('preview derives its exact deployment origin without a stored origin or storage key', () => {
  const deployment = { ...preview, APP_ORIGIN: undefined, VERCEL_URL: 'manzoor-ux-review-abc.vercel.app' };
  assert.equal(appOrigin(deployment), 'https://manzoor-ux-review-abc.vercel.app');
  assert.doesNotThrow(() => assertPreviewIsolation(deployment));
  assert.throws(() => assertPreviewIsolation({ ...deployment, APP_ORIGIN: 'https://another.vercel.app' }), /لا يطابق/);
});
