'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { confirmedOrderPaidMinor } from '@/lib/finance';
import { approvedDevelopmentAmount, type ApprovedService } from '@/lib/finance-policy';
import { runOnce, RequestConflict, InvalidRequestId, type Tx } from '@/lib/idempotency';
import type { ActionState } from './actions';
import type { ExpenseCategory } from '@/generated/prisma/client';

class ExpenseError extends Error {}
const f=(form:FormData,key:string)=>String(form.get(key)??'').trim();
const money=(raw:string)=>/^\d{1,15}$/.test(raw)?BigInt(raw):null;
const fail=(e:unknown):ActionState=>({error:e instanceof ExpenseError||e instanceof RequestConflict||e instanceof InvalidRequestId?e.message:'تعذر حفظ المصروف أو المخصص'});
const refresh=()=>{revalidatePath('/finance');revalidatePath('/finance/expenses')};
const categories:ExpenseCategory[]=['PROJECT_DIRECT','GENERAL','SOFTWARE','AI_TOOLS','HOSTING','BANK_FEES','DEVELOPMENT','EXCEPTIONAL'];
const policies:ApprovedService[]=['EG_POSTER','EG_MOTION','EG_VIDEO_3_POSTERS','SA_POSTER','SA_MOTION','SA_VIDEO_POSTER','SA_SUBSCRIPTION'];
async function lock(tx:Tx,key:string){await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`}
async function account(tx:Tx,code:string,currency:string,name:string){return tx.ledgerAccount.upsert({where:{code_currency:{code,currency}},create:{code,currency,name},update:{}})}
async function cashAvailable(tx:Tx,accountId:string){const totals=await tx.ledgerPosting.aggregate({where:{accountId},_sum:{debitMinor:true,creditMinor:true}});return(totals._sum.debitMinor??0n)-(totals._sum.creditMinor??0n)}

export async function reserveDevelopment(_:ActionState,form:FormData):Promise<ActionState>{
  const orderId=f(form,'orderId'),orderItemId=f(form,'orderItemId'),policy=f(form,'policy') as ApprovedService;
  if(!policies.includes(policy))return{error:'اختر قاعدة تطوير معتمدة'};
  const actor=await requireUser();
  try{await runOnce({requestId:f(form,'requestId'),actorId:actor.id,action:'DEVELOPMENT_RESERVE',payload:{orderId,orderItemId,policy},execute:async tx=>{
    if(actor.role!=='OWNER')throw new ExpenseError('المالك فقط يعتمد مخصص التطوير');
    await lock(tx,`DEVELOPMENT_ORDER:${orderId}`);
    const order=await tx.customerOrder.findUnique({where:{id:orderId},include:{items:true}});
    if(!order||order.status!=='APPROVED'||order.items.length!==1||order.items[0].id!==orderItemId||order.items[0].quantity!==1)throw new ExpenseError('يلزم اتفاق معتمد ببند واحد وكمية واحدة');
    if((policy.startsWith('EG_')?'EG':'SA')!==order.marketCode)throw new ExpenseError('قاعدة التطوير لا تطابق السوق');
    if(await confirmedOrderPaidMinor(tx,orderId)!==order.totalMinor)throw new ExpenseError('لا يعتمد المخصص قبل اكتمال التحصيل');
    if(order.marketCode==='SA'&&!await tx.fxReceipt.findFirst({where:{orderId}}))throw new ExpenseError('يلزم توثيق صافي النقدية بالجنيه للتحويل السعودي');
    const item=order.items[0],expected=policy.endsWith('POSTER')&&policy!=='SA_VIDEO_POSTER'&&policy!=='EG_VIDEO_3_POSTERS'?'POSTER':policy.endsWith('MOTION')?'VIDEO':policy==='EG_VIDEO_3_POSTERS'?'VIDEO_3_POSTERS':policy==='SA_VIDEO_POSTER'?'VIDEO_POSTER':null;
    if(expected&&item.productionTypeSnapshot!==expected||policy==='SA_SUBSCRIPTION'&&item.serviceKindSnapshot!=='SUBSCRIPTION')throw new ExpenseError('نوع الخدمة لا يطابق الاتفاق');
    let amountMinor:bigint;
    try{amountMinor=approvedDevelopmentAmount(policy,order.marketCode==='EG'?item.unitMinor:undefined)}catch(e){throw new ExpenseError(e instanceof Error?e.message:'قاعدة التطوير غير صالحة')}
    const cost=await account(tx,'DEVELOPMENT_COST','EGP','مخصص تطوير معتمد');
    const reserve=await account(tx,'DEVELOPMENT_RESERVE','EGP','التزام صندوق التطوير');
    const journal=await tx.journalEntry.create({data:{currency:'EGP',kind:'DEVELOPMENT_RESERVE',reference:`DEVELOPMENT:${orderItemId}`,description:`مخصص تطوير الاتفاق ${orderId}`,createdById:actor.id}});
    await tx.ledgerPosting.create({data:{journalId:journal.id,accountId:cost.id,debitMinor:amountMinor}});
    await tx.ledgerPosting.create({data:{journalId:journal.id,accountId:reserve.id,creditMinor:amountMinor}});
    const allocation=await tx.developmentAllocation.create({data:{orderId,orderItemId,amountMinor,policyCode:policy,policyVersion:1,approvedById:actor.id,reservationJournalId:journal.id}});
    await tx.auditLog.create({data:{actorId:actor.id,action:'DEVELOPMENT_RESERVED',subjectId:allocation.id,detail:{orderId,orderItemId,amountMinor:String(amountMinor),policy,journalId:journal.id}}});
    return{id:allocation.id};
  }})}catch(e){return fail(e)}refresh();return{success:'اعتمد مخصص التطوير كالتزام منفصل ولم يُنقل نقدًا بعد'}
}

export async function fundDevelopment(_:ActionState,form:FormData):Promise<ActionState>{
  const allocationId=f(form,'allocationId');const actor=await requireUser();
  try{await runOnce({requestId:f(form,'requestId'),actorId:actor.id,action:'DEVELOPMENT_FUND',payload:{allocationId},execute:async tx=>{
    if(actor.role!=='OWNER')throw new ExpenseError('المالك فقط يمول صندوق التطوير');
    await lock(tx,'CASH:EGP');await lock(tx,`DEVELOPMENT:${allocationId}`);
    const allocation=await tx.developmentAllocation.findUnique({where:{id:allocationId}});
    if(!allocation||allocation.status!=='RESERVED')throw new ExpenseError('المخصص غير متاح للتمويل');
    const cash=await account(tx,'CASH','EGP','نقدية مستلمة بالجنيه');
    if(await cashAvailable(tx,cash.id)<allocation.amountMinor)throw new ExpenseError('النقدية العامة المسجلة لا تغطي المخصص');
    const fund=await account(tx,'DEVELOPMENT_CASH','EGP','نقدية محجوزة للتطوير');
    const journal=await tx.journalEntry.create({data:{currency:'EGP',kind:'DEVELOPMENT_FUND',reference:`DEVELOPMENT_FUND:${allocationId}`,description:'حجز نقدية داخلية للتطوير',createdById:actor.id}});
    await tx.ledgerPosting.create({data:{journalId:journal.id,accountId:fund.id,debitMinor:allocation.amountMinor}});
    await tx.ledgerPosting.create({data:{journalId:journal.id,accountId:cash.id,creditMinor:allocation.amountMinor}});
    await tx.developmentAllocation.update({where:{id:allocationId},data:{status:'FUNDED',fundingJournalId:journal.id,fundedAt:new Date()}});
    await tx.auditLog.create({data:{actorId:actor.id,action:'DEVELOPMENT_FUNDED',subjectId:allocationId,detail:{amountMinor:String(allocation.amountMinor),journalId:journal.id}}});
    return{id:allocationId};
  }})}catch(e){return fail(e)}refresh();return{success:'حُجزت نقدية التطوير داخليًا دون إنشاء مصروف ثان'}
}

export async function createExpense(_:ActionState,form:FormData):Promise<ActionState>{
  const category=f(form,'category') as ExpenseCategory,description=f(form,'description'),amountMinor=money(f(form,'amountMinor')),currency=f(form,'currency').toUpperCase(),projectId=f(form,'projectId'),developmentAllocationId=f(form,'developmentAllocationId'),proofRef=f(form,'proofRef'),dueRaw=f(form,'dueAt'),dueAt=dueRaw?new Date(dueRaw):null;
  if(!categories.includes(category)||description.length<3||description.length>2000||!amountMinor||amountMinor<=0n||!['EGP','SAR'].includes(currency)||dueAt&&Number.isNaN(dueAt.getTime())||proofRef.length>500||category!=='DEVELOPMENT'&&proofRef.length<3)return{error:'راجع وصف المصروف ومبلغه وفئته ومرجع الإثبات'};
  const actor=await requireUser();
  try{await runOnce({requestId:f(form,'requestId'),actorId:actor.id,action:'EXPENSE_CREATE',payload:{category,description,amountMinor:String(amountMinor),currency,projectId,developmentAllocationId,proofRef,dueAt:dueAt?.toISOString()??null},execute:async tx=>{
    if(actor.role!=='OWNER')throw new ExpenseError('المالك فقط يسجل المصروفات');
    if(category==='PROJECT_DIRECT'&&!projectId||category!=='PROJECT_DIRECT'&&category!=='DEVELOPMENT'&&projectId)throw new ExpenseError('المصروف العام على مستوى الاستوديو، والمباشر يحتاج مشروعًا');
    if(projectId&&!await tx.project.findUnique({where:{id:projectId}}))throw new ExpenseError('المشروع غير موجود');
    if(category==='DEVELOPMENT'&&(!developmentAllocationId||currency!=='EGP')||category!=='DEVELOPMENT'&&developmentAllocationId)throw new ExpenseError('مصروف التطوير يحتاج مخصصًا بالجنيه');
    const expense=await tx.expense.create({data:{category,description,amountMinor,currency,dueAt,projectId:projectId||null,developmentAllocationId:developmentAllocationId||null,proofRef:proofRef||null,createdById:actor.id}});
    await tx.auditLog.create({data:{actorId:actor.id,action:'EXPENSE_DRAFTED',subjectId:expense.id,detail:{category,description,amountMinor:String(amountMinor),currency,projectId:projectId||null}}});
    return{id:expense.id};
  }})}catch(e){return fail(e)}refresh();return{success:'سُجل المصروف كمسودة دون أثر على النقدية'}
}

export async function approveExpense(_:ActionState,form:FormData):Promise<ActionState>{
  const expenseId=f(form,'expenseId'),decisionRef=f(form,'decisionRef');if(decisionRef.length<3||decisionRef.length>500)return{error:'أدخل مرجع قرار المصروف'};const actor=await requireUser();
  try{await runOnce({requestId:f(form,'requestId'),actorId:actor.id,action:'EXPENSE_APPROVE',payload:{expenseId,decisionRef},execute:async tx=>{
    if(actor.role!=='OWNER')throw new ExpenseError('المالك فقط يعتمد المصروف');
    await lock(tx,`EXPENSE:${expenseId}`);
    const expense=await tx.expense.findUnique({where:{id:expenseId}});
    if(!expense||expense.status!=='DRAFT')throw new ExpenseError('المصروف ليس مسودة');
    let journalId:string|null=null;
    if(expense.category==='DEVELOPMENT'){
      await lock(tx,`DEVELOPMENT:${expense.developmentAllocationId}`);
      const allocation=await tx.developmentAllocation.findUnique({where:{id:expense.developmentAllocationId!}});
      if(!allocation||allocation.status!=='FUNDED')throw new ExpenseError('مخصص التطوير لم يُمول بعد');
      const used=await tx.expense.aggregate({where:{developmentAllocationId:allocation.id,status:{in:['APPROVED','PAID']}},_sum:{amountMinor:true}});
      if((used._sum.amountMinor??0n)+expense.amountMinor>allocation.amountMinor)throw new ExpenseError('مصروف التطوير يتجاوز المبلغ المحجوز');
    }else{
      const cost=await account(tx,`EXPENSE_${expense.category}`,expense.currency,`مصروف ${expense.category}`);
      const payable=await account(tx,'ACCOUNTS_PAYABLE',expense.currency,'مصروفات مستحقة');
      const journal=await tx.journalEntry.create({data:{currency:expense.currency,kind:'EXPENSE_ACCRUAL',reference:`EXPENSE_ACCRUAL:${expenseId}`,description:`مصروف معتمد ${decisionRef}`,createdById:actor.id}});
      await tx.ledgerPosting.create({data:{journalId:journal.id,accountId:cost.id,debitMinor:expense.amountMinor}});
      await tx.ledgerPosting.create({data:{journalId:journal.id,accountId:payable.id,creditMinor:expense.amountMinor}});
      journalId=journal.id;
    }
    await tx.expense.update({where:{id:expenseId},data:{status:'APPROVED',approvedById:actor.id,approvedAt:new Date(),accrualJournalId:journalId}});
    await tx.auditLog.create({data:{actorId:actor.id,action:'EXPENSE_APPROVED',subjectId:expenseId,detail:{decisionRef,journalId}}});return{id:expenseId};
  }})}catch(e){return fail(e)}refresh();return{success:'اعتُمد المصروف وأُثبت الالتزام دون تسجيل دفع'}
}

export async function payExpense(_:ActionState,form:FormData):Promise<ActionState>{
  const expenseId=f(form,'expenseId'),paymentRef=f(form,'paymentRef'),proofRef=f(form,'proofRef'),paidAt=new Date(f(form,'paidAt'));
  if(paymentRef.length<3||paymentRef.length>500||proofRef.length<3||proofRef.length>500||Number.isNaN(paidAt.getTime())||paidAt>new Date())return{error:'أدخل مرجع الدفع وإثباته وتاريخه'};
  const actor=await requireUser();
  try{await runOnce({requestId:f(form,'requestId'),actorId:actor.id,action:'EXPENSE_PAY',payload:{expenseId,paymentRef,proofRef,paidAt:paidAt.toISOString()},execute:async tx=>{
    if(actor.role!=='OWNER')throw new ExpenseError('المالك فقط يؤكد دفع المصروف');
    let expense=await tx.expense.findUnique({where:{id:expenseId}});
    if(!expense||expense.status!=='APPROVED')throw new ExpenseError('المصروف غير معتمد أو دُفع سابقًا');
    await lock(tx,`CASH:${expense.currency}`);await lock(tx,`EXPENSE:${expenseId}`);
    expense=await tx.expense.findUnique({where:{id:expenseId}});
    if(!expense||expense.status!=='APPROVED')throw new ExpenseError('المصروف غير معتمد أو دُفع سابقًا');
    if(expense.category==='BANK_FEES'&&(await tx.receipt.findUnique({where:{settlementRef:paymentRef}})||await tx.fxReceipt.findUnique({where:{transferRef:paymentRef}})))throw new ExpenseError('هذه الرسوم مسجلة ضمن التحصيل أو التحويل بالفعل');
    const cash=await account(tx,expense.category==='DEVELOPMENT'?'DEVELOPMENT_CASH':'CASH',expense.currency,'نقدية متاحة للصرف');
    if(await cashAvailable(tx,cash.id)<expense.amountMinor)throw new ExpenseError('الرصيد النقدي المسجل لا يكفي لهذا الدفع');
    const debit=await account(tx,expense.category==='DEVELOPMENT'?'DEVELOPMENT_RESERVE':'ACCOUNTS_PAYABLE',expense.currency,'التزام مصروف معتمد');
    const journal=await tx.journalEntry.create({data:{currency:expense.currency,kind:'EXPENSE_PAYMENT',reference:`EXPENSE_PAYMENT:${paymentRef}`,description:`دفع مصروف ${expenseId}`,createdById:actor.id}});
    await tx.ledgerPosting.create({data:{journalId:journal.id,accountId:debit.id,debitMinor:expense.amountMinor}});
    await tx.ledgerPosting.create({data:{journalId:journal.id,accountId:cash.id,creditMinor:expense.amountMinor}});
    await tx.expense.update({where:{id:expenseId},data:{status:'PAID',paidAt,paidById:actor.id,paymentRef,proofRef,paymentJournalId:journal.id}});
    await tx.auditLog.create({data:{actorId:actor.id,action:'EXPENSE_PAID',subjectId:expenseId,detail:{paymentRef,proofRef,amountMinor:String(expense.amountMinor),currency:expense.currency,journalId:journal.id}}});return{id:expenseId};
  }})}catch(e){return fail(e)}refresh();return{success:'تأكد دفع المصروف وسُجل قيد النقدية دون خصم التطوير مرتين'}
}
