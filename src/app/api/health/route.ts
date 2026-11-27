import { NextRequest, NextResponse } from 'next/server';
import { appOrigin } from '@/lib/preview-isolation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  let database: 'ok' | 'missing' | 'unavailable' = process.env.DATABASE_URL ? 'unavailable' : 'missing';
  if (process.env.DATABASE_URL) {
    try {
      const { db } = await import('@/lib/db');
      await db.$queryRaw`SELECT 1`;
      database = 'ok';
    } catch (error) {
      const failure = error as { name?: string; code?: string; meta?: { code?: string } };
      console.error('Health database check failed', { name: failure.name, code: failure.code, databaseCode: failure.meta?.code });
      database = 'unavailable';
    }
  }

  const expectedOrigin = appOrigin(process.env);
  let origin: 'ok' | 'missing' | 'mismatch' = expectedOrigin ? 'mismatch' : 'missing';
  if (expectedOrigin) {
    try {
      if (new URL(expectedOrigin).origin === new URL(request.url).origin) origin = 'ok';
    } catch {
      origin = 'mismatch';
    }
  }

  const ready = database === 'ok' && origin === 'ok';
  return NextResponse.json({ ready, database, origin }, {
    status: ready ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
