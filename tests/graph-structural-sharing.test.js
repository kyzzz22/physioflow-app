import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode,
  createEdge,
  createNode,
  createProtocolGraph,
  createSequentialIdFactory,
  duplicateNode,
  moveNodes,
  removeNode,
  updateNode,
} from '../src/core/index.js';

// Structural sharing (D8 follow-up): moveNodes/updateNode copy only the path to
// graph.nodes and share the rest. That is safe only if the previous snapshot is
// never mutated, so these tests pin down exactly that contract.

function buildProtocol() {
  const protocol = createProtocolGraph({ idFactory: createSequentialIdFactory(), name: 'sharing', now: '2026-08-29T00:00:00.000Z' });
  const extra = createNode('timing.wait', {
    id: 'wait_a',
    label: 'Wait A',
    config: { durationMs: 100, nested: { keep: true } },
    layout: { x: 10, y: 20 },
  });
  protocol.graph.nodes = [...protocol.graph.nodes, extra];
  protocol.graph.edges = [
    ...protocol.graph.edges,
    createEdge('control', { nodeId: 'wait_a', portId: 'next' }, { nodeId: protocol.graph.nodes[1].id, portId: 'in' }, { id: 'edge_a' }),
  ];
  return protocol;
}

const snapshot = protocol => JSON.stringify(protocol);

test('updateNode leaves the previous snapshot untouched', () => {
  const protocol = buildProtocol();
  const before = snapshot(protocol);
  const updated = updateNode(protocol, 'wait_a', { label: 'Renamed' });

  assert.equal(snapshot(protocol), before, 'the input protocol must not change');
  assert.equal(updated.graph.nodes.find(n => n.id === 'wait_a').label, 'Renamed');
  assert.notEqual(updated, protocol, 'a new object must be returned');
});

test('moveNodes leaves the previous snapshot untouched', () => {
  const protocol = buildProtocol();
  const before = snapshot(protocol);
  const moved = moveNodes(protocol, { wait_a: { x: 999, y: 888 } });

  assert.equal(snapshot(protocol), before, 'the input protocol must not change');
  assert.deepEqual(
    { x: moved.graph.nodes.find(n => n.id === 'wait_a').layout.x, y: moved.graph.nodes.find(n => n.id === 'wait_a').layout.y },
    { x: 999, y: 888 },
  );
});

test('untouched nodes are shared, which is what makes the edit cheap', () => {
  const protocol = buildProtocol();
  const updated = updateNode(protocol, 'wait_a', { label: 'Renamed' });

  const originalOther = protocol.graph.nodes.find(n => n.id !== 'wait_a');
  const updatedOther = updated.graph.nodes.find(n => n.id === originalOther.id);
  assert.equal(originalOther, updatedOther, 'an untouched node should be shared by reference');
  assert.equal(protocol.graph.edges, updated.graph.edges, 'edges are shared when no edge changed');
});

test('the edited node is a new object, not the shared original', () => {
  const protocol = buildProtocol();
  const before = protocol.graph.nodes.find(n => n.id === 'wait_a');
  const updated = updateNode(protocol, 'wait_a', { label: 'Renamed' });
  const after = updated.graph.nodes.find(n => n.id === 'wait_a');

  assert.notEqual(before, after, 'the edited node must be replaced, not mutated');
  assert.equal(before.label, 'Wait A', 'the original node keeps its value');
  assert.equal(after.label, 'Renamed');
  // Only the replaced node's own object is new; sub-objects the patch did not
  // touch stay shared, which is the whole point of the optimisation.
  assert.equal(before.config, after.config, 'config is untouched, so it stays shared');
  assert.equal(before.layout, after.layout, 'layout is untouched, so it stays shared');
});

test('moving a node replaces its layout without touching the original', () => {
  const protocol = buildProtocol();
  const before = protocol.graph.nodes.find(n => n.id === 'wait_a');
  const beforeLayout = { ...before.layout };
  const moved = moveNodes(protocol, { wait_a: { x: 999, y: 888 } });
  const after = moved.graph.nodes.find(n => n.id === 'wait_a');

  assert.deepEqual(before.layout, beforeLayout, 'the original layout is untouched');
  assert.notEqual(before.layout, after.layout, 'a moved node gets a new layout object');
  assert.deepEqual(after.layout, { x: 999, y: 888 });
  // The rest of the moved node is still shared.
  assert.equal(before.config, after.config);
});

