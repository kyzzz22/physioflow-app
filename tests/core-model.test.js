import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode,
  ComponentRegistry,
  connect,
  createCoreComponentRegistry,
  createNode,
  createProtocolGraph,
  createSequentialIdFactory,
  createNextGraphProtocolVersion,
  duplicateGraphProtocolAsProject,
  insertNodeOnControlEdge,
  removeNode,
  serializeProtocolGraph,
  validateComponentDefinition,
  validateProtocolGraph,
} from '../src/core/index.js';
import { inspectLegacyProtocolV1, migrateLegacyProtocolV1 } from '../src/legacy/migrateProtocolV1.js';

const buildGraph = () => createProtocolGraph({
  idFactory: createSequentialIdFactory(),
  now: '2026-08-22T00:00:00.000Z',
  name: 'Core model test',
});

test('new protocol graph has one start, one end and a valid control edge', () => {
  const protocol = buildGraph();
  const registry = createCoreComponentRegistry();
  const result = validateProtocolGraph(protocol, registry);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(protocol.graph.nodes.length, 2);
  assert.equal(protocol.graph.edges.length, 1);
  assert.equal(protocol.graph.entryNodeId, protocol.graph.nodes[0].id);
});

test('graph versions preserve projects while duplicates receive isolated project identities', () => {
  const source = buildGraph();
  const ids = createSequentialIdFactory();
  const version = createNextGraphProtocolVersion(source, { idFactory: ids, now: '2026-08-23T00:00:00.000Z' });
  const duplicate = duplicateGraphProtocolAsProject(source, { idFactory: ids, now: '2026-08-23T00:00:00.000Z' });

  assert.equal(version.projectId, source.projectId);
  assert.notEqual(version.protocolId, source.protocolId);
  assert.equal(version.version.number, 2);
  assert.equal(duplicate.version.number, 1);
  assert.notEqual(duplicate.projectId, source.projectId);
  assert.match(duplicate.metadata.name, /Copy$/);
});

test('component definitions reject duplicate and invalid ports', () => {
  const result = validateComponentDefinition({
    type: 'test.invalid', version: '1.0.0', label: 'Invalid',
    ports: [
      { id: 'value', kind: 'data', direction: 'input' },
      { id: 'value', kind: 'mystery', direction: 'sideways' },
    ],
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /Duplicate component port/);
  assert.match(result.errors.join('\n'), /invalid kind/);
  assert.match(result.errors.join('\n'), /invalid direction/);
});

test('registry isolates stored definitions from callers', () => {
  const registry = new ComponentRegistry();
  const definition = { type: 'test.component', version: '1.0.0', label: 'Test', ports: [] };
  registry.register(definition);
  definition.label = 'Mutated';
  const listed = registry.list();
  listed[0].label = 'Also mutated';
  assert.equal(registry.get('test.component').label, 'Test');
});

test('graph commands are immutable and remove attached edges with a node', () => {
  const protocol = buildGraph();
  const originalJson = JSON.stringify(protocol);
  const edgeId = protocol.graph.edges[0].id;
  const inserted = insertNodeOnControlEdge(protocol, edgeId, 'timing.wait', {
    idFactory: createSequentialIdFactory(100),
    now: '2026-08-22T00:00:01.000Z',
  });
  assert.equal(JSON.stringify(protocol), originalJson);
  assert.equal(inserted.protocol.graph.nodes.length, 3);
  assert.equal(inserted.protocol.graph.edges.length, 2);

  const removed = removeNode(inserted.protocol, inserted.node.id, { now: '2026-08-22T00:00:02.000Z' });
  assert.equal(removed.graph.nodes.length, 2);
  assert.equal(removed.graph.edges.length, 0);
});

test('validation reports unknown components and missing edge endpoints', () => {
  const protocol = buildGraph();
  protocol.graph.nodes.push(createNode('unknown.component', { id: 'node_unknown' }));
  protocol.graph.edges.push({
    id: 'edge_broken', kind: 'control',
    source: { nodeId: 'node_unknown', portId: 'next' },
    target: { nodeId: 'node_missing', portId: 'in' },
  });
  const result = validateProtocolGraph(protocol, createCoreComponentRegistry());
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.code === 'node.component_unknown'));
  assert.ok(result.errors.some(error => error.code === 'edge.target_missing'));
});

