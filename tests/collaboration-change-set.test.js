import test from 'node:test';
import assert from 'node:assert/strict';
import { createProtocolChangeSet, mergeProtocolChangeSet, validateProtocolChangeSet } from '../src/collaboration/index.js';
import { addNode, createProtocolGraph, createSequentialIdFactory, hashProtocolGraph, updateNode } from '../src/core/index.js';

function fixture() {
  const ids = createSequentialIdFactory();
  let protocol = createProtocolGraph({ idFactory: ids, name: 'Collaboration fixture', now: '2026-08-23T00:00:00.000Z' });
  const added = addNode(protocol, 'display.screen', { id: 'screen', label: 'Shared screen', config: { heading: 'Original', body: 'Base body' }, now: '2026-08-23T00:00:01.000Z' });
  protocol = added.protocol;
  return protocol;
}

test('change sets apply portable field-level and entity additions with audit provenance', async () => {
  const base = fixture();
  let edited = updateNode(base, 'screen', { config: { heading: 'Incoming heading', body: 'Base body' } }, { now: '2026-08-23T00:01:00.000Z' });
  edited = addNode(edited, 'timing.wait', { id: 'wait', label: 'Wait', config: { durationMs: 250 }, now: '2026-08-23T00:01:01.000Z' }).protocol;
  const changeSet = await createProtocolChangeSet(base, edited, { id: 'changeset_1', authorId: 'researcher-a', authorName: 'Researcher A', now: '2026-08-23T00:02:00.000Z' });
  assert.equal(validateProtocolChangeSet(changeSet).valid, true);
  assert.ok(changeSet.operations.some(operation => operation.target === 'graph.nodes' && operation.entityKey === 'screen' && operation.path.join('.') === 'config.heading'));
  assert.ok(changeSet.operations.some(operation => operation.target === 'graph.nodes' && operation.entityKey === 'wait' && operation.path.length === 0));
  const result = mergeProtocolChangeSet(base, changeSet, { now: '2026-08-23T00:03:00.000Z' });
  assert.equal(result.unresolved, 0);
  assert.equal(result.protocol.graph.nodes.find(node => node.id === 'screen').config.heading, 'Incoming heading');
  assert.ok(result.protocol.graph.nodes.some(node => node.id === 'wait'));
  assert.equal(result.protocol.collaboration.history[0].changeSetId, 'changeset_1');
  assert.equal(result.protocol.collaboration.history[0].author.id, 'researcher-a');
  assert.equal(await hashProtocolGraph(result.protocol), await hashProtocolGraph(edited));
  const repeated = mergeProtocolChangeSet(result.protocol, changeSet);
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.protocol.collaboration.history.length, 1);
});

test('independent local and incoming fields merge without a conflict', async () => {
  const base = fixture();
  const incoming = updateNode(base, 'screen', { config: { heading: 'Incoming heading', body: 'Base body' } });
  const local = updateNode(base, 'screen', { config: { heading: 'Original', body: 'Local body' } });
  const changeSet = await createProtocolChangeSet(base, incoming, { id: 'changeset_independent' });
  const result = mergeProtocolChangeSet(local, changeSet);
  const screen = result.protocol.graph.nodes.find(node => node.id === 'screen');
  assert.equal(result.unresolved, 0);
  assert.equal(screen.config.heading, 'Incoming heading');
  assert.equal(screen.config.body, 'Local body');
});

test('same-field collaboration conflicts require an explicit local or incoming resolution', async () => {
  const base = fixture();
  const incoming = updateNode(base, 'screen', { config: { heading: 'Incoming heading', body: 'Base body' } });
  const local = updateNode(base, 'screen', { config: { heading: 'Local heading', body: 'Base body' } });
  const changeSet = await createProtocolChangeSet(base, incoming, { id: 'changeset_conflict' });
  const preview = mergeProtocolChangeSet(local, changeSet);
  assert.equal(preview.unresolved, 1);
  assert.equal(preview.protocol.collaboration, undefined);
  const operationId = preview.conflicts[0].operationId;
  const keepLocal = mergeProtocolChangeSet(local, changeSet, { resolutions: { [operationId]: 'local' } });
  assert.equal(keepLocal.unresolved, 0);
  assert.equal(keepLocal.protocol.graph.nodes.find(node => node.id === 'screen').config.heading, 'Local heading');
  const acceptIncoming = mergeProtocolChangeSet(local, changeSet, { resolutions: { [operationId]: 'incoming' } });
  assert.equal(acceptIncoming.unresolved, 0);
  assert.equal(acceptIncoming.protocol.graph.nodes.find(node => node.id === 'screen').config.heading, 'Incoming heading');
  assert.equal(acceptIncoming.protocol.collaboration.history[0].resolvedConflicts, 1);
});

test('change sets reject frozen, cross-version and unsafe inputs', async () => {
  const base = fixture();
  const edited = updateNode(base, 'screen', { label: 'Edited' });
  const changeSet = await createProtocolChangeSet(base, edited, { id: 'changeset_safety' });
  assert.throws(() => mergeProtocolChangeSet({ ...base, version: { ...base.version, status: 'frozen' } }, changeSet), /editable protocol version/);
  assert.throws(() => mergeProtocolChangeSet({ ...base, version: { ...base.version, number: 2 } }, changeSet), /targets version 1/);
  const unsafe = structuredClone(changeSet);
  unsafe.operations[0].path = ['__proto__', 'polluted'];
  assert.equal(validateProtocolChangeSet(unsafe).valid, false);
  assert.throws(() => mergeProtocolChangeSet(base, unsafe), /unsafe path/);
  assert.equal({}.polluted, undefined);
  const identityChange = structuredClone(changeSet);
  identityChange.operations[0] = { ...identityChange.operations[0], target: '$protocol', entityKey: null, path: ['protocolId'] };
  assert.equal(validateProtocolChangeSet(identityChange).valid, false);
  const numericPath = structuredClone(changeSet);
  numericPath.operations[0].path = ['config', 'children', '0'];
  assert.equal(validateProtocolChangeSet(numericPath).valid, false);
});
