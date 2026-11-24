import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateApprovedAllocation } from '../src/lib/finance-policy';

test('Egypt poster uses agreed EGP price and 10 percent development reserve', () => {
  const result = calculateApprovedAllocation({ service: 'EG_POSTER', realizedEgpMinor: 10000n, agreedEgpMinor: 10000n, ownerExecuted: false });
  assert.deepEqual([result.communicationMinor, result.executionMinor, result.developmentMinor, result.distributableMinor, result.charityMinor, result.ownerFamilyMinor], [1500n, 5000n, 1000n, 2500n, 1250n, 1250n]);
});

test('Saudi subscription uses actual converted EGP proceeds and omits owner execution wage', () => {
  const external = calculateApprovedAllocation({ service: 'SA_SUBSCRIPTION', realizedEgpMinor: 1800000n, ownerExecuted: false });
  const owner = calculateApprovedAllocation({ service: 'SA_SUBSCRIPTION', realizedEgpMinor: 1800000n, ownerExecuted: true });
  assert.deepEqual([external.distributableMinor, external.charityMinor, external.ownerFamilyMinor], [900000n, 450000n, 450000n]);
  assert.deepEqual([owner.executionMinor, owner.distributableMinor, owner.charityMinor, owner.ownerFamilyMinor], [0n, 1500000n, 750000n, 750000n]);
});

test('loss does not create a charity or owner distribution', () => {
  assert.throws(() => calculateApprovedAllocation({ service: 'EG_POSTER', realizedEgpMinor: 1000n, agreedEgpMinor: 10000n, ownerExecuted: false }), /لا يوجد فائض/);
});

test('rounding holds whole minor units without inventing or losing cash', () => {
  const result = calculateApprovedAllocation({ service: 'EG_POSTER', realizedEgpMinor: 10002n, agreedEgpMinor: 10001n, ownerExecuted: false });
  assert.equal(result.developmentFractionTenthMinor, 1n);
  assert.equal(result.roundingSuspenseMinor, 2n);
  assert.equal(result.charityMinor, result.ownerFamilyMinor);
  assert.equal(result.communicationMinor + result.executionMinor + result.developmentMinor + result.expenseMinor + result.roundingSuspenseMinor + result.charityMinor + result.ownerFamilyMinor, 10002n);
});
