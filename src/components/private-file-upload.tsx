'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export function PrivateFileUpload({ projectId, deliverables }: { projectId: string; deliverables: { id: string; title: string; version: number }[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState('PREVIEW');
  const [deliverableId, setDeliverableId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) return setMessage('اختر ملفًا');
    setBusy(true); setMessage('يجري إعداد رابط الرفع');
    try {
      const endpoint = `/api/projects/${encodeURIComponent(projectId)}/attachments`;
      const prepare = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'prepare', kind, deliverableId, fileName: file.name, mimeType: file.type, sizeBytes: file.size }) });
      const ticket = await prepare.json();
      if (!prepare.ok) throw new Error(ticket.error ?? 'تعذر إعداد الرفع');
      setMessage('يجري رفع الملف إلى التخزين الخاص');
      const uploaded = await fetch(ticket.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type, 'x-upsert': 'false' }, body: file });
      if (!uploaded.ok) throw new Error('تعذر رفع الملف، حاول بملف جديد');
      const finish = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'finalize', attachmentId: ticket.attachmentId }) });
      const result = await finish.json();
      if (!finish.ok) throw new Error(result.error ?? 'تعذر التحقق من الملف');
      if (input.current) input.current.value = '';
      setMessage('تم رفع الملف والتحقق منه');
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر الرفع'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={upload} className="stack">
    <label>نوع الملف<select value={kind} onChange={event => setKind(event.target.value)} disabled={busy}>
      <option value="REQUIREMENT">متطلبات</option><option value="SCRIPT">سكريبت أو تصور</option>
      <option value="PREVIEW">معاينة</option><option value="REVISION">تعديل</option>
      <option value="FINAL">تسليم نهائي</option><option value="SOURCE">ملف مصدري</option>
    </select></label>
    {['PREVIEW','FINAL'].includes(kind) && <label>المخرج<select value={deliverableId} onChange={event => setDeliverableId(event.target.value)} required disabled={busy}>
      <option value="">اختر</option>{deliverables.map(item => <option key={item.id} value={item.id}>{item.title} · نسخة {item.version}</option>)}
    </select></label>}
    <label>الملف<input ref={input} type="file" required disabled={busy} accept=".pdf,.png,.jpg,.jpeg,.webp,.svg,.mp4,.mov,.zip,.txt,.docx"/></label>
    <button type="submit" disabled={busy}>{busy ? 'جارٍ الرفع' : 'رفع ملف خاص'}</button>
    {message && <p role="status" className="notice">{message}</p>}
  </form>;
}
