import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode,
  connect,
  createCoreComponentRegistry,
  createNodeGroup,
  createProtocolGraph,
  createSequentialIdFactory,
} from '../src/core/index.js';
import {
  completeCurrentNode,
  createRuntimeReplay,
  createRuntimeState,
  pauseRuntime,
  recordRuntimeEvent,
  restoreRuntime,
  resumeRuntime,
  retryCurrentNode,
  skipCurrentNode,
  snapshotRuntime,
  startRuntime,
} from '../src/runtime/index.js';

function services() {
  let tick = 0;
  const idFactory = createSequentialIdFactory();
  return {
    idFactory,
    clock: {
      now: () => {
        const current = tick++;
        return {
          epochMs: 1000 + current * 10,
          monotonicMs: 500 + current * 10,
          iso: new Date(1000 + current * 10).toISOString(),
        };
      },
    },
  };
}

function runtimeFor(protocol, variables = {}) {
  return createRuntimeState(protocol, {
    sessionId: 'session_test',
    startedAtEpochMs: 1000,
    startedAtMonotonicMs: 500,
    variables,
  });
}

function linearProtocol() {
  const idFactory = createSequentialIdFactory();
  const protocol = createProtocolGraph({ idFactory, now: '2026-08-22T00:00:00.000Z', name: 'Linear' });
  const edgeId = protocol.graph.edges[0].id;
  const screen = addNode(protocol, 'display.screen', { id: 'screen_1', label: 'Welcome' });
  const start = protocol.graph.nodes.find(node => node.component.type === 'core.start');
  const end = protocol.graph.nodes.find(node => node.component.type === 'core.end');
  screen.protocol.graph.edges = screen.protocol.graph.edges.filter(edge => edge.id !== edgeId);
  let next = connect(screen.protocol, 'control', { nodeId: start.id, portId: 'next' }, { nodeId: screen.node.id, portId: 'in' }, { id: 'edge_start' }).protocol;
  next = connect(next, 'control', { nodeId: screen.node.id, portId: 'next' }, { nodeId: end.id, portId: 'in' }, { id: 'edge_end' }).protocol;
  return next;
}

test('runtime executes a linear graph with deterministic event envelopes', () => {
  const protocol = linearProtocol();
  const registry = createCoreComponentRegistry();
  const svc = services();
  const started = startRuntime(runtimeFor(protocol), protocol, registry, svc);
  assert.equal(started.state.status, 'waiting');
  assert.equal(started.state.currentNodeId, 'screen_1');
  assert.deepEqual(started.events.map(event => event.eventType), ['protocol_started', 'component_entered']);
  assert.deepEqual(started.events.map(event => event.sequence), [1, 2]);
  assert.equal(started.events[1].elapsedMonotonicMs, 10);

  const completed = completeCurrentNode(started.state, protocol, registry, svc, { outputs: { acknowledged: true } });
  assert.equal(completed.state.status, 'completed');
  assert.deepEqual(completed.events.map(event => event.eventType), ['component_completed', 'protocol_completed']);
  assert.equal(completed.state.outputs.screen_1.acknowledged, true);
});

test('event replay reconstructs runtime variables, outputs and final state', () => {
  const protocol = linearProtocol();
  protocol.variables = [{ name: 'score', type: 'number', scope: 'session', defaultValue: 0 }];
  const registry = createCoreComponentRegistry();
  const svc = services();
  const started = startRuntime(runtimeFor(protocol), protocol, registry, svc);
  const completed = completeCurrentNode(started.state, protocol, registry, svc, { outputs: { score: 7 }, variables: { score: 7 } });
  const replay = createRuntimeReplay(protocol, [...started.events, ...completed.events]);

  assert.equal(replay.frames.length, 5);
  assert.equal(replay.frames[2].state.currentNodeId, 'screen_1');
  assert.equal(replay.finalState.status, completed.state.status);
  assert.equal(replay.finalState.currentNodeId, completed.state.currentNodeId);
  assert.deepEqual(replay.finalState.variables, completed.state.variables);
  assert.deepEqual(replay.finalState.outputs, completed.state.outputs);
  assert.deepEqual(replay.finalState.completedNodeIds, completed.state.completedNodeIds);
});

