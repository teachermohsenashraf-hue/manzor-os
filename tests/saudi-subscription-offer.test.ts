import test from 'node:test';
import assert from 'node:assert/strict';
import { validSaudiSubscriptionOffer } from '../src/lib/saudi-subscription-offer';

const price = { marketCode: 'SA', currency: 'SAR', amountMinor: 130000n };
const parts = [
  { quantity: 3, child: { productionType: 'VIDEO' } },
  { quantity: 3, child: { productionType: 'POSTER' } },
];

test('Saudi monthly subscription remains one 1300 SAR package with six outputs', () => {
  assert.equal(validSaudiSubscriptionOffer(price, parts), true);
  assert.equal(validSaudiSubscriptionOffer({ ...price, amountMinor: 129999n }, parts), false);
  assert.equal(validSaudiSubscriptionOffer(price, [{ ...parts[0], quantity: 2 }, parts[1]]), false);
  assert.equal(validSaudiSubscriptionOffer(price, [...parts, parts[0]]), false);
});
