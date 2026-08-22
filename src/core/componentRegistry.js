import { participantUiTemplate } from './participantUi.js';

const PORT_KINDS = new Set(['control', 'data']);
const PORT_DIRECTIONS = new Set(['input', 'output']);
const RUNTIME_KINDS = new Set(['start', 'end', 'condition', 'loop', 'random', 'handler', 'participant']);

function waitParticipantUi() {
  const schema = participantUiTemplate('instruction');
  schema.root.children = schema.root.children.filter(element => element.type !== 'Button');
  const heading = schema.root.children.find(element => element.type === 'Text');
  if (heading) heading.props.text = 'Please wait';
  return schema;
}

function normalizePort(port) {
  return {
    id: port.id,
    kind: port.kind,
    direction: port.direction,
    dataType: port.kind === 'data' ? (port.dataType || 'unknown') : null,
    required: Boolean(port.required),
    multiple: Boolean(port.multiple),
    label: port.label || port.id,
  };
}

export function validateComponentDefinition(definition) {
  const errors = [];
  if (!definition || typeof definition !== 'object') return { valid: false, errors: ['Component definition must be an object'] };
  if (!definition.type?.trim()) errors.push('Component type is required');
  if (!definition.version?.trim()) errors.push('Component version is required');
  if (!definition.label?.trim()) errors.push('Component label is required');
  if (definition.runtime?.kind && !RUNTIME_KINDS.has(definition.runtime.kind)) errors.push(`Runtime kind ${definition.runtime.kind} is invalid`);
  if (definition.runtime?.kind === 'handler' && !definition.runtime.handlerId?.trim()) errors.push('Handler runtime components need a handlerId');

  const portIds = new Set();
  for (const port of definition.ports || []) {
    if (!port.id?.trim()) errors.push('Every component port needs an ID');
    else if (portIds.has(port.id)) errors.push(`Duplicate component port ${port.id}`);
    else portIds.add(port.id);
    if (!PORT_KINDS.has(port.kind)) errors.push(`Port ${port.id || '(unknown)'} has invalid kind ${port.kind}`);
    if (!PORT_DIRECTIONS.has(port.direction)) errors.push(`Port ${port.id || '(unknown)'} has invalid direction ${port.direction}`);
  }
  return { valid: errors.length === 0, errors };
}

export class ComponentRegistry {
  #definitions = new Map();

