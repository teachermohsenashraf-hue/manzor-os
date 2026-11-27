'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { canMoveStage, canSeeProject, requiredQualityItems, individualPrepaymentCovered, finalPaymentCovered } from '@/lib/production';
import { runOnce, RequestConflict, InvalidRequestId, type Tx } from '@/lib/idempotency';
import { confirmedOrderPaidMinor } from '@/lib/finance';
import type { ActionState } from './actions';
import type { Role, Prisma } from '@/generated/prisma/client';

const field = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const date = (raw: string) => raw ? new Date(raw) : null;
const fail = (e: unknown): ActionState => {
  if (!(e instanceof RequestConflict || e instanceof InvalidRequestId || e instanceof ProductionError)) {
    const error = e as { name?: string; code?: string; meta?: { code?: string } };
    console.error('Production action database failure', { name: error?.name, code: error?.code, metaCode: error?.meta?.code });
  }
  return { error: e instanceof Error && (e instanceof RequestConflict || e instanceof InvalidRequestId || e instanceof ProductionError) ? e.message : 'تعذر حفظ العملية، حاول مرة أخرى' };
};
class ProductionError extends Error {}
async function projectFor(tx: Tx, id: string, actor: { id: string; role: Role }) {
  const project = await tx.project.findUnique({ where: { id }, include: { team: true } });
  if (!project || !canSeeProject(actor.role, actor.id, project.team)) throw new ProductionError('المشروع غير متاح');
  return project;
}
async function event(tx: Tx, projectId: string, actorId: string, kind: string, detail: Prisma.InputJsonValue, requestId: string) {
  await tx.productionEvent.create({ data: { projectId, actorId, kind, detail, requestId } });
  await tx.auditLog.create({ data: { actorId, action: kind, subjectId: projectId, detail } });
}
async function hasEvent(tx: Tx, projectId: string, kind: string, deliverableId: string) {
  const events = await tx.productionEvent.findMany({ where: { projectId, kind }, select: { detail: true }, orderBy: { occurredAt: 'desc' } });
  return events.some(e => typeof e.detail === 'object' && e.detail !== null && !Array.isArray(e.detail) && e.detail.deliverableId === deliverableId);
}
async function latestOutput(tx: Tx, projectId: string) {
  const output = await tx.deliverable.findFirst({ where: { projectId }, orderBy: { version: 'desc' } });
  if (!output) throw new ProductionError('سجل نسخة العمل أولًا');
  return output;
}
async function requireFullPayment(tx: Tx, orderId: string | null) {
  if (!orderId) throw new ProductionError('يجب ربط العمل بطلب وتأكيد السداد قبل التسليم');
  const order = await tx.customerOrder.findUnique({ where: { id: orderId } });
  if (!order || order.status!=='APPROVED' || !finalPaymentCovered(order.totalMinor, await confirmedOrderPaidMinor(tx, orderId)))
    throw new ProductionError('التسليم النهائي يحتاج تحصيلًا معتمدًا للقيمة الكاملة');
}
async function change(form: FormData, action: string, payload: unknown, execute: (tx: Tx, actor: {id:string; role:Role}) => Promise<{id:string}>, path?: string): Promise<ActionState> {
  const actor = await requireUser();
  try { await runOnce({ requestId: field(form,'requestId'), actorId: actor.id, action, payload, execute: async tx => {
    const projectId=field(form,'projectId');
    if(projectId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`;
    return execute(tx,actor);
  } }); }
  catch(e) { return fail(e) }
  if (path) revalidatePath(path);
  revalidatePath('/projects');
  return { success: 'تم حفظ العملية' };
}
const projectInput = z.object({ clientId:z.string().min(1), teamId:z.string().min(1), title:z.string().trim().min(2).max(150), serviceType:z.enum(['SCRIPT_TREATMENT','POSTER','VIDEO','VIDEO_POSTER','VIDEO_3_POSTERS','OTHER']), brief:z.string().trim().min(5).max(10000), requirements:z.string().trim().min(2).max(10000), notes:z.string().trim().max(3000), priority:z.enum(['LOW','NORMAL','HIGH']), dueAt:z.string().min(1), requirementsComplete:z.string().optional() });
export async function createProject(_: ActionState, form: FormData): Promise<ActionState> {
  const actor = await requireUser();
  if (!['OWNER','COMMUNICATION'].includes(actor.role)) return {error:'غير مصرح'};
  const parsed = projectInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return {error:'راجع بيانات التكليف'};
  const data = parsed.data, dueAt = date(data.dueAt);
  if (!dueAt || isNaN(dueAt.getTime()) || dueAt <= new Date()) return {error:'موعد التسليم غير صالح'};
  let result: {id:string};
  try { result = await runOnce({requestId:field(form,'requestId'),actorId:actor.id,action:'PROJECT_CREATE',payload:data,execute:async tx=>{
    const [client,team]=await Promise.all([tx.client.findUnique({where:{id:data.clientId},include:{lead:true}}),tx.team.findUnique({where:{id:data.teamId}})]);
    if (!client || !team?.active || client.lead.teamId!==team.id || actor.role==='COMMUNICATION'&&team.communicatorId!==actor.id) throw new ProductionError('العميل والفريق غير متطابقين');
    if(await tx.customerOrder.findFirst({where:{clientId:data.clientId,status:'APPROVED'}}))throw new ProductionError('أنشئ التكليف من بند الطلب المعتمد لمنع تجاوز الكمية');
    const project=await tx.project.create({data:{clientId:data.clientId,teamId:team.id,executorId:team.executorId,createdById:actor.id,title:data.title,serviceType:data.serviceType,brief:data.brief,requirements:data.requirements,notes:data.notes||null,priority:data.priority,dueAt,requirementsComplete:data.requirementsComplete==='on'}});
    await tx.projectAssignment.create({data:{projectId:project.id,executorId:team.executorId,actorId:actor.id}});
    await event(tx,project.id,actor.id,'ProjectCreated',{teamId:team.id,executorId:team.executorId},field(form,'requestId'));
    return {id:project.id};
  }}) } catch(e) { return fail(e) }
  revalidatePath('/projects'); redirect(`/projects/${result.id}`);
}
export async function acceptAssignment(_:ActionState,form:FormData):Promise<ActionState>{const id=field(form,'projectId');return change(form,'PROJECT_ACCEPT',{id},async(tx,actor)=>{const p=await projectFor(tx,id,actor);if(actor.role!=='EXECUTION'||p.executorId!==actor.id)throw new ProductionError('المُنفذ المكلّف فقط يقبل التكليف');const assignment=await tx.projectAssignment.findFirst({where:{projectId:id,endedAt:null},orderBy:{assignedAt:'desc'}});if(!assignment)throw new ProductionError('لا يوجد تكليف نشط');await tx.projectAssignment.update({where:{id:assignment.id},data:{acceptedAt:assignment.acceptedAt??new Date()}});await event(tx,id,actor.id,'AssignmentAccepted',{},field(form,'requestId'));return {id:assignment.id}},`/projects/${id}`)}
export async function moveStage(_:ActionState,form:FormData):Promise<ActionState>{const id=field(form,'projectId'),to=field(form,'stage');return change(form,'PROJECT_STAGE',{id,to},async(tx,actor)=>{const p=await projectFor(tx,id,actor);if(p.paused||p.cancelledAt)throw new ProductionError('المشروع متوقف أو ملغى');if(!canMoveStage(actor.role,p.stage,to as typeof p.stage))throw new ProductionError('انتقال المرحلة غير مسموح');if(to==='TREATMENT'&&!p.requirementsComplete)throw new ProductionError('أكمل المتطلبات أولًا');if(to==='READY'){const versions=await tx.productionVersion.findMany({where:{projectId:id}});for(const kind of ['SCRIPT','TREATMENT'] as const){const latest=versions.filter(v=>v.kind===kind).sort((a,b)=>b.number-a.number)[0];if(latest&&!await tx.approval.findFirst({where:{projectId:id,kind,versionId:latest.id}}))throw new ProductionError('اعتماد أحدث نسخة من السكريبت والتصور مطلوب')};if(!versions.length||p.serviceType==='SCRIPT_TREATMENT'&&!versions.some(v=>v.kind==='SCRIPT')||p.serviceType==='SCRIPT_TREATMENT'&&!versions.some(v=>v.kind==='TREATMENT'))throw new ProductionError('أضف السكريبت والتصور المطلوبين أولًا')}
  if(['CLIENT_PREVIEW','DELIVERED','COMPLETED'].includes(to))throw new ProductionError('استخدم إجراء الإرسال أو تأكيد الاستلام المخصص');
  if(to==='IN_PROGRESS'&&!p.subscriptionCycleId){
    if(!p.orderId)throw new ProductionError('اربط العمل بطلب مؤكد قبل بدء التنفيذ');
    const order=await tx.customerOrder.findUnique({where:{id:p.orderId}});
    if(!order||order.status!=='APPROVED'||!individualPrepaymentCovered(order.totalMinor,await confirmedOrderPaidMinor(tx,p.orderId)))
      throw new ProductionError('بدء التنفيذ يحتاج تحصيل 50٪ من قيمة الطلب على الأقل');
  }
  if(to==='IN_PROGRESS'&&p.subscriptionCycleId){const cycle=await tx.subscriptionCycle.findUnique({where:{id:p.subscriptionCycleId},include:{subscription:true}});if(!cycle||cycle.status!=='ACTIVE'||cycle.subscription.status!=='ACTIVE')throw new ProductionError('دورة الاشتراك لم تُفعّل بعد')}
  if(to==='IN_PROGRESS'&&p.stage==='REVISIONS'){
    const commercial=await tx.revision.findMany({where:{projectId:id,kind:{in:['SCOPE_CHANGE','PAID_EXTRA']},status:{not:'CLOSED'}},include:{orderChange:true}});
    if(commercial.some(r=>!r.orderChange||r.orderChange.status!=='APPROVED'||r.orderChange.orderId!==p.orderId))throw new ProductionError('تغيير النطاق والطلب الإضافي يحتاجان موافقة منفصلة');
  }
  if(to==='IN_PROGRESS'&&!await tx.projectAssignment.findFirst({where:{projectId:id,endedAt:null,acceptedAt:{not:null}}}))throw new ProductionError('اقبل التكليف قبل بدء التنفيذ');
  const latestDeliverable=await tx.deliverable.findFirst({where:{projectId:id},orderBy:{version:'desc'}});
  if(to==='INTERNAL_REVIEW'&&p.stage==='REVISIONS'){
    const revision=await tx.revision.findFirst({where:{projectId:id},orderBy:{requestedAt:'desc'}});
    if(!revision||!latestDeliverable||latestDeliverable.submittedAt<=revision.requestedAt)
      throw new ProductionError('سجل نسخة جديدة بعد طلب التعديلات قبل إعادة المراجعة');
  }
  const latestQuality=latestDeliverable?await tx.qualityReview.findFirst({where:{projectId:id,deliverableId:latestDeliverable.id},orderBy:{createdAt:'desc'}}):null;
  if(to==='CLIENT_PREVIEW'&&!latestQuality?.passed)throw new ProductionError('اجتياز فحص الجودة مطلوب');
  if(to==='READY_DELIVERY'){
    if(!latestDeliverable||!await hasEvent(tx,id,'OwnerPreviewApproved',latestDeliverable.id)||
      !await tx.approval.findFirst({where:{projectId:id,kind:'PREVIEW',deliverableId:latestDeliverable.id}}))
      throw new ProductionError('اعتماد المالك والعميل لأحدث نسخة مطلوب');
    if(await tx.revision.findFirst({where:{projectId:id,status:{not:'CLOSED'}}}))
      throw new ProductionError('أغلق الملاحظات المفتوحة أولًا');
  }
  const now=new Date();const updated=await tx.project.updateMany({where:{id,stage:p.stage,paused:false,cancelledAt:null},data:{stage:to as typeof p.stage,productionStartedAt:to==='IN_PROGRESS'?(p.productionStartedAt??now):undefined,deliveredAt:to==='DELIVERED'?now:undefined,completedAt:to==='COMPLETED'?now:undefined}});if(updated.count!==1)throw new ProductionError('تغيرت حالة المشروع، حدّث الصفحة');
  await event(tx,id,actor.id,to==='IN_PROGRESS'?'ProductionStarted':to==='COMPLETED'?'ProjectCompleted':'StageChanged',{from:p.stage,to},field(form,'requestId'));return {id}},`/projects/${id}`)}

export async function sendPreviewToOwner(_:ActionState, form:FormData):Promise<ActionState>{
  const id=field(form,'projectId'), reference=field(form,'reference');
  if(reference.length<3||reference.length>300)return {error:'اكتب مرجع إرسال المعاينة عبر واتساب'};
  return change(form,'PREVIEW_OWNER_SENT',{id,reference},async(tx,actor)=>{
    const p=await projectFor(tx,id,actor);
    if(actor.role!=='EXECUTION'||p.executorId!==actor.id||p.stage!=='INTERNAL_REVIEW'||p.paused||p.cancelledAt)
      throw new ProductionError('المنفذ المكلف يرسل المعاينة للمالك أثناء المراجعة فقط');
    const output=await latestOutput(tx,id);
    if(output.submittedById!==actor.id)throw new ProductionError('المعاينة يجب أن تكون من المنفذ المكلف');
    if(await hasEvent(tx,id,'PreviewSentToOwner',output.id))throw new ProductionError('سُجل إرسال هذه النسخة بالفعل');
    await event(tx,id,actor.id,'PreviewSentToOwner',{deliverableId:output.id,reference},field(form,'requestId'));
    return {id:output.id};
  },`/projects/${id}`);
}

export async function reviewOwnerPreview(_:ActionState,form:FormData):Promise<ActionState>{
  const id=field(form,'projectId'),decision=field(form,'decision'),notes=field(form,'notes');
  if(!['approve','revise'].includes(decision)||decision==='revise'&&notes.length<3)return {error:'اكتب قرار المراجعة وملاحظات التعديل'};
  return change(form,'OWNER_PREVIEW_REVIEW',{id,decision,notes},async(tx,actor)=>{
    const p=await projectFor(tx,id,actor);
    if(actor.role!=='OWNER'||p.stage!=='INTERNAL_REVIEW'||p.paused||p.cancelledAt)throw new ProductionError('المالك يراجع المعاينة في مرحلة المراجعة فقط');
    const output=await latestOutput(tx,id);
    if(!await hasEvent(tx,id,'PreviewSentToOwner',output.id))throw new ProductionError('سجل إرسال المعاينة للمالك أولًا');
    if(decision==='approve'){
      const quality=await tx.qualityReview.findFirst({where:{projectId:id,deliverableId:output.id},orderBy:{createdAt:'desc'}});
      if(!quality?.passed)throw new ProductionError('اجتياز فحص الجودة مطلوب قبل اعتماد المالك');
      if(await hasEvent(tx,id,'OwnerPreviewApproved',output.id))throw new ProductionError('هذه النسخة معتمدة بالفعل');
      await event(tx,id,actor.id,'OwnerPreviewApproved',{deliverableId:output.id,notes},field(form,'requestId'));
    }else{
      const updated=await tx.project.updateMany({where:{id,stage:'INTERNAL_REVIEW'},data:{stage:'REVISIONS'}});
      if(updated.count!==1)throw new ProductionError('تغيرت حالة العمل، حدّث الصفحة');
      const last=await tx.revision.findFirst({where:{projectId:id},orderBy:{number:'desc'}});
      const revision=await tx.revision.create({data:{projectId:id,number:(last?.number??0)+1,kind:'CORRECTION',source:'المالك',notes,executorId:p.executorId}});
      await event(tx,id,actor.id,'OwnerPreviewRevisionRequested',{deliverableId:output.id,revisionId:revision.id,notes},field(form,'requestId'));
    }
    return {id:output.id};
  },`/projects/${id}`);
}

export async function sendPreviewToClient(_:ActionState,form:FormData):Promise<ActionState>{
  const id=field(form,'projectId'),reference=field(form,'reference');
  if(reference.length<3||reference.length>300)return {error:'اكتب مرجع إرسال المعاينة المحمية عبر واتساب'};
  return change(form,'PREVIEW_CLIENT_SENT',{id,reference},async(tx,actor)=>{
    const p=await projectFor(tx,id,actor);
    if(actor.role!=='COMMUNICATION'||p.stage!=='INTERNAL_REVIEW'||p.paused||p.cancelledAt)throw new ProductionError('مسؤول التواصل فقط يرسل المعاينة للعميل');
    const output=await latestOutput(tx,id);
    if(!await hasEvent(tx,id,'OwnerPreviewApproved',output.id))throw new ProductionError('اعتماد المالك لأحدث نسخة مطلوب');
    if(await tx.revision.findFirst({where:{projectId:id,status:{not:'CLOSED'}}}))throw new ProductionError('أغلق الملاحظات المفتوحة أولًا');
    const updated=await tx.project.updateMany({where:{id,stage:'INTERNAL_REVIEW'},data:{stage:'CLIENT_PREVIEW'}});
    if(updated.count!==1)throw new ProductionError('تغيرت حالة العمل، حدّث الصفحة');
    await event(tx,id,actor.id,'ProtectedPreviewSentToClient',{deliverableId:output.id,reference},field(form,'requestId'));
    return {id:output.id};
  },`/projects/${id}`);
}

export async function sendFinalToClient(_:ActionState,form:FormData):Promise<ActionState>{
  const id=field(form,'projectId'),reference=field(form,'reference');
  if(reference.length<3||reference.length>300)return {error:'اكتب مرجع إرسال النسخة النهائية عبر واتساب'};
  return change(form,'FINAL_CLIENT_SENT',{id,reference},async(tx,actor)=>{
    const p=await projectFor(tx,id,actor);
    if(actor.role!=='COMMUNICATION'||p.stage!=='READY_DELIVERY'||p.paused||p.cancelledAt)throw new ProductionError('مسؤول التواصل فقط يسجل التسليم النهائي');
    const output=await latestOutput(tx,id);
    if(!await hasEvent(tx,id,'OwnerPreviewApproved',output.id)||
      !await tx.approval.findFirst({where:{projectId:id,kind:'PREVIEW',deliverableId:output.id}}))
      throw new ProductionError('اعتماد المالك والعميل لأحدث نسخة مطلوب');
    if(await tx.revision.findFirst({where:{projectId:id,status:{not:'CLOSED'}}}))throw new ProductionError('أغلق الملاحظات المفتوحة أولًا');
    await requireFullPayment(tx,p.orderId);
    const now=new Date();
    const updated=await tx.project.updateMany({where:{id,stage:'READY_DELIVERY'},data:{stage:'DELIVERED',deliveredAt:now}});
    if(updated.count!==1)throw new ProductionError('تغيرت حالة العمل، حدّث الصفحة');
    await tx.deliverable.update({where:{id:output.id},data:{deliveredAt:now}});
    await event(tx,id,actor.id,'FinalSentToClient',{deliverableId:output.id,reference},field(form,'requestId'));
    return {id:output.id};
  },`/projects/${id}`);
}

export async function confirmClientReceipt(_:ActionState,form:FormData):Promise<ActionState>{
  const id=field(form,'projectId'),reference=field(form,'reference');
  if(reference.length<3||reference.length>300)return {error:'اكتب مرجع تأكيد استلام العميل'};
  return change(form,'CLIENT_RECEIPT_CONFIRMED',{id,reference},async(tx,actor)=>{
    const p=await projectFor(tx,id,actor);
    if(actor.role!=='COMMUNICATION'||p.stage!=='DELIVERED'||p.paused||p.cancelledAt)throw new ProductionError('مسؤول التواصل فقط يسجل تأكيد الاستلام');
    const output=await latestOutput(tx,id);
    if(!output.deliveredAt||!await hasEvent(tx,id,'FinalSentToClient',output.id))throw new ProductionError('سجل إرسال النسخة النهائية أولًا');
    if(await tx.revision.findFirst({where:{projectId:id,status:{not:'CLOSED'}}}))throw new ProductionError('أغلق ملاحظات العميل أولًا');
    const now=new Date();
    const updated=await tx.project.updateMany({where:{id,stage:'DELIVERED'},data:{stage:'COMPLETED',completedAt:now}});
    if(updated.count!==1)throw new ProductionError('تغيرت حالة العمل، حدّث الصفحة');
    await tx.approval.create({data:{projectId:id,kind:'FINAL_DELIVERY',deliverableId:output.id,reference,approvedById:actor.id,approvedAt:now}});
    await event(tx,id,actor.id,'ClientReceiptConfirmed',{deliverableId:output.id,reference},field(form,'requestId'));
    return {id:output.id};
  },`/projects/${id}`);
}

export async function setArchiveDecision(_:ActionState,form:FormData):Promise<ActionState>{
  const id=field(form,'projectId'),decision=field(form,'decision'),permission=field(form,'permission');
  if(!['PENDING','RETAIN','PORTFOLIO','PUBLISH','DELETE'].includes(decision)||decision==='PUBLISH'&&permission.length<3)
    return {error:'قرار الملفات غير صالح أو إذن العميل للنشر غير موثق'};
  return change(form,'ARCHIVE_DECISION',{id,decision,permission},async(tx,actor)=>{
    const p=await projectFor(tx,id,actor);
    if(actor.role!=='OWNER'||p.stage!=='COMPLETED')throw new ProductionError('المالك يحدد مصير الملفات بعد إغلاق العمل');
    await event(tx,id,actor.id,'ArchiveDecisionRecorded',{decision,permission:permission||null},field(form,'requestId'));
    return {id};
  },`/projects/${id}`);
}
export async function addVersion(_:ActionState,form:FormData):Promise<ActionState>{const id=field(form,'projectId'),kind=field(form,'kind'),content=field(form,'content'),reviewNotes=field(form,'reviewNotes');if(!['SCRIPT','TREATMENT'].includes(kind)||content.length<3||content.length>20000)return {error:'بيانات النسخة غير صالحة'};return change(form,'VERSION_ADD',{id,kind,content,reviewNotes},async(tx,actor)=>{const p=await projectFor(tx,id,actor);if(!['OWNER','EXECUTION'].includes(actor.role)||actor.role==='EXECUTION'&&p.executorId!==actor.id||!['TREATMENT','WAITING_APPROVAL','REVISIONS'].includes(p.stage)||p.paused||p.cancelledAt)throw new ProductionError('لا يمكن تعديل التصور في المرحلة الحالية');const previous=await tx.productionVersion.findFirst({where:{projectId:id,kind:kind as 'SCRIPT'|'TREATMENT'},orderBy:{number:'desc'}});const v=await tx.productionVersion.create({data:{projectId:id,kind:kind as 'SCRIPT'|'TREATMENT',number:(previous?.number??0)+1,content,reviewNotes,createdById:actor.id}});await event(tx,id,actor.id,'VersionAdded',{kind,versionId:v.id,number:v.number},field(form,'requestId'));return {id:v.id}},`/projects/${id}`)}
export async function recordApproval(_:ActionState,form:FormData):Promise<ActionState>{
  const id=field(form,'projectId'),kind=field(form,'kind'),versionId=field(form,'versionId')||null,
    deliverableId=field(form,'deliverableId')||null,reference=field(form,'reference'),approvedAt=date(field(form,'approvedAt'));
  if(!['SCRIPT','TREATMENT','PREVIEW'].includes(kind)||!approvedAt||isNaN(approvedAt.getTime())||approvedAt>new Date())
    return {error:'بيانات الاعتماد غير صالحة'};
  if(kind==='PREVIEW'&&reference.length<3)return {error:'مرجع موافقة العميل مطلوب'};
  return change(form,'APPROVAL_RECORD',{id,kind,versionId,deliverableId,reference,approvedAt:approvedAt.toISOString()},async(tx,actor)=>{
    const p=await projectFor(tx,id,actor);
    if(kind==='PREVIEW'){
      if(actor.role!=='COMMUNICATION'||p.stage!=='CLIENT_PREVIEW')throw new ProductionError('مسؤول التواصل يسجل موافقة العميل بعد إرسال المعاينة');
      const output=await latestOutput(tx,id);
      if(output.id!==deliverableId||!await hasEvent(tx,id,'OwnerPreviewApproved',output.id)||
        !await hasEvent(tx,id,'ProtectedPreviewSentToClient',output.id))throw new ProductionError('أرسل أحدث معاينة معتمدة من المالك للعميل أولًا');
      if(await tx.approval.findFirst({where:{projectId:id,kind:'PREVIEW',deliverableId:output.id}}))throw new ProductionError('سُجلت موافقة العميل على هذه النسخة بالفعل');
    }else{
      if(actor.role!=='OWNER')throw new ProductionError('اعتماد السكريبت والتصور للمالك فقط');
      const version=await tx.productionVersion.findUnique({where:{id:versionId??''}});
      if(!version||version.projectId!==id||version.kind!==kind)throw new ProductionError('اختر النسخة المعتمدة الصحيحة');
    }
    const approval=await tx.approval.create({data:{projectId:id,kind:kind as 'SCRIPT'|'TREATMENT'|'PREVIEW',versionId,deliverableId,reference:reference||null,approvedById:actor.id,approvedAt}});
    await event(tx,id,actor.id,kind==='PREVIEW'?'ClientPreviewApproved':'ApprovalRecorded',{kind,approvalId:approval.id,versionId,deliverableId,reference},field(form,'requestId'));
    return {id:approval.id};
  },`/projects/${id}`);
}
export async function setPause(_:ActionState,form:FormData):Promise<ActionState>{const id=field(form,'projectId'),mode=field(form,'mode'),reason=field(form,'reason'),justified=field(form,'justified')==='true';if(!['pause','resume'].includes(mode)||mode==='pause'&&reason.length<3)return {error:'اكتب سبب التوقف'};return change(form,'PROJECT_PAUSE',{id,mode,reason,justified},async(tx,actor)=>{const p=await projectFor(tx,id,actor);if(actor.role==='EXECUTION'&&p.executorId!==actor.id)throw new ProductionError('غير مصرح');if(justified&&actor.role==='EXECUTION')throw new ProductionError('الإدارة أو التواصل فقط يعتمد التوقف المبرر');if(p.cancelledAt||p.stage==='COMPLETED'||p.paused===(mode==='pause'))throw new ProductionError('حالة التوقف تغيرت');const now=new Date();let pauseId:string;if(mode==='pause'){const pause=await tx.projectPause.create({data:{projectId:id,reason,justified,startedById:actor.id}});pauseId=pause.id}else{const old=await tx.projectPause.findFirst({where:{projectId:id,endedAt:null},orderBy:{startedAt:'desc'}});if(!old)throw new ProductionError('لا يوجد توقف نشط');await tx.projectPause.update({where:{id:old.id},data:{endedAt:now,endedById:actor.id}});pauseId=old.id}const updated=await tx.project.updateMany({where:{id,paused:p.paused},data:{paused:mode==='pause'}});if(updated.count!==1)throw new ProductionError('تغيرت حالة المشروع');await event(tx,id,actor.id,mode==='pause'?'ProjectPaused':'ProjectResumed',{pauseId,reason,justified},field(form,'requestId'));return {id:pauseId}},`/projects/${id}`)}
export async function addTask(_:ActionState,form:FormData):Promise<ActionState>{const id=field(form,'projectId'),title=field(form,'title');if(title.length<2||title.length>200)return {error:'عنوان المهمة غير صالح'};return change(form,'TASK_ADD',{id,title},async(tx,actor)=>{const p=await projectFor(tx,id,actor);if(p.cancelledAt||p.stage==='COMPLETED')throw new ProductionError('العمل مغلق ولا يقبل مهام جديدة');const task=await tx.productionTask.create({data:{projectId:id,title}});await event(tx,id,actor.id,'TaskAdded',{taskId:task.id},field(form,'requestId'));return {id:task.id}},`/projects/${id}`)}
export async function completeTask(_:ActionState,form:FormData):Promise<ActionState>{const id=field(form,'projectId'),taskId=field(form,'taskId');return change(form,'TASK_COMPLETE',{id,taskId},async(tx,actor)=>{const p=await projectFor(tx,id,actor);if(p.cancelledAt||p.stage==='COMPLETED')throw new ProductionError('العمل مغلق ولا يقبل تعديل المهام');const task=await tx.productionTask.findUnique({where:{id:taskId}});if(!task||task.projectId!==id)throw new ProductionError('المهمة غير متاحة');await tx.productionTask.update({where:{id:taskId},data:{doneAt:task.doneAt??new Date()}});await event(tx,id,actor.id,'TaskCompleted',{taskId},field(form,'requestId'));return {id:taskId}},`/projects/${id}`)}
export async function addRevision(_:ActionState,form:FormData):Promise<ActionState>{const id=field(form,'projectId'),kind=field(form,'kind'),source=field(form,'source'),notes=field(form,'notes'),orderChangeId=field(form,'orderChangeId')||null,dueAt=date(field(form,'dueAt'));if(!['INCLUDED','CORRECTION','SCOPE_CHANGE','PAID_EXTRA'].includes(kind)||source.length<2||notes.length<3||dueAt&&isNaN(dueAt.getTime()))return {error:'بيانات التعديل غير صالحة'};return change(form,'REVISION_ADD',{id,kind,source,notes,orderChangeId,dueAt:dueAt?.toISOString()},async(tx,actor)=>{const p=await projectFor(tx,id,actor);if(!['OWNER','COMMUNICATION'].includes(actor.role))throw new ProductionError('غير مصرح');if(!['CLIENT_PREVIEW','REVISIONS','DELIVERED'].includes(p.stage))throw new ProductionError('مرحلة المشروع لا تسمح بالتعديلات');const commercial=['SCOPE_CHANGE','PAID_EXTRA'].includes(kind);if(commercial){const approved=await tx.orderChange.findUnique({where:{id:orderChangeId??''},include:{order:{include:{team:true,client:{include:{lead:true}}}}}});if(!approved||approved.status!=='APPROVED'||approved.orderId!==p.orderId||kind==='SCOPE_CHANGE'&&approved.kind!=='SCOPE'||actor.role==='COMMUNICATION'&&(approved.order.team.communicatorId!==actor.id||approved.order.client.lead.teamId!==approved.order.teamId))throw new ProductionError('اختر موافقة تجارية معتمدة لهذا المشروع')}else if(orderChangeId)throw new ProductionError('لا تربط التصحيح بجولة تجارية');const last=await tx.revision.findFirst({where:{projectId:id},orderBy:{number:'desc'}});const revision=await tx.revision.create({data:{projectId:id,number:(last?.number??0)+1,kind:kind as 'INCLUDED'|'CORRECTION'|'SCOPE_CHANGE'|'PAID_EXTRA',source,notes,executorId:p.executorId,dueAt,orderChangeId}});await event(tx,id,actor.id,'RevisionRequested',{revisionId:revision.id,kind,orderChangeId},field(form,'requestId'));return {id:revision.id}},`/projects/${id}`)}
export async function addDeliverable(_:ActionState,form:FormData):Promise<ActionState>{const id=field(form,'projectId'),title=field(form,'title'),note=field(form,'note');if(title.length<2)return {error:'عنوان المخرج غير صالح'};return change(form,'DELIVERABLE_ADD',{id,title,note},async(tx,actor)=>{const p=await projectFor(tx,id,actor);if(actor.role!=='EXECUTION'||p.executorId!==actor.id||!['IN_PROGRESS','REVISIONS','INTERNAL_REVIEW'].includes(p.stage)||p.paused||p.cancelledAt)throw new ProductionError('المنفذ المكلف يسجل نسخة العمل أثناء التنفيذ أو المراجعة فقط');const last=await tx.deliverable.findFirst({where:{projectId:id},orderBy:{version:'desc'}});const d=await tx.deliverable.create({data:{projectId:id,version:(last?.version??0)+1,title,note,submittedById:actor.id}});await event(tx,id,actor.id,'DeliverableSubmitted',{deliverableId:d.id,version:d.version},field(form,'requestId'));return {id:d.id}},`/projects/${id}`)}
export async function reviewQuality(_:ActionState,form:FormData):Promise<ActionState>{const id=field(form,'projectId'),deliverableId=field(form,'deliverableId'),errors=field(form,'errors'),checks=form.getAll('checks').map(String),passed=field(form,'passed')==='true';return change(form,'QUALITY_REVIEW',{id,deliverableId,errors,checks,passed},async(tx,actor)=>{const p=await projectFor(tx,id,actor);if(actor.role!=='OWNER'||p.stage!=='INTERNAL_REVIEW'||p.paused||p.cancelledAt)throw new ProductionError('المالك يراجع الجودة أثناء المراجعة الداخلية فقط');const d=await latestOutput(tx,id);if(d.id!==deliverableId)throw new ProductionError('راجع أحدث نسخة فقط');if(passed&&!requiredQualityItems(p.serviceType).every(item=>checks.includes(item)))throw new ProductionError('أكمل قائمة فحص الجودة');const q=await tx.qualityReview.create({data:{projectId:id,deliverableId,reviewerId:actor.id,checklist:checks,errors,passed}});await event(tx,id,actor.id,'QualityReviewed',{reviewId:q.id,passed,errors},field(form,'requestId'));return {id:q.id}},`/projects/${id}`)}
export async function transferProject(_:ActionState,form:FormData):Promise<ActionState>{const id=field(form,'projectId'),teamId=field(form,'teamId'),reason=field(form,'reason');if(reason.length<3)return {error:'اكتب سبب النقل'};return change(form,'PROJECT_TRANSFER',{id,teamId,reason},async(tx,actor)=>{if(actor.role!=='OWNER')throw new ProductionError('الإدارة فقط تنقل المشروع');const p=await projectFor(tx,id,actor);if(p.cancelledAt||p.completedAt)throw new ProductionError('لا يمكن نقل مشروع مغلق');if(p.productionStartedAt||await tx.deliverable.findFirst({where:{projectId:id}}))throw new ProductionError('نقل مشروع بدأ تنفيذه يحتاج تقييم العمل ومستحق المنفذ الأول وموافقة ميزانية مستقلة');const team=await tx.team.findUnique({where:{id:teamId}}),client=await tx.client.findUnique({where:{id:p.clientId},include:{lead:true}});if(!team?.active||team.id===p.teamId||team.id!==client?.lead.teamId)throw new ProductionError('اختر الفريق الحالي للعميل');await tx.projectAssignment.updateMany({where:{projectId:id,endedAt:null},data:{endedAt:new Date()}});const a=await tx.projectAssignment.create({data:{projectId:id,executorId:team.executorId,actorId:actor.id,reason}});await tx.project.update({where:{id},data:{teamId,executorId:team.executorId}});await event(tx,id,actor.id,'ProjectTransferred',{from:p.teamId,to:teamId,reason},field(form,'requestId'));return {id:a.id}},`/projects/${id}`)}
export async function cancelProject(_:ActionState,form:FormData):Promise<ActionState>{const id=field(form,'projectId'),reason=field(form,'reason');if(reason.length<3)return {error:'اكتب سبب الإلغاء'};return change(form,'PROJECT_CANCEL',{id,reason},async(tx,actor)=>{if(actor.role!=='OWNER')throw new ProductionError('الإدارة فقط تلغي المشروع');const p=await projectFor(tx,id,actor);if(p.cancelledAt||p.completedAt)throw new ProductionError('لا يمكن إلغاء المشروع');const releasable=!p.productionStartedAt&&!await tx.deliverable.findFirst({where:{projectId:id}});if(releasable&&p.cycleItemId){const result=await tx.cycleItem.updateMany({where:{id:p.cycleItemId,assignedQuantity:{gt:0}},data:{assignedQuantity:{decrement:1}}});if(result.count!==1)throw new ProductionError('تعذر تحرير كمية الدورة')}else if(releasable&&p.orderItemId){const result=await tx.orderItem.updateMany({where:{id:p.orderItemId,assignedQuantity:{gt:0}},data:{assignedQuantity:{decrement:1}}});if(result.count!==1)throw new ProductionError('تعذر تحرير كمية الاتفاق')}await tx.project.update({where:{id},data:{cancelledAt:new Date()}});await event(tx,id,actor.id,'ProjectCancelled',{reason,quantityReleased:releasable&&!!p.orderItemId},field(form,'requestId'));return {id}},`/projects/${id}`)}
export async function completeRequirements(_:ActionState,form:FormData):Promise<ActionState>{const id=field(form,'projectId');return change(form,'REQUIREMENTS_COMPLETE',{id},async(tx,actor)=>{const p=await projectFor(tx,id,actor);if(!['OWNER','COMMUNICATION'].includes(actor.role))throw new ProductionError('مسؤول التواصل أو الإدارة فقط يؤكد المتطلبات');if(p.requirementsComplete)return {id};await tx.project.update({where:{id},data:{requirementsComplete:true}});await event(tx,id,actor.id,'RequirementsCompleted',{},field(form,'requestId'));return {id}},`/projects/${id}`)}
export async function updateRevision(_:ActionState,form:FormData):Promise<ActionState>{const id=field(form,'projectId'),revisionId=field(form,'revisionId'),status=field(form,'status'),outputVersionId=field(form,'outputVersionId')||null;if(!['IN_PROGRESS','SUBMITTED','CLOSED'].includes(status))return {error:'حالة التعديل غير صالحة'};return change(form,'REVISION_STATUS',{id,revisionId,status,outputVersionId},async(tx,actor)=>{const p=await projectFor(tx,id,actor);const r=await tx.revision.findUnique({where:{id:revisionId},include:{orderChange:true}});if(!r||r.projectId!==id)throw new ProductionError('جولة التعديل غير متاحة');const next:{[key:string]:string}={OPEN:'IN_PROGRESS',IN_PROGRESS:'SUBMITTED',SUBMITTED:'CLOSED'};if(next[r.status]!==status)throw new ProductionError('انتقال جولة التعديل غير مسموح');if(['SCOPE_CHANGE','PAID_EXTRA'].includes(r.kind)&&(!r.orderChange||r.orderChange.status!=='APPROVED'||r.orderChange.orderId!==p.orderId))throw new ProductionError('تغيير النطاق والطلب الإضافي يحتاجان موافقة منفصلة');if(status==='CLOSED'){if(!['OWNER','COMMUNICATION'].includes(actor.role))throw new ProductionError('مسؤول التواصل أو الإدارة فقط يغلق الجولة')}else if(actor.role!=='OWNER'&&actor.id!==p.executorId)throw new ProductionError('المنفذ المكلف فقط يحدث الجولة');if(status==='SUBMITTED'){const d=await tx.deliverable.findUnique({where:{id:outputVersionId??''}});if(!d||d.projectId!==id)throw new ProductionError('اختر النسخة الناتجة عن التعديل')}const updated=await tx.revision.updateMany({where:{id:revisionId,status:r.status},data:{status:status as 'IN_PROGRESS'|'SUBMITTED'|'CLOSED',outputVersionId:status==='SUBMITTED'?outputVersionId:undefined,closedAt:status==='CLOSED'?new Date():undefined}});if(updated.count!==1)throw new ProductionError('تغيرت حالة الجولة، حدّث الصفحة');await event(tx,id,actor.id,'RevisionStatusChanged',{revisionId,from:r.status,to:status,outputVersionId},field(form,'requestId'));return {id:revisionId}},`/projects/${id}`)}
