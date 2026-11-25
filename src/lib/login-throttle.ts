import { Prisma } from '@/generated/prisma/client';
import { db } from './db';

export async function consumeLoginThrottle(key: string) {
  const schema = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public' : 'public';
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) throw new Error('Invalid database schema');
  const table = Prisma.raw(`"${schema}"."LoginThrottle"`);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO ${table} ("key", "count", "windowEnd")
    VALUES (${key}, 1, NOW() + INTERVAL '15 minutes')
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "LoginThrottle"."windowEnd" < NOW() THEN 1 ELSE "LoginThrottle"."count" + 1 END,
      "windowEnd" = CASE WHEN "LoginThrottle"."windowEnd" < NOW() THEN NOW() + INTERVAL '15 minutes' ELSE "LoginThrottle"."windowEnd" END
    RETURNING "count"`;
  return rows[0].count <= 8;
}
