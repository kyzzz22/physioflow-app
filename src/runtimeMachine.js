import { resolveTrials } from './engine.js';
import { evaluateRule, normalizeFlow } from './flowEngine.js';

const MAX_CONTROL_TRANSITIONS = 10000;

function expandUnits(protocol, session) {
  const units = [];
  protocol.blocks.forEach((block, blockOrder) => {
    const blockRepeats = Math.max(0, Number(block.repeat_count ?? 1));
    for (let blockRepeat = 0; blockRepeat < blockRepeats; blockRepeat++) {
      const constraints = { max_consecutive_same: block.max_consecutive_same || 0, no_immediate_repeat: block.no_immediate_repeat || false };
      const ordered = resolveTrials(block.trials, block.order_rule, Number(session.order_row ?? 0), session.manual_orders?.[block.block_id] || [], constraints);
      ordered.forEach((trial, trialOrder) => {
        const trialRepeats = Math.max(0, Number(trial.repeat_count ?? 1));
        for (let trialRepeat = 0; trialRepeat < trialRepeats; trialRepeat++) units.push({ block, blockOrder, blockRepeat, trial, trialOrder, trialRepeat, iti_jitter_ms: trial.iti_jitter_ms || 0, iti_jitter_distribution: trial.iti_jitter_distribution || 'fixed', is_practice: block.is_practice || false });
      });
    }
  });
  return units;
}

export function createRuntime(protocol, session) {
  const units = expandUnits(protocol, session);
  const state = {
    schema_version: 1,
    status: 'ready',
    unit_index: 0,
    node_id: null,
    loop_counts: {},
    variables: {
      participant_id: session.participant_id,
      participant_language: session.participant_language,
      order_row: session.order_row,
      answers: {},
      session: { ...session },
      // Performance tracking for adaptive experiments
      last_accuracy: null,
      last_rt_ms: null,
      cumulative_accuracy: null,
      cumulative_rt_sum_ms: 0,
      cumulative_rt_count: 0,
      last_attention_passed: null,
      attention_fail_count: 0,
      attention_total_count: 0,
    },
    completed_steps: [],
    skipped_steps: [],
    retries: {},
    transition_count: 0,
  };
  return advanceRuntime(state, units);
}

export function restoreRuntime(snapshot, protocol, session) {
  const units = expandUnits(protocol, session);
  return { state: structuredClone(snapshot), units };
}

export function currentRuntimeItem(runtime, units) {
  const unit = units[runtime.unit_index];
  if (!unit || !runtime.node_id) return null;
  const flow = normalizeFlow(unit.trial);
  const node = flow.nodes.find(item => item.id === runtime.node_id);
  const step = node?.type === 'event' ? unit.trial.steps.find(item => item.step_id === node.step_id) : null;
  return step ? { ...unit, unit_index:runtime.unit_index, node, step } : null;
}

export function completeRuntimeStep(runtime, units, answers = []) {
  const state = structuredClone(runtime);
  const current = currentRuntimeItem(state, units);
  if (!current) return { state, units };
  state.completed_steps.push({ unit_index: state.unit_index, node_id: state.node_id, step_id: current.step.step_id, completed_at_epoch_ms: Date.now() });
  const RESERVED = new Set(['answers', 'session', 'condition', 'participant_id', 'participant_language', 'order_row', 'last_step_id', 'answer',
    'last_accuracy', 'last_rt_ms', 'cumulative_accuracy', 'cumulative_rt_sum_ms', 'cumulative_rt_count', 'last_attention_passed', 'attention_fail_count', 'attention_total_count']);
  answers.forEach(answer => {
    state.variables.answers[answer.question_id] = answer.value;
    state.variables[`answer.${answer.question_id}`] = answer.value;
    // Only set direct variable if not a reserved name
    if (!RESERVED.has(answer.question_id)) {
      state.variables[answer.question_id] = answer.value;
    }
  });
  // Track reaction time if provided (Response step type)
  if (current.step.type === 'response' && answers.some(a => a.reaction_time_ms != null)) {
    const rt = answers.find(a => a.reaction_time_ms != null)?.reaction_time_ms;
    state.variables.last_rt_ms = rt;
    state.variables.cumulative_rt_sum_ms += (rt || 0);
    state.variables.cumulative_rt_count += 1;
    state.variables.answer.rt_ms = rt;
  }
  // Track accuracy if answer has an expected value
  if (answers.some(a => a.expected_value != null)) {
    const acc = answers.filter(a => a.expected_value != null).every(a => String(a.value) === String(a.expected_value));
    state.variables.last_accuracy = acc;
    const prevTotal = (runtime.variables.cumulative_accuracy != null) ? (runtime.variables._accuracy_total || 0) : 0;
    const prevCorrect = (runtime.variables.cumulative_accuracy != null) ? (runtime.variables._accuracy_correct || 0) : 0;
    state.variables._accuracy_total = prevTotal + 1;
    state.variables._accuracy_correct = prevCorrect + (acc ? 1 : 0);
    state.variables.cumulative_accuracy = state.variables._accuracy_total > 0 ? state.variables._accuracy_correct / state.variables._accuracy_total : null;
    state.variables.answer.correct = acc;
  }
  state.variables.last_step_id = current.step.step_id;
  state.variables.condition = current.trial.condition;
  return advanceRuntime(state, units, state.node_id);
}

