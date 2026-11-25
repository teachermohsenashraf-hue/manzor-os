import type { Role } from '@/generated/prisma/client';

export const BUCKET = process.env.VERCEL_ENV === 'preview' || process.env.MANZOOR_ENV === 'preview'
  ? 'manzoor-test' : 'manzoor-production';
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MIME_TYPES = [
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml',
  'video/mp4', 'video/quicktime', 'application/zip', 'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;
export const FILE_KINDS = ['REQUIREMENT','SCRIPT','PREVIEW','REVISION','FINAL','SOURCE'] as const;
const extensions: Record<string, string[]> = {
  'application/pdf':['pdf'], 'image/png':['png'], 'image/jpeg':['jpg','jpeg'],
  'image/webp':['webp'], 'image/svg+xml':['svg'], 'video/mp4':['mp4'],
  'video/quicktime':['mov'], 'application/zip':['zip'], 'text/plain':['txt'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['docx'],
};

export function validateFile(name: string, mime: string, size: number) {
  if (!name || name.length > 180 || /[\\/\x00-\x1f]/.test(name) || name === '.' || name === '..' || name.includes('..'))
    throw new Error('اسم الملف غير صالح');
  const ext = name.split('.').at(-1)?.toLowerCase() ?? '';
  if (!extensions[mime]?.includes(ext) || !Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_BYTES)
    throw new Error('نوع الملف أو حجمه غير مسموح');
  return ext;
}

export function canAccessFile(
  actor: { id: string; role: Role },
  project: { teamId: string; executorId: string; team: { communicatorId: string }; client: { lead: { teamId: string } } },
  kind: string,
  mode: 'upload' | 'download',
) {
  if (actor.role === 'OWNER') return true;
  if (actor.role === 'EXECUTION') return project.executorId === actor.id;
  if (actor.role === 'COMMUNICATION') {
    if (project.team.communicatorId !== actor.id || project.client.lead.teamId !== project.teamId) return false;
    if (kind === 'SOURCE') return false;
    return mode === 'download' || kind === 'REQUIREMENT';
  }
  return false;
}
