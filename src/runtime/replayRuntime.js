function initialVariables(protocol) {
  return Object.fromEntries((protocol.variables || []).map(variable => [variable.name, structuredClone(variable.defaultValue ?? null)]));
}

function initialReplayState(protocol, sessionId) {
  return {
    sessionId,
    protocolId: protocol.protocolId,
    protocolVersion: protocol.version?.number ?? null,
    status: 'ready',
    statusBeforePause: null,
    currentNodeId: null,
    variables: initialVariables(protocol),
    outputs: {},
    attempts: {},
    completedNodeIds: [],
    skippedNodeIds: [],
    loopCounts: {},
    randomSeed: null,
    randomDrawCount: 0,
    decisions: [],
    eventSequence: 0,
    error: null,
  };
}

function appendUnique(values, value) {
  return values.includes(value) ? values : [...values, value];
}

export function reduceRuntimeEvent(previous, event) {
  let state = { ...previous, eventSequence: event.sequence };
  const payload = event.payload || {};
  switch (event.eventType) {
    case 'protocol_started':
      return { ...state, status: 'running', randomSeed: payload.randomSeed || null };
    case 'component_entered':
      return { ...state, status: 'waiting', currentNodeId: event.nodeId, attempts: { ...state.attempts, [event.nodeId]: payload.attempt || 1 } };
    case 'response_submitted':
      return { ...state, variables: { ...state.variables, ...(payload.values || {}) } };
    case 'component_completed':
      return {
        ...state,
        status: 'running',
        currentNodeId: null,
        variables: { ...state.variables, ...(payload.variables || {}) },
        outputs: { ...state.outputs, [event.nodeId]: { ...(state.outputs[event.nodeId] || {}), ...(payload.outputs || {}) } },
        completedNodeIds: appendUnique(state.completedNodeIds, event.nodeId),
      };
    case 'component_skipped':
      return { ...state, status: 'running', currentNodeId: null, skippedNodeIds: appendUnique(state.skippedNodeIds, event.nodeId) };
    case 'component_retried':
      return { ...state, status: 'running' };
    case 'condition_evaluated':
      return { ...state, decisions: [...state.decisions, { sequence: event.sequence, nodeId: event.nodeId, kind: 'condition', selectedPort: payload.result ? 'true' : 'false', payload: structuredClone(payload) }] };
    case 'loop_evaluated':
      return { ...state, loopCounts: { ...state.loopCounts, [event.nodeId]: payload.enterBody ? Number(payload.completedIterations || 0) + 1 : Number(payload.completedIterations || 0) }, decisions: [...state.decisions, { sequence: event.sequence, nodeId: event.nodeId, kind: 'loop', selectedPort: payload.enterBody ? 'body' : 'exit', payload: structuredClone(payload) }] };
    case 'randomization_evaluated':
      return { ...state, randomSeed: payload.seed || state.randomSeed, randomDrawCount: Math.max(state.randomDrawCount, Number(payload.drawIndex || 0)), decisions: [...state.decisions, { sequence: event.sequence, nodeId: event.nodeId, kind: 'random', selectedPort: payload.selectedPort, payload: structuredClone(payload) }] };
    case 'session_paused':
      return { ...state, statusBeforePause: state.status, status: 'paused' };
    case 'session_resumed':
      return { ...state, status: state.statusBeforePause || (state.currentNodeId ? 'waiting' : 'running'), statusBeforePause: null };
    case 'protocol_completed':
      return { ...state, status: 'completed', currentNodeId: null };
    case 'runtime_failed':
      return { ...state, status: 'failed', currentNodeId: event.nodeId || state.currentNodeId, error: payload.message || 'Runtime failed' };
    default:
      return state;
  }
}

export function createRuntimeReplay(protocol, events = []) {
  if (!protocol?.graph) throw new Error('Runtime replay requires a Protocol Graph snapshot');
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  const sessionId = ordered[0]?.sessionId || null;
  let state = initialReplayState(protocol, sessionId);
  const frames = [{ sequence: 0, event: null, state: structuredClone(state) }];
  ordered.forEach((event, index) => {
    if (event.sequence !== index + 1) throw new Error(`Runtime replay requires contiguous event sequences; expected ${index + 1}, found ${event.sequence}`);
    if (event.protocolId !== protocol.protocolId) throw new Error(`Event ${event.sequence} belongs to a different protocol`);
    if (event.sessionId !== sessionId) throw new Error(`Event ${event.sequence} belongs to a different session`);
    state = reduceRuntimeEvent(state, event);
    frames.push({ sequence: event.sequence, event: structuredClone(event), state: structuredClone(state) });
  });
  return { frames, finalState: structuredClone(state) };
}

export function replayRuntimeToSequence(protocol, events, sequence) {
  const replay = createRuntimeReplay(protocol, events);
  const target = Math.max(0, Math.min(Number(sequence) || 0, replay.frames.length - 1));
  return replay.frames[target];
}
