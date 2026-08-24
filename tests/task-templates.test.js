import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCoreComponentRegistry,
  createEmotionGraphTemplate,
  createGonogoGraphTemplate,
  createSequentialIdFactory,
  createStroopGraphTemplate,
  generateGonogoTrials,
  generateStroopTrials,
  validateProtocolGraph,
  validateProtocolGraphConfiguration,
} from '../src/core/index.js';

const registry = createCoreComponentRegistry();
const validate = template => validateProtocolGraph(template, registry);

test('emotion template counterbalances five conditions with recovery and unique questionnaire IDs', () => {
  const protocol = createEmotionGraphTemplate({ idFactory: createSequentialIdFactory(), seed: 2 });
  assert.equal(protocol.graph.nodes.filter(node => node.component.type === 'core.start').length, 1);
  assert.equal(protocol.graph.nodes.filter(node => node.component.type === 'core.end').length, 1);
  assert.equal(protocol.graph.nodes.filter(node => node.component.type === 'input.questionnaire').length, 5);
  assert.equal(protocol.graph.nodes.filter(node => node.component.type === 'timing.wait').length, 5);
  assert.deepEqual(protocol.metadata.experimentDesign.conditionOrder, ['LVLA', 'HVLA', 'NVLA', 'HVHA', 'LVHA']);
  const questionnaires = protocol.graph.nodes.filter(node => node.component.type === 'input.questionnaire').map(node => node.config.questionnaire);
  assert.equal(new Set(questionnaires.map(item => item.questionnaire_id)).size, 5);
  assert.equal(new Set(questionnaires.flatMap(item => item.questions.map(question => question.question_id))).size, 15);
  assert.ok(questionnaires.every(item => item.questions.length === 3));
  assert.equal(validate(protocol).valid, true);
  assert.ok(validateProtocolGraphConfiguration(protocol, registry).errors.some(error => error.code === 'config.media_source_missing'));
});

test('stroop generator is deterministic, balanced, jittered, and encodes actual color-word trials', () => {
  const first = generateStroopTrials({ trials: 20, seed: 7, jitter: 250 });
  const second = generateStroopTrials({ trials: 20, seed: 7, jitter: 250 });
  assert.deepEqual(first, second);
  assert.equal(first.length, 20);
  assert.equal(first.filter(trial => trial.congruent).length, 10);
  assert.deepEqual(new Set(first.map(trial => trial.expectedKey)), new Set(['r', 'g', 'b', 'y']));
  assert.ok(first.every(trial => trial.word && trial.inkColor && trial.responseWindowMs > 0));
  assert.ok(new Set(first.map(trial => trial.itiMs)).size > 1);
});

test('stroop template changes with practice and jitter settings and passes formal configuration validation', () => {
  const withPractice = createStroopGraphTemplate({ idFactory: createSequentialIdFactory(), trials: 20, practice: true, jitter: 300, seed: 9 });
  const withoutPractice = createStroopGraphTemplate({ idFactory: createSequentialIdFactory(), trials: 20, practice: false, jitter: 0, seed: 9 });
  const tasks = withPractice.graph.nodes.filter(node => node.component.type === 'experiment.cognitive-task');
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].config.practice, true);
  assert.equal(tasks[1].config.trials.length, 20);
  assert.equal(withoutPractice.graph.nodes.filter(node => node.component.type === 'experiment.cognitive-task').length, 1);
  assert.notDeepEqual(tasks[1].config.trials.map(trial => trial.itiMs), withoutPractice.graph.nodes.find(node => node.component.type === 'experiment.cognitive-task').config.trials.map(trial => trial.itiMs));
  assert.equal(validate(withPractice).valid, true);
  assert.equal(validateProtocolGraphConfiguration(withPractice, registry).valid, true);
});

test('go/no-go generator honors go ratio and prevents long same-type runs', () => {
  const trials = generateGonogoTrials({ trials: 40, goRatio: 65, seed: 4, jitter: 200 });
  assert.equal(trials.filter(trial => trial.trialType === 'go').length, 26);
  assert.equal(trials.filter(trial => trial.trialType === 'nogo').length, 14);
  assert.ok(trials.filter(trial => trial.trialType === 'go').every(trial => trial.expectedKey === 'space'));
  assert.ok(trials.filter(trial => trial.trialType === 'nogo').every(trial => trial.expectedKey === null));
  for (let index = 3; index < trials.length; index += 1) assert.equal(trials.slice(index - 3, index + 1).every(trial => trial.trialType === trials[index].trialType), false);
});

test('go/no-go template applies go ratio, practice and jitter and validates task semantics', () => {
  const protocol = createGonogoGraphTemplate({ idFactory: createSequentialIdFactory(), trials: 30, goRatio: 80, practice: false, jitter: 150, seed: 3 });
  const task = protocol.graph.nodes.find(node => node.component.type === 'experiment.cognitive-task');
  assert.equal(task.config.trials.length, 30);
  assert.equal(task.config.trials.filter(trial => trial.trialType === 'go').length, 24);
  assert.ok(new Set(task.config.trials.map(trial => trial.itiMs)).size > 1);
  assert.equal(protocol.metadata.experimentDesign.goRatio, 80);
  assert.equal(validate(protocol).valid, true);
  assert.equal(validateProtocolGraphConfiguration(protocol, registry).valid, true);
});

test('formal validation rejects malformed cognitive-task trials', () => {
  const protocol = createStroopGraphTemplate({ idFactory: createSequentialIdFactory(), practice: false });
  const task = protocol.graph.nodes.find(node => node.component.type === 'experiment.cognitive-task');
  task.config.trials[1].trialId = task.config.trials[0].trialId;
  task.config.trials[1].expectedKey = 'space';
  const result = validateProtocolGraphConfiguration(protocol, registry);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.code === 'config.cognitive_task_trial_id_invalid'));
  assert.ok(result.errors.some(error => error.code === 'config.stroop_trial_invalid'));
});
