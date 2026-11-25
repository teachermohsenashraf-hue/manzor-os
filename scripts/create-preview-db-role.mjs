import 'dotenv/config';
import pg from 'pg';

const connectionString = process.env.DIRECT_URL;
if (!connectionString) throw new Error('DIRECT_URL غير متاح');
const url = new URL(connectionString);
const ref = 'qepccducwytxchzstgsh';
if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname !== '/postgres' ||
    !(url.hostname === `db.${ref}.supabase.co` ||
      (url.hostname.endsWith('.pooler.supabase.com') && url.username.endsWith(`.${ref}`))))
  throw new Error('اتصال PostgreSQL لا يشير إلى مشروع Supabase المعتمد');

const role = 'manzoor_preview_app';
const client = new pg.Client({ connectionString });
try {
  await client.connect();
  await client.query('BEGIN');
  const { rows: [target] } = await client.query(`
    select current_user as admin_role,
           to_regnamespace('manzoor_test') is not null as test_exists,
           exists(select 1 from pg_roles where rolname = $1) as role_exists
  `, [role]);
  if (target.admin_role !== 'postgres' || !target.test_exists || target.role_exists)
    throw new Error('وجهة إنشاء الدور غير متوقعة أو الدور موجود بالفعل');

  await client.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT`);
  await client.query(`GRANT USAGE ON SCHEMA manzoor_test TO ${role}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA manzoor_test TO ${role}`);
  await client.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA manzoor_test TO ${role}`);
  const { rows: [access] } = await client.query(`
    select has_schema_privilege($1, 'manzoor_test', 'USAGE') as test_usage,
           has_schema_privilege($1, 'manzoor_test', 'CREATE') as test_create,
           has_schema_privilege($1, 'public', 'CREATE') as public_create,
           (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind in ('r', 'p')
               and (has_table_privilege($1, c.oid, 'SELECT')
                 or has_table_privilege($1, c.oid, 'INSERT')
                 or has_table_privilege($1, c.oid, 'UPDATE')
                 or has_table_privilege($1, c.oid, 'DELETE'))) as accessible_public_tables
  `, [role]);
  if (!access.test_usage || access.test_create || access.public_create ||
      Number(access.accessible_public_tables) !== 0)
    throw new Error('الدور المحدود لم يجتز فحص عزل قاعدة البيانات');
  await client.query('COMMIT');
  console.log('أُنشئ دور المعاينة بدون صلاحية تسجيل دخول، وبصلاحيات جداول manzoor_test فقط');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await client.end();
}
