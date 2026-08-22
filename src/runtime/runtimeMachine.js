import { createRuntimeEvent } from './eventEnvelope.js';
import { evaluateExpression, resolveBinding } from './expression.js';

export const RUNTIME_STATE_SCHEMA_VERSION = '1.0.0';
const MAX_AUTOMATIC_TRANSITIONS = 10000;

function nodeMap(protocol) {
  return new Map((protocol.graph?.nodes || []).map(node => [node.id, node]));
}

function outgoingControlEdges(protocol, nodeId) {
  return (protocol.graph?.edges || []).filter(edge => edge.kind === 'control' && edge.source.nodeId === nodeId);
}

function incomingDataEdge(protocol, nodeId, portId) {
  return (protocol.graph?.edges || []).find(edge => edge.kind === 'data' && edge.target.nodeId === nodeId && edge.target.portId === portId);
}

function appendEvent(state, protocol, type, services, options = {}) {
  const event = createRuntimeEvent(state, protocol, type, services, options);
  return {
    state: { ...state, eventSequence: event.sequence },
    event,
  };
}

function initializeVariables(protocol, initialValues = {}) {
  const values = {};
  for (const variable of protocol.variables || []) values[variable.name] = structuredClone(variable.defaultValue ?? null);
  return { ...values, ...structuredClone(initialValues) };
}

