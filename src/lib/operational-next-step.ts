import type { OrderStatus, ProjectStage, Role, SubscriptionStatus } from '@/generated/prisma/client';

type OrderProgress = {
  status: OrderStatus;
  totalMinor: bigint;
  items: { id: string; serviceKindSnapshot?: string }[];
  subscription: { status: SubscriptionStatus } | null;
  projects: { id: string; stage: ProjectStage }[];
};

export function nextOrderStep(order: OrderProgress, collected: bigint, role: Role): string {
  if (order.status === 'CANCELLED') return 'الطلب ملغى، راجع التسوية عند الحاجة';
  if (order.status === 'REJECTED') return 'راجع سبب الرفض قبل إنشاء طلب جديد';
  if (order.status === 'DRAFT') return order.items.length ? 'أرسل الطلب للاعتماد' : 'أضف الخدمة ثم أرسل الطلب';
  if (order.status === 'PROPOSED') return role === 'OWNER' ? 'راجع السعر والاتفاق واعتمد الطلب' : 'بانتظار اعتماد المالك';
  if (collected < order.totalMinor) return role === 'OWNER' ? 'تحقق من وصول التحصيل وسجله' : 'تابع إثبات دفع العميل';
  if (order.items.some(item => item.serviceKindSnapshot === 'SUBSCRIPTION') && !order.subscription)
    return role === 'OWNER' ? 'أنشئ الدورة الشهرية للباقة المدفوعة' : 'بانتظار إعداد الدورة الشهرية';
  if (order.subscription?.status === 'PENDING') return role === 'OWNER' ? 'فعّل الاشتراك المدفوع' : 'بانتظار تفعيل الاشتراك';
  if (!order.projects.length) return 'أنشئ تكليف الإنتاج';
  if (order.projects.some(project => project.stage !== 'COMPLETED')) return 'تابع التنفيذ والمراجعة والتسليم';
  return 'اكتمل التسليم، راجع مستحقات الفريق';
}