test('runtime snapshot feeds the live inspector with variables, outputs and flow-state counters (W5)', () => {
  const protocol = linearProtocol();
  protocol.variables = [{ name: 'score', type: 'number', scope: 'session', defaultValue: 0 }];
  const registry = createCoreComponentRegistry();
  const svc = services();
  const started = startRuntime(runtimeFor(protocol), protocol, registry, svc);
  const completed = completeCurrentNode(started.state, protocol, registry, svc, { outputs: { acknowledged: true }, variables: { score: 5 } });
  const snapshot = snapshotRuntime(completed.state);

  // Fields rendered by the W5 live inspector (RuntimeInspector in GraphRuntimeRunnerPage)
  const variableRows = (protocol.variables || []).map(variable => ({ name: variable.name, type: variable.type, value: snapshot.variables?.[variable.name] }));
  const outputRows = Object.entries(snapshot.outputs || {});
  const flowState = {
    status: snapshot.status,
    completed: snapshot.completedNodeIds.length,
    skipped: snapshot.skippedNodeIds.length,
    attempts: Object.keys(snapshot.attempts || {}).length,
    loopCounts: snapshot.loopCounts || {},
  };

  assert.deepEqual(variableRows[0], { name: 'score', type: 'number', value: 5 });
  assert.ok(outputRows.some(([key, value]) => key === 'screen_1' && value.acknowledged === true));
  assert.equal(flowState.status, 'completed');
  assert.ok(flowState.completed >= 1);
  assert.equal(flowState.skipped, 0);
  assert.ok(flowState.attempts >= 1);
  assert.deepEqual(flowState.loopCounts, {});
});

test('event replay rejects sequence gaps instead of inventing state', () => {
  const protocol = linearProtocol();
  const started = startRuntime(runtimeFor(protocol), protocol, createCoreComponentRegistry(), services());
  assert.throws(() => createRuntimeReplay(protocol, [started.events[1]]), /expected 1, found 2/);
});

test('subflow output parameters write through to mapped protocol variables', () => {
  const protocol = linearProtocol();
  const screen = protocol.graph.nodes.find(node => node.id === 'screen_1');
  screen.component = { type: 'input.rating', version: '1.0.0' };
  screen.config = { min: 1, max: 7, required: true };
  protocol.variables = [{ name: 'score', type: 'number', scope: 'session', defaultValue: 0 }];
  const grouped = createNodeGroup(protocol, ['screen_1'], {
    id: 'rating_instance', name: 'Rating instance', kind: 'subflow', entryNodeId: 'screen_1', exitNodeIds: ['screen_1'],
    parameters: [{ name: 'score', type: 'number', direction: 'output', source: { nodeId: 'screen_1', portId: 'value' } }],
    metadata: { templateId: 'rating_template', templateVersion: 1 },
  }).protocol;
  grouped.graph.groups[0].parameterMappings = { score: 'score' };
  const registry = createCoreComponentRegistry();
  const svc = services();
  const started = startRuntime(runtimeFor(grouped), grouped, registry, svc);
  const completed = completeCurrentNode(started.state, grouped, registry, svc, { outputs: { value: 6 } });
  assert.equal(completed.state.variables.score, 6);
  assert.equal(completed.events[0].payload.variables.score, 6);
});

test('subflow input parameters resolve mapped variables at runtime', () => {
  const protocol = createProtocolGraph({ idFactory: createSequentialIdFactory(), name: 'Mapped condition', now: '2026-08-22T00:00:00.000Z' });
  const start = protocol.graph.nodes.find(node => node.component.type === 'core.start');
  const endA = protocol.graph.nodes.find(node => node.component.type === 'core.end');
  protocol.graph.edges = [];
  let next = addNode(protocol, 'logic.condition', { id: 'mapped_condition', config: { operator: 'greater_than', expected: 5 } }).protocol;
  next = addNode(next, 'core.end', { id: 'mapped_end_b', label: 'End B' }).protocol;
  next = connect(next, 'control', { nodeId: start.id, portId: 'next' }, { nodeId: 'mapped_condition', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'mapped_condition', portId: 'true' }, { nodeId: endA.id, portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'mapped_condition', portId: 'false' }, { nodeId: 'mapped_end_b', portId: 'in' }).protocol;
  next.variables = [{ name: 'criterion', type: 'number', scope: 'session', defaultValue: 0 }];
  next = createNodeGroup(next, ['mapped_condition'], {
    id: 'condition_instance', name: 'Condition instance', kind: 'subflow', entryNodeId: 'mapped_condition', exitNodeIds: ['mapped_condition'],
    parameters: [{ name: 'criterion', type: 'number', direction: 'input', target: { nodeId: 'mapped_condition', portId: 'value' } }],
    metadata: { templateId: 'condition_template', templateVersion: 1 },
  }).protocol;
  next.graph.groups[0].parameterMappings = { criterion: 'criterion' };
  const result = startRuntime(runtimeFor(next, { criterion: 8 }), next, createCoreComponentRegistry(), services());
  assert.equal(result.state.status, 'completed');
  assert.equal(result.events.find(event => event.eventType === 'condition_evaluated').payload.actual, 8);
  assert.equal(result.events.at(-1).nodeId, endA.id);
});