function hashRandomSeed(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function drawRandom(state, salt = '') {
  const salted = salt ? (state.randomState ^ hashRandomSeed(salt)) >>> 0 : state.randomState;
  const randomState = (Math.imul(1664525, salted) + 1013904223) >>> 0;
  return {
    state: { ...state, randomState, randomDrawCount: state.randomDrawCount + 1 },
    value: randomState / 4294967296,
  };
}

export function createRuntimeState(protocol, options) {
  if (!options?.sessionId) throw new Error('Runtime requires a session ID');
  if (!Number.isFinite(options.startedAtEpochMs) || !Number.isFinite(options.startedAtMonotonicMs)) {
    throw new Error('Runtime requires explicit epoch and monotonic start times');
  }
  const randomSeed = String(options.randomSeed ?? `${protocol.protocolId}:${protocol.version?.number ?? 'draft'}:${options.sessionId}`);
  return {
    schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
    sessionId: options.sessionId,
    protocolId: protocol.protocolId,
    protocolSchemaVersion: protocol.schemaVersion,
    protocolVersion: protocol.version?.number ?? null,
    status: 'ready',
    statusBeforePause: null,
    currentNodeId: null,
    variables: initializeVariables(protocol, options.variables),
    outputs: {},
    loopCounts: {},
    randomSeed,
    randomState: hashRandomSeed(randomSeed),
    randomDrawCount: 0,
    attempts: {},
    completedNodeIds: [],
    skippedNodeIds: [],
    transitionCount: 0,
    eventSequence: 0,
    startedAtEpochMs: options.startedAtEpochMs,
    startedAtMonotonicMs: options.startedAtMonotonicMs,
    error: null,
  };
}

function chooseControlTarget(protocol, node, portId) {
  const edges = outgoingControlEdges(protocol, node.id).filter(edge => edge.source.portId === portId);
  if (edges.length !== 1) throw new Error(`Node ${node.id} requires exactly one ${portId} control connection; found ${edges.length}`);
  return edges[0].target.nodeId;
}

function resolveNodeInput(protocol, node, portId, state) {
  if (Object.prototype.hasOwnProperty.call(node.bindings || {}, portId)) {
    return resolveBinding(node.bindings[portId], state);
  }
  const edge = incomingDataEdge(protocol, node.id, portId);
  if (!edge) return undefined;
  return state.outputs[edge.source.nodeId]?.[edge.source.portId];
}

function failRuntime(state, protocol, services, error, node, events) {
  const failed = { ...state, status: 'failed', error: error instanceof Error ? error.message : String(error), currentNodeId: node?.id || state.currentNodeId };
  const emitted = appendEvent(failed, protocol, 'runtime_failed', services, { node, payload: { message: failed.error } });
  events.push(emitted.event);
  return { state: emitted.state, events };
}

function enterExecutableNode(state, protocol, node, services, events) {
  const attempt = (state.attempts[node.id] || 0) + 1;
  const next = {
    ...state,
    status: 'waiting',
    currentNodeId: node.id,
    attempts: { ...state.attempts, [node.id]: attempt },
  };
  const emitted = appendEvent(next, protocol, 'component_entered', services, { node, payload: { attempt } });
  events.push(emitted.event);
  return { state: emitted.state, events };
}

function advanceAutomatic(initialState, protocol, registry, services, startNodeId, existingEvents = []) {
  let state = { ...initialState, status: 'running', currentNodeId: null };
  let currentNodeId = startNodeId;
  const nodes = nodeMap(protocol);
  const events = [...existingEvents];

  for (let transition = 0; transition < MAX_AUTOMATIC_TRANSITIONS; transition += 1) {
    const node = nodes.get(currentNodeId);
    if (!node) return failRuntime(state, protocol, services, `Node ${currentNodeId} does not exist`, null, events);
    state = { ...state, transitionCount: state.transitionCount + 1 };
    const type = node.component.type;
    try {
      if (type === 'core.start') {
        currentNodeId = chooseControlTarget(protocol, node, 'next');
        continue;
      }
      if (type === 'core.end') {
        const emitted = appendEvent({ ...state, status: 'completed', currentNodeId: null }, protocol, 'protocol_completed', services, { node });
        events.push(emitted.event);
        return { state: emitted.state, events };
      }
      if (type === 'logic.condition') {
        const actual = resolveNodeInput(protocol, node, 'value', state);
        const passed = evaluateExpression(node.config, actual);
        const emitted = appendEvent(state, protocol, 'condition_evaluated', services, {
          node,
          payload: { actual, operator: node.config?.operator || 'equals', expected: node.config?.expected, result: passed },
        });
        state = emitted.state;
        events.push(emitted.event);
        currentNodeId = chooseControlTarget(protocol, node, passed ? 'true' : 'false');
        continue;
      }
      if (type === 'logic.loop') {
        const count = state.loopCounts[node.id] || 0;
        const maximum = Math.max(0, Number(node.config?.maxIterations ?? 1));
        const enterBody = count < maximum;
        state = {
          ...state,
          loopCounts: enterBody ? { ...state.loopCounts, [node.id]: count + 1 } : state.loopCounts,
        };
        const emitted = appendEvent(state, protocol, 'loop_evaluated', services, {
          node,
          payload: { completedIterations: count, maxIterations: maximum, enterBody },
        });
        state = emitted.state;
        events.push(emitted.event);
        currentNodeId = chooseControlTarget(protocol, node, enterBody ? 'body' : 'exit');
        continue;
      }
      if (type === 'logic.random') {
        const probabilityA = Number(node.config?.probabilityA ?? 0.5);
        const draw = drawRandom(state, node.config?.seedSalt || '');
        state = draw.state;
        const selectedPort = draw.value < probabilityA ? 'a' : 'b';
        const emitted = appendEvent(state, protocol, 'randomization_evaluated', services, {
          node,
          payload: { seed: state.randomSeed, drawIndex: state.randomDrawCount, randomValue: draw.value, probabilityA, selectedPort },
        });
        state = emitted.state;
        events.push(emitted.event);
        currentNodeId = chooseControlTarget(protocol, node, selectedPort);
        continue;
      }
      if (!registry.has(node.component.type, node.component.version)) {
        return failRuntime(state, protocol, services, `Unknown component ${node.component.type}@${node.component.version}`, node, events);
      }
      return enterExecutableNode(state, protocol, node, services, events);
    } catch (error) {
      return failRuntime(state, protocol, services, error, node, events);
    }
  }
  return failRuntime(state, protocol, services, 'Automatic transition limit exceeded', nodes.get(currentNodeId), events);
}

export function startRuntime(runtime, protocol, registry, services) {
  if (runtime.status !== 'ready') throw new Error(`Cannot start runtime in ${runtime.status} status`);
  let state = { ...runtime, status: 'running' };
  const started = appendEvent(state, protocol, 'protocol_started', services, {
    nodeId: protocol.graph.entryNodeId,
    payload: { protocolSchemaVersion: protocol.schemaVersion, randomSeed: state.randomSeed },
  });
  state = started.state;
  return advanceAutomatic(state, protocol, registry, services, protocol.graph.entryNodeId, [started.event]);
}

export function completeCurrentNode(runtime, protocol, registry, services, result = {}) {
  if (runtime.status !== 'waiting' || !runtime.currentNodeId) throw new Error('Runtime is not waiting on a component');
  const node = nodeMap(protocol).get(runtime.currentNodeId);
  if (!node) return failRuntime(runtime, protocol, services, `Node ${runtime.currentNodeId} does not exist`, null, []);
  const outputs = structuredClone(result.outputs || {});
  const variables = { ...runtime.variables, ...structuredClone(result.variables || {}) };
  let state = {
    ...runtime,
    variables,
    outputs: { ...runtime.outputs, [node.id]: { ...(runtime.outputs[node.id] || {}), ...outputs } },
    completedNodeIds: [...runtime.completedNodeIds, node.id],
  };
  const emitted = appendEvent(state, protocol, 'component_completed', services, {
    node,
    payload: { attempt: state.attempts[node.id], outputs, metadata: structuredClone(result.metadata || {}) },
  });
  state = emitted.state;
  let target;
  try {
    target = chooseControlTarget(protocol, node, 'next');
  } catch (error) {
    return failRuntime(state, protocol, services, error, node, [emitted.event]);
  }
  return advanceAutomatic(state, protocol, registry, services, target, [emitted.event]);
}

export function recordRuntimeEvent(runtime, protocol, services, eventType, options = {}) {
  const node = options.node || (runtime.currentNodeId ? nodeMap(protocol).get(runtime.currentNodeId) : null);
  const emitted = appendEvent(runtime, protocol, eventType, services, { ...options, node });
  return { state: emitted.state, events: [emitted.event] };
}

export function skipCurrentNode(runtime, protocol, registry, services, reason = '') {
  if (runtime.status !== 'waiting' || !runtime.currentNodeId) throw new Error('Runtime is not waiting on a component');
  const node = nodeMap(protocol).get(runtime.currentNodeId);
  if (!node) return failRuntime(runtime, protocol, services, `Node ${runtime.currentNodeId} does not exist`, null, []);
  let state = { ...runtime, skippedNodeIds: [...runtime.skippedNodeIds, node.id] };
  const emitted = appendEvent(state, protocol, 'component_skipped', services, { node, payload: { reason } });
  state = emitted.state;
  try {
    return advanceAutomatic(state, protocol, registry, services, chooseControlTarget(protocol, node, 'next'), [emitted.event]);
  } catch (error) {
    return failRuntime(state, protocol, services, error, node, [emitted.event]);
  }
}

export function retryCurrentNode(runtime, protocol, services, reason = '') {
  if (runtime.status !== 'waiting' || !runtime.currentNodeId) throw new Error('Runtime is not waiting on a component');
  const node = nodeMap(protocol).get(runtime.currentNodeId);
  if (!node) return failRuntime(runtime, protocol, services, `Node ${runtime.currentNodeId} does not exist`, null, []);
  const retry = appendEvent(runtime, protocol, 'component_retried', services, { node, payload: { reason, previousAttempt: runtime.attempts[node.id] } });
  return enterExecutableNode(retry.state, protocol, node, services, [retry.event]);
}

export function pauseRuntime(runtime, protocol, services, reason = '') {
  if (!['running', 'waiting'].includes(runtime.status)) throw new Error(`Cannot pause runtime in ${runtime.status} status`);
  const node = runtime.currentNodeId ? nodeMap(protocol).get(runtime.currentNodeId) : null;
  const state = { ...runtime, statusBeforePause: runtime.status, status: 'paused' };
  const emitted = appendEvent(state, protocol, 'session_paused', services, { node, payload: { reason } });
  return { state: emitted.state, events: [emitted.event] };
}

export function resumeRuntime(runtime, protocol, services) {
  if (runtime.status !== 'paused') throw new Error(`Cannot resume runtime in ${runtime.status} status`);
  const node = runtime.currentNodeId ? nodeMap(protocol).get(runtime.currentNodeId) : null;
  const state = { ...runtime, status: runtime.statusBeforePause || (runtime.currentNodeId ? 'waiting' : 'running'), statusBeforePause: null };
  const emitted = appendEvent(state, protocol, 'session_resumed', services, { node });
  return { state: emitted.state, events: [emitted.event] };
}

export function snapshotRuntime(runtime) {
  return structuredClone(runtime);
}

export function restoreRuntime(snapshot, protocol) {
  if (snapshot.protocolId !== protocol.protocolId || snapshot.protocolSchemaVersion !== protocol.schemaVersion || snapshot.protocolVersion !== (protocol.version?.number ?? null)) {
    throw new Error('Runtime snapshot does not match the protocol version');
  }
  return structuredClone(snapshot);
}
