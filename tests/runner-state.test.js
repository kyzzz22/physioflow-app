import test from 'node:test';
import assert from 'node:assert/strict';
import { captureRunnerState, recoverySchedule, remainingMilliseconds } from '../src/runnerState.js';

test('active timers snapshot only their remaining duration',()=>{
  assert.equal(remainingMilliseconds({remaining:5000,started_at:1000,active:true},2500),3500);
  assert.equal(remainingMilliseconds({remaining:5000,started_at:1000,active:false},9000),5000);
  const snapshot=captureRunnerState({remaining:5000,started_at:1000,active:true},{paused:false,awaiting_start:false,timed_out:false,media_ended:false},2500);
  assert.equal(snapshot.remaining_ms,3500);
});

test('recovery schedules remaining non-media time and restarts media timing',()=>{
  const state={remaining_ms:1200,paused:false,awaiting_start:false,timed_out:false};
  assert.equal(recoverySchedule({type:'timer',duration_mode:'fixed',planned_duration_ms:5000},state),1200);
  assert.equal(recoverySchedule({type:'video',duration_mode:'fixed',planned_duration_ms:5000},state),5000);
  assert.equal(recoverySchedule({type:'timer',duration_mode:'fixed',planned_duration_ms:5000,recovery_behavior:'restart'},state),5000);
  assert.equal(recoverySchedule({type:'timer',duration_mode:'fixed',planned_duration_ms:5000,recovery_behavior:'wait_operator'},state),null);
  assert.equal(recoverySchedule({type:'timer',duration_mode:'fixed'}, {...state,paused:true}),null);
});
