import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser } from '@/lib/auth';
import { BUCKET, FILE_KINDS, canAccessFile, privateStorage, validateFile } from '@/lib/private-storage';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
const response = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: NextRequest, context: Context) {
  const actor = await currentUser();
  if (!actor || actor.mustChangePassword) return response('يلزم تسجيل الدخول', 401);
  if (request.headers.get('origin') !== request.nextUrl.origin) return response('مصدر الطلب غير موثوق', 403);
  const { id } = await context.params;
  const project = await db.project.findUnique({ where: { id }, include: { team: true, client: { include: { lead: true } } } });
  if (!project || project.cancelledAt) return response('المشروع غير متاح', 404);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return response('طلب غير صالح', 400); }
  if (body.action === 'finalize') {
    const attachmentId = typeof body.attachmentId === 'string' ? body.attachmentId : '';
    const file = await db.attachment.findUnique({ where: { id: attachmentId } });
    if (!file || file.projectId !== id || file.uploadedById !== actor.id ||
        !canAccessFile(actor, project, file.kind, 'upload')) return response('الملف غير متاح', 403);
    if (file.verifiedAt) return NextResponse.json({ ok: true });
    if (!file.uploadExpiresAt || file.uploadExpiresAt < new Date()) return response('انتهت مهلة الرفع، ابدأ ملفًا جديدًا', 409);
    try {
      const storage = await privateStorage();
      const { data, error } = await storage.info(file.storageKey);
      if (error || !data || data.bucketId !== BUCKET ||
          ![file.storageKey, file.storageKey.split('/').at(-1)].includes(data.name) ||
          data.size !== file.sizeBytes || data.contentType !== file.mimeType)
        return response('الملف المرفوع لا يطابق بيانات الطلب', 409);
      await db.$transaction(async tx => {
        const updated = await tx.attachment.updateMany({ where: { id: file.id, verifiedAt: null }, data: { verifiedAt: new Date() } });
        if (updated.count) await tx.auditLog.create({ data: { actorId: actor.id, action: 'ATTACHMENT_VERIFIED', subjectId: file.id,
          detail: { projectId: id, kind: file.kind, storageKey: file.storageKey, sizeBytes: file.sizeBytes } } });
      });
      return NextResponse.json({ ok: true });
    } catch { return response('تعذر التحقق من التخزين الخاص', 503); }
  }
  if (body.action !== 'prepare') return response('الإجراء غير صالح', 400);
  const kind = typeof body.kind === 'string' ? body.kind : '';
  const name = typeof body.fileName === 'string' ? body.fileName.trim() : '';
  const mime = typeof body.mimeType === 'string' ? body.mimeType : '';
  const size = body.sizeBytes;
  const deliverableId = typeof body.deliverableId === 'string' && body.deliverableId ? body.deliverableId : null;
  if (!FILE_KINDS.some(value => value === kind)) return response('نوع الملف غير صالح', 400);
  if (!canAccessFile(actor, project, kind, 'upload')) return response('ليس لديك صلاحية رفع هذا الملف', 403);
  let ext: string;
  try { ext = validateFile(name, mime, Number(size)); } catch (error) { return response((error as Error).message, 400); }
  if (kind === 'PREVIEW' || kind === 'FINAL') {
    const deliverable = await db.deliverable.findUnique({ where: { id: deliverableId ?? '' } });
    if (!deliverable || deliverable.projectId !== id) return response('اختر مخرجًا تابعًا للمشروع', 400);
  } else if (deliverableId) return response('ربط المخرج غير مسموح لهذا النوع', 400);
  const storageKey = `${project.id}/${randomUUID()}.${ext}`;
  try {
    const storage = await privateStorage();
    const { data, error } = await storage.createSignedUploadUrl(storageKey, { upsert: false });
    if (error || !data) return response('تعذر إعداد رابط الرفع الخاص', 503);
    const file = await db.attachment.create({ data: { projectId: id, kind: kind as typeof FILE_KINDS[number], storageKey,
      fileName: name, mimeType: mime, sizeBytes: Number(size), deliverableId, uploadedById: actor.id,
      uploadExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000) } });
    return NextResponse.json({ attachmentId: file.id, uploadUrl: data.signedUrl }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return response('التخزين الخاص غير متاح', 503); }
}
