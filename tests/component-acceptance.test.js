import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addNode,
  connect,
  createCoreComponentRegistry,
  createProtocolGraph,
  createSequentialIdFactory,
  validateComponentDefinition,
  validateParticipantUi,
  validateProtocolGraphConfiguration,
} from '../src/core/index.js';
import { localResourceManifest, schemaForNode } from '../src/runtime/nodeSchema.js';
import { completeCurrentNode, createCoreControlHandlerRegistry, createRuntimeState, startRuntime } from '../src/runtime/index.js';
import { generateStroopTrials } from '../src/core/index.js';

// ── Component inventory ──────────────────────────────────────────────────────
// Every core component with its runtime kind and participant UI adapter.
const COMPONENTS = [
  { type: 'core.start', kind: 'start', adapter: null },
  { type: 'core.end', kind: 'end', adapter: null },
  { type: 'display.screen', kind: 'participant', adapter: 'screen' },
  { type: 'display.media', kind: 'participant', adapter: 'media' },
  { type: 'input.rating', kind: 'participant', adapter: 'rating' },
  { type: 'input.text', kind: 'participant', adapter: 'text' },
  { type: 'input.response', kind: 'participant', adapter: 'response' },
  { type: 'input.questionnaire', kind: 'participant', adapter: 'schema' },
  { type: 'timing.wait', kind: 'participant', adapter: 'wait' },
  { type: 'stimulus.fixation', kind: 'participant', adapter: 'schema' },
  { type: 'stimulus.attention-check', kind: 'participant', adapter: 'schema' },
  { type: 'setup.device-check', kind: 'participant', adapter: 'schema' },
  { type: 'operator.manual-event', kind: 'participant', adapter: 'schema' },
  { type: 'stimulus.screen-calibration', kind: 'participant', adapter: 'schema' },
  { type: 'stimulus.custom-html', kind: 'participant', adapter: 'schema' },
  { type: 'utility.note', kind: 'participant', adapter: 'schema' },
  { type: 'utility.junction', kind: 'participant', adapter: 'schema' },
  { type: 'logic.condition', kind: 'condition', adapter: null },
  { type: 'logic.random', kind: 'random', adapter: null },
  { type: 'logic.value-switch', kind: 'handler', adapter: null },
  { type: 'logic.loop', kind: 'loop', adapter: null },
  { type: 'experiment.cognitive-task', kind: 'participant', adapter: 'none' },
  { type: 'legacy.step', kind: 'participant', adapter: 'schema' },
];

const PARTICIPANT_TYPES = COMPONENTS.filter(c => c.kind === 'participant').map(c => c.type);
const CONTROL_TYPES = COMPONENTS.filter(c => c.kind !== 'participant').map(c => c.type);

function withConfig(registry, type, overrides = {}) {
  return { ...structuredClone(registry.get(type)?.defaultConfig || {}), ...structuredClone(overrides) };
}

function services() {
  const idFactory = createSequentialIdFactory();
  let tick = 0;
  return {
    idFactory,
    clock: { now: () => { const n = tick++; return { epochMs: 1000 + n * 10, monotonicMs: 500 + n * 10, iso: new Date(1000 + n * 10).toISOString() }; } },
    controlHandlers: createCoreControlHandlerRegistry(),
  };
}

// Build a linear graph: start → [chain] → end. Returns { protocol, nodeIds }.
function linearGraph(registry, chain, idFactory) {
  const protocol = createProtocolGraph({ idFactory, name: 'acceptance', now: '2026-08-22T00:00:00.000Z' });
  const start = protocol.graph.nodes.find(node => node.component.type === 'core.start');
  const end = protocol.graph.nodes.find(node => node.component.type === 'core.end');
  protocol.graph.edges = [];
  let current = protocol;
  let previousId = start.id;
  const nodeIds = [];
  for (const type of chain) {
    const config = withConfig(registry, type);
    if (type === 'display.media') { config.sourceUrl = 'https://example.com/stimulus.mp4'; config.mediaType = 'video'; }
    if (type === 'setup.device-check') config.checklist = 'Electrodes attached\nSignal stable';
    if (type === 'stimulus.custom-html') config.html = '<h1>Custom</h1>';
    if (type === 'experiment.cognitive-task') config.trials = generateStroopTrials({ trials: 4, seed: 1 });
    if (type === 'legacy.step') config.legacyStep = { name: 'Legacy', type: 'timer' };
    const added = addNode(current, type, { id: `n_${type.replace(/\./g, '_')}`, label: type, config });
    current = added.protocol;
    nodeIds.push(added.node.id);
    current = connect(current, 'control', { nodeId: previousId, portId: 'next' }, { nodeId: added.node.id, portId: 'in' }).protocol;
    previousId = added.node.id;
  }
  current = connect(current, 'control', { nodeId: previousId, portId: 'next' }, { nodeId: end.id, portId: 'in' }).protocol;
  return { protocol: current, nodeIds };
}

