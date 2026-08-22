export const RUNTIME_EVENT_SCHEMA_VERSION = '1.0.0';

export function createRuntimeEvent(state, protocol, type, services, options = {}) {
  if (!services?.clock?.now || !services?.idFactory) throw new Error('Runtime services require clock.now and idFactory');
  const timestamp = services.clock.now();
  const node = options.node || null;
  return {
    schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
    eventId: services.idFactory('event'),
    sequence: state.eventSequence + 1,
    sessionId: state.sessionId,
    protocolId: protocol.protocolId,
    protocolVersion: protocol.version?.number ?? null,
    nodeId: node?.id || options.nodeId || null,
    componentType: node?.component?.type || options.componentType || null,
    componentVersion: node?.component?.version || options.componentVersion || null,
    eventType: type,
    timestampIso: timestamp.iso,
    timestampEpochMs: timestamp.epochMs,
    elapsedMonotonicMs: Math.max(0, timestamp.monotonicMs - state.startedAtMonotonicMs),
    payload: structuredClone(options.payload || {}),
  };
}
