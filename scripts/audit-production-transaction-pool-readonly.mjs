import { config } from 'dotenv';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { PrismaPg } from '@prisma/adapter-pg';

config({ path: '.env', quiet: true });
const original = process.env.DATABASE_URL;
if (!original) throw new Error('DATABASE_URL غير متاح');
const url = new URL(original);
const ref = 'qepccducwytxchzstgsh';
if (!url.hostname.endsWith('.pooler.supabase.com') || url.username !== `postgres.${ref}` ||
    url.port !== '5432' || url.pathname !== '/postgres' || ![null, 'public'].includes(url.searchParams.get('schema')))
  throw new Error('رابط الإنتاج لا يطابق مجمع الجلسات المتوقع');
url.port = '6543';
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString(),
  max: 2, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 10_000 }) });
try {
  const [health, teams, leads, orders] = await Promise.all([
    db.$queryRaw`SELECT 1 AS ok`,
    db.team.count(),
    db.lead.count(),
    db.customerOrder.count(),
  ]);
  console.log(JSON.stringify({ transactionPool: '6543', health: health[0]?.ok === 1,
    countsReadable: [teams, leads, orders].every(Number.isInteger) }));
} finally { await db.$disconnect(); }
