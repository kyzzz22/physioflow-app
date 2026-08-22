import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoreComponentRegistry, createProtocolGraph, createSequentialIdFactory, freezeProtocolGraph, insertNodeOnControlEdge, participantUiTemplate, validateProtocolGraphConfiguration } from '../src/core/index.js';
import { buildGraphSessionFiles } from '../src/data/index.js';
import { completeCurrentNode, createRuntimeState, restoreRuntime, snapshotRuntime, startRuntime } from '../src/runtime/index.js';

function services() {
  let event = 0;
  return {
    idFactory: prefix => `${prefix}_${++event}`,
    clock: { now: () => ({ epochMs: 1000 + event, monotonicMs: 500 + event, iso: new Date(1000 + event).toISOString() }) },
  };
}

test('refactor E2E: compose, validate, freeze, run, restore, and export', async () => {
  const ids = createSequentialIdFactory();
  let protocol = createProtocolGraph({ idFactory: ids, name: 'Refactor E2E', now: '2026-08-23T00:00:00.000Z' });
  let edgeId = protocol.graph.edges[0].id;
  const screen = insertNodeOnControlEdge(protocol, edgeId, 'display.screen', {
    idFactory: ids, label: 'Instructions',
    config: { ui: participantUiTemplate('instruction'), completion: { mode: 'manual' } },
  });
  protocol = screen.protocol;
  edgeId = protocol.graph.edges.find(edge => edge.source.nodeId === screen.node.id).id;
  const rating = insertNodeOnControlEdge(protocol, edgeId, 'input.rating', {
    idFactory: ids, label: 'Rating',
    config: { min: 1, max: 7, required: true, ui: participantUiTemplate('form') },
  });
  protocol = rating.protocol;
  const registry = createCoreComponentRegistry();
  assert.equal(validateProtocolGraphConfiguration(protocol, registry).valid, true);
  protocol = await freezeProtocolGraph(protocol, registry, { now: '2026-08-23T01:00:00.000Z' });

  const session = { session_id: 'session_e2e', participant_id: 'E2E-001', status: 'completed' };
  const svc = services();
  const initial = createRuntimeState(protocol, { sessionId: session.session_id, startedAtEpochMs: 1000, startedAtMonotonicMs: 500, randomSeed: 'e2e-seed' });
  const started = startRuntime(initial, protocol, registry, svc);
  const afterScreen = completeCurrentNode(started.state, protocol, registry, svc, { outputs: { acknowledged: true } });
  const restored = restoreRuntime(snapshotRuntime(afterScreen.state), protocol);
  const afterRating = completeCurrentNode(restored, protocol, registry, svc, { outputs: { value: 5 }, variables: { rating: 5 } });
  const events = [...started.events, ...afterScreen.events, ...afterRating.events];
  const responses = [{ responseId: 'response_e2e', sessionId: session.session_id, participantId: session.participant_id, protocolId: protocol.protocolId, nodeId: rating.node.id, componentType: 'input.rating', name: 'value', value: 5, reactionTimeMs: 250, timestampIso: '2026-08-23T01:00:01.000Z' }];
  const files = buildGraphSessionFiles({ ...session, runtime_snapshot: afterRating.state }, protocol, events, responses);

  assert.equal(afterRating.state.status, 'completed');
  assert.equal(afterRating.state.variables.rating, 5);
  assert.equal(JSON.parse(files['quality_report.json']).validity_status, 'valid');
  assert.equal(JSON.parse(files['manifest.json']).counts.responses, 1);
  assert.match(files['responses.csv'], /reaction_time_ms/);
});
