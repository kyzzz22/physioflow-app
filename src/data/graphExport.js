import { createProjectComponentRegistry } from '../sdk/index.js';
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

export function normalizeDeviceEvents(session, deviceEvents = session.device_events || []) {
  return deviceEvents.map(event => ({
    event_id: event.eventId,
    sequence: event.sequence,
    session_id: event.sessionId || session.session_id || '',
    connector_id: event.connector?.id || '',
    connector_version: event.connector?.version || '',
    transport: event.connector?.transport || '',
    device_id: event.device?.deviceId || '',
    event_type: event.eventType,
    timestamp_iso: event.timestampIso,
    timestamp_epoch_ms: event.timestampEpochMs,
    elapsed_monotonic_ms: event.elapsedMonotonicMs,
    payload_json: event.payload || {},
    device_json: event.device || {},
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
      device_events: {
        primaryKey: 'event_id',
        ordering: 'sequence within connector session',
        description: 'Immutable external-device lifecycle, sample, marker, failure and recovery events with connector/device provenance.',
        columns: ['event_id', 'sequence', 'session_id', 'connector_id', 'connector_version', 'transport', 'device_id', 'event_type', 'timestamp_iso', 'timestamp_epoch_ms', 'elapsed_monotonic_ms', 'payload_json', 'device_json'],
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
  const deviceEvents = session.device_events || [];
  const deviceEventRows = normalizeDeviceEvents(session, deviceEvents);
  const componentRegistry = createProjectComponentRegistry(protocol);
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
    counts: { events: events.length, responses: responses.length, deviceEvents: deviceEvents.length, nodes: protocol.graph.nodes.length, assets: (protocol.assets || []).length },
  };
  return {
    'manifest.json': JSON.stringify(manifest, null, 2),
    'session.json': JSON.stringify({ ...session, events: undefined, responses: undefined, device_events: undefined, protocol_snapshot: undefined }, null, 2),
    'protocol_snapshot.json': JSON.stringify(protocol, null, 2),
    'runtime_snapshot.json': JSON.stringify(session.runtime_snapshot || null, null, 2),
    'events.jsonl': events.map(event => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''),
    'responses.jsonl': responses.map(response => JSON.stringify(response)).join('\n') + (responses.length ? '\n' : ''),
    'device_events.jsonl': deviceEvents.map(event => JSON.stringify(event)).join('\n') + (deviceEvents.length ? '\n' : ''),
    'events.csv': csv(eventRows, graphDataDictionary().tables.events.columns),
    'responses.csv': csv(responseRows, graphDataDictionary().tables.responses.columns),
    'device_events.csv': csv(deviceEventRows, graphDataDictionary().tables.device_events.columns),
    'data_dictionary.json': JSON.stringify(graphDataDictionary(), null, 2),
    'event_schema_registry.json': JSON.stringify(eventRegistry.list(), null, 2),
    'component_manifest.json': JSON.stringify(components, null, 2),
    'asset_manifest.json': JSON.stringify(protocol.assets || [], null, 2),
    'quality_report.json': JSON.stringify(quality, null, 2),
  };
}

export const BIDS_SCHEMA_VERSION = '1.8.0';

/**
 * Build a BIDS v1.8.0 events bundle for a graph session.
 * Returns a flat map of BIDS file paths -> contents. Events are projected from the
 * normalized graph events (onset/duration in seconds from the monotonic clock).
 */
export function buildGraphBidsBundle(session, protocol, events = [], responses = []) {
  const normalized = normalizeGraphEvents(session, events);
  const sorted = normalized.filter(event => event.elapsed_monotonic_ms != null).sort((a, b) => a.elapsed_monotonic_ms - b.elapsed_monotonic_ms);
  const responseByNode = new Map();
  for (const response of responses) responseByNode.set(response.nodeId || response.node_id, response);
  const rows = sorted.map((event, index) => {
    const next = sorted[index + 1];
    const durationSec = next ? Math.max(0, (next.elapsed_monotonic_ms - event.elapsed_monotonic_ms) / 1000) : 0;
    const payload = event.payload_json || {};
    const response = responseByNode.get(event.node_id);
    return {
      onset: (event.elapsed_monotonic_ms / 1000).toFixed(3),
      duration: durationSec.toFixed(3),
      sample: event.elapsed_monotonic_ms,
      trial_type: event.event_type,
      component_type: event.component_type || '',
      node_id: event.node_id || '',
      stim_file: payload.assetId || payload.sourceUrl || '',
      value: payload.value !== undefined ? JSON.stringify(payload.value) : '',
      accuracy: response?.is_correct !== undefined ? (response.is_correct ? '1' : '0') : '',
    };
  });
  const participantId = session.participant_id || 'P001';
  const task = protocol.metadata?.name ? protocol.metadata.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') : 'task';
  const sessionLabel = String(session.session_id || '01').replace(/[^a-zA-Z0-9]/g, '');
  const prefix = `sub-${participantId}/ses-${sessionLabel}/func/${task}_${sessionLabel}_events`;
  const columns = ['onset', 'duration', 'sample', 'trial_type', 'component_type', 'node_id', 'stim_file', 'value', 'accuracy'];
  const eventsJson = {
    onset: { LongName: 'Event onset', Units: 's' },
    duration: { LongName: 'Event duration', Units: 's' },
    sample: { LongName: 'Event sample (runtime monotonic clock)', Units: 'ms' },
    trial_type: { LongName: 'Runtime event type' },
    component_type: { LongName: 'Component type' },
    node_id: { LongName: 'Graph node identifier' },
    stim_file: { LongName: 'Stimulus file or URL' },
    value: { LongName: 'Response value' },
    accuracy: { LongName: 'Accuracy (1 correct / 0 incorrect)' },
  };
  return {
    [`${prefix}.tsv`]: csv(rows, columns),
    [`${prefix}.json`]: JSON.stringify(eventsJson, null, 2),
    'participants.tsv': `participant_id\n${participantId}\n`,
    'participants.json': JSON.stringify({ participant_id: { LongName: 'Participant identifier' } }, null, 2),
    'dataset_description.json': JSON.stringify({
      Name: protocolNameOf(protocol),
      BIDSVersion: BIDS_SCHEMA_VERSION,
      DatasetType: 'raw',
    }, null, 2),
  };
}
