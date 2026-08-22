import { createId } from './ids.js';

export const PARTICIPANT_UI_SCHEMA_VERSION = '1.0.0';
export const PARTICIPANT_UI_TYPES = Object.freeze(['Screen', 'Layout', 'Text', 'Media', 'Input', 'Button', 'Progress']);

const CONTAINERS = new Set(['Screen', 'Layout']);

export function createUiElement(type, options = {}) {
  if (!PARTICIPANT_UI_TYPES.includes(type)) throw new Error(`Unknown participant UI element ${type}`);
  const idFactory = options.idFactory || createId;
  return {
    id: options.id || idFactory('ui'),
    type,
    props: structuredClone(options.props || {}),
    bindings: structuredClone(options.bindings || {}),
    actions: structuredClone(options.actions || []),
    children: CONTAINERS.has(type) ? structuredClone(options.children || []) : [],
  };
}

export function createParticipantScreen(options = {}) {
  return {
    schemaVersion: PARTICIPANT_UI_SCHEMA_VERSION,
    root: createUiElement('Screen', {
      ...options,
      props: { maxWidth: 800, align: 'center', background: '#ffffff', color: '#17211b', padding: 32, ...(options.props || {}) },
      children: options.children || [],
    }),
  };
}

export function participantUiTemplate(kind = 'instruction', options = {}) {
  const idFactory = options.idFactory || createId;
  if (kind === 'media') return createParticipantScreen({ idFactory, children: [
    createUiElement('Text', { idFactory, props: { text: 'Stimulus', variant: 'heading' } }),
    createUiElement('Media', { idFactory, props: { mediaType: 'image', sourceUrl: '', alt: 'Experiment stimulus', fit: 'contain' } }),
    createUiElement('Button', { idFactory, props: { label: 'Continue', variant: 'primary' }, actions: [{ event: 'click', action: 'submit' }] }),
  ] });
  if (kind === 'form') return createParticipantScreen({ idFactory, children: [
    createUiElement('Text', { idFactory, props: { text: 'How do you feel?', variant: 'heading' } }),
    createUiElement('Input', { idFactory, props: { name: 'response', inputType: 'rating', label: 'Rating', min: 1, max: 7, required: true } }),
    createUiElement('Button', { idFactory, props: { label: 'Submit response', variant: 'primary' }, actions: [{ event: 'click', action: 'submit' }] }),
  ] });
  return createParticipantScreen({ idFactory, children: [
    createUiElement('Text', { idFactory, props: { text: 'Welcome', variant: 'heading' } }),
    createUiElement('Text', { idFactory, props: { text: 'Please read the instructions carefully.', variant: 'body' } }),
    createUiElement('Progress', { idFactory, props: { value: 0, max: 100, label: '' }, bindings: { value: 'progress.percent' } }),
    createUiElement('Button', { idFactory, props: { label: 'Continue', variant: 'primary' }, actions: [{ event: 'click', action: 'submit' }] }),
  ] });
}

export function normalizeParticipantUi(value) {
  if (value?.schemaVersion === PARTICIPANT_UI_SCHEMA_VERSION && value.root) return structuredClone(value);
  return participantUiTemplate('instruction');
}

export function validateParticipantUi(schema) {
  const errors = [];
  const warnings = [];
  if (schema?.schemaVersion !== PARTICIPANT_UI_SCHEMA_VERSION) errors.push({ code: 'ui.schema_invalid', message: 'Unsupported Participant UI schema version', path: 'schemaVersion' });
  const ids = new Set();
  const visit = (element, path) => {
    if (!element?.id) errors.push({ code: 'ui.id_missing', message: 'UI element ID is required', path: `${path}.id` });
    else if (ids.has(element.id)) errors.push({ code: 'ui.id_duplicate', message: `Duplicate UI element ID ${element.id}`, path: `${path}.id` });
    else ids.add(element.id);
    if (!PARTICIPANT_UI_TYPES.includes(element?.type)) errors.push({ code: 'ui.type_unknown', message: `Unknown UI element ${element?.type}`, path: `${path}.type` });
    if (!CONTAINERS.has(element?.type) && element?.children?.length) errors.push({ code: 'ui.children_invalid', message: `${element.type} cannot contain children`, path: `${path}.children` });
    if (element?.type === 'Input' && !element.props?.name?.trim()) errors.push({ code: 'ui.input_name_missing', message: 'Input needs a response name', path: `${path}.props.name`, elementId: element.id });
    if (element?.type === 'Media' && !element.props?.sourceUrl && !element.props?.assetId) warnings.push({ code: 'ui.media_source_missing', message: 'Media has no source yet', path: `${path}.props`, elementId: element.id });
    for (const [index, action] of (element?.actions || []).entries()) {
      if (!['submit', 'setVariable', 'next'].includes(action.action)) errors.push({ code: 'ui.action_unknown', message: `Unknown UI action ${action.action}`, path: `${path}.actions.${index}`, elementId: element.id });
    }
    (element?.children || []).forEach((child, index) => visit(child, `${path}.children.${index}`));
  };
  if (!schema?.root) errors.push({ code: 'ui.root_missing', message: 'Participant UI needs a root Screen', path: 'root' });
  else {
    if (schema.root.type !== 'Screen') errors.push({ code: 'ui.root_not_screen', message: 'Participant UI root must be a Screen', path: 'root.type' });
    visit(schema.root, 'root');
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function mapUiElement(schema, elementId, updater) {
  const next = structuredClone(schema);
  const visit = element => {
    if (element.id === elementId) return updater(structuredClone(element));
    return { ...element, children: (element.children || []).map(visit) };
  };
  next.root = visit(next.root);
  return next;
}

export function removeUiElement(schema, elementId) {
  if (schema.root?.id === elementId) throw new Error('Root Screen cannot be removed');
  const next = structuredClone(schema);
  const visit = element => ({ ...element, children: (element.children || []).filter(child => child.id !== elementId).map(visit) });
  next.root = visit(next.root);
  return next;
}

export function appendUiElement(schema, parentId, element) {
  return mapUiElement(schema, parentId, parent => {
    if (!CONTAINERS.has(parent.type)) throw new Error(`${parent.type} cannot contain children`);
    return { ...parent, children: [...(parent.children || []), structuredClone(element)] };
  });
}

export function resolveUiBinding(binding, context = {}) {
  if (typeof binding !== 'string') return binding;
  return binding.split('.').reduce((value, key) => value?.[key], context);
}
