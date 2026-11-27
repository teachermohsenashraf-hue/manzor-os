'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { createOperationalOrder } from '@/app/operational-actions';
import { formatMinor } from '@/lib/commerce';

type Client = { id: string; name: string };
type Team = { id: string; name: string };
type Offer = { id: string; name: string; kind: string; currency: string; amountMinor: bigint; marketCode: string };

export function OperationalOrderForm({ clients, teams, offers, canManageServices }: { clients: Client[]; teams: Team[]; offers: Offer[]; canManageServices: boolean }) {
  const [mode, setMode] = useState<'existing' | 'new'>(clients.length ? 'existing' : 'new');
  const [state, submit, pending] = useActionState(createOperationalOrder, {});
  return <form action={submit} className="stack production-form" onSubmit={event => {
    const key = event.currentTarget.elements.namedItem('requestId') as HTMLInputElement;
    key.value = crypto.randomUUID();
  }}>
    <input type="hidden" name="requestId" />
    <input type="hidden" name="clientMode" value={mode} />
    <fieldset className="stack"><legend>العميل</legend>
      <div className="form-two">
        <label className="check"><input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} />عميل مسجل</label>
        <label className="check"><input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} />عميل جديد</label>
      </div>
      {mode === 'existing' ? <label>اختر العميل<select name="clientId" required defaultValue=""><option value="">اختر</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label> : <>
        <label>اسم العميل<input name="clientName" required minLength={2} /></label>
        <label>رقم التواصل<input name="contact" required inputMode="tel" dir="ltr" /></label>
        <label>الفريق المسؤول<select name="teamId" required defaultValue={teams.length === 1 ? teams[0].id : ''}><option value="">اختر</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
        <label className="check"><input type="checkbox" name="accepted" value="yes" required />وافق العميل على الطلب وتحويله إلى عميل فعلي</label>
      </>}
    </fieldset>
    <label>الخدمة<select name="priceId" required defaultValue=""><option value="">اختر الخدمة</option>{offers.map(offer => <option key={offer.id} value={offer.id}>{offer.name} · {offer.marketCode} · {formatMinor(offer.amountMinor, offer.currency)}{offer.kind === 'SUBSCRIPTION' ? ' · شهريًا 3 فيديوهات و3 بوسترات' : ''}</option>)}</select></label>
    <label>وصف المطلوب<textarea name="scope" rows={3} required placeholder="ما الذي طلبه العميل؟" /></label>
    <details><summary>تفاصيل إضافية عند الحاجة</summary><div className="stack">
      <label>اسم مخصص للطلب<input name="title" /></label>
      <label>المتطلبات المتوفرة<textarea name="requirements" rows={2} placeholder="يمكن استكمالها قبل بدء الإنتاج" /></label>
      <label>موعد التسليم<input type="datetime-local" name="dueAt" /></label>
      <label>مرجع الاتفاق<input name="agreementRef" /></label>
    </div></details>
    {state.error && <p role="alert" className="message error">{state.error}</p>}
    <button disabled={pending || !offers.length || !teams.length}>{pending ? 'جار الحفظ' : 'حفظ وإرسال الطلب للمراجعة'}</button>
    {!teams.length && <p className="notice">لا يوجد فريق متاح لحسابك، اطلب من المالك ربطك بفريق قبل تسجيل الطلب</p>}
    {!offers.length && <p className="notice">لا توجد خدمة بسعر ساري {canManageServices ? <Link href="/services">أضف خدمة وسعرها</Link> : 'اطلب من المالك إضافة الخدمة وسعرها'}</p>}
  </form>;
}
