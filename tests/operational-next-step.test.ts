import test from 'node:test';
import assert from 'node:assert/strict';
import { nextOrderStep, remainingSubscriptionWork } from '../src/lib/operational-next-step';

test('Saudi subscription still requests the remaining assignments after its first project completes', () => {
  const order = {
    status: 'APPROVED' as const,
    totalMinor: 130000n,
    items: [{ id: 'package', serviceKindSnapshot: 'SUBSCRIPTION' }],
    subscription: { status: 'ACTIVE' as const, cycles: [{ status: 'ACTIVE', items: [
      { plannedQuantity: 3, assignedQuantity: 1 },
      { plannedQuantity: 3, assignedQuantity: 0 },
    ] }] },
    projects: [{ id: 'first', stage: 'COMPLETED' as const }],
  };

  assert.equal(remainingSubscriptionWork(order), 5);
  assert.match(nextOrderStep(order, 130000n, 'OWNER'), /المتبقية وعددها 5/);
  assert.equal(nextOrderStep({ ...order, subscription: { status: 'ACTIVE', cycles: [{ status: 'ACTIVE', items: [
    { plannedQuantity: 3, assignedQuantity: 3 }, { plannedQuantity: 3, assignedQuantity: 3 },
   ] }] } }, 130000n, 'OWNER'), 'راجع الأعمال الستة وأغلق دورة الاشتراك');
   assert.equal(nextOrderStep({ ...order, subscription: { status: 'ACTIVE', cycles: [{ status: 'CLOSED', items: [
     { plannedQuantity: 3, assignedQuantity: 3 }, { plannedQuantity: 3, assignedQuantity: 3 },
   ] }] } }, 130000n, 'COMMUNICATION'), 'اكتمل تسليم أعمال الاشتراك وإغلاق دورته');
});
