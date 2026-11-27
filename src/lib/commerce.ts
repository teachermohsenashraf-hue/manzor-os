import type { OrderStatus, Role, ServiceKind } from '@/generated/prisma/client';

export const serviceKindLabels: Record<ServiceKind,string>={SINGLE:'خدمة فردية',BUNDLE:'باقة',SUBSCRIPTION:'اشتراك شهري'};
export const orderStatusLabels: Record<OrderStatus,string>={DRAFT:'مسودة',PROPOSED:'بانتظار الاعتماد',APPROVED:'معتمد',REJECTED:'مرفوض',CANCELLED:'ملغى'};
export function canSeeCommercial(role:Role,userId:string,team:{communicatorId:string;executorId:string}){
  return role==='OWNER'||role==='COMMUNICATION'&&team.communicatorId===userId;
}
export function canChangeOrder(role:Role,from:OrderStatus,to:OrderStatus){
  if(to==='PROPOSED')return ['OWNER','COMMUNICATION'].includes(role)&&from==='DRAFT';
  if(to==='APPROVED'||to==='REJECTED')return role==='OWNER'&&from==='PROPOSED';
  if(to==='CANCELLED')return role==='OWNER'&&['DRAFT','PROPOSED','APPROVED'].includes(from);
  return false;
}
export function parseMinor(value:string):bigint|null{
  if(!/^(0|[1-9]\d{0,14})$/.test(value))return null;
  return BigInt(value);
}
export function activePrice<T extends {effectiveFrom:Date;effectiveTo:Date|null}>(prices:T[],at:Date):T|null{
  return prices.filter(p=>p.effectiveFrom<=at&&(!p.effectiveTo||p.effectiveTo>at)).sort((a,b)=>b.effectiveFrom.getTime()-a.effectiveFrom.getTime())[0]??null;
}
export function remainingQuantity(quantity:number,assigned:number,approvedExtra:number){return Math.max(0,quantity+approvedExtra-assigned)}
export function cycleRemaining(planned:number,assigned:number){return Math.max(0,planned-assigned)}
export function formatMinor(amount:bigint,currency:string){
  const digits=new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits??2;
  const factor=10n**BigInt(digits),sign=amount<0n?'-':'' ,value=amount<0n?-amount:amount;
  const whole=new Intl.NumberFormat('en-US').format(value/factor);
  const fraction=digits?(value%factor).toString().padStart(digits,'0').replace(/0+$/,''):'';
  return `${sign}${whole}${fraction?'.'+fraction:''} ${currency}`;
}
export type ComponentSnapshot={serviceId:string;quantity:number;productionType:string;name:string};
export function readComponents(value:unknown):ComponentSnapshot[]{
  if(!Array.isArray(value)||!value.every(x=>x&&typeof x==='object'&&typeof x.serviceId==='string'&&Number.isSafeInteger(x.quantity)&&x.quantity>0&&typeof x.productionType==='string'&&typeof x.name==='string'))throw new Error('نسخة مكونات الخدمة غير صالحة');
  return value as ComponentSnapshot[];
}