/** Record the result of an attention check step.
 *  @param {object} runtime — current runtime state
 *  @param {boolean} passed — whether the participant responded correctly
 *  @param {number|null} rtMs — reaction time in ms
 *  @returns {object} new runtime state
 */
export function recordAttentionResult(runtime, passed, rtMs = null) {
  const state = structuredClone(runtime);
  state.variables.last_attention_passed = passed;
  state.variables.attention_total_count = (state.variables.attention_total_count || 0) + 1;
  if (!passed) state.variables.attention_fail_count = (state.variables.attention_fail_count || 0) + 1;
  state.variables.last_rt_ms = rtMs;
  return state;
}

export function skipRuntimeStep(runtime, units) {
  const state = structuredClone(runtime);
  const current = currentRuntimeItem(state, units);
  if (current) state.skipped_steps.push({ unit_index: state.unit_index, node_id: state.node_id, step_id: current.step.step_id, skipped_at_epoch_ms: Date.now() });
  return advanceRuntime(state, units, state.node_id);
}

export function retryRuntimeStep(runtime) {
  const state = structuredClone(runtime);
  const key = `${state.unit_index}:${state.node_id}`;
  state.retries[key] = (state.retries[key] || 0) + 1;
  return state;
}

function advanceRuntime(runtime, units, fromNodeId = null) {
  const state = structuredClone(runtime);
  state.status = 'running';
  let guard = 0;
  let nextFrom = fromNodeId;
  while (guard++ < MAX_CONTROL_TRANSITIONS) {
    const unit = units[state.unit_index];
    if (!unit) { state.status = 'completed'; state.node_id = null; return { state, units }; }
    const flow = normalizeFlow(unit.trial);
    const nodes = new Map(flow.nodes.map(node => [node.id, node]));
    let node;
    if (nextFrom === null) node = flow.nodes.find(item => item.type === 'start') || flow.nodes[0];
    else {
      const source = nodes.get(nextFrom);
      const outgoing = flow.edges.filter(edge => edge.source === nextFrom);
      let edge;
      if (source?.type === 'condition') edge = outgoing.find(item => item.branch === (evaluateRule(source.rule, { condition: unit.trial.condition, ...state.variables }) ? 'true' : 'false'));
      else if (source?.type === 'loop') {
        const key = `${state.unit_index}:${source.id}`;
        const count = state.loop_counts[key] || 0;
        const limit = Math.max(0, Number.isFinite(Number(source.max_iterations)) ? Number(source.max_iterations) : 1);
        const loopVars = { condition: unit.trial.condition, ...state.variables };
        const condition = !source.rule?.variable || evaluateRule(source.rule, loopVars);
        const repeat = count < limit && condition;
        if (repeat) state.loop_counts[key] = count + 1;
        edge = outgoing.find(item => item.branch === (repeat ? 'body' : 'exit'));
      } else edge = outgoing.find(item => item.branch === 'next') || outgoing[0];
      node = edge ? nodes.get(edge.target) : null;
    }
    state.transition_count += 1;
    if (!node || node.type === 'end') {
      state.unit_index += 1;
      state.node_id = null;
      nextFrom = null;
      continue;
    }
    if (node.type === 'event') {
      state.node_id = node.id;
      state.variables.condition = unit.trial.condition;
      return { state, units };
    }
    nextFrom = node.id;
  }
  state.status = 'invalid';
  state.error = 'control_transition_limit_exceeded';
  state.node_id = null;
  return { state, units };
}

export function runtimeProgress(runtime, units) {
  return { current_unit: Math.min(runtime.unit_index + 1, units.length), total_units: units.length, completed_steps: runtime.completed_steps.length };
}

export function runtimeBoundaryEvents(previous,nextRuntime,units){
  if(!previous||nextRuntime.unit_index===previous.unit_index)return[];
  const nextUnit=units[nextRuntime.unit_index],events=[{type:'trial_completed',metadata:{block_repeat_index:previous.blockRepeat,trial_repeat_index:previous.trialRepeat}}];
  if(!nextUnit||nextUnit.blockOrder!==previous.blockOrder||nextUnit.blockRepeat!==previous.blockRepeat)events.push({type:'block_completed',metadata:{block_repeat_index:previous.blockRepeat}});
  return events;
}
