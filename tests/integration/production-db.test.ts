import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { requireTestDatabaseUrl } from './test-db';

const {schema}=requireTestDatabaseUrl();
const {db}=await import('../../src/lib/db');
const {runOnce,RequestConflict}=await import('../../src/lib/idempotency');
const {consumeLoginThrottle}=await import('../../src/lib/login-throttle');

test('login throttle writes only to the configured test schema',async()=>{
  const key=randomUUID();
  try{
    const results=await Promise.all([consumeLoginThrottle(key),consumeLoginThrottle(key)]);
    assert.deepEqual(results,[true,true]);
    assert.equal((await db.loginThrottle.findUniqueOrThrow({where:{key}})).count,2);
  }finally{await db.loginThrottle.deleteMany({where:{key}})}
});

test('production migration created private tables and uniqueness indexes',async()=>{
  const rows=await db.$queryRaw<{tablename:string;rowsecurity:boolean}[]>`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname=${schema} AND tablename IN ('Project','ProjectAssignment','ProductionEvent','ProjectPause','Attachment')`;
  assert.equal(rows.length,5);assert.ok(rows.every(x=>x.rowsecurity));
  const indexes=await db.$queryRaw<{indexname:string}[]>`SELECT indexname FROM pg_indexes WHERE schemaname=${schema} AND indexname IN ('project_one_current_assignment','project_one_active_pause','ProductionEvent_requestId_key')`;
  assert.equal(indexes.length,3);
});

test('cycle closure and verified attachment migration retain private database access',async()=>{
  const tables=await db.$queryRaw<{tablename:string;rowsecurity:boolean}[]>`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname=${schema} AND tablename = 'SubscriptionCycleClosure'`;
  assert.equal(tables.length,1); assert.equal(tables[0].rowsecurity,true);
  const grants=await db.$queryRaw<{anon:boolean;authenticated:boolean}[]>`SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN has_table_privilege('anon',c.oid,'SELECT') ELSE false END AS anon, CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN has_table_privilege('authenticated',c.oid,'SELECT') ELSE false END AS authenticated FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema} AND c.relname='SubscriptionCycleClosure'`;
  assert.equal(grants.length,1); assert.equal(grants[0].anon,false); assert.equal(grants[0].authenticated,false);
  const indexes=await db.$queryRaw<{indexname:string}[]>`SELECT indexname FROM pg_indexes WHERE schemaname=${schema} AND indexname IN ('SubscriptionCycleClosure_cycleId_key','EmployeeEarning_subscriptionCycleId_key','Attachment_projectId_kind_verifiedAt_idx')`;
  assert.equal(indexes.length,3);
  const columns=await db.$queryRaw<{column_name:string}[]>`SELECT column_name FROM information_schema.columns WHERE table_schema=${schema} AND table_name='Attachment' AND column_name IN ('verifiedAt','deliverableId','uploadExpiresAt')`;
  assert.equal(columns.length,3);
  const link=await db.$queryRaw<{conname:string}[]>`SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=${schema} AND conname='Attachment_deliverableId_fkey'`;
  assert.equal(link.length,1);
});

test('concurrent idempotent requests create one record and reject changed payload',async()=>{
  const requestId=randomUUID(),actorId=randomUUID();
  const input={requestId,actorId,action:'INTEGRATION_PROBE',payload:{same:true},execute:async(tx:Parameters<typeof runOnce>[0]['execute'] extends (tx:infer T)=>unknown?T:never)=>{
    const row=await tx.loginThrottle.create({data:{key:requestId,windowEnd:new Date(Date.now()+60_000)}});
    return {id:row.key};
  }};
  try{
    const [first,second]=await Promise.all([runOnce(input),runOnce(input)]);
    assert.equal(first.id,second.id);
    assert.equal(await db.loginThrottle.count({where:{key:first.id}}),1);
    await assert.rejects(runOnce({...input,payload:{same:false}}),RequestConflict);
  }finally{
    const request=await db.mutationRequest.findUnique({where:{id:requestId}});
    if(request){const result=request.result as {id?:string};if(result.id)await db.loginThrottle.deleteMany({where:{key:result.id}});await db.mutationRequest.delete({where:{id:requestId}})}
  }
});

