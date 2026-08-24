import { addNode, connect, createCoreComponentRegistry, createProtocolGraph, createSequentialIdFactory } from './index.js';
import { createBlockOrder, createJitteredDuration } from './experimentStructure.js';
import { PRESETS } from './questionnaireModel.js';

const REGISTRY = createCoreComponentRegistry();
const withConfig = (type, overrides) => ({ ...(REGISTRY.get(type)?.defaultConfig || {}), ...(overrides || {}) });
const control = (nodeId, portId) => ({ nodeId, portId });

function constrainRuns(items, category, maximum) {
  const next = [...items];
  for (let index = maximum; index < next.length; index += 1) {
    const value = category(next[index]);
    if (!next.slice(index - maximum, index).every(item => category(item) === value)) continue;
    const swap = next.findIndex((item, candidate) => candidate > index && category(item) !== value);
    if (swap > index) [next[index], next[swap]] = [next[swap], next[index]];
  }
  return next;
}

function seedGraph(options, name) {
  const idFactory = options.idFactory || createSequentialIdFactory();
  const protocol = createProtocolGraph({ idFactory, name, now: options.now || '2026-08-23T00:00:00.000Z' });
  const startId = protocol.graph.entryNodeId;
  const endId = protocol.graph.nodes.find(node => node.component.type === 'core.end').id;
  const edges = protocol.graph.edges.filter(edge => !(edge.kind === 'control' && edge.source.nodeId === startId && edge.target.nodeId === endId));
  return { protocol: { ...protocol, graph: { ...protocol.graph, edges } }, startId, endId, idFactory };
}

function chain(protocol, ids) {
  for (let index = 0; index < ids.length - 1; index += 1) protocol = connect(protocol, 'control', control(ids[index], 'next'), control(ids[index + 1], 'in')).protocol;
  return protocol;
}

function samQuestionnaire(condition, idFactory) {
  const valence = { ...PRESETS.sam_valence(), question_id: idFactory('question') };
  const arousal = { ...PRESETS.sam_arousal(), question_id: idFactory('question') };
  const label = {
    question_id: idFactory('question'), type: 'single_choice', required: true,
    prompt_i18n: { zh: '请选择最符合当前感受的情绪', ja: '現在の感情に最も近いものを選んでください', en: 'Choose the emotion closest to your current feeling' },
    options_i18n: { zh: ['愉快', '悲伤', '紧张', '平静', '其他'], ja: ['喜び', '悲しみ', '緊張', '平静', 'その他'], en: ['Joy', 'Sadness', 'Tension', 'Calm', 'Other'] },
    shuffle: false,
  };
  return { questionnaire_id: idFactory('questionnaire'), name: `SAM ${condition}`, questions: [valence, arousal, label], shuffle_questions: false, show_progress: true };
}

/** Five emotion conditions with configurable counterbalancing and recovery intervals. */
export function createEmotionGraphTemplate(options = {}) {
  const { protocol: seeded, startId, endId, idFactory } = seedGraph(options, 'Emotion (SAM) template');
  let protocol = seeded;
  const conditions = ['HVHA', 'LVHA', 'LVLA', 'HVLA', 'NVLA'];
  const order = createBlockOrder({ items: conditions, rule: options.orderRule || 'latin_square', seed: Number(options.seed ?? 1), manualOrder: options.manualOrder || [] }).order;
  const ids = [startId];
  for (const [index, condition] of order.entries()) {
    const prefix = `c${index}`;
    const fixation = addNode(protocol, 'stimulus.fixation', { id: `${prefix}-fix`, label: `Fixation (${condition})`, config: withConfig('stimulus.fixation', { completion: { mode: 'fixed', durationMs: options.fixationMs ?? 500 } }), layout: { x: 300 + index * 760, y: 80 } });
    protocol = fixation.protocol;
    const source = options.mediaSources?.[condition] || {};
    const media = addNode(protocol, 'display.media', { id: `${prefix}-media`, label: `Video (${condition})`, config: withConfig('display.media', { mediaType: 'video', sourceUrl: source.sourceUrl || '', assetId: source.assetId || null, completion: { mode: source.durationMs ? 'fixed' : 'media-ended', durationMs: source.durationMs || 6000 } }), layout: { x: 500 + index * 760, y: 80 } });
    protocol = media.protocol;
    const sam = addNode(protocol, 'input.questionnaire', { id: `${prefix}-sam`, label: `SAM (${condition})`, config: withConfig('input.questionnaire', { questionnaire: samQuestionnaire(condition, idFactory) }), layout: { x: 700 + index * 760, y: 80 } });
    protocol = sam.protocol;
    const recovery = addNode(protocol, 'timing.wait', { id: `${prefix}-recovery`, label: `Recovery (${condition})`, config: withConfig('timing.wait', { durationMs: options.recoveryMs ?? 3000 }), layout: { x: 900 + index * 760, y: 80 } });
    protocol = recovery.protocol;
    ids.push(fixation.node.id, media.node.id, sam.node.id, recovery.node.id);
  }
  ids.push(endId);
  protocol = chain(protocol, ids);
  return { ...protocol, metadata: { ...protocol.metadata, experimentDesign: { paradigm: 'emotion-sam', conditionOrder: order, orderRule: options.orderRule || 'latin_square', seed: Number(options.seed ?? 1) } } };
}

