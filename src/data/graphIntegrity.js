import { createCoreComponentRegistry } from '../core/componentRegistry.js';
import { createEventSchemaRegistry, validateRuntimeEvent } from './eventSchemaRegistry.js';

export function assessGraphSession({ session, protocol, events = [], responses = [], runtime }) {
  const errors = [];
  const warnings = [];
  const registry = createEventSchemaRegistry(createCoreComponentRegistry());
  const eventIds = new Set();
  const nodeIds = new Set((protocol.graph?.nodes || []).map(node => node.id));
  let previousSequence = 0;
  let previousElapsed = -1;
  for (const event of events) {
    const check = validateRuntimeEvent(event, registry);
    if (!check.valid) errors.push(`Event ${event.eventId || '(missing)'}: ${check.errors.join(', ')}`);
    if (eventIds.has(event.eventId)) errors.push(`Duplicate event ID ${event.eventId}`);
    eventIds.add(event.eventId);
    if (event.sequence !== previousSequence + 1) errors.push(`Event sequence gap before ${event.sequence}`);
    if (event.elapsedMonotonicMs < previousElapsed) errors.push(`Monotonic time moved backwards at event ${event.sequence}`);
    if (event.nodeId && !nodeIds.has(event.nodeId)) errors.push(`Event ${event.sequence} references unknown node ${event.nodeId}`);
    previousSequence = event.sequence;
    previousElapsed = event.elapsedMonotonicMs;
  }
  if (session?.status === 'completed' && !events.some(event => event.eventType === 'protocol_completed')) errors.push('Completed session lacks protocol_completed event');
  if (runtime?.status === 'failed') errors.push(`Runtime failed: ${runtime.error || 'unknown error'}`);
  if (runtime?.status === 'completed' && session?.status !== 'completed') warnings.push('Runtime completed but session status differs');
  const skipped = events.filter(event => event.eventType === 'component_skipped').length;
  const retries = events.filter(event => event.eventType === 'component_retried').length;
  const pauses = events.filter(event => event.eventType === 'session_paused').length;
  if (skipped) warnings.push(`${skipped} component(s) skipped`);
  if (retries) warnings.push(`${retries} component retry/retries`);
  if (pauses) warnings.push(`${pauses} pause(s)`);
  const validity_status = errors.length ? 'invalid' : warnings.length ? 'attention' : 'valid';
  return {
    validity_status,
    checked_at: new Date().toISOString(),
    errors,
    warnings,
    facts: {
      events: events.length,
      responses: responses.length,
      components_entered: events.filter(event => event.eventType === 'component_entered').length,
      components_completed: events.filter(event => event.eventType === 'component_completed').length,
      skipped,
      retries,
      pauses,
    },
  };
}