test('concurrent cycle closures and earnings are unique in PostgreSQL',async()=>{
  const tag=randomUUID().slice(0,8);
  const owner=await db.user.create({data:{name:'closure owner',username:`co_${tag}`,passwordHash:'test',role:'OWNER'}});
  const comm=await db.user.create({data:{name:'closure communicator',username:`cc_${tag}`,passwordHash:'test',role:'COMMUNICATION'}});
  const executor=await db.user.create({data:{name:'closure executor',username:`ce_${tag}`,passwordHash:'test',role:'EXECUTION'}});
  let teamId='',leadId='',clientId='',orderId='',subscriptionId='',cycleId='';
  try{
    teamId=(await db.team.create({data:{name:`closure ${tag}`,communicatorId:comm.id,executorId:executor.id}})).id;
    leadId=(await db.lead.create({data:{name:`closure ${tag}`,teamId,status:'CLIENT'}})).id;
    clientId=(await db.client.create({data:{leadId}})).id;
    orderId=(await db.customerOrder.create({data:{clientId,teamId,createdById:owner.id,approvedById:owner.id,status:'APPROVED',marketCode:'SA',currency:'SAR',title:'closure test',scope:'test scope',requirements:'test requirements',approvedAt:new Date(),totalMinor:130000n}})).id;
    const startsAt=new Date(),endsAt=new Date(startsAt.getTime()+30*86400000);
    subscriptionId=(await db.subscription.create({data:{orderId,status:'ACTIVE',startsAt,endsAt,cycleDays:30,createdById:owner.id}})).id;
    cycleId=(await db.subscriptionCycle.create({data:{subscriptionId,number:1,startsAt,endsAt,status:'ACTIVE'}})).id;
    const close=()=>db.subscriptionCycleClosure.create({data:{cycleId,executorId:executor.id,projectIds:[],evidence:{test:true},closedById:owner.id}});
    const closeResults=await Promise.allSettled([close(),close()]);
    assert.equal(closeResults.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(await db.subscriptionCycleClosure.count({where:{cycleId}}),1);
    await assert.rejects(db.$transaction(async tx=>{
      const earn=(n:number)=>tx.employeeEarning.create({data:{entitlementKey:`TEST:CYCLE:${cycleId}:${n}`,kind:'EXECUTION',recipientId:executor.id,orderId,subscriptionCycleId:cycleId,amountMinor:600000n,policyCode:'SA_SUBSCRIPTION',policyVersion:1,basisRef:'closure test',proposedById:owner.id}});
      await earn(1);await earn(2);
    }));
    await assert.rejects(db.$transaction(async tx=>{
      const earning=await tx.employeeEarning.create({data:{entitlementKey:`TEST:CYCLE:${cycleId}:immutable`,kind:'EXECUTION',recipientId:executor.id,orderId,subscriptionCycleId:cycleId,amountMinor:600000n,policyCode:'SA_SUBSCRIPTION',policyVersion:1,basisRef:'closure test',proposedById:owner.id}});
      await tx.employeeEarning.update({where:{id:earning.id},data:{subscriptionCycleId:null}});
    }));
    assert.equal(await db.employeeEarning.count({where:{subscriptionCycleId:cycleId}}),0);
  }finally{
    if(cycleId){await db.subscriptionCycleClosure.deleteMany({where:{cycleId}});await db.subscriptionCycle.deleteMany({where:{id:cycleId}})}
    if(subscriptionId)await db.subscription.deleteMany({where:{id:subscriptionId}});
    if(orderId)await db.customerOrder.deleteMany({where:{id:orderId}});
    if(clientId)await db.client.deleteMany({where:{id:clientId}});
    if(leadId)await db.lead.deleteMany({where:{id:leadId}});
    if(teamId)await db.team.deleteMany({where:{id:teamId}});
    await db.user.deleteMany({where:{id:{in:[owner.id,comm.id,executor.id]}}});
  }
});

test.after(async()=>{await db.$disconnect()});
