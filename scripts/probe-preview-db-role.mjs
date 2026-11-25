import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const connectionString = process.env.DIRECT_URL;
if (!connectionString) throw new Error('DIRECT_URL غير متاح');
const url = new URL(connectionString);
const ref = 'qepccducwytxchzstgsh';
if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname !== '/postgres' ||
    !(url.hostname === `db.${ref}.supabase.co` ||
      (url.hostname.endsWith('.pooler.supabase.com') && url.username.endsWith(`.${ref}`))))
  throw new Error('اتصال PostgreSQL لا يشير إلى مشروع Supabase المعتمد');

const role = `manzoor_preview_probe_${randomBytes(4).toString('hex')}`;
const client = new pg.Client({ connectionString });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT`);
  await client.query(`GRANT ${role} TO CURRENT_USER`);
  await client.query(`GRANT USAGE ON SCHEMA manzoor_test TO ${role}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA manzoor_test TO ${role}`);
  await client.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA manzoor_test TO ${role}`);
  const { rows: [result] } = await client.query(`
    select has_schema_privilege($1, 'manzoor_test', 'USAGE') as test_usage,
           has_schema_privilege($1, 'manzoor_test', 'CREATE') as test_create,
           has_schema_privilege($1, 'public', 'USAGE') as public_usage,
           has_schema_privilege($1, 'public', 'CREATE') as public_create,
           (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind in ('r', 'p')
               and (has_table_privilege($1, c.oid, 'SELECT')
                 or has_table_privilege($1, c.oid, 'INSERT')
                 or has_table_privilege($1, c.oid, 'UPDATE')
                 or has_table_privilege($1, c.oid, 'DELETE'))) as accessible_public_tables,
           (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'manzoor_test' and c.relkind in ('r', 'p')
               and has_table_privilege($1, c.oid, 'SELECT')) as accessible_test_tables
  `, [role]);
  await client.query(`SET LOCAL ROLE ${role}`);
  await client.query('SAVEPOINT public_access_check');
  let publicSelectDenied = false;
  try {
    await client.query('SELECT * FROM public."User" LIMIT 0');
  } catch (error) {
    publicSelectDenied = error.code === '42501';
  }
  await client.query('ROLLBACK TO SAVEPOINT public_access_check');
  await client.query('SELECT id FROM manzoor_test."User" LIMIT 0');
  await client.query('RESET ROLE');
  result.public_select_denied = publicSelectDenied;
  result.test_select_succeeded = true;
  console.log(JSON.stringify(result));
} finally {
  try { await client.query('ROLLBACK'); } finally { await client.end(); }
}
