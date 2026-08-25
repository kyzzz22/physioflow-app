import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode,
  connect,
  createCoreComponentRegistry,
  createProtocolGraph,
  createSequentialIdFactory,
  validateComponentDefinition,
} from '../src/core/index.js';
import { completeCurrentNode, createRuntimeState, startRuntime } from '../src/runtime/index.js';
import { parseResponseOptionLine, parseResponseOptions, serializeResponseOptions } from '../src/core/responseOptions.js';
import { migrateLegacyProtocolV1 } from '../src/legacy/migrateProtocolV1.js';

// ── 1. Registry contract ──────────────────────────────────────────────────────
test('input.response registers with a valid definition and response-specific fields', () => {
  const registry = createCoreComponentRegistry();
  const definition = registry.get('input.response');
  assert.ok(definition, 'input.response is registered');
  assert.equal(validateComponentDefinition(definition).valid, true);
  assert.equal(definition.label, 'Response');
  assert.equal(definition.runtime.uiAdapter, 'response');
  assert.equal(definition.runtime.completion, 'submit');
  assert.deepEqual(definition.dataFields, ['value', 'response_key', 'reaction_time_ms', 'correct', 'timed_out']);
  const portIds = definition.ports.map(port => port.id);
  assert.ok(portIds.includes('in') && portIds.includes('next') && portIds.includes('value'));
  const valuePort = definition.ports.find(port => port.id === 'value');
  assert.equal(valuePort.direction, 'output');
  assert.equal(valuePort.dataType, 'string');
  const fields = Object.fromEntries(definition.editorFields.map(field => [field.path, field]));
  for (const key of ['variable', 'prompt', 'options', 'correctValue', 'feedbackMode', 'timeoutMs', 'autoAdvance', 'required']) {
    assert.ok(fields[key], `editorField '${key}' exists`);
  }
  assert.equal(fields.feedbackMode.type, 'select');
});

test('input.response default config provides a usable baseline', () => {
  const registry = createCoreComponentRegistry();
  const config = registry.get('input.response').defaultConfig;
  assert.equal(config.variable, 'response');
  assert.ok(Array.isArray(config.options) && config.options.length === 2);
  assert.equal(config.autoAdvance, true);
  assert.equal(config.required, true);
  assert.equal(config.timeoutMs, 0);
  assert.equal(config.feedbackMode, 'none');
  assert.ok(config.ui?.root, 'default participant UI template is present');
  const hasSubmit = (config.ui.root.children || []).some(element => element.type === 'Button' && (element.actions || []).some(action => ['submit', 'next'].includes(action.action)));
  assert.ok(hasSubmit, 'default UI ships a submit button');
});

// ── 2. Options parsing / serialization ───────────────────────────────────────
test('parseResponseOptions round-trips the line format', () => {
  const lines = 'yes=Yes,key=y\nno=No,key=n';
  const parsed = parseResponseOptions(lines);
  assert.deepEqual(parsed, [
    { value: 'yes', label: 'Yes', key: 'y' },
    { value: 'no', label: 'No', key: 'n' },
  ]);
  assert.equal(serializeResponseOptions(parsed), lines);
});

test('parseResponseOptions handles labels without keys and plain values', () => {
  assert.deepEqual(parseResponseOptions('one=One\ntwo'), [
    { value: 'one', label: 'One' },
    { value: 'two', label: 'two' },
  ]);
});

test('parseResponseOptions normalizes array input and skips blanks', () => {
  const parsed = parseResponseOptions([
    { value: 'a', label: 'A', key: '1' },
    'b=B',
    '',
    null,
  ]);
  assert.deepEqual(parsed, [
    { value: 'a', label: 'A', key: '1' },
    { value: 'b', label: 'B' },
  ]);
});

test('serializeResponseOptions omits redundant labels and drops empty lines', () => {
  const text = serializeResponseOptions([
    { value: 'same', label: 'same' },
    { value: 'v', label: 'Label', key: 'k' },
    null,
  ]);
  assert.equal(text, 'same\nv=Label,key=k');
});

test('parseResponseOptionLine tolerates junk input', () => {
  assert.equal(parseResponseOptionLine('   '), null);
  assert.equal(parseResponseOptionLine(''), null);
  assert.deepEqual(parseResponseOptionLine('x=1,key=9,junk=ignored'), { value: 'x', label: '1', key: '9' });
});

