import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addNode,
  appendUiElement,
  connect,
  createCoreComponentRegistry,
  createSequentialIdFactory,
  createUiElement,
  mapUiElement,
  moveUiElement,
  parseQuestionnaireCsv,
  PARTICIPANT_UI_THEME_DEFAULTS,
  participantUiTemplate,
  removeUiElement,
  resolveStyleValue,
  resolveTheme,
  resolveUiBinding,
  resolveUiStyle,
  UI_STYLE_KEYS,
  createQuestionnaire,
  createProtocolGraph,
  questionnaireScore,
  removeQuestionnaireFromLibrary,
  saveQuestionnaireToLibrary,
  seededShuffle,
  validateQuestionnaire,
  validateProtocolGraphConfiguration,
  validateComponentDefinition,
  validateParticipantUi,
} from '../src/core/index.js';
import { localResourceManifest, schemaForNode } from '../src/runtime/nodeSchema.js';

test('instruction, media, and form participant UI templates are valid', () => {
  for (const kind of ['instruction', 'media', 'form']) {
    const schema = participantUiTemplate(kind, { idFactory: createSequentialIdFactory() });
    const result = validateParticipantUi(schema);
    assert.equal(result.valid, true, `${kind}: ${JSON.stringify(result.errors)}`);
  }
});

test('experiment-design default frameworks are valid participant UI templates', () => {
  for (const kind of ['rating', 'fixation', 'attention', 'device', 'manual', 'html', 'calibration']) {
    const schema = participantUiTemplate(kind, { idFactory: createSequentialIdFactory() });
    const result = validateParticipantUi(schema);
    assert.equal(result.valid, true, `${kind}: ${JSON.stringify(result.errors)}`);
  }
});

test('experiment-design components register with valid defaults', () => {
  const registry = createCoreComponentRegistry();
  for (const type of ['stimulus.fixation', 'stimulus.attention-check', 'setup.device-check', 'operator.manual-event', 'stimulus.screen-calibration', 'stimulus.custom-html', 'utility.note', 'utility.junction']) {
    const definition = registry.get(type);
    assert.ok(definition, `${type} is registered`);
    assert.equal(validateComponentDefinition(definition).valid, true, `${type} definition is valid`);
    assert.equal(validateParticipantUi(definition.defaultConfig.ui).valid, true, `${type} default UI is valid`);
  }
});

test('participant UI tree commands append, update, and remove elements immutably', () => {
  const source = participantUiTemplate('instruction', { idFactory: createSequentialIdFactory() });
  const input = createUiElement('Input', { id: 'ui_response', props: { name: 'mood', inputType: 'rating' } });
  const appended = appendUiElement(source, source.root.id, input);
  const updated = mapUiElement(appended, input.id, element => ({ ...element, props: { ...element.props, label: 'Mood' } }));
  const removed = removeUiElement(updated, input.id);

  assert.equal(source.root.children.some(element => element.id === input.id), false);
  assert.equal(updated.root.children.find(element => element.id === input.id).props.label, 'Mood');
  assert.equal(removed.root.children.some(element => element.id === input.id), false);
});

test('participant UI validation reports duplicate IDs and invalid input configuration', () => {
  const schema = participantUiTemplate('form', { idFactory: createSequentialIdFactory() });
  schema.root.children[0].id = schema.root.id;
  schema.root.children.find(element => element.type === 'Input').props.name = '';
  const result = validateParticipantUi(schema);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.code === 'ui.id_duplicate'));
  assert.ok(result.errors.some(error => error.code === 'ui.input_name_missing'));
});

test('participant UI bindings resolve runtime context paths', () => {
  assert.equal(resolveUiBinding('progress.percent', { progress: { percent: 75 } }), 75);
  assert.equal(resolveUiBinding('variables.score', { variables: { score: 6 } }), 6);
});

test('moveUiElement reorders within the same parent immutably', () => {
  const schema = participantUiTemplate('instruction', { idFactory: createSequentialIdFactory() });
  const ids = schema.root.children.map(child => child.id);
  const moved = moveUiElement(schema, ids[3], schema.root.id, 0);
  assert.equal(moved.root.children.map(child => child.id).join(','), [ids[3], ...ids.slice(0, 3)].join(','));
  assert.equal(schema.root.children.map(child => child.id).join(','), ids.join(','));
});

