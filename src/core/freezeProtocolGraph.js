import { serializeProtocolGraph } from './serialization.js';
import { validateProtocolGraph } from './validateProtocolGraph.js';
import { validateParticipantUi } from './participantUi.js';
import { validateQuestionnaire } from './questionnaireModel.js';

function hashableProtocol(protocol) {
  const next = structuredClone(protocol);
  delete next.freeze;
  delete next.collaboration;
  next.audit = { ...next.audit, createdAt: null, updatedAt: null, frozenAt: null, archivedAt: null };
  return next;
}

function uiElements(schema) {
  const elements = [];
  const visit = element => {
    if (!element) return;
    elements.push(element);
    for (const child of element.children || []) visit(child);
  };
  visit(schema?.root);
  return elements;
}

function isPlausibleMediaUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const trimmed = value.trim();
  if (/[\s]/.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return ['http:', 'https:', 'data:', 'blob:'].includes(parsed.protocol);
  } catch {
    // Relative paths (local dev / packaged asset files) must look like a file path.
    return trimmed.includes('/') && !/^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  }
}

export async function hashProtocolGraph(protocol) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable');
  const bytes = new TextEncoder().encode(serializeProtocolGraph(hashableProtocol(protocol), 0));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function validateProtocolGraphConfiguration(protocol, registry) {
  const base = validateProtocolGraph(protocol, registry);
  const errors = [...base.errors];
  const warnings = [...base.warnings];
  for (const node of protocol.graph?.nodes || []) {
    const path = `graph.nodes.${node.id}.config`;
    const definition = registry?.get(node.component?.type, node.component?.version);
    const participantComponent = definition?.runtime?.kind === 'participant' && definition.runtime.uiAdapter !== 'none';
    if (node.component?.type === 'input.questionnaire') {
      const questionnaire = validateQuestionnaire(node.config?.questionnaire);
      errors.push(...questionnaire.errors.map(error => ({ ...error, code: `config.${error.code}`, path: `${path}.questionnaire${error.path ? `.${error.path}` : ''}`, nodeId: node.id })));
      warnings.push(...questionnaire.warnings.map(warning => ({ ...warning, code: `config.${warning.code}`, path: `${path}.questionnaire${warning.path ? `.${warning.path}` : ''}`, nodeId: node.id })));
    }
    if (node.component?.type === 'experiment.cognitive-task') {
      const taskKind = node.config?.taskKind;
      const trials = node.config?.trials;
      if (!['stroop', 'gonogo'].includes(taskKind)) errors.push({ code: 'config.cognitive_task_kind_invalid', message: `${node.label} needs a supported cognitive-task paradigm`, path: `${path}.taskKind`, nodeId: node.id });
      if (!Array.isArray(trials) || trials.length === 0) errors.push({ code: 'config.cognitive_task_trials_empty', message: `${node.label} needs at least one trial`, path: `${path}.trials`, nodeId: node.id });
      const trialIds = new Set();
      for (const [index, trial] of (Array.isArray(trials) ? trials : []).entries()) {
        const trialPath = `${path}.trials.${index}`;
        if (!trial?.trialId?.trim() || trialIds.has(trial.trialId)) errors.push({ code: 'config.cognitive_task_trial_id_invalid', message: `${node.label} has a missing or duplicate trial ID`, path: `${trialPath}.trialId`, nodeId: node.id });
        else trialIds.add(trial.trialId);
        for (const field of ['fixationMs', 'responseWindowMs', 'itiMs']) if (!Number.isFinite(Number(trial?.[field])) || Number(trial[field]) < 0 || (field === 'responseWindowMs' && Number(trial[field]) === 0)) errors.push({ code: 'config.cognitive_task_timing_invalid', message: `${node.label} trial ${index + 1} has invalid ${field}`, path: `${trialPath}.${field}`, nodeId: node.id });
        if (taskKind === 'stroop' && (!trial?.word || !trial?.inkColor || !['r', 'g', 'b', 'y'].includes(trial?.expectedKey))) errors.push({ code: 'config.stroop_trial_invalid', message: `${node.label} trial ${index + 1} needs a word, ink color, and valid response key`, path: trialPath, nodeId: node.id });
        if (taskKind === 'gonogo' && (!['go', 'nogo'].includes(trial?.trialType) || (trial.trialType === 'go' && trial.expectedKey !== 'space') || (trial.trialType === 'nogo' && trial.expectedKey !== null))) errors.push({ code: 'config.gonogo_trial_invalid', message: `${node.label} trial ${index + 1} has invalid Go/No-Go semantics`, path: trialPath, nodeId: node.id });
      }
      if (taskKind === 'gonogo' && Array.isArray(trials) && trials.length) {
        const actualRatio = trials.filter(trial => trial.trialType === 'go').length / trials.length * 100;
        if (Math.abs(actualRatio - Number(node.config?.goRatio)) > (100 / trials.length)) warnings.push({ code: 'config.gonogo_ratio_mismatch', message: `${node.label} generated Go ratio differs from its configured ratio`, path: `${path}.goRatio`, nodeId: node.id });
      }
    }
    if (participantComponent && !node.config?.ui) {
      errors.push({ code: 'config.participant_ui_missing', message: `${node.label} needs a participant interface`, path: `${path}.ui`, nodeId: node.id });
    }
    if (node.config?.ui) {
      const ui = validateParticipantUi(node.config.ui);
      errors.push(...ui.errors.map(issue => ({ ...issue, code: `config.${issue.code}`, path: `${path}.ui.${issue.path}`, nodeId: node.id })));
      warnings.push(...ui.warnings.map(issue => ({ ...issue, code: `config.${issue.code}`, path: `${path}.ui.${issue.path}`, nodeId: node.id })));
      const elements = uiElements(node.config.ui);
      const variableNames = new Set((protocol.variables || []).map(variable => variable.name));
      for (const element of elements) {
        for (const binding of Object.values(element.bindings || {})) {
          const match = typeof binding === 'string' && binding.match(/^variables\.([A-Za-z_][A-Za-z0-9_]*)$/);
          if (match && !variableNames.has(match[1])) errors.push({ code: 'config.ui_variable_missing', message: `${node.label} UI references undeclared variable ${match[1]}`, path: `${path}.ui`, nodeId: node.id });
        }
      }
      const requiresInput = ['input.rating', 'input.text', 'input.questionnaire'].includes(node.component?.type);
      if (requiresInput && !elements.some(element => element.type === 'Input')) {
        errors.push({ code: 'config.input_missing', message: `${node.label} needs at least one participant input`, path: `${path}.ui`, nodeId: node.id });
      }
      const requiresManualSubmit = requiresInput || node.config?.completion?.mode === 'manual';
      // Fixation manual mode gets its Continue button injected by schemaForNode at run time,
      // so the stored UI schema does not need to carry one.
      const injectedButton = node.component?.type === 'stimulus.fixation' && requiresManualSubmit;
      const hasSubmit = injectedButton || elements.some(element => element.type === 'Button' && (element.actions || []).some(action => ['submit', 'next'].includes(action.action)));
      if (requiresManualSubmit && !hasSubmit) {
        errors.push({ code: 'config.completion_action_missing', message: `${node.label} needs a submit or next button`, path: `${path}.ui`, nodeId: node.id });
      }
    }
    if (node.component?.type === 'display.media' && !node.config?.sourceUrl && !node.config?.assetId) {
      errors.push({ code: 'config.media_source_missing', message: `${node.label} needs a media URL or asset`, path, nodeId: node.id });
    }
    if (node.component?.type === 'display.media' && node.config?.sourceUrl && !isPlausibleMediaUrl(node.config.sourceUrl)) {
      errors.push({ code: 'config.media_url_invalid', message: `${node.label} has an invalid media URL`, path: `${path}.sourceUrl`, nodeId: node.id });
    }
    const mediaMode = node.config?.completion?.mode;
    if (node.component?.type === 'display.media' && mediaMode && !['manual', 'fixed', 'media-ended'].includes(mediaMode)) {
      errors.push({ code: 'config.media_mode_invalid', message: `${node.label} needs a supported completion mode`, path: `${path}.completion.mode`, nodeId: node.id });
    }
    if (node.component?.type === 'stimulus.fixation' && node.config?.shape && !['cross', 'dot', 'diamond'].includes(node.config.shape)) {
      errors.push({ code: 'config.fixation_shape_invalid', message: `${node.label} has an unsupported fixation shape`, path: `${path}.shape`, nodeId: node.id });
    }
    const fixedDuration = node.config?.completion?.mode === 'fixed' ? node.config?.completion?.durationMs : undefined;
    if (fixedDuration !== undefined && (!Number.isFinite(Number(fixedDuration)) || Number(fixedDuration) < 0)) {
      errors.push({ code: 'config.duration_invalid', message: `${node.label} needs a non-negative fixed duration`, path, nodeId: node.id });
    }
    if (node.component?.type === 'timing.wait' && (!Number.isFinite(Number(node.config?.durationMs)) || Number(node.config.durationMs) < 0)) {
      errors.push({ code: 'config.wait_duration_invalid', message: `${node.label} needs a non-negative wait duration`, path, nodeId: node.id });
    }
    if (node.component?.type === 'input.rating' && (!Number.isFinite(Number(node.config?.min)) || !Number.isFinite(Number(node.config?.max)) || Number(node.config.min) >= Number(node.config.max))) {
      errors.push({ code: 'config.rating_range_invalid', message: `${node.label} maximum must be greater than minimum`, path, nodeId: node.id });
    }
    if (node.component?.type === 'logic.loop' && (!Number.isInteger(Number(node.config?.maxIterations)) || Number(node.config.maxIterations) < 1)) {
      errors.push({ code: 'config.loop_limit_invalid', message: `${node.label} needs a positive integer iteration limit`, path, nodeId: node.id });
    }
    if (node.component?.type === 'logic.condition' && !['equals', 'not_equals', 'contains', 'greater_than', 'greater_than_or_equal', 'less_than', 'less_than_or_equal', 'is_truthy', 'is_falsy'].includes(node.config?.operator)) {
      errors.push({ code: 'config.condition_operator_invalid', message: `${node.label} needs a supported condition operator`, path, nodeId: node.id });
    }
    if (node.component?.type === 'logic.random') {
      for (const key of ['probabilityA', 'probabilityB', 'probabilityC', 'probabilityD']) {
        if (node.config?.[key] == null) continue;
        if (!Number.isFinite(Number(node.config[key])) || Number(node.config[key]) < 0 || Number(node.config[key]) > 1) {
          errors.push({ code: 'config.random_probability_invalid', message: `${node.label} ${key} must be between 0 and 1`, path: `${path}.${key}`, nodeId: node.id });
        }
      }
    }
    if (node.component?.type === 'logic.loop' && node.config?.untilRule?.operator && !['equals', 'not_equals', 'contains', 'greater_than', 'greater_than_or_equal', 'less_than', 'less_than_or_equal', 'is_truthy', 'is_falsy'].includes(node.config.untilRule.operator)) {
      errors.push({ code: 'config.loop_until_operator_invalid', message: `${node.label} has an unsupported until-rule operator`, path: `${path}.untilRule.operator`, nodeId: node.id });
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function validateProtocolGraphForFreeze(protocol, registry) {
  const result = validateProtocolGraphConfiguration(protocol, registry);
  const errors = [...result.errors];
  if (protocol?.legacy?.migrationReport?.formalRunAllowed === false) errors.push({ code: 'migration.review_required', message: 'Migration review must be acknowledged before freezing', path: 'legacy.migrationReport' });
  return { valid: errors.length === 0, errors, warnings: result.warnings };
}

export async function freezeProtocolGraph(protocol, registry, options = {}) {
  const check = validateProtocolGraphForFreeze(protocol, registry);
  if (!check.valid) throw new Error(`Protocol Graph cannot be frozen:\n${check.errors.map(error => error.message).join('\n')}`);
  const now = options.now || new Date().toISOString();
  const next = structuredClone(protocol);
  next.version = { ...next.version, status: 'frozen' };
  next.audit = { ...next.audit, updatedAt: now, frozenAt: now };
  next.freeze = { configHash: await hashProtocolGraph(next), frozenAt: now, dataContractVersion: '2.0.0-alpha.1' };
  return next;
}