// ── 3. Legacy V1 migration ───────────────────────────────────────────────────
function legacyResponseProtocol() {
  return {
    schema_version: '1.0.0',
    protocol_id: 'proto_1',
    project_id: 'project_1',
    name: 'Response pilot',
    version: 1,
    blocks: [{
      block_id: 'block_1',
      name: 'Block 1',
      order: 1,
      trials: [{
        trial_id: 'trial_1',
        name: 'Trial 1',
        order: 1,
        steps: [
          { step_id: 'step_fix', type: 'fixation', name: 'Fixation', duration_mode: 'timed', planned_duration_ms: 800 },
          {
            step_id: 'step_resp', type: 'response', name: 'Respond',
            response_variable: 'pressed',
            response_required: true,
            response_auto_advance: true,
            response_options: [
              { value: 'yes', key: 'y', label: 'Yes' },
              { value: 'no', key: 'n', label: 'No' },
            ],
          },
        ],
      }],
    }],
  };
}

test('legacy response steps migrate to input.response with options preserved', () => {
  const { protocol: migrated } = migrateLegacyProtocolV1(legacyResponseProtocol(), { idFactory: createSequentialIdFactory(), now: '2026-08-22T00:00:00.000Z' });
  const nodes = migrated.graph.nodes;
  const response = nodes.find(node => node.component.type === 'input.response');
  assert.ok(response, 'response step maps to an input.response node');
  assert.equal(response.component.version, '1.0.0');
  assert.equal(response.config.variable, 'pressed');
  assert.equal(response.config.autoAdvance, true);
  assert.equal(response.config.required, true);
  assert.deepEqual(response.config.options, [
    { value: 'yes', key: 'y', label: 'Yes' },
    { value: 'no', key: 'n', label: 'No' },
  ]);
  assert.ok(response.config.legacyStep, 'original legacy step is preserved');
});

test('legacy response steps without explicit options keep free-form response', () => {
  const source = legacyResponseProtocol();
  const step = source.blocks[0].trials[0].steps[1];
  delete step.response_options;
  delete step.response_variable;
  const { protocol: migrated } = migrateLegacyProtocolV1(source, { idFactory: createSequentialIdFactory(), now: '2026-08-22T00:00:00.000Z' });
  const response = migrated.graph.nodes.find(node => node.component.type === 'input.response');
  assert.equal(response.config.variable, 'response');
  assert.deepEqual(response.config.options, []);
});

// ── 4. Runtime contract ──────────────────────────────────────────────────────
test('input.response declares the runtime contract consumed by ResponseRunner', () => {
  const registry = createCoreComponentRegistry();
  const definition = registry.get('input.response');
  assert.equal(definition.runtime.kind, 'participant');
  assert.equal(definition.runtime.completion, 'submit');
  for (const event of ['component_entered', 'key_pressed', 'response_submitted', 'response_timeout', 'component_completed']) {
    assert.ok(definition.events.includes(event), `emits ${event}`);
  }
});

test('an input.response node completes end-to-end through the submit path', () => {
  const registry = createCoreComponentRegistry();
  const idFactory = createSequentialIdFactory();
  const protocol = createProtocolGraph({ idFactory, name: 'response run', now: '2026-08-22T00:00:00.000Z' });
  const start = protocol.graph.nodes.find(node => node.component.type === 'core.start');
  const end = protocol.graph.nodes.find(node => node.component.type === 'core.end');
  protocol.graph.edges = [];
  const added = addNode(protocol, 'input.response', {
    id: 'n_response',
    label: 'Respond',
    config: {
      variable: 'pressed',
      prompt: 'Press the matching key',
      options: [
        { value: 'yes', key: 'y', label: 'Yes' },
        { value: 'no', key: 'n', label: 'No' },
      ],
      correctValue: 'yes',
      timeoutMs: 0,
      autoAdvance: true,
    },
  });
  let next = added.protocol;
  next = connect(next, 'control', { nodeId: start.id, portId: 'next' }, { nodeId: 'n_response', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'n_response', portId: 'next' }, { nodeId: end.id, portId: 'in' }).protocol;
  const svc = { idFactory, clock: { now: () => ({ epochMs: 1000, monotonicMs: 500, iso: '2026-08-22T00:00:00.000Z' }) } };
  let state = startRuntime(createRuntimeState(next, { sessionId: 's', startedAtEpochMs: 1000, startedAtMonotonicMs: 500, randomSeed: 'r' }), next, registry, svc).state;
  assert.equal(state.currentNodeId, 'n_response');
  state = completeCurrentNode(state, next, registry, svc, {
    outputs: {
      value: 'yes',
      response_key: 'y',
      reaction_time_ms: 812,
      correct: true,
      timed_out: false,
      pressed: 'yes',
    },
    variables: { pressed: 'yes', pressed_rt_ms: 812 },
  }).state;
  assert.equal(state.status, 'completed');
  assert.deepEqual(state.completedNodeIds, ['n_response']);
});
