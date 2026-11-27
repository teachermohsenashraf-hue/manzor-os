import 'dotenv/config';
import { config } from 'dotenv';
import { spawn } from 'node:child_process';

config({ path: '.env.local' });

if (!process.env.PREVIEW_DATABASE_URL) throw new Error('PREVIEW_DATABASE_URL للدور المحدود مطلوب');
const url = new URL(process.env.PREVIEW_DATABASE_URL);
const ref = 'qepccducwytxchzstgsh';
const direct = url.hostname === `db.${ref}.supabase.co` && url.username === 'manzoor_preview_app';
const pooled = url.hostname.endsWith('.pooler.supabase.com') && url.username === `manzoor_preview_app.${ref}`;
if (!['postgresql:', 'postgres:'].includes(url.protocol) || (!direct && !pooled) ||
    url.pathname !== '/postgres' || url.searchParams.get('schema') !== 'manzoor_test')
  throw new Error('اتصال التطبيق المحلي يجب أن يستخدم الدور المحدود ومخطط manzoor_test');
const port = process.env.OP_TEST_PORT || '3000';
const mode = ['start', 'build'].includes(process.env.OP_TEST_MODE) ? process.env.OP_TEST_MODE : 'dev';
const env = { ...process.env, MANZOOR_ENV: 'preview', MANZOOR_LOCAL_STORAGE: '0',
  DATABASE_URL: url.toString(), DIRECT_URL: url.toString(), APP_ORIGIN: `http://localhost:${port}`,
  SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' };
console.log(`Starting local ${mode} app with isolated manzoor_test schema on port ${port}`);
const child = mode === 'build'
  ? spawn(process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run build'] : ['run', 'build'], { env, stdio: 'inherit' })
  : spawn(process.execPath, ['node_modules/next/dist/bin/next', mode, '-p', port], { env, stdio: 'inherit' });
child.on('exit', code => { process.exitCode = code ?? 1; });