test('a patch object the caller keeps mutating cannot leak into the protocol', () => {
  const protocol = buildProtocol();
  const patch = { label: 'First', config: { durationMs: 1, nested: { keep: true } } };
  const updated = updateNode(protocol, 'wait_a', patch);

  // The caller reuses the object; the stored value must not follow it.
  patch.label = 'Changed afterwards';
  patch.config.durationMs = 4242;

  const stored = updated.graph.nodes.find(n => n.id === 'wait_a');
  assert.equal(stored.label, 'First');
  assert.equal(stored.config.durationMs, 1);
});

test('a changes() function may mutate its draft without touching the stored node', () => {
  const protocol = buildProtocol();
  const updated = updateNode(protocol, 'wait_a', (draft) => {
    draft.label = 'From draft';
    draft.config.durationMs = 77;
    return draft;
  });

  const original = protocol.graph.nodes.find(n => n.id === 'wait_a');
  assert.equal(original.label, 'Wait A', 'the original node is untouched');
  assert.equal(original.config.durationMs, 100, 'the original config is untouched');

  const stored = updated.graph.nodes.find(n => n.id === 'wait_a');
  assert.equal(stored.label, 'From draft');
  assert.equal(stored.config.durationMs, 77);
});

test('sequential edits do not leak between snapshots', () => {
  let protocol = buildProtocol();
  const first = updateNode(protocol, 'wait_a', { label: 'One' });
  const second = updateNode(first, 'wait_a', { label: 'Two' });
  const moved = moveNodes(second, { wait_a: { x: 5, y: 6 } });

  assert.equal(protocol.graph.nodes.find(n => n.id === 'wait_a').label, 'Wait A');
  assert.equal(first.graph.nodes.find(n => n.id === 'wait_a').label, 'One');
  assert.equal(second.graph.nodes.find(n => n.id === 'wait_a').label, 'Two');
  assert.equal(moved.graph.nodes.find(n => n.id === 'wait_a').label, 'Two');
  assert.deepEqual(moved.graph.nodes.find(n => n.id === 'wait_a').layout, { x: 5, y: 6 });
});

test('a shared protocol still survives commands that clone defensively', () => {
  // duplicateNode pushes into a group's nodeIds, which is exactly the in-place
  // mutation that made a global shallow copy unsafe. It must stay correct when
  // handed a structurally shared protocol.
  let protocol = buildProtocol();
  protocol = updateNode(protocol, 'wait_a', { label: 'Ready' });
  const duplicated = duplicateNode(protocol, 'wait_a', { id: 'wait_a_copy', label: 'Copy' });

  assert.equal(duplicated.protocol.graph.nodes.filter(n => n.id === 'wait_a_copy').length, 1);
  assert.equal(protocol.graph.nodes.filter(n => n.id === 'wait_a_copy').length, 0,
    'the previous snapshot must not gain the duplicated node');
  assert.equal(protocol.graph.nodes.find(n => n.id === 'wait_a').label, 'Ready');
});

test('editing after addNode and removeNode keeps snapshots independent', () => {
  let protocol = buildProtocol();
  const added = addNode(protocol, 'timing.wait', { id: 'wait_b', label: 'B' });
  const removed = removeNode(added.protocol, 'wait_a');
  const edited = updateNode(removed, 'wait_b', { label: 'B renamed' });

  assert.equal(protocol.graph.nodes.some(n => n.id === 'wait_b'), false, 'the original never gains the new node');
  assert.equal(added.protocol.graph.nodes.some(n => n.id === 'wait_b'), true);
  assert.equal(removed.graph.nodes.some(n => n.id === 'wait_a'), false);
  assert.equal(edited.graph.nodes.find(n => n.id === 'wait_b').label, 'B renamed');
  assert.equal(added.protocol.graph.nodes.find(n => n.id === 'wait_b').label, 'B', 'the earlier snapshot keeps its label');
});

test('audit is updated on the new object without mutating the old one', () => {
  const protocol = buildProtocol();
  const beforeAudit = protocol.audit?.updatedAt;
  const updated = updateNode(protocol, 'wait_a', { label: 'Renamed' }, { now: '2026-08-29T12:00:00.000Z' });

  assert.equal(updated.audit.updatedAt, '2026-08-29T12:00:00.000Z');
  assert.equal(protocol.audit?.updatedAt, beforeAudit, 'the original audit is untouched');
  assert.notEqual(protocol.audit, updated.audit);
});
