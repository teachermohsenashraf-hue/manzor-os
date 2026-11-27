import test from 'node:test';
import assert from 'node:assert/strict';
import { canMoveStage, canSeeProject, delayHours, targetHours, transitions, individualPrepaymentCovered, finalPaymentCovered } from '../src/lib/production';

test('stage graph rejects shortcuts and executor final acceptance',()=>{
  assert.deepEqual(transitions.WAITING_REQUIREMENTS,['TREATMENT']);
  assert.equal(canMoveStage('EXECUTION','READY','COMPLETED'),false);
  assert.equal(canMoveStage('EXECUTION','DELIVERED','COMPLETED'),false);
  assert.equal(canMoveStage('COMMUNICATION','DELIVERED','COMPLETED'),false);
  assert.equal(canMoveStage('EXECUTION','READY','IN_PROGRESS'),true);
  assert.equal(canMoveStage('EXECUTION','INTERNAL_REVIEW','CLIENT_PREVIEW'),false);
  assert.equal(canMoveStage('EXECUTION','CLIENT_PREVIEW','READY_DELIVERY'),false);
  assert.equal(canMoveStage('COMMUNICATION','READY_DELIVERY','DELIVERED'),false);
});
test('production visibility stays within assigned team',()=>{
  const team={communicatorId:'c1',executorId:'e1'};
  assert.equal(canSeeProject('EXECUTION','e1',team),true);
  assert.equal(canSeeProject('EXECUTION','e2',team),false);
  assert.equal(canSeeProject('COMMUNICATION','c2',team),false);
  assert.equal(canSeeProject('MANAGER','m1',team),false);
});
test('individual work needs half confirmed payment to start and all to deliver',()=>{
  assert.equal(individualPrepaymentCovered(10001n,5000n),false);
  assert.equal(individualPrepaymentCovered(10001n,5001n),true);
  assert.equal(finalPaymentCovered(10001n,5001n),false);
  assert.equal(finalPaymentCovered(10001n,10001n),true);
  assert.equal(individualPrepaymentCovered(0n,0n),false);
});
test('approved service windows and delay exclusions',()=>{
  assert.deepEqual(targetHours('SCRIPT_TREATMENT'),[24,48]);
  assert.deepEqual(targetHours('VIDEO_3_POSTERS'),[72,96]);
  assert.deepEqual(targetHours('VIDEO',true),[48,72]);
  const d=(hour:number)=>new Date(`2026-11-22T${String(hour).padStart(2,'0')}:00:00Z`);
  assert.deepEqual(delayHours(null,d(8),[],d(12)),{justified:0,unjustified:0});
  assert.deepEqual(delayHours(d(7),d(8),[{startedAt:d(9),endedAt:d(10),justified:true}],d(12)),{justified:1,unjustified:3});
});