test('moveUiElement moves across parents and nests into containers', () => {
  const idFactory = createSequentialIdFactory();
  const schema = participantUiTemplate('instruction', { idFactory });
  const layout = createUiElement('Layout', { idFactory, props: { direction: 'row' } });
  const withLayout = appendUiElement(schema, schema.root.id, layout);
  const leafId = withLayout.root.children.find(child => child.id !== layout.id).id;
  const nested = moveUiElement(withLayout, leafId, layout.id, 0);
  assert.ok((nested.root.children.find(child => child.id === layout.id).children || []).some(child => child.id === leafId));
  assert.equal(nested.root.children.some(child => child.id === leafId), false);
});

test('moveUiElement rejects invalid moves', () => {
  const schema = participantUiTemplate('instruction', { idFactory: createSequentialIdFactory() });
  const [a, b] = schema.root.children.map(child => child.id);
  assert.throws(() => moveUiElement(schema, schema.root.id, schema.root.id, 0), /Root Screen cannot be moved/);
  assert.throws(() => moveUiElement(schema, a, a, 0), /into itself/);
  assert.throws(() => moveUiElement(schema, 'missing', schema.root.id, 0), /not found/);
  assert.throws(() => moveUiElement(schema, a, b, 0), /cannot contain children/);
});

test('moveUiElement clamps the insert index to the moved array', () => {
  const schema = participantUiTemplate('instruction', { idFactory: createSequentialIdFactory() });
  const ids = schema.root.children.map(child => child.id);
  const moved = moveUiElement(schema, ids[0], schema.root.id, 99);
  assert.equal(moved.root.children.at(-1).id, ids[0]);
});

test('participant UI theme and style validate', () => {
  const schema = participantUiTemplate('instruction', { idFactory: createSequentialIdFactory() });
  schema.theme = { green: '#123456' };
  schema.root.children[0].style = { background: { $token: 'green' }, padding: '12px' };
  assert.equal(validateParticipantUi(schema).valid, true);
});

test('participant UI theme validation reports invalid and unsafe keys', () => {
  const schema = participantUiTemplate('instruction', { idFactory: createSequentialIdFactory() });
  schema.theme = { unknownToken: '#fff', constructor: 'x' };
  const result = validateParticipantUi(schema);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.code === 'ui.theme_key_unsafe'));
  assert.ok(result.warnings.some(warning => warning.code === 'ui.theme_key_unknown'));
});

test('participant UI style validation reports bad values and unknown keys', () => {
  const schema = participantUiTemplate('instruction', { idFactory: createSequentialIdFactory() });
  schema.root.children[0].style = { backgroundColor: '#fff', color: { $token: 'nope', extra: 1 } };
  const result = validateParticipantUi(schema);
  assert.equal(result.valid, false);
  assert.ok(result.warnings.some(warning => warning.code === 'ui.style_key_unknown'));
  assert.ok(result.errors.some(error => error.code === 'ui.style_value_invalid'));
});

test('legacy participant UI schemas without theme or style stay valid', () => {
  const schema = participantUiTemplate('instruction', { idFactory: createSequentialIdFactory() });
  assert.equal(validateParticipantUi(schema).valid, true);
});

test('resolveUiStyle maps legacy props and resolves token references', () => {
  const schema = participantUiTemplate('instruction', { idFactory: createSequentialIdFactory() });
  const theme = resolveTheme(schema);
  const element = createUiElement('Text', { props: { fontSize: '20px', align: 'center' } });
  assert.equal(resolveUiStyle(element, theme).fontSize, '20px');
  assert.equal(resolveUiStyle(element, theme).textAlign, 'center');
  const tokenElement = createUiElement('Text', { style: { background: { $token: 'mint' } } });
  assert.equal(resolveUiStyle(tokenElement, theme).background, theme.mint);
});

test('resolveUiStyle precedence: style overrides props, binding overrides both', () => {
  const schema = participantUiTemplate('instruction', { idFactory: createSequentialIdFactory() });
  const theme = resolveTheme(schema);
  const element = { ...createUiElement('Text', { props: { color: '#000' }, style: { color: '#111' }, bindings: { color: 'variables.color' } }) };
  assert.equal(resolveUiStyle(element, theme, { variables: { color: '#fff' } }).color, '#fff');
  assert.equal(resolveUiStyle({ ...element, bindings: {} }, theme, {}).color, '#111');
});

