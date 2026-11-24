import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const url=process.env.TEST_DATABASE_URL;
if(!url||!/test/i.test(new URL(url).pathname))throw new Error('TEST_DATABASE_URL يجب أن يشير إلى قاعدة اختبار منفصلة');
process.env.DATABASE_URL=url;
const {db}=await import('../../src/lib/db');

test('commerce tables have RLS and quota constraints',async()=>{
  const tables=await db.$queryRaw<{tablename:string;rowsecurity:boolean}[]>`SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename IN ('Service','PriceVersion','CustomerOrder','OrderItem','OrderChange','Subscription','SubscriptionCycle','CycleItem')`;
  assert.equal(tables.length,8);assert.ok(tables.every(t=>t.rowsecurity));
  const constraints=await db.$queryRaw<{conname:string}[]>`SELECT conname FROM pg_constraint WHERE conname IN ('order_item_positive','cycle_item_positive','price_version_valid')`;
  assert.equal(constraints.length,3);
  const indexes=await db.$queryRaw<{indexname:string}[]>`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname='price_one_open_version'`;
  assert.equal(indexes.length,1);
});

test('parallel assignments cannot exceed an approved order item quantity',async()=>{
  const tag=randomUUID().slice(0,8);
  const owner=await db.user.create({data:{name:'test owner',username:`ot_${tag}`,passwordHash:'test',role:'OWNER'}});
  const comm=await db.user.create({data:{name:'test communication',username:`ct_${tag}`,passwordHash:'test',role:'COMMUNICATION'}});
  const exec=await db.user.create({data:{name:'test execution',username:`et_${tag}`,passwordHash:'test',role:'EXECUTION'}});
  let teamId='',leadId='',clientId='',serviceId='',priceId='',orderId='',itemId='';
  try{
    const team=await db.team.create({data:{name:`test ${tag}`,communicatorId:comm.id,executorId:exec.id}});teamId=team.id;
    const lead=await db.lead.create({data:{name:`test ${tag}`,teamId,status:'CLIENT'}});leadId=lead.id;
    const client=await db.client.create({data:{leadId}});clientId=client.id;
    const service=await db.service.create({data:{code:`TEST_${tag.toUpperCase()}`,name:'test service',kind:'SINGLE',productionType:'POSTER',active:true}});serviceId=service.id;
    const price=await db.priceVersion.create({data:{serviceId,marketCode:'EG',currency:'EGP',amountMinor:10000n,effectiveFrom:new Date(),createdById:owner.id}});priceId=price.id;
    const order=await db.customerOrder.create({data:{clientId,teamId,createdById:owner.id,approvedById:owner.id,status:'APPROVED',marketCode:'EG',currency:'EGP',title:'test',scope:'test scope',requirements:'test requirements',approvedAt:new Date(),totalMinor:10000n}});orderId=order.id;
    const item=await db.orderItem.create({data:{orderId,serviceId,priceVersionId:priceId,serviceNameSnapshot:'test service',serviceKindSnapshot:'SINGLE',productionTypeSnapshot:'POSTER',componentSnapshot:[],quantity:1,unitMinor:10000n,currency:'EGP',scope:'test scope'}});itemId=item.id;
    const attempt=()=>db.$transaction(tx=>tx.orderItem.updateMany({where:{id:itemId,assignedQuantity:{lt:1}},data:{assignedQuantity:{increment:1}}}));
    const results=await Promise.all([attempt(),attempt()]);
    assert.equal(results.reduce((sum,r)=>sum+r.count,0),1);
    assert.equal((await db.orderItem.findUniqueOrThrow({where:{id:itemId}})).assignedQuantity,1);
  }finally{
    if(itemId)await db.orderItem.deleteMany({where:{id:itemId}});
    if(orderId)await db.customerOrder.deleteMany({where:{id:orderId}});
    if(priceId)await db.priceVersion.deleteMany({where:{id:priceId}});
    if(serviceId)await db.service.deleteMany({where:{id:serviceId}});
    if(clientId)await db.client.deleteMany({where:{id:clientId}});
    if(leadId)await db.lead.deleteMany({where:{id:leadId}});
    if(teamId)await db.team.deleteMany({where:{id:teamId}});
    await db.user.deleteMany({where:{id:{in:[owner.id,comm.id,exec.id]}}});
  }
});
test.after(async()=>{await db.$disconnect()});