function runtimeFor(protocol) {
  return createRuntimeState(protocol, { sessionId: 'acceptance-session', startedAtEpochMs: 1000, startedAtMonotonicMs: 500, randomSeed: 'acceptance' });
}

// ── 1. Registry contract matrix ──────────────────────────────────────────────
test('all 22 core components register with valid contracts', () => {
  const registry = createCoreComponentRegistry();
  const registeredTypes = new Set(registry.list().map(definition => definition.type));
  assert.equal(COMPONENTS.length, 23);
  for (const { type } of COMPONENTS) {
    const definition = registry.get(type);
    assert.ok(definition, `${type} is registered`);
    assert.equal(validateComponentDefinition(definition).valid, true, `${type} definition is valid`);
    for (const field of definition.editorFields || []) {
      // Fields guarded by showWhen that do not apply to the default config are fine
      // (they appear once the designer changes the triggering value).
      if (field.showWhen) {
        const actual = field.showWhen.path.split('.').reduce((cursor, key) => cursor?.[key], definition.defaultConfig);
        if (actual !== field.showWhen.equals) continue;
      }
      // The path's first segment must be a declared defaultConfig key (catches typos);
      // optional sub-paths (e.g. loop untilRule) may be null and get created by setPath.
      const first = field.path.split('.')[0];
      assert.ok(Object.prototype.hasOwnProperty.call(definition.defaultConfig, first), `${type} editorField '${field.path}' starts with a declared config key`);
    }
  }
  const unexpected = registry.list().map(definition => definition.type).filter(type => !COMPONENTS.some(item => item.type === type));
  assert.deepEqual(unexpected, [], 'registry should contain exactly the expected component set');
});

test('participant components declare a completion strategy that the runner can honor', () => {
  const registry = createCoreComponentRegistry();
  for (const type of PARTICIPANT_TYPES) {
    const definition = registry.get(type);
    const completion = definition.runtime?.completion;
    // Components with a custom runner (uiAdapter 'none') have no participant UI template.
    if (definition.runtime?.uiAdapter === 'none') continue;
    const ui = definition.defaultConfig?.ui;
    assert.ok(ui, `${type} provides a default participant UI`);
    // durationMs strategy must have a duration on the default config.
    if (completion === 'durationMs') {
      const duration = type === 'timing.wait' ? definition.defaultConfig.durationMs : definition.defaultConfig.completion?.durationMs;
      assert.ok(Number.isFinite(Number(duration)), `${type} durationMs strategy needs a default duration`);
    }
    // Manual completion or input components must ship a submit/next button so the
    // default node is usable without the UI builder.
    const requiresManualSubmit = ['input.rating', 'input.text', 'input.questionnaire'].includes(type) || definition.defaultConfig?.completion?.mode === 'manual';
    if (requiresManualSubmit) {
      const hasSubmit = (ui?.root?.children || []).some(element => element.type === 'Button' && (element.actions || []).some(action => ['submit', 'next'].includes(action.action)));
      assert.ok(hasSubmit, `${type} default UI needs a submit/next button for its ${definition.defaultConfig?.completion?.mode || completion} completion`);
    }
  }
});

// ── 2. schemaForNode participant UI validity ─────────────────────────────────
test('every participant component renders a valid participant UI via schemaForNode', () => {
  const registry = createCoreComponentRegistry();
  const resources = localResourceManifest([]);
  for (const type of PARTICIPANT_TYPES) {
    const definition = registry.get(type);
    const config = withConfig(registry, type);
    if (type === 'display.media') { config.sourceUrl = 'https://example.com/stimulus.mp4'; config.mediaType = 'video'; }
    if (type === 'setup.device-check') config.checklist = 'Electrodes attached\nSignal stable';
    if (type === 'stimulus.fixation') config.shape = 'dot';
    if (type === 'legacy.step') config.legacyStep = { name: 'Legacy', type: 'timer' };
    const node = { id: 'node', component: { type, version: '1.0.0' }, config, label: type };
    const schema = schemaForNode(node, definition, resources);
    const result = validateParticipantUi(schema);
    assert.equal(result.valid, true, `${type} schemaForNode UI valid: ${result.errors.map(error => error.message).join('; ')}`);
  }
});

