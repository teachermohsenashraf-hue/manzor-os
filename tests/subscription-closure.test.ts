import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCycleClosure, type ClosureProject } from '../src/lib/subscription-closure';

const now = new Date();
const items = [
  { id: 'video', plannedQuantity: 3, assignedQuantity: 3, service: { productionType: 'VIDEO' } },
  { id: 'poster', plannedQuantity: 3, assignedQuantity: 3, service: { productionType: 'POSTER' } },
];
function projects(): ClosureProject[] {
  return Array.from({ length: 6 }, (_, n) => ({
    id: `p${n}`, cycleItemId: n < 3 ? 'video' : 'poster', executorId: 'executor',
    cancelledAt: null, productionStartedAt: now, completedAt: now, deliveredAt: now,
    assignments: [{ executorId: 'executor', acceptedAt: now }],
    deliverables: [{ id: `d${n}`, version: 1, deliveredAt: now }],
    approvals: [{ kind: 'FINAL_DELIVERY', deliverableId: `d${n}` }],
    qualityReviews: [{ deliverableId: `d${n}`, passed: true, createdAt: now }],
  }));
}
test('closes only six accepted delivered subscription outputs', () => {
  assert.deepEqual(validateCycleClosure(items, projects()).projectIds, ['p0','p1','p2','p3','p4','p5']);
  const missing = projects().slice(1);
  assert.throws(() => validateCycleClosure(items, missing), /الأعمال الستة/);
  const failed = projects(); failed[0].qualityReviews[0].passed = false;
  assert.throws(() => validateCycleClosure(items, failed), /الجودة|للجودة/);
  const regression = projects(); regression[0].qualityReviews.push({deliverableId:'d0',passed:false,createdAt:new Date(now.getTime()+1000)});
  assert.throws(() => validateCycleClosure(items, regression), /جودة/);
  const mixed = projects(); mixed[0].executorId = 'another';
  assert.throws(() => validateCycleClosure(items, mixed), /منفذ نفسه/);
  const cancelled = projects(); cancelled[0].cancelledAt = now;
  assert.throws(() => validateCycleClosure(items, cancelled), /تسوية/);
  const released = projects(); released.push({...released[0],id:'withdrawn',cancelledAt:now,productionStartedAt:null,completedAt:null,deliveredAt:null,deliverables:[]});
  assert.equal(validateCycleClosure(items,released).projectIds.length,6);
});
