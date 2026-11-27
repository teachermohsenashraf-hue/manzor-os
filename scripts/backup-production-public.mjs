import { config } from 'dotenv';
import { spawn } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

config({ path: '.env', quiet: true });
const connection = process.env.DIRECT_URL;
if (!connection) throw new Error('DIRECT_URL غير متاح');
const url = new URL(connection);
const ref = 'qepccducwytxchzstgsh';
const direct = url.hostname === `db.${ref}.supabase.co` && url.username === 'postgres';
const pooled = url.hostname.endsWith('.pooler.supabase.com') && url.username === `postgres.${ref}`;
if (!['postgresql:', 'postgres:'].includes(url.protocol) || (!direct && !pooled) ||
    url.pathname !== '/postgres' || ![null, 'public'].includes(url.searchParams.get('schema')))
  throw new Error('اتصال النسخ الاحتياطي لا يطابق مشروع الإنتاج ومخطط public');

const tool = join(process.cwd(), 'backups', 'tools', 'pgsql', 'bin', 'pg_dump.exe');
const folder = join(process.cwd(), 'backups', 'production');
await mkdir(folder, { recursive: true });
const file = join(folder, `public-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432',
  PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
  PGDATABASE: 'postgres', PGSSLMODE: 'require', PGOPTIONS: '-c default_transaction_read_only=on' };
const exit = await new Promise((resolve, reject) => {
  const child = spawn(tool, ['--format=custom', '--schema=public', '--file', file,
    '--no-password', '--lock-wait-timeout=10s'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let errorOutput = '';
  child.stderr.on('data', chunk => { errorOutput += chunk.toString().slice(0, 2000); });
  child.on('error', reject);
  child.on('exit', code => resolve({ code, failed: errorOutput.length > 0 }));
});
if (exit.code !== 0) throw new Error(`pg_dump فشل بالرمز ${exit.code} دون عرض تفاصيل الاتصال`);
const size = (await stat(file)).size;
if (size < 1024) throw new Error('النسخة الاحتياطية أصغر من المتوقع');
console.log(JSON.stringify({ file, bytes: size, schema: 'public', format: 'custom', tool: 'pg_dump 17.12' }));