test('resolveTheme merges schema theme over defaults', () => {
  const schema = participantUiTemplate('instruction', { idFactory: createSequentialIdFactory() });
  schema.theme = { green: '#123456' };
  assert.equal(resolveTheme(schema).green, '#123456');
  assert.equal(resolveTheme(schema).ink, PARTICIPANT_UI_THEME_DEFAULTS.ink);
});

test('questionnaire library upserts and removes questionnaires purely', () => {
  const q1 = createQuestionnaire();
  q1.questionnaire_id = 'lib_q1';
  q1.name = 'First';
  const q2 = createQuestionnaire();
  q2.questionnaire_id = 'lib_q2';
  q2.name = 'Second';
  let library = saveQuestionnaireToLibrary([], q1);
  library = saveQuestionnaireToLibrary(library, q2);
  assert.equal(library.length, 2);
  const q1v2 = structuredClone(q1);
  q1v2.name = 'First v2';
  library = saveQuestionnaireToLibrary(library, q1v2);
  assert.equal(library.length, 2);
  assert.equal(library.find(item => item.questionnaire_id === 'lib_q1').name, 'First v2');
  library = removeQuestionnaireFromLibrary(library, 'lib_q2');
  assert.equal(library.length, 1);
  assert.equal(library[0].questionnaire_id, 'lib_q1');
});

test('questionnaire validation rejects missing schema, duplicate IDs, bad types and inverted scales', () => {
  const missing = validateQuestionnaire(null);
  assert.equal(missing.valid, false);
  const questionnaire = createQuestionnaire();
  questionnaire.name = '';
  questionnaire.questions.push({ ...structuredClone(questionnaire.questions[0]), type: 'unknown', scale_min: 9, scale_max: 1 });
  const result = validateQuestionnaire(questionnaire);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.code === 'questionnaire.name_missing'));
  assert.ok(result.errors.some(error => error.code === 'questionnaire.question_id_duplicate'));
  assert.ok(result.errors.some(error => error.code === 'questionnaire.type_invalid'));
  assert.ok(result.errors.some(error => error.code === 'questionnaire.scale_invalid'));
});

test('questionnaire shuffle is deterministic and scoring is exported as structured metadata', () => {
  const values = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(seededShuffle(values, 'session-1'), seededShuffle(values, 'session-1'));
  assert.notDeepEqual(seededShuffle(values, 'session-1'), seededShuffle(values, 'session-2'));
  const questionnaire = createQuestionnaire();
  questionnaire.questions[0].correct_answer = '5';
  assert.deepEqual(questionnaireScore(questionnaire, { [questionnaire.questions[0].question_id]: 5 }), { correct: 1, total: 1, pct: 100 });
});

test('questionnaire defaults are immediately valid instead of displaying an unsaved phantom question', () => {
  const questionnaire = createQuestionnaire();
  const result = validateQuestionnaire(questionnaire);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(questionnaire.questions.length, 1);
  assert.ok(questionnaire.questions[0].prompt_i18n.en);
});

test('formal graph validation blocks a malformed questionnaire before freeze', () => {
  const registry = createCoreComponentRegistry();
  const base = createProtocolGraph({ idFactory: createSequentialIdFactory() });
  const definition = registry.get('input.questionnaire');
  const added = addNode(base, 'input.questionnaire', { config: definition.defaultConfig }).protocol;
  const node = added.graph.nodes.find(item => item.component.type === 'input.questionnaire');
  node.config.questionnaire.questions[0].scale_min = 9;
  node.config.questionnaire.questions[0].scale_max = 1;
  const result = validateProtocolGraphConfiguration(added, registry);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.code === 'config.questionnaire.scale_invalid'));
});

test('questionnaire CSV import supports quoted commas and rejects unknown types', () => {
  const imported = parseQuestionnaireCsv('type,en,options,min,max,required\nsingle_choice,"Mood, right now?","Good|Bad",1,5,false', createSequentialIdFactory());
  assert.equal(imported.length, 1);
  assert.equal(imported[0].prompt_i18n.en, 'Mood, right now?');
  assert.deepEqual(imported[0].options_i18n.en, ['Good', 'Bad']);
  assert.equal(imported[0].required, false);
  assert.throws(() => parseQuestionnaireCsv('type,en\nmagic,Question'), /unsupported type/);
});

