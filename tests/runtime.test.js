import test from 'node:test';
import assert from 'node:assert/strict';
import { block, protocol, step, trial } from '../src/domain.js';
import { completeRuntimeStep, createRuntime, currentRuntimeItem, restoreRuntime, retryRuntimeStep, runtimeBoundaryEvents, skipRuntimeStep } from '../src/runtimeMachine.js';

function branchingProtocol() {
  const question = step('questionnaire', { name: 'Choice' });
  const yes = step('instruction', { name: 'Yes path' });
  const no = step('instruction', { name: 'No path' });
  const t = trial({ name: 'Branch', steps: [question, yes, no] });
  t.flow = {
    nodes: [{ id:'start',type:'start' },{ id:'q',type:'event',step_id:question.step_id },{ id:'condition',type:'condition',rule:{variable:'choice',operator:'equals',value:'yes'} },{ id:'yes',type:'event',step_id:yes.step_id },{ id:'no',type:'event',step_id:no.step_id },{ id:'end',type:'end' }],
    edges: [{source:'start',target:'q',branch:'next'},{source:'q',target:'condition',branch:'next'},{source:'condition',target:'yes',branch:'true'},{source:'condition',target:'no',branch:'false'},{source:'yes',target:'end',branch:'next'},{source:'no',target:'end',branch:'next'}],
  };
  return protocol({ blocks: [block({ trials: [t] })] });
}

test('runtime evaluates a branch after questionnaire answers arrive', () => {
  const p = branchingProtocol();
  let runtime = createRuntime(p, { participant_id:'P1',participant_language:'en',order_row:0 });
  assert.equal(currentRuntimeItem(runtime.state, runtime.units).step.name, 'Choice');
  runtime = completeRuntimeStep(runtime.state, runtime.units, [{ question_id:'choice',value:'yes' }]);
  assert.equal(currentRuntimeItem(runtime.state, runtime.units).step.name, 'Yes path');
});

test('runtime evaluates a branch after response node values arrive', () => {
  const response = step('response', { name:'Quick choice', response_variable:'choice', content_i18n:{ en:'Choose' } });
  const left = step('instruction', { name:'Left path' });
  const right = step('instruction', { name:'Right path' });
  const t = trial({ name:'Response branch', steps:[response, left, right] });
  t.flow = {
    nodes: [{ id:'start',type:'start' },{ id:'r',type:'event',step_id:response.step_id },{ id:'condition',type:'condition',rule:{variable:'choice',operator:'equals',value:'left'} },{ id:'left',type:'event',step_id:left.step_id },{ id:'right',type:'event',step_id:right.step_id },{ id:'end',type:'end' }],
    edges: [{source:'start',target:'r',branch:'next'},{source:'r',target:'condition',branch:'next'},{source:'condition',target:'left',branch:'true'},{source:'condition',target:'right',branch:'false'},{source:'left',target:'end',branch:'next'},{source:'right',target:'end',branch:'next'}],
  };
  const p = protocol({ blocks:[block({ trials:[t] })] });
  let runtime = createRuntime(p, { participant_id:'P1',participant_language:'en',order_row:0 });
  assert.equal(currentRuntimeItem(runtime.state, runtime.units).step.name, 'Quick choice');
  runtime = completeRuntimeStep(runtime.state, runtime.units, [{ question_id:'choice', value:'left' }]);
  assert.equal(currentRuntimeItem(runtime.state, runtime.units).step.name, 'Left path');
});

test('runtime completes after final event', () => {
  const p = branchingProtocol();
  let runtime = createRuntime(p, { participant_id:'P1',participant_language:'en',order_row:0 });
  runtime = completeRuntimeStep(runtime.state, runtime.units, [{ question_id:'choice',value:'no' }]);
  assert.equal(currentRuntimeItem(runtime.state, runtime.units).step.name, 'No path');
  runtime = completeRuntimeStep(runtime.state, runtime.units);
  assert.equal(runtime.state.status, 'completed');
});

test('runtime expands block and trial repeat counts',()=>{const p=branchingProtocol();p.blocks[0].repeat_count=2;p.blocks[0].trials[0].repeat_count=3;const runtime=createRuntime(p,{participant_id:'P',order_row:0});assert.equal(runtime.units.length,6)});

test('runtime follows a bounded loop and exits deterministically',()=>{const repeated=step('instruction',{name:'Repeated'}),t=trial({steps:[repeated]});t.flow={nodes:[{id:'start',type:'start'},{id:'loop',type:'loop',max_iterations:2,rule:{variable:'',operator:'equals',value:''}},{id:'event',type:'event',step_id:repeated.step_id},{id:'end',type:'end'}],edges:[{source:'start',target:'loop',branch:'next'},{source:'loop',target:'event',branch:'body'},{source:'event',target:'loop',branch:'next'},{source:'loop',target:'end',branch:'exit'}]};const p=protocol({blocks:[block({trials:[t]})]});let runtime=createRuntime(p,{participant_id:'P'});assert.equal(currentRuntimeItem(runtime.state,runtime.units).step.name,'Repeated');runtime=completeRuntimeStep(runtime.state,runtime.units);assert.equal(currentRuntimeItem(runtime.state,runtime.units).step.name,'Repeated');runtime=completeRuntimeStep(runtime.state,runtime.units);assert.equal(runtime.state.status,'completed')});

test('skip terminates an attempt and retry preserves the current node',()=>{const p=branchingProtocol();let runtime=createRuntime(p,{participant_id:'P'}),node=runtime.state.node_id;const retried=retryRuntimeStep(runtime.state);assert.equal(retried.node_id,node);assert.equal(retried.retries[`0:${node}`],1);runtime=skipRuntimeStep(runtime.state,runtime.units);assert.equal(currentRuntimeItem(runtime.state,runtime.units).step.name,'No path')});

test('restoring a runtime snapshot keeps the exact graph position',()=>{const p=branchingProtocol();const created=createRuntime(p,{participant_id:'P'}),snapshot=structuredClone(created.state),restored=restoreRuntime(snapshot,p,{participant_id:'P'});assert.deepEqual(restored.state,snapshot);assert.equal(currentRuntimeItem(restored.state,restored.units).step.name,'Choice')});

test('runtime reports trial and block boundaries across repeats',()=>{const p=branchingProtocol(),created=createRuntime(p,{participant_id:'P'}),previous=currentRuntimeItem(created.state,created.units);const next={...created.state,unit_index:created.units.length,status:'completed'};assert.deepEqual(runtimeBoundaryEvents(previous,next,created.units).map(event=>event.type),['trial_completed','block_completed'])});
