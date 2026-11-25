export type ClosureProject = {
  id: string;
  cycleItemId: string | null;
  executorId: string;
  cancelledAt: Date | null;
  productionStartedAt: Date | null;
  completedAt: Date | null;
  deliveredAt: Date | null;
  assignments: { executorId: string; acceptedAt: Date | null }[];
  deliverables: { id: string; version: number; deliveredAt: Date | null }[];
  approvals: { kind: string; deliverableId: string | null }[];
  qualityReviews: { deliverableId: string; passed: boolean; createdAt: Date }[];
};

export function validateCycleClosure(
  items: { id: string; plannedQuantity: number; assignedQuantity: number; service: { productionType: string } }[],
  projects: ClosureProject[],
): { executorId: string; projectIds: string[] } {
  if (projects.some(project => project.cancelledAt && (project.productionStartedAt || project.deliverables.length)))
    throw new Error('عمل ملغى بعد بدء التنفيذ يحتاج تسوية قبل إغلاق الدورة');
  const active = projects.filter(project => !project.cancelledAt);
  if (items.length !== 2 || items.reduce((n, item) => n + item.plannedQuantity, 0) !== 6 ||
      !items.some(item => item.service.productionType === 'VIDEO' && item.plannedQuantity === 3) ||
      !items.some(item => item.service.productionType === 'POSTER' && item.plannedQuantity === 3)) {
    throw new Error('مكونات دورة الاشتراك لا تطابق ثلاث فيديوهات وثلاثة بوسترات');
  }
  if (active.length !== 6 || items.some(item => item.assignedQuantity !== item.plannedQuantity ||
      active.filter(project => project.cycleItemId === item.id).length !== item.plannedQuantity)) {
    throw new Error('يجب تكليف الأعمال الستة في الدورة دون نقص أو زيادة');
  }
  const executorId = active[0].executorId;
  if (active.some(project => {
    const latest = [...project.deliverables].sort((a, b) => b.version - a.version)[0];
    const latestReview = project.qualityReviews.filter(review => review.deliverableId === latest?.id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return project.cancelledAt || !project.completedAt || !project.deliveredAt ||
      project.executorId !== executorId ||
      !project.assignments.some(assignment => assignment.executorId === executorId && assignment.acceptedAt) ||
      !latest?.deliveredAt ||
      !latestReview?.passed ||
      !project.approvals.some(approval => approval.kind === 'FINAL_DELIVERY' && approval.deliverableId === latest.id);
  })) throw new Error('جميع الأعمال يجب أن تكون مكتملة ومجتازة للجودة ومعتمدة التسليم للمنفذ نفسه');
  return { executorId, projectIds: active.map(project => project.id).sort() };
}
