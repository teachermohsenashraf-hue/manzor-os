import test from 'node:test';
import assert from 'node:assert/strict';
import { amountToMinor } from '../src/lib/operational-money';

test('receipt amount accepts whole and decimal values without floating point rounding', () => {
  assert.equal(amountToMinor('100'), '10000');
  assert.equal(amountToMinor(' 100.05 '), '10005');
  assert.equal(amountToMinor('100,5'), '10050');
  assert.equal(amountToMinor('0.01'), '1');
});

test('receipt amount rejects ambiguous, negative and overprecision input', () => {
  for (const value of ['', '1,234.56', '-1', '1.005', '1e3', '01', '100,']) {
    assert.equal(amountToMinor(value), null, value);
  }
});
