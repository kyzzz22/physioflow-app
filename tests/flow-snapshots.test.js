import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_FLOW_SNAPSHOTS, mergeFlowSnapshot, withoutFlowSnapshot } from '../src/core/index.js';

test('mergeFlowSnapshot upserts by id and caps at the maximum', () => {
  let snapshots = [];
  for (let i = 0; i < MAX_FLOW_SNAPSHOTS + 5; i++) {
    snapshots = mergeFlowSnapshot(snapshots, { id: `s${i}`, name: `S${i}`, nodes: [] });
  }
  assert.equal(snapshots.length, MAX_FLOW_SNAPSHOTS);
  assert.equal(snapshots.at(-1).id, `s${MAX_FLOW_SNAPSHOTS + 4}`);
  // upsert replaces by id, keeps position at end
  snapshots = mergeFlowSnapshot(snapshots, { id: 's1', name: 'Updated', nodes: [] });
  assert.equal(snapshots.length, MAX_FLOW_SNAPSHOTS);
  assert.equal(snapshots.at(-1).name, 'Updated');
});

test('withoutFlowSnapshot removes a snapshot by id', () => {
  const snapshots = mergeFlowSnapshot(mergeFlowSnapshot([], { id: 'a', name: 'A' }), { id: 'b', name: 'B' });
  const next = withoutFlowSnapshot(snapshots, 'a');
  assert.deepEqual(next.map(item => item.id), ['b']);
});