  register(definition) {
    const check = validateComponentDefinition(definition);
    if (!check.valid) throw new Error(`Invalid component definition:\n${check.errors.join('\n')}`);
    const key = this.keyOf(definition.type, definition.version);
    if (this.#definitions.has(key)) throw new Error(`Component ${key} is already registered`);
    const normalized = structuredClone({
      category: 'custom',
      description: '',
      defaultConfig: {},
      editorFields: [],
      events: [],
      dataFields: [],
      runtime: { kind: 'participant', uiAdapter: 'schema', completion: 'config' },
      ...definition,
      ports: (definition.ports || []).map(normalizePort),
    });
    this.#definitions.set(key, normalized);
    return this;
  }

  get(type, version = '1.0.0') {
    return this.#definitions.get(this.keyOf(type, version)) || null;
  }

  has(type, version = '1.0.0') {
    return this.#definitions.has(this.keyOf(type, version));
  }

  list() {
    return [...this.#definitions.values()].map(definition => structuredClone(definition));
  }

  keyOf(type, version) {
    return `${type}@${version}`;
  }
}

const controlInput = { id: 'in', kind: 'control', direction: 'input', required: true };
const controlOutput = { id: 'next', kind: 'control', direction: 'output', required: true };

export function createCoreComponentRegistry() {
  const registry = new ComponentRegistry();
  registry.register({
    type: 'core.start', version: '1.0.0', label: 'Start', category: 'control',
    ports: [controlOutput],
    runtime: { kind: 'start' },
    events: ['protocol_started'],
  });
  registry.register({
    type: 'core.end', version: '1.0.0', label: 'End', category: 'control',
    ports: [controlInput],
    runtime: { kind: 'end' },
    events: ['protocol_completed'],
  });
  registry.register({
    type: 'display.screen', version: '1.0.0', label: 'Screen', category: 'presentation',
    ports: [controlInput, controlOutput],
    runtime: { kind: 'participant', uiAdapter: 'screen', completion: 'config' },
    defaultConfig: { content: '', ui: participantUiTemplate('instruction'), completion: { mode: 'manual' } },
    editorFields: [
      { path: 'content', label: 'Screen content', type: 'textarea' },
      { path: 'completion.mode', label: 'Completion', type: 'select', options: ['manual', 'fixed'] },
      { path: 'completion.durationMs', label: 'Duration (ms)', type: 'number', min: 0, showWhen: { path: 'completion.mode', equals: 'fixed' } },
    ],
    events: ['component_entered', 'component_completed'],
  });
  registry.register({
    type: 'display.media', version: '1.0.0', label: 'Media', category: 'presentation',
    ports: [controlInput, controlOutput],
    runtime: { kind: 'participant', uiAdapter: 'media', completion: 'config' },
    defaultConfig: { mediaType: 'image', assetId: null, ui: participantUiTemplate('media'), completion: { mode: 'fixed', durationMs: 3000 } },
    editorFields: [
      { path: 'mediaType', label: 'Media type', type: 'select', options: ['image', 'audio', 'video'] },
      { path: 'sourceUrl', label: 'Source URL', type: 'text' },
      { path: 'assetId', label: 'Asset ID', type: 'text' },
      { path: 'completion.durationMs', label: 'Duration (ms)', type: 'number', min: 0 },
    ],
    events: ['component_entered', 'media_loaded', 'media_started', 'media_ended', 'media_error', 'component_completed'],
    dataFields: ['asset_id', 'media_type', 'actual_duration_ms'],
  });
  registry.register({
    type: 'input.rating', version: '1.0.0', label: 'Rating', category: 'interaction',
    runtime: { kind: 'participant', uiAdapter: 'rating', completion: 'submit' },
    ports: [
      controlInput,
      controlOutput,
      { id: 'value', kind: 'data', direction: 'output', dataType: 'number', required: true },
    ],
    defaultConfig: { min: 1, max: 7, required: true, ui: participantUiTemplate('form') },
    editorFields: [
      { path: 'min', label: 'Minimum', type: 'number' },
      { path: 'max', label: 'Maximum', type: 'number' },
      { path: 'required', label: 'Required', type: 'boolean' },
    ],
    events: ['component_entered', 'value_changed', 'response_submitted', 'component_completed'],
    dataFields: ['value', 'reaction_time_ms'],
  });
  registry.register({
    type: 'input.text', version: '1.0.0', label: 'Text Input', category: 'interaction',
    runtime: { kind: 'participant', uiAdapter: 'text', completion: 'submit' },
    ports: [
      controlInput,
      controlOutput,
      { id: 'value', kind: 'data', direction: 'output', dataType: 'string' },
    ],
    defaultConfig: { required: false, multiline: false, ui: participantUiTemplate('form') },
    editorFields: [
      { path: 'placeholder', label: 'Placeholder', type: 'text' },
      { path: 'required', label: 'Required', type: 'boolean' },
      { path: 'multiline', label: 'Multiline', type: 'boolean' },
    ],
    events: ['component_entered', 'value_changed', 'response_submitted', 'component_completed'],
    dataFields: ['value', 'reaction_time_ms'],
  });
  registry.register({
    type: 'input.questionnaire', version: '1.0.0', label: 'Questionnaire', category: 'interaction',
    runtime: { kind: 'participant', uiAdapter: 'schema', completion: 'submit' },
    ports: [controlInput, controlOutput],
    defaultConfig: { questionnaire: null, ui: participantUiTemplate('form') },
    events: ['component_entered', 'value_changed', 'response_submitted', 'component_completed'],
    dataFields: ['question_id', 'value', 'reaction_time_ms'],
  });
  registry.register({
    type: 'timing.wait', version: '1.0.0', label: 'Wait', category: 'timing',
    runtime: { kind: 'participant', uiAdapter: 'wait', completion: 'durationMs' },
    ports: [controlInput, controlOutput],
    defaultConfig: { durationMs: 1000, ui: waitParticipantUi() },
    editorFields: [{ path: 'durationMs', label: 'Duration (ms)', type: 'number', min: 0 }],
    events: ['component_entered', 'component_completed'],
    dataFields: ['planned_duration_ms', 'actual_duration_ms'],
  });
  registry.register({
    type: 'logic.condition', version: '1.0.0', label: 'Condition', category: 'control',
    runtime: { kind: 'condition' },
    ports: [
      controlInput,
      { id: 'value', kind: 'data', direction: 'input', dataType: 'unknown', required: true },
      { id: 'true', kind: 'control', direction: 'output', required: true },
      { id: 'false', kind: 'control', direction: 'output', required: true },
    ],
    defaultConfig: { operator: 'equals', expected: true },
    editorFields: [
      { path: 'operator', label: 'Operator', type: 'select', options: ['equals', 'not_equals', 'contains', 'greater_than', 'greater_than_or_equal', 'less_than', 'less_than_or_equal', 'is_truthy', 'is_falsy'] },
      { path: 'expected', label: 'Expected value', type: 'text' },
    ],
    events: ['condition_evaluated'],
  });
  registry.register({
    type: 'logic.random', version: '1.0.0', label: 'Random split', category: 'control',
    runtime: { kind: 'random' },
    ports: [
      controlInput,
      { id: 'a', label: 'A', kind: 'control', direction: 'output', required: true },
      { id: 'b', label: 'B', kind: 'control', direction: 'output', required: true },
    ],
    defaultConfig: { probabilityA: 0.5, seedSalt: '' },
    editorFields: [
      { path: 'probabilityA', label: 'Probability of A (0–1)', type: 'number', min: 0, max: 1 },
      { path: 'seedSalt', label: 'Seed salt', type: 'text' },
    ],
    events: ['randomization_evaluated'],
    dataFields: ['seed', 'draw_index', 'random_value', 'selected_port'],
  });
  registry.register({
    type: 'logic.value-switch', version: '1.0.0', label: 'Value switch', category: 'control',
    runtime: { kind: 'handler', handlerId: 'core.value-switch', handlerVersion: '1.0.0' },
    ports: [
      controlInput,
      { id: 'value', kind: 'data', direction: 'input', dataType: 'unknown', required: true },
      { id: 'match', label: 'Match', kind: 'control', direction: 'output', required: true },
      { id: 'default', label: 'Default', kind: 'control', direction: 'output', required: true },
    ],
    defaultConfig: { match: '' },
    editorFields: [{ path: 'match', label: 'Match value', type: 'text' }],
    events: ['control_handler_evaluated'],
    dataFields: ['actual', 'expected', 'matched', 'handler_id'],
  });
  registry.register({
    type: 'logic.loop', version: '1.0.0', label: 'Loop', category: 'control',
    runtime: { kind: 'loop' },
    ports: [
      { ...controlInput, multiple: true },
      { id: 'body', kind: 'control', direction: 'output', required: true },
      { id: 'exit', kind: 'control', direction: 'output', required: true },
    ],
    defaultConfig: { maxIterations: 1 },
    editorFields: [{ path: 'maxIterations', label: 'Maximum iterations', type: 'number', min: 1 }],
    events: ['loop_evaluated'],
  });
  registry.register({
    type: 'legacy.step', version: '1.0.0', label: 'Legacy Step', category: 'legacy',
    ports: [controlInput, controlOutput],
    runtime: { kind: 'participant', uiAdapter: 'schema', completion: 'submit' },
    defaultConfig: { legacyStep: null, ui: participantUiTemplate('instruction') },
    events: ['component_entered', 'component_completed'],
  });
  return registry;
}
