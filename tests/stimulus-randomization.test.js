import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCoreComponentRegistry,
  createProtocolGraph,
  participantUiTemplate,
  resolveStimulusAssignments,
  validateProtocolGraphConfiguration,
  withStimulusAssignment,
} from '../src/core/index.js';
import { localResourceManifest, schemaForNode } from '../src/runtime/nodeSchema.js';

function fixture() {
  const protocol = createProtocolGraph({ name: 'Stimulus pool test' });
  protocol.assets = ['a', 'b', 'c'].map(id => ({ id, name: id.toUpperCase(), mediaType: 'image', sourceUrl: `https://example.test/${id}.png` }));
  protocol.stimulusPools = [{ id: 'main', name: 'Main stimuli', mediaType: 'image', assetIds: ['a', 'b', 'c'] }];
  const mediaConfig = id => ({
    mediaType: 'image',
    assetId: null,
    sourceUrl: '',
    stimulusPoolId: 'main',
    ui: participantUiTemplate('media'),
    completion: { mode: 'fixed', durationMs: 1000 },
    id,
  });
  protocol.graph.nodes.push(
    { id: 'slot-1', component: { type: 'display.media', version: '1.0.0' }, label: 'Slot 1', config: mediaConfig('slot-1'), bindings: {}, layout: { x: 0, y: 0 }, metadata: {} },
    { id: 'slot-2', component: { type: 'display.media', version: '1.0.0' }, label: 'Slot 2', config: mediaConfig('slot-2'), bindings: {}, layout: { x: 0, y: 0 }, metadata: {} },
    { id: 'slot-3', component: { type: 'display.media', version: '1.0.0' }, label: 'Slot 3', config: mediaConfig('slot-3'), bindings: {}, layout: { x: 0, y: 0 }, metadata: {} },
  );
  return protocol;
}

test('stimulus pools keep fixed slots and assign assets reproducibly without replacement', () => {
  const protocol = fixture();
  const first = resolveStimulusAssignments(protocol, 'session-seed');
  const repeated = resolveStimulusAssignments(protocol, 'session-seed');
  assert.deepEqual([...first], [...repeated]);
  assert.deepEqual([...first.keys()], ['slot-1', 'slot-2', 'slot-3']);
  assert.equal(new Set([...first.values()].map(value => value.assetId)).size, 3);

  const repeatedSlotProtocol = fixture();
  repeatedSlotProtocol.graph.nodes = repeatedSlotProtocol.graph.nodes.filter(node => node.id === 'slot-1' || node.component.type !== 'display.media');
  const draws = [1, 2, 3].map(attempt => resolveStimulusAssignments(repeatedSlotProtocol, 'session-seed', { 'slot-1': attempt }).get('slot-1').assetId);
  assert.equal(new Set(draws).size, 3, 'a looped media node draws without replacement before the pool repeats');
});

test('assigned media schema renders the selected asset and validation rejects undersized pools', () => {
  const protocol = fixture();
  const assignment = resolveStimulusAssignments(protocol, 'session-seed').get('slot-1');
  const node = withStimulusAssignment(protocol.graph.nodes.find(item => item.id === 'slot-1'), assignment);
  const schema = schemaForNode(node, createCoreComponentRegistry().get('display.media'), localResourceManifest(protocol.assets));
  const media = schema.root.children.find(item => item.type === 'Media');
  assert.equal(media.props.assetId, assignment.assetId);
  assert.equal(media.props.sourceUrl, assignment.sourceUrl);

  protocol.stimulusPools[0].assetIds = ['a', 'b'];
  const check = validateProtocolGraphConfiguration(protocol, createCoreComponentRegistry());
  assert.ok(check.errors.some(error => error.code === 'config.stimulus_pool_too_small'));
});
