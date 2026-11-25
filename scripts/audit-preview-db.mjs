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

const client = new pg.Client({ connectionString });
try {
  await client.connect();
  const { rows: [role] } = await client.query(`
    select current_user as role_name,
           (select rolsuper from pg_roles where rolname = current_user) as superuser,
           (select rolbypassrls from pg_roles where rolname = current_user) as bypass_rls,
           has_schema_privilege(current_user, 'public', 'USAGE') as public_usage,
           has_schema_privilege(current_user, 'public', 'CREATE') as public_create,
           has_schema_privilege(current_user, 'manzoor_test', 'USAGE') as test_usage,
           has_schema_privilege(current_user, 'manzoor_test', 'CREATE') as test_create,
           (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind in ('r', 'p')
               and (has_table_privilege(current_user, c.oid, 'SELECT')
                 or has_table_privilege(current_user, c.oid, 'INSERT')
                 or has_table_privilege(current_user, c.oid, 'UPDATE')
                 or has_table_privilege(current_user, c.oid, 'DELETE'))) as accessible_public_tables
  `);
  console.log(JSON.stringify(role));
  const { rows: [defaults] } = await client.query(`
    select exists (
      select 1 from pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
      where n.nspname = 'public' and a.grantee = 0 and a.privilege_type = 'USAGE'
    ) as public_schema_usage_for_every_role,
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace,
      lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where n.nspname = 'public' and c.relkind in ('r', 'p') and a.grantee = 0
        and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) as public_table_grants_for_every_role,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
      lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where n.nspname = 'public' and a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_functions_executable_by_every_role,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
      lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where n.nspname = 'public' and p.prosecdef and a.grantee = 0
        and a.privilege_type = 'EXECUTE') as public_definer_functions_executable_by_every_role
  `);
  console.log(JSON.stringify(defaults));
  const { rows: callableDefiners } = await client.query(`
    select p.proname as name, pg_get_function_identity_arguments(p.oid) as arguments
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
      lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and p.prosecdef and a.grantee = 0
      and a.privilege_type = 'EXECUTE'
  `);
  console.log(JSON.stringify({ callable_public_definer_functions: callableDefiners }));
  const { rows: [previewRole] } = await client.query(`
    select rolname as role_name, rolcanlogin as can_login, rolsuper as superuser,
           rolbypassrls as bypass_rls,
           has_schema_privilege(rolname, 'manzoor_test', 'USAGE') as test_usage,
           has_schema_privilege(rolname, 'manzoor_test', 'CREATE') as test_create,
           has_schema_privilege(rolname, 'public', 'CREATE') as public_create,
           (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind in ('r', 'p')
               and has_table_privilege('manzoor_preview_app', c.oid, 'SELECT')) as readable_public_tables
    from pg_roles where rolname = 'manzoor_preview_app'
  `);
  console.log(JSON.stringify({ preview_role: previewRole ?? null }));
} finally {
  await client.end();
}
