'use client';
import { useActionState, type ReactNode } from 'react';
import type { ActionState } from '@/app/actions';

export function ProductionForm({action,projectId,children,label}:{action:(state:ActionState,form:FormData)=>Promise<ActionState>;projectId?:string;children?:ReactNode;label:string}) {
  const [state,submit,pending]=useActionState(action,{});
  return <form action={submit} className="stack form-grid production-form" onSubmit={e=>{const input=e.currentTarget.elements.namedItem('requestId') as HTMLInputElement;input.value=crypto.randomUUID()}}>
    <input type="hidden" name="requestId"/>{projectId&&<input type="hidden" name="projectId" value={projectId}/>}{children}
    {state.error&&<p role="alert" className="message error">{state.error}</p>}{state.success&&<p role="status" className="message success">{state.success}</p>}
    <button disabled={pending}>{pending?'جار الحفظ':label}</button>
  </form>;
}
