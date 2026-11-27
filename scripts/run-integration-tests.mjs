import { config } from 'dotenv';
import { spawn } from 'node:child_process';

config({ path: '.env.local', quiet: true });
const connection = process.env.PREVIEW_DATABASE_URL;
if (!connection) throw new Error('PREVIEW_DATABASE_URL للدور المحدود مطلوب لتشغيل اختبارات التكامل');
const url = new URL(connection);
const ref = 'qepccducwytxchzstgsh';
const direct = url.hostname === `db.${ref}.supabase.co` && url.username === 'manzoor_preview_app';
const pooled = url.hostname.endsWith('.pooler.supabase.com') && url.username === `manzoor_preview_app.${ref}`;
if (!['postgresql:', 'postgres:'].includes(url.protocol) || (!direct && !pooled) ||
    url.pathname !== '/postgres' || url.searchParams.get('schema') !== 'manzoor_test')
  throw new Error('اختبارات التكامل محصورة في الدور المحدود ومخطط manzoor_test');
const env = { ...process.env, TEST_DATABASE_URL: url.toString(), DATABASE_URL: url.toString(), DIRECT_URL: url.toString(),
  SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' };
console.log('تشغيل اختبارات التكامل بالدور المحدود على مخطط manzoor_test بالتتابع');
const paths = [
  'tests/integration/commerce-db.test.ts',
  'tests/integration/finance-db.test.ts',
  'tests/integration/production-db.test.ts',
  'tests/integration/revenue-db.test.ts',
  'tests/integration/refund-db.test.ts',
];
const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...paths], { env, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
