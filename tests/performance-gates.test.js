import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createCoreComponentRegistry, createEdge, createNode, createProtocolGraph, createSequentialIdFactory, moveNodes, participantUiTemplate, validateProtocolGraphConfiguration } from '../src/core/index.js';
import { buildGraphSessionFiles } from '../src/data/index.js';

test('performance gate: validate and edit a 500-node Protocol Graph', () => {
  const protocol = createProtocolGraph({ idFactory: createSequentialIdFactory(), name: '500 node gate', now: '2026-08-23T00:00:00.000Z' });
  const start = protocol.graph.nodes[0];
  const end = protocol.graph.nodes[1];
  const waits = Array.from({ length: 498 }, (_, index) => createNode('timing.wait', {
    id: `wait_${index + 1}`,
    label: `Wait ${index + 1}`,
    config: { durationMs: 1, ui: participantUiTemplate('instruction') },
    layout: { x: 280 + index * 18, y: 180 + (index % 4) * 140 },
  }));
  const nodes = [start, ...waits, end];
  protocol.graph.nodes = nodes;
  protocol.graph.edges = nodes.slice(0, -1).map((node, index) => createEdge('control', { nodeId: node.id, portId: 'next' }, { nodeId: nodes[index + 1].id, portId: 'in' }, { id: `perf_edge_${index + 1}` }));
  end.layout.x = 280 + waits.length * 18;

  const started = performance.now();
  const validation = validateProtocolGraphConfiguration(protocol, createCoreComponentRegistry());
  const moved = moveNodes(protocol, { wait_250: { x: 5000, y: 600 } });
  const elapsedMs = performance.now() - started;
  assert.equal(validation.valid, true, JSON.stringify(validation.errors.slice(0, 3)));
  assert.equal(moved.graph.nodes.find(node => node.id === 'wait_250').layout.x, 5000);
  assert.ok(elapsedMs < 2000, `500-node validation/edit took ${elapsedMs.toFixed(1)}ms`);
});

test('performance gate: export a 10,000-event graph session', () => {
  const protocol = createProtocolGraph({ idFactory: createSequentialIdFactory(), name: '10k event gate', now: '2026-08-23T00:00:00.000Z' });
  const session = { session_id: 'session_10k', participant_id: 'PERF-001', status: 'completed', runtime_snapshot: { status: 'completed' } };
  const events = Array.from({ length: 10000 }, (_, index) => ({
    schemaVersion: '1.0.0', eventId: `event_${index + 1}`, sequence: index + 1,
    sessionId: session.session_id, protocolId: protocol.protocolId, protocolVersion: 1,
    nodeId: protocol.graph.nodes[index === 9999 ? 1 : 0].id,
    componentType: index === 9999 ? 'core.end' : 'core.start', componentVersion: '1.0.0',
    eventType: index === 0 ? 'protocol_started' : index === 9999 ? 'protocol_completed' : 'ui_action',
    timestampIso: new Date(1000 + index).toISOString(), timestampEpochMs: 1000 + index,
    elapsedMonotonicMs: index, payload: index > 0 && index < 9999 ? { action: 'performance_marker', index } : {},
  }));
  const started = performance.now();
  const files = buildGraphSessionFiles(session, protocol, events, []);
  const elapsedMs = performance.now() - started;
  assert.equal(files['events.jsonl'].split('\n').filter(Boolean).length, 10000);
  assert.equal(JSON.parse(files['manifest.json']).counts.events, 10000);
  assert.ok(elapsedMs < 3000, `10,000-event export took ${elapsedMs.toFixed(1)}ms`);
});
