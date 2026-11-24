import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFxAmounts, validateFxRate } from '../src/lib/finance';

test('known transfer fee is subtracted once from gross EGP', () => {
  assert.doesNotThrow(() => validateFxAmounts({ paidSarMinor: 130000n, grossEgpMinor: 1820000n, feeEgpMinor: 20000n, netEgpMinor: 1800000n }));
  assert.throws(() => validateFxAmounts({ paidSarMinor: 130000n, grossEgpMinor: 1820000n, feeEgpMinor: 20000n, netEgpMinor: 1780000n }), /مرة واحدة/);
});

test('unknown gross and fee stay explicitly unknown', () => {
  assert.doesNotThrow(() => validateFxAmounts({ paidSarMinor: 130000n, grossEgpMinor: null, feeEgpMinor: null, netEgpMinor: 1800000n }));
  assert.throws(() => validateFxAmounts({ paidSarMinor: 130000n, grossEgpMinor: null, feeEgpMinor: 20000n, netEgpMinor: 1800000n }), /معًا/);
});

test('actual exchange rate is checked with integer arithmetic', () => {
  assert.doesNotThrow(() => validateFxRate('14', 130000n, 1820000n));
  assert.throws(() => validateFxRate('14', 130000n, 1800000n), /لا يطابق/);
  assert.doesNotThrow(() => validateFxRate('13.846153846154', 130000n, 1800000n));
});
