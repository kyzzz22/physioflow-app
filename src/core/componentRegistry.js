const PORT_KINDS = new Set(['control', 'data']);
const PORT_DIRECTIONS = new Set(['input', 'output']);

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

const controlInput = { id: 'in', kind: 'control', direction: 'input' };
const controlOutput = { id: 'next', kind: 'control', direction: 'output' };

export function createCoreComponentRegistry() {
  const registry = new ComponentRegistry();
  registry.register({
    type: 'core.start', version: '1.0.0', label: 'Start', category: 'control',
    ports: [controlOutput],
    events: ['protocol_started'],
  });
  registry.register({
    type: 'core.end', version: '1.0.0', label: 'End', category: 'control',
    ports: [controlInput],
    events: ['protocol_completed'],
  });
  registry.register({
    type: 'display.screen', version: '1.0.0', label: 'Screen', category: 'presentation',
    ports: [controlInput, controlOutput],
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
    defaultConfig: { mediaType: 'image', assetId: null, completion: { mode: 'fixed', durationMs: 3000 } },
    editorFields: [
      { path: 'mediaType', label: 'Media type', type: 'select', options: ['image', 'audio', 'video'] },
      { path: 'sourceUrl', label: 'Source URL', type: 'text' },
      { path: 'assetId', label: 'Asset ID', type: 'text' },
      { path: 'completion.durationMs', label: 'Duration (ms)', type: 'number', min: 0 },
    ],
    events: ['component_entered', 'media_started', 'media_ended', 'component_completed'],
    dataFields: ['asset_id', 'media_type', 'actual_duration_ms'],
  });
  registry.register({
    type: 'input.rating', version: '1.0.0', label: 'Rating', category: 'interaction',
    ports: [
      controlInput,
      controlOutput,
      { id: 'value', kind: 'data', direction: 'output', dataType: 'number', required: true },
    ],
    defaultConfig: { min: 1, max: 7, required: true },
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
    ports: [
      controlInput,
      controlOutput,
      { id: 'value', kind: 'data', direction: 'output', dataType: 'string' },
    ],
    defaultConfig: { required: false, multiline: false },
    editorFields: [
      { path: 'placeholder', label: 'Placeholder', type: 'text' },
      { path: 'required', label: 'Required', type: 'boolean' },
      { path: 'multiline', label: 'Multiline', type: 'boolean' },
    ],
    events: ['component_entered', 'value_changed', 'response_submitted', 'component_completed'],
    dataFields: ['value', 'reaction_time_ms'],
  });
  registry.register({
    type: 'timing.wait', version: '1.0.0', label: 'Wait', category: 'timing',
    ports: [controlInput, controlOutput],
    defaultConfig: { durationMs: 1000 },
    editorFields: [{ path: 'durationMs', label: 'Duration (ms)', type: 'number', min: 0 }],
    events: ['component_entered', 'component_completed'],
    dataFields: ['planned_duration_ms', 'actual_duration_ms'],
  });
  registry.register({
    type: 'logic.condition', version: '1.0.0', label: 'Condition', category: 'control',
    ports: [
      controlInput,
      { id: 'value', kind: 'data', direction: 'input', dataType: 'unknown', required: true },
      { id: 'true', kind: 'control', direction: 'output' },
      { id: 'false', kind: 'control', direction: 'output' },
    ],
    defaultConfig: { operator: 'equals', expected: true },
    editorFields: [
      { path: 'operator', label: 'Operator', type: 'select', options: ['equals', 'not_equals', 'greater_than', 'less_than', 'truthy', 'falsy'] },
      { path: 'expected', label: 'Expected value', type: 'text' },
    ],
    events: ['condition_evaluated'],
  });
  registry.register({
    type: 'logic.loop', version: '1.0.0', label: 'Loop', category: 'control',
    ports: [
      { ...controlInput, multiple: true },
      { id: 'body', kind: 'control', direction: 'output' },
      { id: 'exit', kind: 'control', direction: 'output' },
    ],
    defaultConfig: { maxIterations: 1 },
    editorFields: [{ path: 'maxIterations', label: 'Maximum iterations', type: 'number', min: 1 }],
    events: ['loop_evaluated'],
  });
  registry.register({
    type: 'legacy.step', version: '1.0.0', label: 'Legacy Step', category: 'legacy',
    ports: [controlInput, controlOutput],
    defaultConfig: { legacyStep: null },
    events: ['component_entered', 'component_completed'],
  });
  return registry;
}
import { participantUiTemplate } from './participantUi.js';
