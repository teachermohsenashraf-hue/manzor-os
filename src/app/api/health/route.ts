import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  let database: 'ok' | 'missing' | 'unavailable' = process.env.DATABASE_URL ? 'unavailable' : 'missing';
  if (process.env.DATABASE_URL) {
    try {
      const { db } = await import('@/lib/db');
      await db.$queryRaw`SELECT 1`;
      database = 'ok';
    } catch {
      database = 'unavailable';
    }
  }

  let origin: 'ok' | 'missing' | 'mismatch' = process.env.APP_ORIGIN ? 'mismatch' : 'missing';
  if (process.env.APP_ORIGIN) {
    try {
      if (new URL(process.env.APP_ORIGIN).origin === new URL(request.url).origin) origin = 'ok';
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
