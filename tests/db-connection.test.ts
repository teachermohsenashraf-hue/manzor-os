import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeDatabaseUrl } from '../src/lib/db-connection';

test('Vercel runtime uses the transaction pool while local and migration URLs stay unchanged', () => {
  const session = 'postgresql://test:example@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?schema=public';
  const transaction = session.replace(':5432/', ':6543/');
  assert.equal(runtimeDatabaseUrl(session, { VERCEL_ENV: 'production' }), transaction);
  assert.equal(runtimeDatabaseUrl(session, { MANZOOR_ENV: 'preview' }), session);
  assert.equal(runtimeDatabaseUrl(transaction, { VERCEL_ENV: 'production' }), transaction);
  assert.equal(runtimeDatabaseUrl('postgresql://test:example@db.example.com:5432/postgres', { VERCEL_ENV: 'production' }),
    'postgresql://test:example@db.example.com:5432/postgres');
});