// ── 3. Full-graph runtime execution ──────────────────────────────────────────
test('a linear graph of every participant component executes end-to-end', () => {
  const registry = createCoreComponentRegistry();
  const idFactory = createSequentialIdFactory();
  const { protocol, nodeIds } = linearGraph(registry, PARTICIPANT_TYPES, idFactory);
  const svc = services();
  let state = startRuntime(runtimeFor(protocol), protocol, registry, svc).state;
  assert.equal(state.status, 'waiting', 'runtime should stop on the first participant component');
  assert.equal(state.currentNodeId, nodeIds[0]);
  let guard = 0;
  while (state.status === 'waiting' && state.currentNodeId && guard++ < 60) {
    state = completeCurrentNode(state, protocol, registry, svc, { outputs: { done: true }, variables: {} }).state;
  }
  assert.equal(state.status, 'completed', 'all participant components complete through to End');
  assert.deepEqual(state.completedNodeIds, nodeIds, 'every component was entered and completed exactly once');
  assert.equal(state.skippedNodeIds.length, 0);
});

// ── 4. Full-graph formal validation ──────────────────────────────────────────
test('a graph containing every component passes formal validation', () => {
  const registry = createCoreComponentRegistry();
  const idFactory = createSequentialIdFactory();
  const { protocol } = linearGraph(registry, PARTICIPANT_TYPES, idFactory);
  const result = validateProtocolGraphConfiguration(protocol, registry);
  assert.equal(result.valid, true, `full graph valid: ${result.errors.map(error => error.message).join('; ')}`);
});

