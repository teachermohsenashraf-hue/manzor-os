import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCancellationSettlement, calculateSaudiSubscriptionRefund } from '../src/lib/finance-settlement';

test('cancellation settlement balances paid cash without a fixed penalty', () => {
  const settlement = calculateCancellationSettlement({ paidMinor: 130000n, workValueMinor: 45000n,
    employeeDueMinor: 10000n, documentedCostMinor: 5000n, retainedMinor: 50000n,
    returnFeeMinor: 1000n, refundMinor: 79000n });
  assert.equal(settlement.retainedMinor + settlement.returnFeeMinor + settlement.refundMinor, settlement.paidMinor);
  assert.throws(() => calculateCancellationSettlement({ ...settlement, retainedMinor: 51000n }), /يساووا أصل/);
  assert.throws(() => calculateCancellationSettlement({ ...settlement, refundMinor: 0n, retainedMinor: 129000n }), /استردادًا فعليًا/);
});

test('accepted subscription work cannot retain more than was paid', () => {
  const settlement = calculateSaudiSubscriptionRefund({ contractSarMinor: 130000n, paidSarMinor: 10000n,
    acceptedVideos: 1, acceptedPosters: 0, unsettledStartedWork: false, actualReturnFeeSarMinor: 0n });
  assert.equal(settlement.retainedSarMinor, 10000n);
  assert.equal(settlement.refundToClientSarMinor, 0n);
});

test('Saudi subscription refund counts only accepted actual work and actual return fee', () => {
  assert.deepEqual(calculateSaudiSubscriptionRefund({ contractSarMinor:130000n, paidSarMinor:130000n, acceptedVideos:1, acceptedPosters:1, unsettledStartedWork:false, actualReturnFeeSarMinor:2000n }), { retainedSarMinor:50000n, refundBeforeFeeSarMinor:80000n, returnFeeSarMinor:2000n, refundToClientSarMinor:78000n });
});

test('full refund has no invented cancellation fee and caps retained amount', () => {
  assert.equal(calculateSaudiSubscriptionRefund({ contractSarMinor:130000n, paidSarMinor:130000n, acceptedVideos:0, acceptedPosters:0, unsettledStartedWork:false, actualReturnFeeSarMinor:0n }).refundToClientSarMinor,130000n);
  assert.equal(calculateSaudiSubscriptionRefund({ contractSarMinor:130000n, paidSarMinor:130000n, acceptedVideos:3, acceptedPosters:3, unsettledStartedWork:false, actualReturnFeeSarMinor:0n }).retainedSarMinor,130000n);
});

test('started but unsettled work blocks a final refund amount', () => {
  assert.throws(() => calculateSaudiSubscriptionRefund({ contractSarMinor:130000n, paidSarMinor:130000n, acceptedVideos:1, acceptedPosters:0, unsettledStartedWork:true, actualReturnFeeSarMinor:0n }),/يلزم قرار تسوية/);
});
