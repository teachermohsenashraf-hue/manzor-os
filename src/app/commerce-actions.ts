'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { canChangeOrder, canSeeCommercial, parseMinor, readComponents } from '@/lib/commerce';
import { runOnce, RequestConflict, InvalidRequestId, type Tx } from '@/lib/idempotency';
import type { ActionState } from './actions';
import type { Role, Prisma } from '@/generated/prisma/client';

class CommerceError extends Error {}
const f=(form:FormData,key:string)=>String(form.get(key)??'').trim();
const err=(e:unknown):ActionState=>({error:e instanceof Error&&(e instanceof CommerceError||e instanceof RequestConflict||e instanceof InvalidRequestId)?e.message:'تعذر حفظ العملية، حاول مرة أخرى'});
const path=(id?:string)=>{revalidatePath('/services');revalidatePath('/orders');revalidatePath('/subscriptions');if(id)revalidatePath(`/orders/${id}`)};
async function once(form:FormData,action:string,payload:unknown,execute:(tx:Tx,actor:{id:string;role:Role})=>Promise<{id:string}>,id?:string):Promise<ActionState>{
  const actor=await requireUser();
  try{await runOnce({requestId:f(form,'requestId'),actorId:actor.id,action,payload,execute:tx=>execute(tx,actor)})}catch(e){return err(e)}
  path(id);return {success:'تم حفظ العملية'};
}
async function orderFor(tx:Tx,id:string,actor:{id:string;role:Role}){
  const order=await tx.customerOrder.findUnique({where:{id},include:{team:true,client:{include:{lead:true}}}});
  if(!order||!canSeeCommercial(actor.role,actor.id,order.team)||actor.role!=='OWNER'&&order.client.lead.teamId!==order.teamId)throw new CommerceError('الطلب غير متاح');
  return order;
}
async function audit(tx:Tx,actorId:string,action:string,subjectId:string,detail:Prisma.InputJsonValue){await tx.auditLog.create({data:{actorId,action,subjectId,detail}})}
async function lockOrder(tx:Tx,id:string){await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'ORDER:'+id},0))`}
async function lockPrice(tx:Tx,serviceId:string,marketCode:string){await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'PRICE:'+serviceId+':'+marketCode},0))`}
async function currentPrice(tx:Tx,serviceId:string,marketCode:string,at=new Date()){
  return tx.priceVersion.findFirst({where:{serviceId,marketCode,effectiveFrom:{lte:at},OR:[{effectiveTo:null},{effectiveTo:{gt:at}}]},orderBy:{effectiveFrom:'desc'}});
}
const productionTypes=['SCRIPT_TREATMENT','POSTER','VIDEO','VIDEO_POSTER','VIDEO_3_POSTERS','OTHER'] as const;
export async function createService(_:ActionState,form:FormData):Promise<ActionState>{
  const parsed=z.object({code:z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,40}$/),name:z.string().trim().min(2).max(120),kind:z.enum(['SINGLE','BUNDLE','SUBSCRIPTION']),productionType:z.enum(productionTypes),description:z.string().trim().max(2000)}).safeParse(Object.fromEntries(form));
  if(!parsed.success)return {error:'راجع بيانات الخدمة'};
  const data=parsed.data;
  return once(form,'SERVICE_CREATE',data,async(tx,actor)=>{if(actor.role!=='OWNER')throw new CommerceError('المالك فقط يدير الكتالوج');const service=await tx.service.create({data:{...data}});await audit(tx,actor.id,'SERVICE_CREATED',service.id,{code:data.code,kind:data.kind});return {id:service.id}});
}
export async function setServiceActive(_:ActionState,form:FormData):Promise<ActionState>{const id=f(form,'serviceId'),active=f(form,'active')==='true';return once(form,'SERVICE_STATUS',{id,active},async(tx,actor)=>{if(actor.role!=='OWNER')throw new CommerceError('المالك فقط يدير الكتالوج');const service=await tx.service.findUnique({where:{id},include:{components:true}});if(!service)throw new CommerceError('الخدمة غير موجودة');if(active&&service.kind!=='SINGLE'&&!service.components.length)throw new CommerceError('أضف عناصر الباقة أو الاشتراك أولًا');await tx.service.update({where:{id},data:{active}});await audit(tx,actor.id,'SERVICE_STATUS',id,{before:service.active,after:active});return {id}})}
export async function addServiceComponent(_:ActionState,form:FormData):Promise<ActionState>{const parentId=f(form,'parentId'),childId=f(form,'childId'),quantity=Number(f(form,'quantity'));if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000)return {error:'كمية العنصر غير صالحة'};return once(form,'SERVICE_COMPONENT_ADD',{parentId,childId,quantity},async(tx,actor)=>{if(actor.role!=='OWNER')throw new CommerceError('المالك فقط يدير الباقات');const [parent,child]=await Promise.all([tx.service.findUnique({where:{id:parentId}}),tx.service.findUnique({where:{id:childId}})]);if(!parent||!child||parentId===childId||parent.kind==='SINGLE'||child.kind!=='SINGLE'||parent.active)throw new CommerceError('اختر باقة وخدمة فردية صحيحتين');const c=await tx.serviceComponent.create({data:{parentId,childId,quantity}});await audit(tx,actor.id,'SERVICE_COMPONENT_ADDED',parentId,{childId,quantity});return {id:c.id}})}
export async function addPriceVersion(_:ActionState,form:FormData):Promise<ActionState>{const serviceId=f(form,'serviceId'),marketCode=f(form,'marketCode').toUpperCase(),currency=f(form,'currency').toUpperCase(),amountMinor=parseMinor(f(form,'amountMinor')),effectiveFrom=new Date(f(form,'effectiveFrom'));if(!/^[A-Z]{2}$/.test(marketCode)||!/^[A-Z]{3}$/.test(currency)||amountMinor===null||isNaN(effectiveFrom.getTime())||effectiveFrom.getTime()<Date.now()-60000)return {error:'بيانات السعر غير صالحة أو تاريخ السريان سابق'};return once(form,'PRICE_VERSION_ADD',{serviceId,marketCode,currency,amountMinor:amountMinor.toString(),effectiveFrom:effectiveFrom.toISOString()},async(tx,actor)=>{if(actor.role!=='OWNER')throw new CommerceError('المالك فقط يغير الأسعار');await lockPrice(tx,serviceId,marketCode);const service=await tx.service.findUnique({where:{id:serviceId}});if(!service)throw new CommerceError('الخدمة غير موجودة');const old=await tx.priceVersion.findFirst({where:{serviceId,marketCode,effectiveTo:null}});if(old){if(old.effectiveFrom>=effectiveFrom)throw new CommerceError('تاريخ السريان يجب أن يأتي بعد الإصدار الحالي');await tx.priceVersion.update({where:{id:old.id},data:{effectiveTo:effectiveFrom}})}const price=await tx.priceVersion.create({data:{serviceId,marketCode,currency,amountMinor,effectiveFrom,createdById:actor.id}});await audit(tx,actor.id,'PRICE_VERSION_ADDED',serviceId,{priceId:price.id,marketCode,currency,amountMinor:amountMinor.toString(),effectiveFrom:effectiveFrom.toISOString()});return {id:price.id}})}
const orderInput=z.object({clientId:z.string().min(1),teamId:z.string().min(1),marketCode:z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),currency:z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),title:z.string().trim().min(2).max(150),scope:z.string().trim().min(3).max(10000),requirements:z.string().trim().min(2).max(10000),dueAt:z.string(),agreementRef:z.string().trim().max(500)});
export async function createOrder(_:ActionState,form:FormData):Promise<ActionState>{const parsed=orderInput.safeParse(Object.fromEntries(form));if(!parsed.success)return {error:'راجع بيانات الطلب'};const data=parsed.data,dueAt=data.dueAt?new Date(data.dueAt):null;if(dueAt&&isNaN(dueAt.getTime()))return {error:'موعد الطلب غير صالح'};const actor=await requireUser();let result:{id:string};try{result=await runOnce({requestId:f(form,'requestId'),actorId:actor.id,action:'ORDER_CREATE',payload:data,execute:async tx=>{if(!['OWNER','COMMUNICATION'].includes(actor.role))throw new CommerceError('غير مصرح');const [client,team]=await Promise.all([tx.client.findUnique({where:{id:data.clientId},include:{lead:true}}),tx.team.findUnique({where:{id:data.teamId}})]);if(!client||!team?.active||client.lead.teamId!==team.id||actor.role==='COMMUNICATION'&&team.communicatorId!==actor.id)throw new CommerceError('العميل والفريق غير متطابقين');const order=await tx.customerOrder.create({data:{clientId:data.clientId,teamId:data.teamId,createdById:actor.id,marketCode:data.marketCode,currency:data.currency,title:data.title,scope:data.scope,requirements:data.requirements,dueAt,agreementRef:data.agreementRef||null}});await audit(tx,actor.id,'ORDER_CREATED',order.id,{clientId:data.clientId,teamId:data.teamId});return {id:order.id}}})}catch(e){return err(e)}path(result.id);redirect(`/orders/${result.id}`)}
export async function addOrderItem(_:ActionState,form:FormData):Promise<ActionState>{const orderId=f(form,'orderId'),serviceId=f(form,'serviceId'),quantity=Number(f(form,'quantity')),scope=f(form,'scope'),agreed=f(form,'agreedUnitMinor'),expectedVersion=Number(f(form,'orderVersion'));if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000||scope.length<2||!Number.isSafeInteger(expectedVersion)||agreed&&parseMinor(agreed)===null)return {error:'راجع بيانات البند'};return once(form,'ORDER_ITEM_ADD',{orderId,serviceId,quantity,scope,agreed,expectedVersion},async(tx,actor)=>{await lockOrder(tx,orderId);const order=await orderFor(tx,orderId,actor);if(order.status!=='DRAFT'||order.version!==expectedVersion)throw new CommerceError('تغيرت نسخة الطلب، حدّث الصفحة');await lockPrice(tx,serviceId,order.marketCode);const service=await tx.service.findUnique({where:{id:serviceId},include:{components:{include:{child:true}}}});if(!service?.active||service.kind!=='SINGLE'&&!service.components.length)throw new CommerceError('الخدمة غير متاحة');const price=await currentPrice(tx,serviceId,order.marketCode);if(!price||price.currency!==order.currency)throw new CommerceError('لا يوجد سعر فعّال لهذه الخدمة والسوق والعملة');const unitMinor=agreed?parseMinor(agreed)!:price.amountMinor;const item=await tx.orderItem.create({data:{orderId,serviceId,priceVersionId:price.id,serviceNameSnapshot:service.name,serviceKindSnapshot:service.kind,productionTypeSnapshot:service.productionType,componentSnapshot:service.components.map(c=>({serviceId:c.childId,quantity:c.quantity,productionType:c.child.productionType,name:c.child.name})),quantity,unitMinor,currency:order.currency,scope,dueAt:order.dueAt}});await tx.customerOrder.update({where:{id:orderId},data:{version:{increment:1}}});await audit(tx,actor.id,'ORDER_ITEM_ADDED',orderId,{itemId:item.id,serviceId,quantity,unitMinor:unitMinor.toString(),priceVersionId:price.id});return {id:item.id}},orderId)}
export async function decideOrder(_:ActionState,form:FormData):Promise<ActionState>{
  const orderId=f(form,'orderId'),target=f(form,'target'),expectedVersion=Number(f(form,'orderVersion')),note=f(form,'note').slice(0,3000),reference=f(form,'reference').slice(0,500);
  if(!['PROPOSED','APPROVED','REJECTED','CANCELLED'].includes(target)||!Number.isSafeInteger(expectedVersion)||['REJECTED','CANCELLED'].includes(target)&&note.length<3)return {error:'قرار الطلب أو سببه غير صالح'};
  return once(form,'ORDER_DECISION',{orderId,target,expectedVersion,note,reference},async(tx,actor)=>{
    await lockOrder(tx,orderId);const order=await orderFor(tx,orderId,actor);
    if(order.version!==expectedVersion||!canChangeOrder(actor.role,order.status,target as typeof order.status))throw new CommerceError('انتقال الطلب غير مسموح أو تغيرت نسخته');
    if(target==='CANCELLED'&&(await tx.project.findFirst({where:{orderId,completedAt:null,cancelledAt:null}})||await tx.subscription.findUnique({where:{orderId}})))throw new CommerceError('سوِّ التكليفات والاشتراك قبل إلغاء الطلب');
    const items=await tx.orderItem.findMany({where:{orderId}});
    if(target==='PROPOSED'&&!items.length)throw new CommerceError('أضف بند خدمة قبل الإرسال');
    let total=order.totalMinor;
    if(target==='APPROVED'){
      if(!items.length)throw new CommerceError('الطلب بلا بنود');
      for(const serviceId of [...new Set(items.map(x=>x.serviceId))].sort())await lockPrice(tx,serviceId,order.marketCode);
      for(const item of items){const current=await currentPrice(tx,item.serviceId,order.marketCode);if(!current||current.id!==item.priceVersionId)throw new CommerceError('تغير سعر إحدى الخدمات، أنشئ اتفاقًا جديدًا بالسعر الحالي')}
      total=items.reduce((sum,item)=>sum+item.unitMinor*BigInt(item.quantity),0n);
    }
    const now=new Date(),updated=await tx.customerOrder.updateMany({where:{id:orderId,version:expectedVersion,status:order.status},data:{status:target as typeof order.status,version:{increment:1},totalMinor:total,proposedAt:target==='PROPOSED'?now:undefined,approvedAt:target==='APPROVED'?now:undefined,approvedById:target==='APPROVED'?actor.id:undefined,agreementRef:reference||order.agreementRef}});
    if(updated.count!==1)throw new CommerceError('تغيرت نسخة الطلب، حدّث الصفحة');
    const decision=await tx.orderDecision.create({data:{orderId,kind:target==='PROPOSED'?'SUBMITTED':target as 'APPROVED'|'REJECTED'|'CANCELLED',actorId:actor.id,note,reference:reference||null,orderVersion:expectedVersion+1}});
    await audit(tx,actor.id,'ORDER_'+target,orderId,{decisionId:decision.id,totalMinor:total.toString(),reference});return {id:decision.id};
  },orderId);
}
export async function createSubscription(_:ActionState,form:FormData):Promise<ActionState>{
  const orderId=f(form,'orderId'),startsAt=new Date(f(form,'startsAt')),endsAt=new Date(f(form,'endsAt')),cycleDays=Number(f(form,'cycleDays')),deliveryPlan=f(form,'deliveryPlan'),renewalOfId=f(form,'renewalOfId')||null;
  if(isNaN(startsAt.getTime())||isNaN(endsAt.getTime())||endsAt<=startsAt||!Number.isSafeInteger(cycleDays)||cycleDays<28||cycleDays>31||cycleDays!==Math.ceil((endsAt.getTime()-startsAt.getTime())/86400000)||deliveryPlan.length<5)return {error:'الدورة الشهرية يجب أن تطابق التواريخ وخطة التسليم'};
  return once(form,'SUBSCRIPTION_CREATE',{orderId,startsAt:startsAt.toISOString(),endsAt:endsAt.toISOString(),cycleDays,deliveryPlan,renewalOfId},async(tx,actor)=>{
    if(actor.role!=='OWNER')throw new CommerceError('المالك فقط ينشئ الاشتراك');await lockOrder(tx,orderId);const order=await orderFor(tx,orderId,actor);
    if(order.status!=='APPROVED'||order.marketCode!=='SA')throw new CommerceError('الاشتراك يحتاج طلبًا سعوديًا معتمدًا');
    if(await tx.subscription.findUnique({where:{orderId}}))throw new CommerceError('للطلب اشتراك بالفعل');
    const items=await tx.orderItem.findMany({where:{orderId},include:{service:{include:{components:{include:{child:true}}}}}});
    if(items.length!==1||items[0].serviceKindSnapshot!=='SUBSCRIPTION'||items[0].quantity!==1)throw new CommerceError('الطلب يجب أن يحتوي اشتراكًا واحدًا بعناصره');
    const components=readComponents(items[0].componentSnapshot);
    if(components.length!==2||!components.some(c=>c.productionType==='VIDEO'&&c.quantity===3)||!components.some(c=>c.productionType==='POSTER'&&c.quantity===3))throw new CommerceError('الدورة السعودية المعتمدة هي ثلاثة فيديوهات وثلاثة بوسترات');
    if(renewalOfId){const old=await tx.subscription.findUnique({where:{id:renewalOfId},include:{order:true}});if(!old||old.order.clientId!==order.clientId)throw new CommerceError('الاشتراك السابق لا يخص العميل')}
    const subscription=await tx.subscription.create({data:{orderId,startsAt,endsAt,cycleDays,renewalOfId,createdById:actor.id,status:'PENDING'}});
    const cycle=await tx.subscriptionCycle.create({data:{subscriptionId:subscription.id,number:1,startsAt,endsAt,status:'PLANNED',deliveryPlan}});
    for(const component of components){await tx.cycleItem.create({data:{cycleId:cycle.id,orderItemId:items[0].id,serviceId:component.serviceId,plannedQuantity:component.quantity,deliveryPlan}})}
    await audit(tx,actor.id,'SUBSCRIPTION_CREATED',subscription.id,{orderId,cycleId:cycle.id,status:'PENDING',renewalOfId});return {id:subscription.id};
  },orderId);
}
export async function endSubscription(_:ActionState,form:FormData):Promise<ActionState>{const id=f(form,'subscriptionId'),reason=f(form,'reason');if(reason.length<3)return {error:'اكتب سبب الإيقاف'};return once(form,'SUBSCRIPTION_END',{id,reason},async(tx,actor)=>{if(actor.role!=='OWNER')throw new CommerceError('المالك فقط يوقف الاشتراك');const old=await tx.subscription.findUnique({where:{id}});if(!old||old.status==='ENDED')throw new CommerceError('الاشتراك غير متاح');if(await tx.project.findFirst({where:{subscriptionCycle:{subscriptionId:id},completedAt:null,cancelledAt:null}}))throw new CommerceError('سوِّ التكليفات المفتوحة قبل إنهاء الاشتراك');await tx.subscription.update({where:{id},data:{status:'ENDED'}});await tx.subscriptionCycle.updateMany({where:{subscriptionId:id,status:{in:['PLANNED','ACTIVE']}},data:{status:'CANCELLED'}});await audit(tx,actor.id,'SUBSCRIPTION_ENDED',id,{reason,from:old.status});return {id}})}
export async function transferOrder(_:ActionState,form:FormData):Promise<ActionState>{const orderId=f(form,'orderId'),teamId=f(form,'teamId'),reason=f(form,'reason');if(reason.length<3)return {error:'اكتب سبب نقل الاتفاق'};return once(form,'ORDER_TRANSFER',{orderId,teamId,reason},async(tx,actor)=>{if(actor.role!=='OWNER')throw new CommerceError('المالك فقط ينقل الاتفاق');await lockOrder(tx,orderId);const order=await orderFor(tx,orderId,actor);const team=await tx.team.findUnique({where:{id:teamId}});if(!team?.active||team.id!==order.client.lead.teamId||team.id===order.teamId)throw new CommerceError('اختر الفريق الحالي للعميل');if(await tx.project.findFirst({where:{orderId,cancelledAt:null,completedAt:null,teamId:{not:teamId}}}))throw new CommerceError('انقل تكليفات الإنتاج المفتوحة أولًا');await tx.customerOrder.update({where:{id:orderId},data:{teamId,version:{increment:1}}});await audit(tx,actor.id,'ORDER_TRANSFERRED',orderId,{from:order.teamId,to:teamId,reason});return {id:orderId}},orderId)}
const projectInput=z.object({orderId:z.string().min(1),orderItemId:z.string().min(1),cycleItemId:z.string(),title:z.string().trim().min(2).max(150),brief:z.string().trim().min(5).max(10000),requirements:z.string().trim().min(2).max(10000),notes:z.string().trim().max(3000),dueAt:z.string().min(1),priority:z.enum(['LOW','NORMAL','HIGH'])});
export async function createLinkedProject(_:ActionState,form:FormData):Promise<ActionState>{
  const parsed=projectInput.safeParse(Object.fromEntries(form));if(!parsed.success)return {error:'راجع بيانات التكليف'};
  const data=parsed.data,dueAt=new Date(data.dueAt);if(isNaN(dueAt.getTime())||dueAt<=new Date())return {error:'موعد التسليم غير صالح'};
  const actor=await requireUser();let result:{id:string};
  try{result=await runOnce({requestId:f(form,'requestId'),actorId:actor.id,action:'ORDER_PROJECT_CREATE',payload:data,execute:async tx=>{
    if(!['OWNER','COMMUNICATION'].includes(actor.role))throw new CommerceError('غير مصرح');await lockOrder(tx,data.orderId);const order=await orderFor(tx,data.orderId,actor);
    if(order.status!=='APPROVED')throw new CommerceError('التكليف يحتاج طلبًا معتمدًا');
    const item=await tx.orderItem.findUnique({where:{id:data.orderItemId},include:{service:true}});if(!item||item.orderId!==order.id)throw new CommerceError('البند لا يخص الطلب');
    let serviceType=item.productionTypeSnapshot,cycleId:string|null=null;
    if(item.serviceKindSnapshot==='SUBSCRIPTION'){
      const cycleItem=await tx.cycleItem.findUnique({where:{id:data.cycleItemId},include:{service:true,cycle:{include:{subscription:true}}}});
      if(!cycleItem||cycleItem.orderItemId!==item.id||cycleItem.cycle.subscription.orderId!==order.id||cycleItem.cycle.subscription.status==='ENDED'||cycleItem.cycle.status==='CANCELLED'||cycleItem.assignedQuantity>=cycleItem.plannedQuantity)throw new CommerceError('بند الدورة غير متاح أو اكتملت كميته');
      const updated=await tx.cycleItem.updateMany({where:{id:cycleItem.id,assignedQuantity:{lt:cycleItem.plannedQuantity}},data:{assignedQuantity:{increment:1}}});if(updated.count!==1)throw new CommerceError('اكتملت كمية الدورة');
      serviceType=cycleItem.service.productionType;cycleId=cycleItem.cycleId;
    }else{
      if(data.cycleItemId)throw new CommerceError('بند الدورة لا ينتمي لهذه الخدمة');
      const approved=await tx.orderChange.aggregate({where:{orderId:order.id,orderItemId:item.id,kind:'ADD_QUANTITY',status:'APPROVED'},_sum:{quantityDelta:true}});
      const capacity=item.quantity+(approved._sum.quantityDelta??0);
      const updated=await tx.orderItem.updateMany({where:{id:item.id,assignedQuantity:{lt:capacity}},data:{assignedQuantity:{increment:1}}});if(updated.count!==1)throw new CommerceError('اكتملت الكمية المتفق عليها');
    }
    const team=await tx.team.findUnique({where:{id:order.teamId}});if(!team?.active)throw new CommerceError('الفريق غير نشط');
    const project=await tx.project.create({data:{clientId:order.clientId,teamId:order.teamId,executorId:team.executorId,createdById:actor.id,title:data.title,serviceType,brief:data.brief,requirements:data.requirements,notes:data.notes||null,priority:data.priority,dueAt,orderId:order.id,orderItemId:item.id,subscriptionCycleId:cycleId,cycleItemId:data.cycleItemId||null}});
    await tx.projectAssignment.create({data:{projectId:project.id,executorId:team.executorId,actorId:actor.id}});
    await tx.productionEvent.create({data:{projectId:project.id,actorId:actor.id,kind:'ProjectCreated',detail:{orderId:order.id,orderItemId:item.id,cycleItemId:data.cycleItemId||null},requestId:f(form,'requestId')}});
    await audit(tx,actor.id,'ORDER_PROJECT_CREATED',project.id,{orderId:order.id,orderItemId:item.id,cycleItemId:data.cycleItemId||null});return {id:project.id};
  }})}catch(e){return err(e)}path(data.orderId);revalidatePath('/projects');redirect(`/projects/${result.id}`);
}
const signedMinor=(value:string)=>/^-?(0|[1-9]\d{0,14})$/.test(value)?BigInt(value):null;
export async function requestOrderChange(_:ActionState,form:FormData):Promise<ActionState>{
  const orderId=f(form,'orderId'),kind=f(form,'kind'),orderItemId=f(form,'orderItemId')||null,serviceId=f(form,'serviceId')||null,description=f(form,'description'),quantityDelta=f(form,'quantityDelta')?Number(f(form,'quantityDelta')):null,proposedScope=f(form,'proposedScope')||null,priceImpactMinor=signedMinor(f(form,'priceImpactMinor')),deadlineImpactAt=f(form,'deadlineImpactAt')?new Date(f(form,'deadlineImpactAt')):null;
  if(!['SCOPE','ADD_SERVICE','ADD_QUANTITY'].includes(kind)||description.length<3||priceImpactMinor===null||deadlineImpactAt&&isNaN(deadlineImpactAt.getTime())||kind==='SCOPE'&&!orderItemId||kind==='SCOPE'&&!proposedScope||kind==='ADD_QUANTITY'&&!orderItemId||kind==='ADD_SERVICE'&&!serviceId||kind!=='SCOPE'&&(!Number.isSafeInteger(quantityDelta)||!quantityDelta||quantityDelta<1))return {error:'بيانات التغيير غير صالحة'};
  return once(form,'ORDER_CHANGE_REQUEST',{orderId,kind,orderItemId,serviceId,description,quantityDelta,proposedScope,priceImpactMinor:priceImpactMinor.toString(),deadlineImpactAt:deadlineImpactAt?.toISOString()},async(tx,actor)=>{
    await lockOrder(tx,orderId);const order=await orderFor(tx,orderId,actor);if(order.status!=='APPROVED')throw new CommerceError('التغيير يتطلب اتفاقًا معتمدًا');
    if(orderItemId){const item=await tx.orderItem.findUnique({where:{id:orderItemId}});if(!item||item.orderId!==orderId)throw new CommerceError('البند لا يخص الاتفاق');if(kind==='ADD_QUANTITY'&&item.serviceKindSnapshot==='SUBSCRIPTION')throw new CommerceError('زيادة كمية الاشتراك تحتاج دورة أو اتفاق تجديد مستقل')}
    if(serviceId){const service=await tx.service.findUnique({where:{id:serviceId}});if(!service?.active)throw new CommerceError('الخدمة غير متاحة')}
    const change=await tx.orderChange.create({data:{orderId,kind:kind as 'SCOPE'|'ADD_SERVICE'|'ADD_QUANTITY',orderItemId,serviceId,description,quantityDelta,proposedScope,priceImpactMinor,deadlineImpactAt,requestedById:actor.id}});
    await tx.customerOrder.update({where:{id:orderId},data:{version:{increment:1}}});await audit(tx,actor.id,'ORDER_CHANGE_REQUESTED',orderId,{changeId:change.id,kind,priceImpactMinor:priceImpactMinor.toString()});return {id:change.id};
  },orderId);
}
export async function decideOrderChange(_:ActionState,form:FormData):Promise<ActionState>{
  const orderId=f(form,'orderId'),changeId=f(form,'changeId'),decision=f(form,'decision'),decisionRef=f(form,'decisionRef'),decisionNote=f(form,'decisionNote'),expectedVersion=Number(f(form,'orderVersion'));
  if(!['APPROVED','REJECTED'].includes(decision)||!Number.isSafeInteger(expectedVersion)||decision==='APPROVED'&&decisionRef.length<3||decision==='REJECTED'&&decisionNote.length<3)return {error:'قرار التغيير يحتاج مرجع موافقة أو سبب رفض واضحًا'};
  return once(form,'ORDER_CHANGE_DECISION',{orderId,changeId,decision,decisionRef,decisionNote,expectedVersion},async(tx,actor)=>{
    if(actor.role!=='OWNER')throw new CommerceError('المالك فقط يعتمد التغيير التجاري');await lockOrder(tx,orderId);const order=await orderFor(tx,orderId,actor);
    if(order.status!=='APPROVED'||order.version!==expectedVersion)throw new CommerceError('تغيرت نسخة الاتفاق، حدّث الصفحة');
    const change=await tx.orderChange.findUnique({where:{id:changeId}});if(!change||change.orderId!==orderId||change.status!=='PENDING')throw new CommerceError('طلب التغيير غير متاح');
    let appliedItemId:string|null=null;
    if(decision==='APPROVED'){
      if(order.totalMinor+(change.priceImpactMinor??0n)<0n)throw new CommerceError('أثر السعر يتجاوز قيمة الاتفاق');
      if(change.kind==='ADD_SERVICE'){
        await lockPrice(tx,change.serviceId!,order.marketCode);
        const service=await tx.service.findUnique({where:{id:change.serviceId!},include:{components:{include:{child:true}}}}),price=await currentPrice(tx,change.serviceId!,order.marketCode);
        if(!service?.active||!price||price.currency!==order.currency||service.kind!=='SINGLE'&&!service.components.length)throw new CommerceError('الخدمة أو سعرها غير متاح');
        const quantity=change.quantityDelta!,impact=change.priceImpactMinor!;
        if(impact<0n||impact%BigInt(quantity)!==0n)throw new CommerceError('أثر السعر يجب أن يقبل القسمة على الكمية');
        const item=await tx.orderItem.create({data:{orderId,serviceId:service.id,priceVersionId:price.id,serviceNameSnapshot:service.name,serviceKindSnapshot:service.kind,productionTypeSnapshot:service.productionType,componentSnapshot:service.components.map(c=>({serviceId:c.childId,quantity:c.quantity,productionType:c.child.productionType,name:c.child.name})),quantity,unitMinor:impact/BigInt(quantity),currency:order.currency,scope:change.proposedScope||change.description,dueAt:change.deadlineImpactAt??order.dueAt}});
        appliedItemId=item.id;
      }
      await tx.customerOrder.update({where:{id:orderId},data:{totalMinor:{increment:change.priceImpactMinor??0n},version:{increment:1}}});
    }else await tx.customerOrder.update({where:{id:orderId},data:{version:{increment:1}}});
    await tx.orderChange.update({where:{id:changeId},data:{status:decision as 'APPROVED'|'REJECTED',decidedById:actor.id,decisionRef:decisionRef||null,decisionNote,decidedAt:new Date(),appliedItemId}});
    await audit(tx,actor.id,'ORDER_CHANGE_'+decision,orderId,{changeId,decisionRef,appliedItemId});return {id:changeId};
  },orderId);
}
