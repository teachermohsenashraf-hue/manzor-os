'use client';

import { useActionState, useState } from 'react';
import { createSubscription } from '@/app/commerce-actions';

export function MonthlySubscriptionForm({ orderId }: { orderId: string }) {
  const [start, setStart] = useState('');
  const [state, submit, pending] = useActionState(createSubscription, {});
  const first = start ? new Date(start) : null;
  const end = first && !Number.isNaN(first.getTime()) ? new Date(first.getTime() + 30 * 86400000) : null;
  return <form action={submit} className="stack production-form" onSubmit={event => {
    const key = event.currentTarget.elements.namedItem('requestId') as HTMLInputElement;
    key.value = crypto.randomUUID();
  }}>
    <input type="hidden" name="requestId" /><input type="hidden" name="orderId" value={orderId} />
    <input type="hidden" name="startsAt" value={first && !Number.isNaN(first.getTime()) ? first.toISOString() : ''} />
    <input type="hidden" name="endsAt" value={end?.toISOString() ?? ''} />
    <input type="hidden" name="cycleDays" value="30" />
    <input type="hidden" name="deliveryPlan" value="ثلاثة فيديوهات وثلاثة بوسترات خلال الدورة الشهرية" />
    <label>بداية الدورة الشهرية<input type="datetime-local" value={start} onChange={event => setStart(event.target.value)} required /></label>
    <p className="muted">باقة واحدة بقيمة 1300 ريال مقدمًا، تضم 3 فيديوهات و3 بوسترات دون أسعار مستقلة للمخرجات</p>
    {state.error && <p role="alert" className="message error">{state.error}</p>}
    {state.success && <p role="status" className="message success">{state.success}</p>}
    <button disabled={pending || !end}>{pending ? 'جار الحفظ' : 'إنشاء الدورة الشهرية'}</button>
  </form>;
}
