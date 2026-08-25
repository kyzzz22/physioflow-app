import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_FLOW_SNAPSHOTS, loadFlowSnapshots, mergeFlowSnapshot, renameFlowSnapshot, saveFlowSnapshot, withoutFlowSnapshot } from '../src/core/index.js';

const storage = new Map();
globalThis.localStorage = {
  getItem: key => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
  clear: () => storage.clear(),
};

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

test('renameFlowSnapshot renames in place and ignores unknown ids / blank names', () => {
  storage.clear();
  saveFlowSnapshot('proto-rename', { id: 's1', name: 'Old', savedAt: 'x', graph: { nodes: [] } });
  let snapshots = renameFlowSnapshot('proto-rename', 's1', 'New Name');
  assert.equal(snapshots[0].name, 'New Name');
  assert.deepEqual(loadFlowSnapshots('proto-rename').map(item => item.name), ['New Name']);
  assert.equal(renameFlowSnapshot('proto-rename', 'nope', 'X').length, 1);
  assert.equal(renameFlowSnapshot('proto-rename', 's1', '   ')[0].name, 'New Name');
});
