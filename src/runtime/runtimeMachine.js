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

function subflowParameterVariable(protocol, nodeId, direction, portId) {
  for (const group of protocol.graph?.groups || []) {
    if (group.kind !== 'subflow' || !group.nodeIds?.includes(nodeId)) continue;
    const parameter = (group.parameters || []).find(item => item.direction === direction && (direction === 'input' ? item.target : item.source)?.nodeId === nodeId && (direction === 'input' ? item.target : item.source)?.portId === portId);
    if (parameter && group.parameterMappings?.[parameter.name]) return group.parameterMappings[parameter.name];
  }
  return null;
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
  const mappedVariable = subflowParameterVariable(protocol, node.id, 'input', portId);
  if (mappedVariable) return state.variables[mappedVariable];
  const edge = incomingDataEdge(protocol, node.id, portId);
  if (!edge) return undefined;
  return state.outputs[edge.source.nodeId]?.[edge.source.portId];
}

// Optional data input: distinguishes "port never wired" (fall back to config) from
// "port wired but the value happens to be undefined" (compare against undefined).
function optionalNodeInput(protocol, node, portId, state) {
  const hasBinding = Object.prototype.hasOwnProperty.call(node.bindings || {}, portId);
  const hasSubflow = Boolean(subflowParameterVariable(protocol, node.id, 'input', portId));
  const hasEdge = Boolean(incomingDataEdge(protocol, node.id, portId));
  if (!hasBinding && !hasSubflow && !hasEdge) return { present: false, value: undefined };
  return { present: true, value: resolveNodeInput(protocol, node, portId, state) };
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
    const definition = registry.get(node.component.type, node.component.version);
    if (!definition) return failRuntime(state, protocol, services, `Unknown component ${node.component.type}@${node.component.version}`, node, events);
    const runtimeKind = definition.runtime?.kind || 'participant';
    try {
      if (runtimeKind === 'start') {
        currentNodeId = chooseControlTarget(protocol, node, 'next');
        continue;
      }
      if (runtimeKind === 'end') {
        const emitted = appendEvent({ ...state, status: 'completed', currentNodeId: null }, protocol, 'protocol_completed', services, { node });
        events.push(emitted.event);
        return { state: emitted.state, events };
      }
      if (runtimeKind === 'condition') {
        const actual = resolveNodeInput(protocol, node, 'value', state);
        const compare = optionalNodeInput(protocol, node, 'compare', state);
        const passed = evaluateExpression(node.config, actual, compare.present ? compare.value : undefined);
        const conditionPayload = {
          actual,
          operator: node.config?.operator || 'equals',
          expected: compare.present ? compare.value : node.config?.expected,
          result: passed,
        };
        if (compare.present) conditionPayload.compare = compare.value;
        const emitted = appendEvent(state, protocol, 'condition_evaluated', services, {
          node,
          payload: conditionPayload,
        });
        state = emitted.state;
        events.push(emitted.event);
        currentNodeId = chooseControlTarget(protocol, node, passed ? 'true' : 'false');
        continue;
      }
      if (runtimeKind === 'loop') {
        const count = state.loopCounts[node.id] || 0;
        const maximum = Math.max(0, Number(node.config?.maxIterations ?? 1));
        const until = optionalNodeInput(protocol, node, 'until', state);
        const hasRule = until.present && node.config?.untilRule?.operator;
        const ruleHolds = hasRule ? evaluateExpression(node.config.untilRule, until.value) : true;
        const enterBody = count < maximum && ruleHolds;
        state = {
          ...state,
          loopCounts: enterBody ? { ...state.loopCounts, [node.id]: count + 1 } : state.loopCounts,
        };
        const emitted = appendEvent(state, protocol, 'loop_evaluated', services, {
          node,
          payload: {
            completedIterations: count,
            maxIterations: maximum,
            enterBody,
            ...(hasRule ? { untilValue: until.value, ruleHolds } : {}),
          },
        });
        state = emitted.state;
        events.push(emitted.event);
        currentNodeId = chooseControlTarget(protocol, node, enterBody ? 'body' : 'exit');
        continue;
      }
      if (runtimeKind === 'random') {
        const probabilityA = Number(node.config?.probabilityA ?? 0.5);
        const draw = drawRandom(state, node.config?.seedSalt || '');
        state = draw.state;
        const weightOf = portId => {
          const key = `probability${portId.toUpperCase()}`;
          if (node.config?.[key] != null) return Math.max(0, Number(node.config[key]));
          if (portId === 'b') return Math.max(0, 1 - probabilityA);
          return 0.5;
        };
        const candidates = ['a', 'b', 'c', 'd'].filter(portId => outgoingControlEdges(protocol, node.id).some(edge => edge.source.portId === portId));
        if (!candidates.length) throw new Error(`Node ${node.id} needs at least one connected random branch`);
        const weighted = candidates.map(portId => ({ portId, weight: weightOf(portId) }));
        const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
        if (!(totalWeight > 0)) throw new Error(`Node ${node.id} random branches need a positive total weight`);
        let selectedPort = candidates[candidates.length - 1];
        let cumulative = 0;
        for (const item of weighted) {
          cumulative += item.weight / totalWeight;
          if (draw.value < cumulative) { selectedPort = item.portId; break; }
        }
        const emitted = appendEvent(state, protocol, 'randomization_evaluated', services, {
          node,
          payload: {
            seed: state.randomSeed,
            drawIndex: state.randomDrawCount,
            randomValue: draw.value,
            probabilityA,
            branchWeights: Object.fromEntries(weighted.map(item => [item.portId, Math.round(item.weight / totalWeight * 1000) / 1000])),
            selectedPort,
          },
        });
        state = emitted.state;
        events.push(emitted.event);
        currentNodeId = chooseControlTarget(protocol, node, selectedPort);
        continue;
      }
      if (runtimeKind === 'handler') {
        const handlerId = definition.runtime?.handlerId;
        const handlerVersion = definition.runtime?.handlerVersion || '1.0.0';
        if (!services.controlHandlers?.execute) throw new Error(`Control handler registry is unavailable for ${handlerId}`);
        const inputs = Object.fromEntries(definition.ports.filter(port => port.kind === 'data' && port.direction === 'input').map(port => [port.id, resolveNodeInput(protocol, node, port.id, state)]));
        const result = services.controlHandlers.execute(handlerId, handlerVersion, { nodeId: node.id, component: node.component, config: node.config || {}, inputs, variables: state.variables, outputs: state.outputs });
        const output = definition.ports.find(port => port.id === result.selectedPort && port.kind === 'control' && port.direction === 'output');
        if (!output) throw new Error(`Control handler ${handlerId} selected undeclared port ${result.selectedPort}`);
        const emitted = appendEvent(state, protocol, result.eventType || 'control_handler_evaluated', services, { node, payload: { handlerId, handlerVersion, selectedPort: result.selectedPort, ...result.payload } });
        state = emitted.state;
        events.push(emitted.event);
        currentNodeId = chooseControlTarget(protocol, node, result.selectedPort);
        continue;
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
  const variableChanges = structuredClone(result.variables || {});
  for (const [portId, value] of Object.entries(outputs)) {
    const mappedVariable = subflowParameterVariable(protocol, node.id, 'output', portId);
    if (mappedVariable) variableChanges[mappedVariable] = structuredClone(value);
  }
  const variables = { ...runtime.variables, ...variableChanges };
  let state = {
    ...runtime,
    variables,
    outputs: { ...runtime.outputs, [node.id]: { ...(runtime.outputs[node.id] || {}), ...outputs } },
    completedNodeIds: [...runtime.completedNodeIds, node.id],
  };
  const emitted = appendEvent(state, protocol, 'component_completed', services, {
    node,
    payload: { attempt: state.attempts[node.id], outputs, variables: variableChanges, metadata: structuredClone(result.metadata || {}) },
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
