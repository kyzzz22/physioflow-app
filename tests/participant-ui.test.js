import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendUiElement,
  createSequentialIdFactory,
  createUiElement,
  mapUiElement,
  participantUiTemplate,
  removeUiElement,
  resolveUiBinding,
  validateParticipantUi,
} from '../src/core/index.js';

test('instruction, media, and form participant UI templates are valid', () => {
  for (const kind of ['instruction', 'media', 'form']) {
    const schema = participantUiTemplate(kind, { idFactory: createSequentialIdFactory() });
    const result = validateParticipantUi(schema);
    assert.equal(result.valid, true, `${kind}: ${JSON.stringify(result.errors)}`);
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
