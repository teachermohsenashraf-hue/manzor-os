import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSubscriptionRevenueAllocation, type RevenueShare } from '../src/lib/subscription-revenue-allocation';

const shares: RevenueShare[] = [
  { projectId: 'v1', kind: 'VIDEO', amountMinor: 1n },
  { projectId: 'v2', kind: 'VIDEO', amountMinor: 1n },
  { projectId: 'v3', kind: 'VIDEO', amountMinor: 1n },
  { projectId: 'p1', kind: 'POSTER', amountMinor: 1n },
  { projectId: 'p2', kind: 'POSTER', amountMinor: 1n },
  { projectId: 'p3', kind: 'POSTER', amountMinor: 2n },
];

test('allocation structure requires six distinct outputs and exact contract total', () => {
  assert.equal(validateSubscriptionRevenueAllocation(shares, 7n).length, 6);
  assert.throws(() => validateSubscriptionRevenueAllocation(shares, 8n));
  assert.throws(() => validateSubscriptionRevenueAllocation([{ ...shares[0], projectId: 'p3' }, ...shares.slice(1)], 7n));
  assert.throws(() => validateSubscriptionRevenueAllocation([{ ...shares[0], kind: 'POSTER' }, ...shares.slice(1)], 7n));
});
