import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGraphBidsBundle } from '../src/data/index.js';
import { createProtocolGraph, createSequentialIdFactory } from '../src/core/index.js';

function fixture() {
  const ids = createSequentialIdFactory();
  const protocol = createProtocolGraph({ idFactory: ids, name: 'Stroop Task', now: '2026-08-23T00:00:00.000Z' });
  return protocol;
}

test('BIDS bundle projects graph events into BIDS events files', () => {
  const protocol = fixture();
  const session = { session_id: 'S1', participant_id: 'P01', status: 'completed' };
  const events = [
    { eventId: 'e1', sequence: 1, sessionId: 'S1', protocolId: protocol.protocolId, protocolVersion: 1, nodeId: 'n1', componentType: 'display.screen', componentVersion: '1.0.0', eventType: 'protocol_started', timestampIso: 't', timestampEpochMs: 1, elapsedMonotonicMs: 0, payload: {} },
    { eventId: 'e2', sequence: 2, sessionId: 'S1', protocolId: protocol.protocolId, protocolVersion: 1, nodeId: 'n2', componentType: 'input.rating', componentVersion: '1.0.0', eventType: 'response_submitted', timestampIso: 't', timestampEpochMs: 2, elapsedMonotonicMs: 500, payload: { value: 5 } },
    { eventId: 'e3', sequence: 3, sessionId: 'S1', protocolId: protocol.protocolId, protocolVersion: 1, nodeId: 'n3', componentType: 'core.end', componentVersion: '1.0.0', eventType: 'protocol_completed', timestampIso: 't', timestampEpochMs: 3, elapsedMonotonicMs: 700, payload: {} },
  ];
  const responses = [{ nodeId: 'n2', name: 'value', value: 5, is_correct: true }];
  const bundle = buildGraphBidsBundle(session, protocol, events, responses);
  const tsvPath = Object.keys(bundle).find(key => key.endsWith('_events.tsv'));
  assert.ok(tsvPath, 'has a BIDS events .tsv');
  assert.ok(tsvPath.startsWith('sub-P01/ses-S1/func/'), `BIDS path structure ${tsvPath}`);
  const tsv = bundle[tsvPath];
  assert.match(tsv, /^onset,duration,sample,trial_type,component_type,node_id,stim_file,value,accuracy\n/);
  assert.match(tsv, /response_submitted/);
  assert.match(tsv, /^0\.000,0\.500,0,protocol_started,display\.screen,n1,,,/m);
  assert.match(tsv, /^0\.500,0\.200,500,response_submitted,input\.rating,n2,,5,1/m);
  assert.ok(bundle['participants.tsv'].includes('P01'));
  assert.ok(bundle['dataset_description.json'].includes('"BIDSVersion": "1.8.0"'));
});