const STROOP_COLORS = [
  { name: 'red', label: '红 / 赤 / RED', color: '#d32f2f', key: 'r' },
  { name: 'green', label: '绿 / 緑 / GREEN', color: '#198754', key: 'g' },
  { name: 'blue', label: '蓝 / 青 / BLUE', color: '#1565c0', key: 'b' },
  { name: 'yellow', label: '黄 / 黄 / YELLOW', color: '#c28b00', key: 'y' },
];

export function generateStroopTrials({ trials = 16, seed = 1, jitter = 0, fixationMs = 500, responseWindowMs = 2000 } = {}) {
  const count = Math.max(4, Math.round(Number(trials) / 4) * 4);
  const generated = Array.from({ length: count }, (_, index) => {
    const ink = STROOP_COLORS[index % STROOP_COLORS.length];
    const congruent = index % 2 === 0;
    const word = congruent ? ink : STROOP_COLORS[(index + 1 + Math.floor(index / 4)) % STROOP_COLORS.length];
    return {
      trialId: `stroop_${String(index + 1).padStart(3, '0')}`, word: word.name.toUpperCase(), ink: ink.name, inkColor: ink.color,
      expectedKey: ink.key, congruent, fixationMs, responseWindowMs,
      itiMs: createJitteredDuration({ baseMs: 500, jitterMs: Number(jitter), distribution: jitter ? 'uniform' : 'fixed', seed: Number(seed) + index }).durationMs,
    };
  });
  const order = createBlockOrder({ items: generated.map(trial => trial.trialId), rule: 'random', seed: Number(seed), noImmediateRepeat: true }).order;
  return constrainRuns(order.map(id => generated.find(trial => trial.trialId === id)), trial => trial.ink, 2);
}

export function generateGonogoTrials({ trials = 40, goRatio = 70, seed = 1, jitter = 0, fixationMs = 500, responseWindowMs = 1000 } = {}) {
  const count = Math.max(10, Math.round(Number(trials)));
  const goCount = Math.max(1, Math.min(count - 1, Math.round(count * Number(goRatio) / 100)));
  const generated = Array.from({ length: count }, (_, index) => {
    const isGo = index < goCount;
    return {
      trialId: `gonogo_${String(index + 1).padStart(3, '0')}`, stimulus: isGo ? 'X' : 'O', trialType: isGo ? 'go' : 'nogo', expectedKey: isGo ? 'space' : null,
      fixationMs, responseWindowMs,
      itiMs: createJitteredDuration({ baseMs: 500, jitterMs: Number(jitter), distribution: jitter ? 'uniform' : 'fixed', seed: Number(seed) + index }).durationMs,
    };
  });
  const order = createBlockOrder({ items: generated.map(trial => trial.trialId), rule: 'random', seed: Number(seed), maxConsecutiveSame: 3 }).order;
  return constrainRuns(order.map(id => generated.find(trial => trial.trialId === id)), trial => trial.trialType, 3);
}

function createCognitiveTaskTemplate(options, kind) {
  const name = kind === 'stroop' ? 'Stroop template' : 'Go/No-Go template';
  const { protocol: seeded, startId, endId } = seedGraph(options, name);
  let protocol = seeded;
  const seed = Number(options.seed ?? 1);
  const generator = kind === 'stroop' ? generateStroopTrials : generateGonogoTrials;
  const common = { seed, jitter: Number(options.jitter ?? 0), fixationMs: Number(options.fixationMs ?? 500), responseWindowMs: Number(options.responseWindowMs ?? (kind === 'stroop' ? 2000 : 1000)) };
  const ids = [startId];
  if (options.practice !== false) {
    const practiceTrials = generator({ ...common, trials: kind === 'stroop' ? 8 : 10, goRatio: options.goRatio ?? 70, seed: seed - 1 });
    const practice = addNode(protocol, 'experiment.cognitive-task', { id: 'practice', label: `${kind === 'stroop' ? 'Stroop' : 'Go/No-Go'} practice`, config: { taskKind: kind, practice: true, seed: seed - 1, goRatio: options.goRatio ?? 70, trials: practiceTrials }, layout: { x: 300, y: 180 } });
    protocol = practice.protocol;
    ids.push(practice.node.id);
  }
  const mainTrials = generator({ ...common, trials: options.trials ?? (kind === 'stroop' ? 16 : 40), goRatio: options.goRatio ?? 70 });
  const task = addNode(protocol, 'experiment.cognitive-task', { id: 'task', label: kind === 'stroop' ? 'Stroop trials' : 'Go/No-Go trials', config: { taskKind: kind, practice: false, seed, goRatio: options.goRatio ?? 70, jitterMs: common.jitter, trials: mainTrials }, layout: { x: 540, y: 180 } });
  protocol = task.protocol;
  ids.push(task.node.id, endId);
  protocol = chain(protocol, ids);
  return { ...protocol, metadata: { ...protocol.metadata, experimentDesign: { paradigm: kind, seed, practice: options.practice !== false, trials: mainTrials.length, jitterMs: common.jitter, ...(kind === 'gonogo' ? { goRatio: Number(options.goRatio ?? 70) } : {}) } } };
}

export function createStroopGraphTemplate(options = {}) { return createCognitiveTaskTemplate(options, 'stroop'); }
export function createGonogoGraphTemplate(options = {}) { return createCognitiveTaskTemplate(options, 'gonogo'); }