function collectElements(schema, type) {
  const found = [];
  const visit = element => {
    if (!element) return;
    if (element.type === type) found.push(element);
    for (const child of element.children || []) visit(child);
  };
  visit(schema.root);
  return found;
}

test('media component exposes a media-ended completion mode in the inspector schema', () => {
  const registry = createCoreComponentRegistry();
  const media = registry.get('display.media');
  const modeField = media.editorFields.find(field => field.path === 'completion.mode');
  assert.ok(modeField, 'media inspector should offer a completion mode field');
  assert.ok(modeField.options.includes('media-ended'));
  assert.ok(modeField.options.includes('manual'));
  const duration = media.editorFields.find(field => field.path === 'completion.durationMs');
  assert.deepEqual(duration.showWhen, { path: 'completion.mode', equals: 'fixed' });
});

test('fixation schemaForNode renders the configured shape and pulse flag', () => {
  const registry = createCoreComponentRegistry();
  const definition = registry.get('stimulus.fixation');
  const base = { id: 'fix_1', component: { type: 'stimulus.fixation', version: '1.0.0' }, label: 'Fix' };
  const dot = schemaForNode({ ...base, config: { shape: 'dot', sizePx: 60, color: '#123456', pulse: true } }, definition, null);
  const dotText = collectElements(dot, 'Text')[0];
  assert.equal(dotText.props.text, '●');
  assert.equal(dotText.props.pulse, true);
  assert.match(dotText.style.fontSize, /60px/);
  assert.equal(dotText.style.color, '#123456');
  const diamond = schemaForNode({ ...base, config: { shape: 'diamond' } }, definition, null);
  assert.equal(collectElements(diamond, 'Text')[0].props.text, '◆');
  const cross = schemaForNode({ ...base, config: { shape: 'cross' } }, definition, null);
  assert.equal(collectElements(cross, 'Text')[0].props.text, '+');
});

test('device-check schemaForNode renders one required checkbox per checklist item', () => {
  const registry = createCoreComponentRegistry();
  const definition = registry.get('setup.device-check');
  const node = { id: 'dc_1', component: { type: 'setup.device-check', version: '1.0.0' }, label: 'Device check', config: { checklist: 'Electrodes attached\nSignal stable' } };
  const schema = schemaForNode(node, definition, null);
  const inputs = collectElements(schema, 'Input');
  assert.equal(inputs.length, 2);
  assert.ok(inputs.every(input => input.props.inputType === 'checkbox' && input.props.required === true));
  assert.equal(inputs[0].props.name, 'check_0');
  assert.equal(inputs[0].props.label, 'Electrodes attached');
  assert.ok(collectElements(schema, 'Button').some(button => (button.actions || []).some(action => action.action === 'submit')));
});

test('manual-event requireNote renders a required note input only when enabled', () => {
  const registry = createCoreComponentRegistry();
  const definition = registry.get('operator.manual-event');
  const withNote = schemaForNode({ id: 'me_1', component: { type: 'operator.manual-event', version: '1.0.0' }, label: 'Manual', config: { requireNote: true, confirmLabel: 'Log' } }, definition, null);
  const note = collectElements(withNote, 'Input').find(input => input.props.name === 'note');
  assert.ok(note, 'requireNote should add a note input');
  assert.equal(note.props.inputType, 'textarea');
  assert.equal(note.props.required, true);
  const withoutNote = schemaForNode({ id: 'me_2', component: { type: 'operator.manual-event', version: '1.0.0' }, label: 'Manual', config: { requireNote: false } }, definition, null);
  assert.equal(collectElements(withoutNote, 'Input').length, 0);
});

test('media schemaForNode removes the advance button in media-ended mode', () => {
  const registry = createCoreComponentRegistry();
  const definition = registry.get('display.media');
  const base = { id: 'm_1', component: { type: 'display.media', version: '1.0.0' }, label: 'Video' };
  const ended = schemaForNode({ ...base, config: { mediaType: 'video', sourceUrl: 'https://example.com/v.mp4', completion: { mode: 'media-ended' } } }, definition, null);
  assert.equal(collectElements(ended, 'Button').length, 0);
  const manual = schemaForNode({ ...base, config: { mediaType: 'video', sourceUrl: 'https://example.com/v.mp4', completion: { mode: 'manual' } } }, definition, null);
  assert.ok(collectElements(manual, 'Button').length > 0);
});