test('a registered participant component runs without a runtime type branch', () => {
  const registry = createCoreComponentRegistry();
  registry.register({
    type: 'custom.confirmation', version: '1.0.0', label: 'Custom confirmation',
    ports: [
      { id: 'in', kind: 'control', direction: 'input', required: true },
      { id: 'next', kind: 'control', direction: 'output', required: true },
    ],
    runtime: { kind: 'participant', uiAdapter: 'schema', completion: 'submit' },
    events: ['component_entered', 'component_completed'],
  });
  const idFactory = createSequentialIdFactory();
  const protocol = createProtocolGraph({ idFactory, name: 'Registry extension', now: '2026-08-22T00:00:00.000Z' });
  const edgeId = protocol.graph.edges[0].id;
  const custom = addNode(protocol, 'custom.confirmation', { id: 'custom_1' });
  const start = custom.protocol.graph.nodes.find(node => node.component.type === 'core.start');
  const end = custom.protocol.graph.nodes.find(node => node.component.type === 'core.end');
  custom.protocol.graph.edges = custom.protocol.graph.edges.filter(edge => edge.id !== edgeId);
  let next = connect(custom.protocol, 'control', { nodeId: start.id, portId: 'next' }, { nodeId: 'custom_1', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'custom_1', portId: 'next' }, { nodeId: end.id, portId: 'in' }).protocol;
  const started = startRuntime(runtimeFor(next), next, registry, services());
  assert.equal(started.state.currentNodeId, 'custom_1');
  assert.equal(started.state.status, 'waiting');
});

