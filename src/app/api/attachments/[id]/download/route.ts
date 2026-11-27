import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUser } from '@/lib/auth';
import { canAccessFile, privateStorage } from '@/lib/private-storage';
import { localTestStorageEnabled, readLocalTestFile } from '@/lib/local-test-storage';

export const runtime = 'nodejs';
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor || actor.mustChangePassword) return new NextResponse('يلزم تسجيل الدخول', { status: 401 });
  const { id } = await context.params;
  const file = await db.attachment.findUnique({ where: { id }, include: {
    project: { include: { team: true, client: { include: { lead: true } } } },
  } });
  if (!file?.verifiedAt || file.project.cancelledAt || !canAccessFile(actor, file.project, file.kind, 'download'))
    return new NextResponse('الملف غير متاح', { status: 404 });
  if (file.kind === 'FINAL' && !file.project.deliveredAt && actor.role !== 'OWNER' && actor.role !== 'EXECUTION')
    return new NextResponse('التسليم لم يعتمد بعد', { status: 403 });
  if (file.kind === 'PREVIEW' && !file.project.completedAt &&
      !['CLIENT_PREVIEW','REVISIONS','READY_DELIVERY','DELIVERED'].includes(file.project.stage) && actor.role === 'COMMUNICATION')
    return new NextResponse('المعاينة لم تعتمد بعد', { status: 403 });
  try {
    if (localTestStorageEnabled()) {
      const bytes = await readLocalTestFile(file.storageKey);
      return new NextResponse(new Uint8Array(bytes), { headers: {
        'Content-Type': file.mimeType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        'Cache-Control': 'no-store',
      } });
    }
    const storage = await privateStorage();
    const { data, error } = await storage.createSignedUrl(file.storageKey, 60, { download: file.fileName });
    if (error || !data) return new NextResponse('تعذر إنشاء رابط خاص', { status: 503 });
    return NextResponse.redirect(data.signedUrl, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch { return new NextResponse('التخزين الخاص غير متاح', { status: 503 }); }
}