test('data edges enforce port data types', () => {
  const protocol = buildGraph();
  const registry = createCoreComponentRegistry();
  registry.register({
    type: 'test.string-consumer', version: '1.0.0', label: 'String consumer',
    ports: [{ id: 'value', kind: 'data', direction: 'input', dataType: 'string', required: true }],
  });
  const rating = addNode(protocol, 'input.rating', { id: 'node_rating' }).protocol;
  const withConsumer = addNode(rating, 'test.string-consumer', { id: 'node_consumer' }).protocol;
  const connected = connect(
    withConsumer,
    'data',
    { nodeId: 'node_rating', portId: 'value' },
    { nodeId: 'node_consumer', portId: 'value' },
    { id: 'edge_data' },
  ).protocol;
  const result = validateProtocolGraph(connected, registry);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.code === 'edge.data_type_mismatch'));
});

test('required data ports can be satisfied by a variable binding', () => {
  const protocol = buildGraph();
  const condition = addNode(protocol, 'logic.condition', {
    id: 'node_condition',
    bindings: { value: { kind: 'variable', variable: 'score' } },
  }).protocol;
  condition.variables.push({ name: 'score', type: 'number', scope: 'session', defaultValue: 0 });
  const result = validateProtocolGraph(condition, createCoreComponentRegistry());
  assert.ok(!result.errors.some(error => error.code === 'port.required_unbound'));
});

test('protocol graph serialization is canonical', () => {
  const left = buildGraph();
  const right = { ...left, metadata: { tags: [], description: '', name: 'Core model test' } };
  assert.equal(serializeProtocolGraph(left), serializeProtocolGraph(right));
});

test('legacy inspection identifies non-linear semantics and custom code', () => {
  const legacy = {
    schema_version: '1.0.0', protocol_id: 'old_protocol', project_id: 'old_project', name: 'Legacy',
    blocks: [{ block_id: 'block_1', order_rule: 'random', repeat_count: 2, trials: [{
      trial_id: 'trial_1', repeat_count: 1,
      flow: { nodes: [{ id: 'condition_1', type: 'condition' }], edges: [] },
      steps: [{ step_id: 'step_1', type: 'custom_html', name: 'Custom', html: '<p>test</p>', appearance: {} }],
    }] }],
  };
  const report = inspectLegacyProtocolV1(legacy);
  assert.equal(report.counts.steps, 1);
  assert.equal(report.counts.customCode, 1);
  assert.equal(report.requiresReview, true);
  assert.ok(report.issues.some(item => item.code === 'block.order_requires_semantic_migration'));
  assert.ok(report.issues.some(item => item.code === 'trial.control_flow_requires_review'));
});

test('legacy migration preserves every step payload and creates a safe linear draft', () => {
  const legacy = {
    schema_version: '1.0.0', protocol_id: 'old_protocol', project_id: 'old_project', name: 'Legacy', version: 3,
    blocks: [{ block_id: 'block_1', order_rule: 'fixed', repeat_count: 1, trials: [{
      trial_id: 'trial_1', repeat_count: 1,
      steps: [
        { step_id: 'step_1', type: 'instruction', name: 'Welcome', content: 'Hello', content_i18n: { en: 'Hello' }, duration_mode: 'manual' },
        { step_id: 'step_2', type: 'image', name: 'Stimulus', source_mode: 'upload', asset_id: 'asset_1', planned_duration_ms: 2000, duration_mode: 'fixed' },
      ],
    }] }],
    stimuli: [{ stimulus_id: 'asset_1', name: 'Image' }], questionnaires: [], theme: { primary_color: '#197453' },
  };
  const sourceBefore = structuredClone(legacy);
  const { protocol, report } = migrateLegacyProtocolV1(legacy, {
    idFactory: createSequentialIdFactory(),
    now: '2026-08-22T00:00:00.000Z',
  });
  assert.deepEqual(legacy, sourceBefore);
  assert.equal(protocol.graph.nodes.length, 4);
  assert.equal(protocol.graph.edges.length, 3);
  assert.equal(protocol.graph.nodes[1].component.type, 'core.end');
  assert.equal(protocol.graph.nodes[2].config.legacyStep.content, 'Hello');
  assert.equal(protocol.graph.nodes[3].config.legacyStep.asset_id, 'asset_1');
  assert.equal(report.formalRunAllowed, false);
  assert.equal(report.executionMode, 'linear-safe-draft');
  assert.equal(report.idMap.steps.step_1, protocol.graph.nodes[2].id);
  assert.equal(validateProtocolGraph(protocol, createCoreComponentRegistry()).valid, true);
});
