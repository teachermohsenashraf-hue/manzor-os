import { config } from 'dotenv';
import { spawn } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import pg from 'pg';

config({ path: '.env', quiet: true });
const connection = process.env.DIRECT_URL;
if (!connection) throw new Error('DIRECT_URL غير متاح');
const url = new URL(connection);
const ref = 'qepccducwytxchzstgsh';
const direct = url.hostname === `db.${ref}.supabase.co` && url.username === 'postgres';
const pooled = url.hostname.endsWith('.pooler.supabase.com') && url.username === `postgres.${ref}`;
if (!['postgresql:', 'postgres:'].includes(url.protocol) || (!direct && !pooled) ||
    url.pathname !== '/postgres' || ![null, 'public'].includes(url.searchParams.get('schema')))
  throw new Error('اتصال الفحص لا يطابق مشروع الإنتاج ومخطط public');

const file = resolve(process.argv[2] ?? '');
const folder = resolve('backups', 'production');
if (dirname(file) !== folder || !/^public-.*\.dump$/.test(file.slice(folder.length + 1)))
  throw new Error('حدد أرشيف public من backups/production فقط');
const restore = join(process.cwd(), 'backups', 'tools', 'pgsql', 'bin', 'pg_restore.exe');
const counts = new Map();
await new Promise((done, reject) => {
  const child = spawn(restore, ['--data-only', '--schema=public', '--file=-', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  let buffer = '', active = null, stderr = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n');
      const line = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      if (active !== null) {
        if (line === '\\.') active = null;
        else counts.set(active, counts.get(active) + 1);
      } else {
        const match = /^COPY public\."?([A-Za-z_][A-Za-z_0-9]*)"? \(.+\) FROM stdin;$/.exec(line);
        if (match) { active = match[1]; counts.set(active, 0); }
      }
    }
  });
  child.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 500); });
  child.on('error', reject);
  child.on('exit', code => code === 0 && !stderr && active === null ? done() : reject(new Error(`pg_restore data read failed ${code}: ${stderr.slice(0, 300)}`)));
});
if (counts.size < 40 || !counts.has('_prisma_migrations')) throw new Error('أرشيف النسخة لا يحتوي الجداول المتوقعة');

const client = new pg.Client({ connectionString: connection, options: '-c default_transaction_read_only=on' });
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const missing = [];
  const decreased = [];
  for (const [name, before] of counts) {
    const escaped = name.replaceAll('"', '""');
    const exists = (await client.query('SELECT to_regclass($1) IS NOT NULL AS present', [`public."${escaped}"`])).rows[0].present;
    if (!exists) { missing.push(name); continue; }
    const now = Number((await client.query(`SELECT count(*) AS count FROM public."${escaped}"`)).rows[0].count);
    if (now < before) decreased.push({ table: name, before, now });
  }
  await client.query('ROLLBACK');
  console.log(JSON.stringify({ backedUpTables: counts.size, missing, decreased, checked: true }));
  if (missing.length || decreased.length) process.exitCode = 1;
} finally { await client.end(); }
