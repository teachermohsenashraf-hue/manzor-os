import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertPreviewIsolation } from './preview-isolation';
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
assertPreviewIsolation(process.env);
const connectionString = process.env.DATABASE_URL;
const schema = connectionString ? new URL(connectionString).searchParams.get('schema') ?? undefined : undefined;
export const db = globalDb.prisma ?? new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
if (process.env.NODE_ENV !== 'production') globalDb.prisma = db;
