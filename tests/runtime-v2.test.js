import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode,
  connect,
  createCoreComponentRegistry,
  createProtocolGraph,
  createSequentialIdFactory,
} from '../src/core/index.js';
import {
  completeCurrentNode,
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
