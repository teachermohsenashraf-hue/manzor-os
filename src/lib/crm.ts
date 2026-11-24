import { z } from 'zod';
import { db } from './db';
import type { User } from '@/generated/prisma/client';
export { statuses, priorities } from './crm-labels';
export const leadInput = z.object({name:z.string().trim().min(2).max(160),country:z.string().trim().max(80).optional(),city:z.string().trim().max(80).optional(),sector:z.string().trim().max(100).optional(),phone:z.string().trim().max(40).optional(),whatsapp:z.string().trim().max(40).optional(),socialUrl:z.string().trim().max(500).optional(),source:z.string().trim().max(100).optional(),notes:z.string().trim().max(3000).optional(),teamId:z.string().min(1),priority:z.enum(['LOW','NORMAL','HIGH'])});
export const phoneNorm=(s?:string)=>{const value=(s??'').replace(/[^0-9+]/g,'');return value.length>=7?value.replace(/^00/,'+'):null};
export const socialNorm=(s?:string)=>{try{if(!s)return null;const u=new URL(s.startsWith('http')?s:`https://${s}`);if(!['https:','http:'].includes(u.protocol))return null;return `${u.hostname.toLowerCase().replace(/^www\./,'')}${u.pathname.replace(/\/$/,'').toLowerCase()}`}catch{return null}};
export function visibleLeadWhere(user:Pick<User,'id'|'role'>){return user.role==='OWNER'?{}:user.role==='COMMUNICATION'?{team:{communicatorId:user.id}}:user.role==='EXECUTION'?{team:{executorId:user.id}}:{id:'__none__'};}
export async function accessibleLead(id:string,user:Pick<User,'id'|'role'>){return db.lead.findFirst({where:{id,...visibleLeadWhere(user)},include:{team:true,client:true}})}
export async function duplicateLeads(phone:string|null,whatsapp:string|null,social:string|null,excludeId?:string){const checks=[phone,whatsapp,social].filter(Boolean);if(!checks.length)return [];return db.lead.findMany({where:{id:excludeId?{not:excludeId}:undefined,OR:[...(phone?[{phoneNorm:phone},{whatsappNorm:phone}]:[]),...(whatsapp?[{phoneNorm:whatsapp},{whatsappNorm:whatsapp}]:[]),...(social?[{socialNorm:social}]:[])]},select:{id:true,name:true,status:true},take:10})}
