import { createHash } from 'node:crypto';
import { db } from './db';
import type { Prisma } from '@/generated/prisma/client';

export class RequestConflict extends Error {}
export class InvalidRequestId extends Error {}
export type Tx = Prisma.TransactionClient;
export async function runOnce<T extends { id: string }>(input: {
  requestId: string; actorId: string; action: string; payload: unknown;
  execute: (tx: Tx) => Promise<T>;
}): Promise<T> {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(input.requestId)) throw new InvalidRequestId('معرف الطلب غير صالح');
  const payloadHash = createHash('sha256').update(JSON.stringify(input.payload)).digest('hex');
  return db.$transaction(async tx => {
    // Serializes retries of the same key, including requests arriving concurrently
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.requestId}, 0))`;
    const old = await tx.mutationRequest.findUnique({ where: { id: input.requestId } });
    if (old) {
      if (old.actorId !== input.actorId || old.action !== input.action || old.payloadHash !== payloadHash) throw new RequestConflict('استُخدم معرف الطلب مع بيانات مختلفة');
      return old.result as T;
    }
    const result = await input.execute(tx);
    await tx.mutationRequest.create({ data: { id: input.requestId, actorId: input.actorId, action: input.action, payloadHash, result } });
    return result;
  }, { maxWait: 10000, timeout: 20000 });
}
