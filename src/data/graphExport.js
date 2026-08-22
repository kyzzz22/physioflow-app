import { createCoreComponentRegistry } from '../core/componentRegistry.js';
import { protocolNameOf, protocolVersionOf } from '../core/protocolSelectors.js';
import { assessGraphSession } from './graphIntegrity.js';
import { createEventSchemaRegistry } from './eventSchemaRegistry.js';

export const GRAPH_DATA_CONTRACT_VERSION = '2.0.0-alpha.1';

const csvValue = value => {
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

function csv(rows, columns) {
  return `${columns.join(',')}\n${rows.map(row => columns.map(column => csvValue(row[column])).join(',')).join('\n')}${rows.length ? '\n' : ''}`;
}

export function normalizeGraphEvents(session, events = []) {
  return events.map(event => ({
    event_id: event.eventId,
    sequence: event.sequence,
    session_id: event.sessionId,
    participant_id: session.participant_id || '',
    protocol_id: event.protocolId,
    protocol_version: event.protocolVersion,
    node_id: event.nodeId || '',
    component_type: event.componentType || '',
    component_version: event.componentVersion || '',
    event_type: event.eventType,
    timestamp_iso: event.timestampIso,
    timestamp_epoch_ms: event.timestampEpochMs,
    elapsed_monotonic_ms: event.elapsedMonotonicMs,
    payload_json: event.payload || {},
  }));
}

export function normalizeGraphResponses(session, protocol, responses = []) {
  return responses.map(response => ({
    response_id: response.responseId || response.response_id || '',
    session_id: response.sessionId || session.session_id,
    participant_id: response.participantId || session.participant_id || '',
    protocol_id: response.protocolId || protocol.protocolId,
    protocol_version: protocolVersionOf(protocol),
    node_id: response.nodeId || '',
    component_type: response.componentType || '',
    response_name: response.name || '',
    value_json: response.value,
    reaction_time_ms: response.reactionTimeMs ?? '',
    timestamp_iso: response.timestampIso || '',
  }));
}

export function graphDataDictionary() {
  return {
    contractVersion: GRAPH_DATA_CONTRACT_VERSION,
    tables: {
      events: {
        primaryKey: 'event_id',
        ordering: 'sequence',
        description: 'One row per immutable Runtime V2 event. payload_json retains the complete component payload.',
        columns: ['event_id', 'sequence', 'session_id', 'participant_id', 'protocol_id', 'protocol_version', 'node_id', 'component_type', 'component_version', 'event_type', 'timestamp_iso', 'timestamp_epoch_ms', 'elapsed_monotonic_ms', 'payload_json'],
      },
      responses: {
        primaryKey: 'response_id',
        description: 'One row per participant response value projected from component submission.',
        columns: ['response_id', 'session_id', 'participant_id', 'protocol_id', 'protocol_version', 'node_id', 'component_type', 'response_name', 'value_json', 'reaction_time_ms', 'timestamp_iso'],
      },
    },
    clocks: {
      timestamp_epoch_ms: 'Wall-clock Unix milliseconds for cross-device alignment.',
      elapsed_monotonic_ms: 'Monotonic milliseconds since runtime start for duration analysis.',
    },
  };
}

export function buildGraphSessionFiles(session, protocol, events = session.events || [], responses = session.responses || []) {
  const eventRows = normalizeGraphEvents(session, events);
  const responseRows = normalizeGraphResponses(session, protocol, responses);
  const componentRegistry = createCoreComponentRegistry();
  const eventRegistry = createEventSchemaRegistry(componentRegistry);
  const quality = assessGraphSession({ session, protocol, events, responses, runtime: session.runtime_snapshot });
  const componentTypes = new Set(protocol.graph.nodes.map(node => node.component.type));
  const components = componentRegistry.list().filter(component => componentTypes.has(component.type)).map(component => ({ type: component.type, version: component.version, events: component.events, dataFields: component.dataFields }));
  const manifest = {
    contractVersion: GRAPH_DATA_CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
    sessionId: session.session_id,
    participantId: session.participant_id,
    protocolId: protocol.protocolId,
    protocolName: protocolNameOf(protocol),
    protocolVersion: protocolVersionOf(protocol),
    counts: { events: events.length, responses: responses.length, nodes: protocol.graph.nodes.length, assets: (protocol.assets || []).length },
  };
  return {
    'manifest.json': JSON.stringify(manifest, null, 2),
    'session.json': JSON.stringify({ ...session, events: undefined, responses: undefined, protocol_snapshot: undefined }, null, 2),
    'protocol_snapshot.json': JSON.stringify(protocol, null, 2),
    'runtime_snapshot.json': JSON.stringify(session.runtime_snapshot || null, null, 2),
    'events.jsonl': events.map(event => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''),
    'responses.jsonl': responses.map(response => JSON.stringify(response)).join('\n') + (responses.length ? '\n' : ''),
    'events.csv': csv(eventRows, graphDataDictionary().tables.events.columns),
    'responses.csv': csv(responseRows, graphDataDictionary().tables.responses.columns),
    'data_dictionary.json': JSON.stringify(graphDataDictionary(), null, 2),
    'event_schema_registry.json': JSON.stringify(eventRegistry.list(), null, 2),
    'component_manifest.json': JSON.stringify(components, null, 2),
    'asset_manifest.json': JSON.stringify(protocol.assets || [], null, 2),
    'quality_report.json': JSON.stringify(quality, null, 2),
  };
}
