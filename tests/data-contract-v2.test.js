import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoreComponentRegistry, createProtocolGraph, createSequentialIdFactory } from '../src/core/index.js';
import { assessGraphSession, buildGraphSessionFiles, createEventSchemaRegistry, normalizeGraphEvents, validateRuntimeEvent } from '../src/data/index.js';

function fixture() {
  const protocol = createProtocolGraph({ idFactory: createSequentialIdFactory(), name: 'Export fixture', now: '2026-08-22T00:00:00.000Z' });
  const session = { session_id: 'session_1', participant_id: 'P,001', status: 'completed' };
  const base = {
    schemaVersion: '1.0.0', sessionId: session.session_id, protocolId: protocol.protocolId,
    protocolVersion: 1, nodeId: protocol.graph.nodes[0].id, componentType: 'core.start', componentVersion: '1.0.0',
    timestampIso: '2026-08-22T00:00:00.000Z', timestampEpochMs: 1000, elapsedMonotonicMs: 0, payload: {},
  };
  const events = [
    { ...base, eventId: 'event_1', sequence: 1, eventType: 'protocol_started' },
    { ...base, eventId: 'event_2', sequence: 2, eventType: 'protocol_completed', nodeId: protocol.graph.nodes[1].id, componentType: 'core.end', elapsedMonotonicMs: 10 },
  ];
  return { protocol, session, events };
}

test('Runtime V2 event schema registry validates standard envelopes', () => {
  const { events } = fixture();
  const registry = createEventSchemaRegistry(createCoreComponentRegistry());
  assert.equal(validateRuntimeEvent(events[0], registry).valid, true);
  assert.equal(registry.has('component_completed'), true);
  assert.equal(registry.has('response_submitted'), true);
});

test('graph export includes raw records, normalized tables, manifests, dictionary, and quality report', () => {
  const { protocol, session, events } = fixture();
  const responses = [{ responseId: 'response_1', sessionId: 'session_1', participantId: 'P,001', protocolId: protocol.protocolId, nodeId: 'node_x', componentType: 'input.text', name: 'comment', value: 'hello, world', timestampIso: '2026-08-22T00:00:01.000Z' }];
  const runtime = { status: 'completed' };
  const device_events = [{ schemaVersion: '1.0.0', eventId: 'device_event_1', sequence: 1, sessionId: session.session_id, eventType: 'device_sample_received', timestampIso: '2026-08-22T00:00:00.500Z', timestampEpochMs: 1500, elapsedMonotonicMs: 500, connector: { id: 'org.example.sensor', version: '1.0.0', transport: 'serial' }, device: { deviceId: 'SENSOR-1' }, payload: { channelId: 'signal', value: 2.5, unit: 'mV' } }];
  const files = buildGraphSessionFiles({ ...session, runtime_snapshot: runtime, device_events }, protocol, events, responses);

  for (const name of ['events.jsonl', 'responses.jsonl', 'device_events.jsonl', 'events.csv', 'responses.csv', 'device_events.csv', 'data_dictionary.json', 'event_schema_registry.json', 'component_manifest.json', 'asset_manifest.json', 'quality_report.json', 'protocol_snapshot.json', 'runtime_snapshot.json', 'manifest.json']) assert.ok(files[name], name);
  assert.match(files['events.csv'], /"P,001"/);
  assert.match(files['responses.csv'], /hello, world/);
  assert.match(files['device_events.csv'], /SENSOR-1/);
  assert.equal(JSON.parse(files['manifest.json']).counts.deviceEvents, 1);
  assert.equal(JSON.parse(files['quality_report.json']).validity_status, 'valid');
});

test('graph integrity rejects sequence gaps and backwards monotonic time', () => {
  const { protocol, session, events } = fixture();
  events[1].sequence = 3;
  events[1].elapsedMonotonicMs = -1;
  const result = assessGraphSession({ session, protocol, events, runtime: { status: 'completed' } });
  assert.equal(result.validity_status, 'invalid');
  assert.ok(result.errors.some(error => error.includes('sequence gap')));
  assert.ok(result.errors.some(error => error.includes('backwards')));
});

test('normalized event rows retain complete payload objects for CSV JSON projection', () => {
  const { session, events } = fixture();
  events[0].payload = { nested: { value: 3 } };
  assert.deepEqual(normalizeGraphEvents(session, events)[0].payload_json, { nested: { value: 3 } });
});
