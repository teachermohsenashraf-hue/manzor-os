import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const testUrl=process.env.TEST_DATABASE_URL;
if (!testUrl || !/test/i.test(new URL(testUrl).pathname)) throw new Error('استخدم TEST_DATABASE_URL لقاعدة اختبار منفصلة باسم يحتوي test');
process.env.DATABASE_URL=testUrl;
const {db}=await import('../../src/lib/db');
const {runOnce,RequestConflict}=await import('../../src/lib/idempotency');

test('production migration created private tables and uniqueness indexes',async()=>{
  const rows=await db.$queryRaw<{tablename:string;rowsecurity:boolean}[]>`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename IN ('Project','ProjectAssignment','ProductionEvent','ProjectPause','Attachment')`;
  assert.equal(rows.length,5);assert.ok(rows.every(x=>x.rowsecurity));
  const indexes=await db.$queryRaw<{indexname:string}[]>`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname IN ('project_one_current_assignment','project_one_active_pause','ProductionEvent_requestId_key')`;
  assert.equal(indexes.length,3);
});

test('concurrent idempotent requests create one record and reject changed payload',async()=>{
  const requestId=randomUUID(),actorId=randomUUID();
  const input={requestId,actorId,action:'INTEGRATION_PROBE',payload:{same:true},execute:async(tx:Parameters<typeof runOnce>[0]['execute'] extends (tx:infer T)=>unknown?T:never)=>{
    const row=await tx.auditLog.create({data:{action:'INTEGRATION_PROBE',detail:{requestId}}});
    return {id:row.id};
  }};
  try{
    const [first,second]=await Promise.all([runOnce(input),runOnce(input)]);
    assert.equal(first.id,second.id);
    assert.equal(await db.auditLog.count({where:{id:first.id}}),1);
    await assert.rejects(runOnce({...input,payload:{same:false}}),RequestConflict);
  }finally{
    const request=await db.mutationRequest.findUnique({where:{id:requestId}});
    if(request){const result=request.result as {id?:string};if(result.id)await db.auditLog.deleteMany({where:{id:result.id}});await db.mutationRequest.delete({where:{id:requestId}})}
  }
});

test.after(async()=>{await db.$disconnect()});
