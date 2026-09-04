import { RUNTIME_EVENT_SCHEMA_VERSION } from '../runtime/eventEnvelope.js';

const RUNTIME_EVENTS = [
  'protocol_started', 'protocol_completed', 'component_entered', 'component_completed',
  'component_skipped', 'component_retried', 'condition_evaluated', 'loop_evaluated', 'randomization_evaluated',
  'session_paused', 'session_resumed', 'runtime_failed',
  'control_handler_evaluated',
  'ui_action', 'stimulus_assigned', 'media_loaded', 'media_error', 'value_changed', 'response_submitted',
];

export class EventSchemaRegistry {
  #schemas = new Map();

  register(eventType, schema = {}) {
    if (!eventType?.trim()) throw new Error('Event type is required');
    this.#schemas.set(eventType, structuredClone({
      eventType,
      schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
      source: 'runtime',
      description: '',
      payloadFields: [],
      ...schema,
    }));
    return this;
  }

  get(eventType) { return structuredClone(this.#schemas.get(eventType) || null); }
  has(eventType) { return this.#schemas.has(eventType); }
  list() { return [...this.#schemas.values()].map(schema => structuredClone(schema)); }
}

export function createEventSchemaRegistry(componentRegistry) {
  const registry = new EventSchemaRegistry();
  RUNTIME_EVENTS.forEach(eventType => registry.register(eventType));
  for (const component of componentRegistry?.list() || []) {
    for (const eventType of component.events || []) {
      if (!registry.has(eventType)) registry.register(eventType, { source: component.type });
    }
  }
  return registry;
}

export function validateRuntimeEvent(event, registry) {
  const errors = [];
  if (event?.schemaVersion !== RUNTIME_EVENT_SCHEMA_VERSION) errors.push('Unsupported event schema version');
  if (!event?.eventId) errors.push('eventId is required');
  if (!Number.isInteger(event?.sequence) || event.sequence < 1) errors.push('sequence must be a positive integer');
  if (!event?.sessionId) errors.push('sessionId is required');
  if (!event?.protocolId) errors.push('protocolId is required');
  if (!event?.eventType) errors.push('eventType is required');
  else if (registry && !registry.has(event.eventType)) errors.push(`Unknown event type ${event.eventType}`);
  if (!Number.isFinite(event?.timestampEpochMs)) errors.push('timestampEpochMs is required');
  if (!Number.isFinite(event?.elapsedMonotonicMs) || event.elapsedMonotonicMs < 0) errors.push('elapsedMonotonicMs must be non-negative');
  return { valid: errors.length === 0, errors };
}