// ── 5. Control-flow components execute ───────────────────────────────────────
test('control components (condition/loop/random/value-switch/start/end) execute', () => {
  const registry = createCoreComponentRegistry();
  const svc = services();
  const idFactory = createSequentialIdFactory();

  // condition true/false routing
  const cond = createProtocolGraph({ idFactory: createSequentialIdFactory(), name: 'cond', now: '2026-08-22T00:00:00.000Z' });
  const cs = cond.graph.nodes.find(node => node.component.type === 'core.start');
  const ce = cond.graph.nodes.find(node => node.component.type === 'core.end');
  cond.graph.edges = [];
  const cNode = addNode(cond, 'logic.condition', { id: 'c1', config: { operator: 'greater_than', expected: 5 }, bindings: { value: { kind: 'variable', variable: 'score' } } });
  const tgt = addNode(cNode.protocol, 'display.screen', { id: 'tgt', label: 'T' });
  let cp = connect(tgt.protocol, 'control', { nodeId: cs.id, portId: 'next' }, { nodeId: 'c1', portId: 'in' }).protocol;
  cp = connect(cp, 'control', { nodeId: 'c1', portId: 'true' }, { nodeId: 'tgt', portId: 'in' }).protocol;
  cp = connect(cp, 'control', { nodeId: 'c1', portId: 'false' }, { nodeId: ce.id, portId: 'in' }).protocol;
  cp = connect(cp, 'control', { nodeId: 'tgt', portId: 'next' }, { nodeId: ce.id, portId: 'in' }, { id: 'e_t' }).protocol;
  const condResult = startRuntime(createRuntimeState(cp, { sessionId: 's_c', startedAtEpochMs: 1000, startedAtMonotonicMs: 500, variables: { score: 8 } }), cp, registry, svc);
  assert.equal(condResult.state.currentNodeId, 'tgt', 'condition >5 with score 8 routes to true branch');

  // loop with bounded iterations
  const loop = createProtocolGraph({ idFactory: createSequentialIdFactory(), name: 'loop', now: '2026-08-22T00:00:00.000Z' });
  const ls = loop.graph.nodes.find(node => node.component.type === 'core.start');
  const le = loop.graph.nodes.find(node => node.component.type === 'core.end');
  loop.graph.edges = [];
  const lNode = addNode(loop, 'logic.loop', { id: 'l1', config: { maxIterations: 2 } });
  const body = addNode(lNode.protocol, 'timing.wait', { id: 'body1' });
  let lp = connect(body.protocol, 'control', { nodeId: ls.id, portId: 'next' }, { nodeId: 'l1', portId: 'in' }).protocol;
  lp = connect(lp, 'control', { nodeId: 'l1', portId: 'body' }, { nodeId: 'body1', portId: 'in' }).protocol;
  lp = connect(lp, 'control', { nodeId: 'body1', portId: 'next' }, { nodeId: 'l1', portId: 'in' }).protocol;
  lp = connect(lp, 'control', { nodeId: 'l1', portId: 'exit' }, { nodeId: le.id, portId: 'in' }).protocol;
  let lstate = startRuntime(createRuntimeState(lp, { sessionId: 's_l', startedAtEpochMs: 1000, startedAtMonotonicMs: 500 }), lp, registry, svc).state;
  lstate = completeCurrentNode(lstate, lp, registry, svc, {}).state;
  lstate = completeCurrentNode(lstate, lp, registry, svc, {}).state;
  assert.equal(lstate.status, 'completed', 'loop exits after maxIterations body visits');
  assert.equal(lstate.loopCounts.l1, 2);

  // random split reproducibility
  const rand = createProtocolGraph({ idFactory: createSequentialIdFactory(), name: 'rand', now: '2026-08-22T00:00:00.000Z' });
  const rs = rand.graph.nodes.find(node => node.component.type === 'core.start');
  const re = rand.graph.nodes.find(node => node.component.type === 'core.end');
  rand.graph.edges = [];
  const rNode = addNode(rand, 'logic.random', { id: 'r1', config: { probabilityA: 0.5 } });
  const ra = addNode(rNode.protocol, 'display.screen', { id: 'ra', label: 'A' });
  const rb = addNode(ra.protocol, 'display.screen', { id: 'rb', label: 'B' });
  let rp = connect(rb.protocol, 'control', { nodeId: rs.id, portId: 'next' }, { nodeId: 'r1', portId: 'in' }).protocol;
  rp = connect(rp, 'control', { nodeId: 'r1', portId: 'a' }, { nodeId: 'ra', portId: 'in' }).protocol;
  rp = connect(rp, 'control', { nodeId: 'r1', portId: 'b' }, { nodeId: 'rb', portId: 'in' }).protocol;
  rp = connect(rp, 'control', { nodeId: 'ra', portId: 'next' }, { nodeId: re.id, portId: 'in' }).protocol;
  rp = connect(rp, 'control', { nodeId: 'rb', portId: 'next' }, { nodeId: re.id, portId: 'in' }, { id: 'e_rb' }).protocol;
  const opts = { sessionId: 's_r', startedAtEpochMs: 1000, startedAtMonotonicMs: 500, randomSeed: 'rseed' };
  const r1 = startRuntime(createRuntimeState(rp, opts), rp, registry, svc);
  const r2 = startRuntime(createRuntimeState(rp, opts), rp, registry, svc);
  assert.equal(r1.state.currentNodeId, r2.state.currentNodeId, 'random split is deterministic for the same seed');

  // value-switch handler routing
  const vs = createProtocolGraph({ idFactory: createSequentialIdFactory(), name: 'vs', now: '2026-08-22T00:00:00.000Z' });
  const vss = vs.graph.nodes.find(node => node.component.type === 'core.start');
  const vse = vs.graph.nodes.find(node => node.component.type === 'core.end');
  vs.graph.edges = [];
  const vsNode = addNode(vs, 'logic.value-switch', { id: 'vs1', config: { match: 'yes' }, bindings: { value: { kind: 'variable', variable: 'answer' } } });
  const vm = addNode(vsNode.protocol, 'display.screen', { id: 'vm', label: 'Match' });
  let vp = connect(vm.protocol, 'control', { nodeId: vss.id, portId: 'next' }, { nodeId: 'vs1', portId: 'in' }).protocol;
  vp = connect(vp, 'control', { nodeId: 'vs1', portId: 'match' }, { nodeId: 'vm', portId: 'in' }).protocol;
  vp = connect(vp, 'control', { nodeId: 'vs1', portId: 'default' }, { nodeId: vse.id, portId: 'in' }).protocol;
  vp = connect(vp, 'control', { nodeId: 'vm', portId: 'next' }, { nodeId: vse.id, portId: 'in' }, { id: 'e_vm' }).protocol;
  const vsResult = startRuntime(createRuntimeState(vp, { sessionId: 's_v', startedAtEpochMs: 1000, startedAtMonotonicMs: 500, variables: { answer: 'yes' } }), vp, registry, svc);
  assert.equal(vsResult.state.currentNodeId, 'vm', 'value-switch matches the input variable');
});
