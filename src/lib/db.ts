import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
const connectionString = process.env.DATABASE_URL;
const schema = connectionString ? new URL(connectionString).searchParams.get('schema') ?? undefined : undefined;
export const db = globalDb.prisma ?? new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
if (process.env.NODE_ENV !== 'production') globalDb.prisma = db;