test('formal validation rejects unsupported media completion modes and fixation shapes', () => {
  const registry = createCoreComponentRegistry();
  const protocol = createProtocolGraph({ idFactory: createSequentialIdFactory(), name: 'Val', now: '2026-08-22T00:00:00.000Z' });
  const start = protocol.graph.nodes.find(node => node.component.type === 'core.start');
  const end = protocol.graph.nodes.find(node => node.component.type === 'core.end');
  protocol.graph.edges = [];
  const withConfig = (type, overrides) => ({ ...(registry.get(type)?.defaultConfig || {}), ...overrides });
  const media = addNode(protocol, 'display.media', { id: 'm_1', label: 'M', config: withConfig('display.media', { sourceUrl: 'https://example.com/a.mp4', mediaType: 'video', completion: { mode: 'media-ended' } }) }).protocol;
  const fix = addNode(media, 'stimulus.fixation', { id: 'f_1', label: 'F', config: withConfig('stimulus.fixation', { shape: 'cross', completion: { mode: 'fixed', durationMs: 500 } }) }).protocol;
  let next = connect(fix, 'control', { nodeId: start.id, portId: 'next' }, { nodeId: 'm_1', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'm_1', portId: 'next' }, { nodeId: 'f_1', portId: 'in' }).protocol;
  next = connect(next, 'control', { nodeId: 'f_1', portId: 'next' }, { nodeId: end.id, portId: 'in' }).protocol;
  assert.equal(validateProtocolGraphConfiguration(next, registry).valid, true);
  const badMode = structuredClone(next);
  badMode.graph.nodes.find(node => node.id === 'm_1').config.completion.mode = 'auto';
  const modeResult = validateProtocolGraphConfiguration(badMode, registry);
  assert.equal(modeResult.valid, false);
  assert.ok(modeResult.errors.some(error => error.code === 'config.media_mode_invalid'));
  const badShape = structuredClone(next);
  badShape.graph.nodes.find(node => node.id === 'f_1').config.shape = 'star';
  const shapeResult = validateProtocolGraphConfiguration(badShape, registry);
  assert.ok(shapeResult.errors.some(error => error.code === 'config.fixation_shape_invalid'));
});

test('legacy.step exposes content editor fields', () => {
  const registry = createCoreComponentRegistry();
  const legacy = registry.get('legacy.step');
  assert.ok(legacy.editorFields.some(field => field.path === 'legacyStep.content'));
  assert.ok(legacy.editorFields.some(field => field.path === 'legacyStep.name'));
});

test('media nodes resolve protocol assets in local (non-hosted) runs', () => {
  const registry = createCoreComponentRegistry();
  const definition = registry.get('display.media');
  const node = { id: 'm_1', component: { type: 'display.media', version: '1.0.0' }, label: 'Video', config: { mediaType: 'video', assetId: 'asset_1', sourceUrl: '' } };
  const manifest = localResourceManifest([{ id: 'asset_1', name: 'clip', mediaType: 'video', sourceUrl: 'https://example.com/clip.mp4' }]);
  const schema = schemaForNode(node, definition, manifest);
  const media = collectElements(schema, 'Media')[0];
  assert.equal(media.props.sourceUrl, 'https://example.com/clip.mp4');
  assert.equal(media.props.assetId, 'asset_1');
});

test('local resource manifest ignores assets without a usable URL', () => {
  assert.deepEqual(localResourceManifest([{ id: 'x', name: 'no url' }, { id: 'y', sourceUrl: 'https://example.com/y.png' }]), [
    { assetId: 'y', nodeId: null, name: '', mediaType: null, checksum: null, status: 'ready', delivery: { url: 'https://example.com/y.png' } },
  ]);
});

test('participant UI elements support free-layout x/y positioning', () => {
  const schema = participantUiTemplate('instruction', { idFactory: createSequentialIdFactory() });
  schema.root.props.free = true;
  schema.root.children[0].props.x = 40;
  schema.root.children[0].props.y = 80;
  assert.equal(validateParticipantUi(schema).valid, true);
  assert.equal(schema.root.children[0].props.x, 40);
  assert.equal(schema.root.children[0].props.y, 80);
});
