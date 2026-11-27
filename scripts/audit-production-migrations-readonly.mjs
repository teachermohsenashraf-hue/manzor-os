import { config } from 'dotenv';
import { readdir } from 'node:fs/promises';
import pg from 'pg';

config({ path: '.env', quiet: true });
const connectionString = process.env.DIRECT_URL;
if (!connectionString) throw new Error('DIRECT_URL غير متاح لفحص الترحيلات');
const target = new URL(connectionString);
const ref = 'qepccducwytxchzstgsh';
const direct = target.hostname === `db.${ref}.supabase.co` && target.username === 'postgres';
const pooled = target.hostname.endsWith('.pooler.supabase.com') && target.username === `postgres.${ref}`;
if (!['postgresql:', 'postgres:'].includes(target.protocol) || (!direct && !pooled) ||
    target.pathname !== '/postgres' || ![null, 'public'].includes(target.searchParams.get('schema')))
  throw new Error('رابط قاعدة الإنتاج لا يطابق المشروع أو مخطط public المتوقع');

const local = (await readdir('prisma/migrations', { withFileTypes: true }))
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
const client = new pg.Client({ connectionString, options: '-c default_transaction_read_only=on' });
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const identity = (await client.query("SELECT current_user AS role, current_database() AS database, current_setting('server_version') AS server_version")).rows[0];
  const applied = (await client.query(`SELECT migration_name, finished_at, rolled_back_at
    FROM public._prisma_migrations ORDER BY started_at`)).rows;
  const preflight = (await client.query(`SELECT
    (SELECT count(*)::int FROM public."Expense" WHERE "status" <> 'CANCELLED' AND nullif(btrim("proofRef"), '') IS NOT NULL) AS active_expenses_with_proof,
    (SELECT count(*)::int FROM (
      SELECT lower(btrim("proofRef")) FROM public."Expense"
      WHERE "status" <> 'CANCELLED' AND nullif(btrim("proofRef"), '') IS NOT NULL
      GROUP BY 1 HAVING count(*) > 1
    ) duplicates) AS duplicate_expense_proofs,
    (SELECT count(*)::int FROM public."FinancialRule" WHERE "code" = 'REVENUE_RECOGNITION' AND "version" = 2) AS existing_revenue_rule_v2,
    (SELECT pg_size_pretty(sum(pg_total_relation_size(c.oid))) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p')) AS public_relation_size`)).rows[0];
  await client.query('ROLLBACK');
  const finished = new Set(applied.filter(row => row.finished_at && !row.rolled_back_at).map(row => row.migration_name));
  console.log(JSON.stringify({ database: identity.database, role: identity.role, serverVersion: identity.server_version, schema: 'public',
    localMigrations: local.length, appliedMigrations: finished.size,
    pending: local.filter(name => !finished.has(name)),
    failed: applied.filter(row => !row.finished_at && !row.rolled_back_at).map(row => row.migration_name),
    preflight }, null, 2));
} finally {
  await client.end();
}
