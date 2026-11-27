import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertPreviewIsolation } from './preview-isolation';
import { runtimeDatabaseUrl } from './db-connection';
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
assertPreviewIsolation(process.env);
const connectionString = process.env.DATABASE_URL;
const schema = connectionString ? new URL(connectionString).searchParams.get('schema') ?? undefined : undefined;
export const db = globalDb.prisma ?? new PrismaClient({ adapter: new PrismaPg({
  connectionString: runtimeDatabaseUrl(connectionString, process.env),
  max: 2,
  idleTimeoutMillis: 1_000,
  connectionTimeoutMillis: 10_000,
}, { schema }) });
if (process.env.NODE_ENV !== 'production') globalDb.prisma = db;