test('custom participant events share the deterministic runtime sequence', () => {
  const protocol = linearProtocol();
  const registry = createCoreComponentRegistry();
  const svc = services();
  const started = startRuntime(runtimeFor(protocol), protocol, registry, svc);
  const changed = recordRuntimeEvent(started.state, protocol, svc, 'value_changed', { payload: { name: 'value', value: 4 } });
  const submitted = recordRuntimeEvent(changed.state, protocol, svc, 'response_submitted', { payload: { fields: ['value'] } });
  const completed = completeCurrentNode(submitted.state, protocol, registry, svc, { outputs: { value: 4 } });
  const events = [...started.events, ...changed.events, ...submitted.events, ...completed.events];
  assert.deepEqual(events.map(event => event.sequence), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(events.map(event => event.eventType), ['protocol_started', 'component_entered', 'value_changed', 'response_submitted', 'component_completed', 'protocol_completed']);
});

test('condition follows a variable binding and records its evaluated inputs', () => {
  const idFactory = createSequentialIdFactory();
  const protocol = createProtocolGraph({ idFactory, name: 'Condition', now: '2026-08-22T00:00:00.000Z' });
  const start = protocol.graph.nodes.find(node => node.component.type === 'core.start');
  const end = protocol.graph.nodes.find(node => node.component.type === 'core.end');
  protocol.graph.edges = [];
  const condition = addNode(protocol, 'logic.condition', {
    id: 'condition_1', config: { operator: 'greater_than', expected: 5 },
    bindings: { value: { kind: 'variable', variable: 'score' } },
  });
  const pass = addNode(condition.protocol, 'display.screen', { id: 'pass_screen', label: 'Pass' });
  const fail = addNode(pass.protocol, 'display.screen', { id: 'fail_screen', label: 'Fail' });
  let next = connect(fail.protocol, 'control', { nodeId: start.id, portId: 'next' }, { nodeId: 'condition_1', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'condition_1', portId: 'true' }, { nodeId: 'pass_screen', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'condition_1', portId: 'false' }, { nodeId: 'fail_screen', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'pass_screen', portId: 'next' }, { nodeId: end.id, portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'fail_screen', portId: 'next' }, { nodeId: end.id, portId: 'in' }, { id: 'edge_fail_end' }).protocol;
  const result = startRuntime(runtimeFor(next, { score: 8 }), next, createCoreComponentRegistry(), services());
  assert.equal(result.state.currentNodeId, 'pass_screen');
  const evaluated = result.events.find(event => event.eventType === 'condition_evaluated');
  assert.deepEqual(evaluated.payload, { actual: 8, operator: 'greater_than', expected: 5, result: true });
});

test('bounded loop exits after the configured number of body visits', () => {
  const idFactory = createSequentialIdFactory();
  const protocol = createProtocolGraph({ idFactory, name: 'Loop', now: '2026-08-22T00:00:00.000Z' });
  const start = protocol.graph.nodes.find(node => node.component.type === 'core.start');
  const end = protocol.graph.nodes.find(node => node.component.type === 'core.end');
  protocol.graph.edges = [];
  const loop = addNode(protocol, 'logic.loop', { id: 'loop_1', config: { maxIterations: 2 } });
  const body = addNode(loop.protocol, 'timing.wait', { id: 'body_1' });
  let next = connect(body.protocol, 'control', { nodeId: start.id, portId: 'next' }, { nodeId: 'loop_1', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'loop_1', portId: 'body' }, { nodeId: 'body_1', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'body_1', portId: 'next' }, { nodeId: 'loop_1', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'loop_1', portId: 'exit' }, { nodeId: end.id, portId: 'in' }).protocol;
  const registry = createCoreComponentRegistry();
  const svc = services();
  const first = startRuntime(runtimeFor(next), next, registry, svc);
  const second = completeCurrentNode(first.state, next, registry, svc);
  const third = completeCurrentNode(second.state, next, registry, svc);
  assert.equal(first.state.currentNodeId, 'body_1');
  assert.equal(second.state.currentNodeId, 'body_1');
  assert.equal(third.state.status, 'completed');
  assert.equal(third.state.loopCounts.loop_1, 2);
});

test('seeded random split is reproducible and records its decision', () => {
  const idFactory = createSequentialIdFactory();
  const protocol = createProtocolGraph({ idFactory, name: 'Random split', now: '2026-08-22T00:00:00.000Z' });
  const start = protocol.graph.nodes.find(node => node.component.type === 'core.start');
  const endA = protocol.graph.nodes.find(node => node.component.type === 'core.end');
  protocol.graph.edges = [];
  const random = addNode(protocol, 'logic.random', { id: 'random_1', config: { probabilityA: 0.5, seedSalt: 'trial-order' } });
  const branchA = addNode(random.protocol, 'display.screen', { id: 'branch_a', label: 'Branch A' });
  const branchB = addNode(branchA.protocol, 'display.screen', { id: 'branch_b', label: 'Branch B' });
  const endB = addNode(branchB.protocol, 'core.end', { id: 'end_b', label: 'End B' });
  let next = connect(endB.protocol, 'control', { nodeId: start.id, portId: 'next' }, { nodeId: 'random_1', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'random_1', portId: 'a' }, { nodeId: 'branch_a', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'random_1', portId: 'b' }, { nodeId: 'branch_b', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'branch_a', portId: 'next' }, { nodeId: endA.id, portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'branch_b', portId: 'next' }, { nodeId: 'end_b', portId: 'in' }).protocol;

  const options = { sessionId: 'session_random', startedAtEpochMs: 1000, startedAtMonotonicMs: 500, randomSeed: 'study-seed-42' };
  const first = startRuntime(createRuntimeState(next, options), next, createCoreComponentRegistry(), services());
  const second = startRuntime(createRuntimeState(next, options), next, createCoreComponentRegistry(), services());
  const firstDecision = first.events.find(event => event.eventType === 'randomization_evaluated');
  const secondDecision = second.events.find(event => event.eventType === 'randomization_evaluated');
  assert.deepEqual(firstDecision.payload, secondDecision.payload);
  assert.equal(first.state.currentNodeId, second.state.currentNodeId);
  assert.equal(first.state.randomDrawCount, 1);
  assert.equal(firstDecision.payload.seed, 'study-seed-42');
  assert.ok(['a', 'b'].includes(firstDecision.payload.selectedPort));
});

test('pause, resume, retry, skip and snapshot preserve explicit state', () => {
  const protocol = linearProtocol();
  const registry = createCoreComponentRegistry();
  const svc = services();
  const started = startRuntime(runtimeFor(protocol), protocol, registry, svc);
  const paused = pauseRuntime(started.state, protocol, svc, 'operator check');
  assert.equal(paused.state.status, 'paused');
  const snapshot = snapshotRuntime(paused.state);
  const restored = restoreRuntime(snapshot, protocol);
  const resumed = resumeRuntime(restored, protocol, svc);
  assert.equal(resumed.state.status, 'waiting');
  const retried = retryCurrentNode(resumed.state, protocol, svc, 'repeat instructions');
  assert.equal(retried.state.attempts.screen_1, 2);
  assert.deepEqual(retried.events.map(event => event.eventType), ['component_retried', 'component_entered']);
  const skipped = skipCurrentNode(retried.state, protocol, registry, svc, 'operator skip');
  assert.equal(skipped.state.status, 'completed');
  assert.deepEqual(skipped.state.skippedNodeIds, ['screen_1']);
});

test('snapshot restore rejects a different protocol version', () => {
  const protocol = linearProtocol();
  const snapshot = runtimeFor(protocol);
  const changed = structuredClone(protocol);
  changed.version.number += 1;
  assert.throws(() => restoreRuntime(snapshot, changed), /does not match/);
});

test('condition compares a variable against another bound variable', () => {
  const idFactory = createSequentialIdFactory();
  const protocol = createProtocolGraph({ idFactory, name: 'Compare', now: '2026-08-22T00:00:00.000Z' });
  const start = protocol.graph.nodes.find(node => node.component.type === 'core.start');
  const end = protocol.graph.nodes.find(node => node.component.type === 'core.end');
  protocol.graph.edges = [];
  const condition = addNode(protocol, 'logic.condition', {
    id: 'condition_1', config: { operator: 'greater_than' },
    bindings: { value: { kind: 'variable', variable: 'score' }, compare: { kind: 'variable', variable: 'threshold' } },
  });
  const pass = addNode(condition.protocol, 'display.screen', { id: 'pass_screen', label: 'Pass' });
  const fail = addNode(pass.protocol, 'display.screen', { id: 'fail_screen', label: 'Fail' });
  let next = connect(fail.protocol, 'control', { nodeId: start.id, portId: 'next' }, { nodeId: 'condition_1', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'condition_1', portId: 'true' }, { nodeId: 'pass_screen', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'condition_1', portId: 'false' }, { nodeId: 'fail_screen', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'pass_screen', portId: 'next' }, { nodeId: end.id, portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'fail_screen', portId: 'next' }, { nodeId: end.id, portId: 'in' }, { id: 'edge_fail_end' }).protocol;
  const registry = createCoreComponentRegistry();
  const passed = startRuntime(runtimeFor(next, { score: 8, threshold: 5 }), next, registry, services());
  assert.equal(passed.state.currentNodeId, 'pass_screen');
  const evaluated = passed.events.find(event => event.eventType === 'condition_evaluated');
  assert.equal(evaluated.payload.expected, 5);
  assert.equal(evaluated.payload.compare, 5);
  assert.equal(evaluated.payload.result, true);
  const failed = startRuntime(runtimeFor(next, { score: 8, threshold: 9 }), next, registry, services());
  assert.equal(failed.state.currentNodeId, 'fail_screen');
});

test('random split routes across three connected branches with normalized weights', () => {
  const idFactory = createSequentialIdFactory();
  const protocol = createProtocolGraph({ idFactory, name: 'Random 3', now: '2026-08-22T00:00:00.000Z' });
  const start = protocol.graph.nodes.find(node => node.component.type === 'core.start');
  const end = protocol.graph.nodes.find(node => node.component.type === 'core.end');
  protocol.graph.edges = [];
  const random = addNode(protocol, 'logic.random', { id: 'random_1', config: { probabilityA: 0.5, probabilityB: 0.25, probabilityC: 0.25 } });
  const branchA = addNode(random.protocol, 'display.screen', { id: 'branch_a', label: 'A' });
  const branchB = addNode(branchA.protocol, 'display.screen', { id: 'branch_b', label: 'B' });
  const branchC = addNode(branchB.protocol, 'display.screen', { id: 'branch_c', label: 'C' });
  const end2 = addNode(branchC.protocol, 'core.end', { id: 'end_2', label: 'End 2' });
  const end2Id = end2.node.id;
  let next = connect(end2.protocol, 'control', { nodeId: start.id, portId: 'next' }, { nodeId: 'random_1', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'random_1', portId: 'a' }, { nodeId: 'branch_a', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'random_1', portId: 'b' }, { nodeId: 'branch_b', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'random_1', portId: 'c' }, { nodeId: 'branch_c', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'branch_a', portId: 'next' }, { nodeId: end2Id, portId: 'in' }, { id: 'edge_a_end' }).protocol;
  next = connect(next, 'control', { nodeId: 'branch_b', portId: 'next' }, { nodeId: end2Id, portId: 'in' }, { id: 'edge_b_end' }).protocol;
  next = connect(next, 'control', { nodeId: 'branch_c', portId: 'next' }, { nodeId: end2Id, portId: 'in' }, { id: 'edge_c_end' }).protocol;
  const registry = createCoreComponentRegistry();
  const options = { sessionId: 'session_r3', startedAtEpochMs: 1000, startedAtMonotonicMs: 500, randomSeed: 'seed-r3' };
  const visited = new Set();
  for (let index = 0; index < 40; index += 1) {
    const run = startRuntime(createRuntimeState(next, { ...options, randomSeed: `seed-r3-${index}` }), next, registry, services());
    assert.equal(run.state.status, 'waiting');
    assert.ok(['branch_a', 'branch_b', 'branch_c'].includes(run.state.currentNodeId));
    const decision = run.events.find(event => event.eventType === 'randomization_evaluated');
    assert.ok(['a', 'b', 'c'].includes(decision.payload.selectedPort));
    assert.deepEqual(decision.payload.branchWeights, { a: 0.5, b: 0.25, c: 0.25 });
    visited.add(run.state.currentNodeId);
  }
  assert.deepEqual([...visited].sort(), ['branch_a', 'branch_b', 'branch_c']);
});

test('loop exits when the until rule stops holding', () => {
  const idFactory = createSequentialIdFactory();
  const protocol = createProtocolGraph({ idFactory, name: 'LoopUntil', now: '2026-08-22T00:00:00.000Z' });
  const start = protocol.graph.nodes.find(node => node.component.type === 'core.start');
  const end = protocol.graph.nodes.find(node => node.component.type === 'core.end');
  protocol.graph.edges = [];
  const loop = addNode(protocol, 'logic.loop', {
    id: 'loop_1', config: { maxIterations: 50, untilRule: { operator: 'less_than', expected: 3 } },
    bindings: { until: { kind: 'variable', variable: 'counter' } },
  });
  const body = addNode(loop.protocol, 'timing.wait', { id: 'body_1' });
  let next = connect(body.protocol, 'control', { nodeId: start.id, portId: 'next' }, { nodeId: 'loop_1', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'loop_1', portId: 'body' }, { nodeId: 'body_1', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'body_1', portId: 'next' }, { nodeId: 'loop_1', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'loop_1', portId: 'exit' }, { nodeId: end.id, portId: 'in' }).protocol;
  const registry = createCoreComponentRegistry();
  const svc = services();
  const started = startRuntime(runtimeFor(next, { counter: 0 }), next, registry, svc);
  assert.equal(started.state.currentNodeId, 'body_1');
  let state = started.state;
  for (let counter = 1; counter <= 3; counter += 1) {
    state = completeCurrentNode(state, next, registry, svc, { variables: { counter } }).state;
  }
  assert.equal(state.status, 'completed');
  assert.equal(state.loopCounts.loop_1, 3);
});
