import type { ProjectStage, Role } from '@/generated/prisma/client';

export const stageLabels: Record<ProjectStage, string> = {
  WAITING_REQUIREMENTS: 'انتظار المتطلبات', TREATMENT: 'إعداد السكريبت والتصور',
  WAITING_APPROVAL: 'انتظار الاعتماد', READY: 'جاهز للتنفيذ', IN_PROGRESS: 'قيد التنفيذ',
  INTERNAL_REVIEW: 'مراجعة داخلية', CLIENT_PREVIEW: 'معاينة العميل', REVISIONS: 'تعديلات',
  READY_DELIVERY: 'جاهز للتسليم', DELIVERED: 'تم التسليم', COMPLETED: 'مكتمل ومقبول',
};
export const transitions: Record<ProjectStage, ProjectStage[]> = {
  WAITING_REQUIREMENTS: ['TREATMENT'], TREATMENT: ['WAITING_APPROVAL'],
  WAITING_APPROVAL: ['READY'], READY: ['IN_PROGRESS'], IN_PROGRESS: ['INTERNAL_REVIEW'],
  INTERNAL_REVIEW: ['IN_PROGRESS', 'CLIENT_PREVIEW'], CLIENT_PREVIEW: ['REVISIONS', 'READY_DELIVERY'],
  REVISIONS: ['IN_PROGRESS', 'INTERNAL_REVIEW'], READY_DELIVERY: ['DELIVERED'],
  DELIVERED: ['COMPLETED', 'REVISIONS'], COMPLETED: [],
};
export function canSeeProject(role: Role, userId: string, team: { communicatorId: string; executorId: string }) {
  return role === 'OWNER' || role === 'COMMUNICATION' && team.communicatorId === userId || role === 'EXECUTION' && team.executorId === userId;
}
export function canMoveStage(role: Role, from: ProjectStage, to: ProjectStage) {
  if (!transitions[from].includes(to)) return false;
  if (role === 'OWNER') return true;
  if (role === 'COMMUNICATION') return ['TREATMENT','WAITING_APPROVAL','READY','REVISIONS','READY_DELIVERY'].includes(to);
  if (role === 'EXECUTION') return ['WAITING_APPROVAL','IN_PROGRESS','INTERNAL_REVIEW'].includes(to);
  return false;
}
export function individualPrepaymentCovered(totalMinor: bigint, collectedMinor: bigint) {
  return totalMinor > 0n && collectedMinor >= (totalMinor + 1n) / 2n;
}
export function finalPaymentCovered(totalMinor: bigint, collectedMinor: bigint) {
  return totalMinor > 0n && collectedMinor >= totalMinor;
}
export function targetHours(service: string, urgent = false): [number, number] {
  if (urgent) return [48, 72];
  if (service === 'SCRIPT_TREATMENT') return [24, 48];
  if (service === 'VIDEO_3_POSTERS') return [72, 96];
  return [48, 72];
}
export const qualityItems = {
  identity: 'مطابقة الهوية', images: 'جودة الصور', language: 'سلامة اللغة', dimensions: 'الأبعاد',
  export: 'جودة التصدير', sync: 'التزامن', motion: 'الحركة', audio: 'جودة الصوت',
  noMusic: 'خلو الفيديو من الموسيقى', requirements: 'اكتمال المتطلبات',
};
export function requiredQualityItems(service: string) {
  return ['identity', 'language', 'dimensions', 'export', 'requirements', ...(service.includes('VIDEO') ? ['sync', 'motion', 'audio', 'noMusic'] : ['images'])];
}
export function delayHours(start: Date | null, due: Date | null, pauses: { startedAt: Date; endedAt: Date | null; justified: boolean }[], now = new Date()) {
  if (!start || !due) return { justified: 0, unjustified: 0 };
  const lateStart = Math.max(start.getTime(), due.getTime());
  const lateEnd = now.getTime();
  if (lateEnd <= lateStart) return { justified: 0, unjustified: 0 };
  const justifiedMs = pauses.filter(p => p.justified).reduce((sum, p) => sum + Math.max(0, Math.min(lateEnd, p.endedAt?.getTime() ?? lateEnd) - Math.max(lateStart, p.startedAt.getTime())), 0);
  return { justified: justifiedMs / 3600000, unjustified: Math.max(0, lateEnd - lateStart - justifiedMs) / 3600000 };
}
