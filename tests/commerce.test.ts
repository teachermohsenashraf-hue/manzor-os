import test from 'node:test';
import assert from 'node:assert/strict';
import { activePrice, canChangeOrder, canSeeCommercial, cycleRemaining, formatMinor, parseMinor, readComponents, remainingQuantity } from '../src/lib/commerce';

test('prices select the effective market version without changing historical amounts',()=>{
  const old={amount:10000n,effectiveFrom:new Date('2026-01-01T00:00:00Z'),effectiveTo:new Date('2026-06-01T00:00:00Z')};
  const next={amount:12000n,effectiveFrom:new Date('2026-06-01T00:00:00Z'),effectiveTo:null};
  assert.equal(activePrice([old,next],new Date('2026-05-01T00:00:00Z'))?.amount,10000n);
  assert.equal(activePrice([old,next],new Date('2026-07-01T00:00:00Z'))?.amount,12000n);
  assert.equal(parseMinor('00100'),null);
  assert.equal(parseMinor('10000'),10000n);
  assert.equal(formatMinor(10000n,'EGP'),`${new Intl.NumberFormat('ar-EG').format(100n)}.00 EGP`);
});
test('only owner approves commercial orders and execution cannot read them',()=>{
  assert.equal(canChangeOrder('COMMUNICATION','DRAFT','PROPOSED'),true);
  assert.equal(canChangeOrder('COMMUNICATION','PROPOSED','APPROVED'),false);
  assert.equal(canChangeOrder('OWNER','PROPOSED','APPROVED'),true);
  assert.equal(canSeeCommercial('EXECUTION','e1',{communicatorId:'c1',executorId:'e1'}),false);
  assert.equal(canSeeCommercial('COMMUNICATION','c2',{communicatorId:'c1',executorId:'e1'}),false);
});
test('bundle composition and contracted quantities remain explicit',()=>{
  const snapshot=readComponents([{serviceId:'video',quantity:3,productionType:'VIDEO',name:'فيديو'}]);
  assert.equal(snapshot[0].quantity,3);
  assert.equal(remainingQuantity(2,2,1),1);
  assert.equal(cycleRemaining(3,2),1);
  assert.throws(()=>readComponents([{serviceId:'video',quantity:0,productionType:'VIDEO',name:'فيديو'}]));
});
