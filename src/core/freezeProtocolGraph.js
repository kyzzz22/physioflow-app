import { serializeProtocolGraph } from './serialization.js';
import { validateProtocolGraph } from './validateProtocolGraph.js';
import { validateParticipantUi } from './participantUi.js';

function hashableProtocol(protocol) {
  const next = structuredClone(protocol);
  delete next.freeze;
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
    const participantComponent = ['display.screen', 'display.media', 'input.rating', 'input.text', 'input.questionnaire', 'timing.wait'].includes(node.component?.type);
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
      const hasSubmit = elements.some(element => element.type === 'Button' && (element.actions || []).some(action => ['submit', 'next'].includes(action.action)));
      if (requiresManualSubmit && !hasSubmit) {
        errors.push({ code: 'config.completion_action_missing', message: `${node.label} needs a submit or next button`, path: `${path}.ui`, nodeId: node.id });
      }
    }
    if (node.component?.type === 'display.media' && !node.config?.sourceUrl && !node.config?.assetId) {
      errors.push({ code: 'config.media_source_missing', message: `${node.label} needs a media URL or asset`, path, nodeId: node.id });
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
    if (node.component?.type === 'logic.random' && (!Number.isFinite(Number(node.config?.probabilityA)) || Number(node.config.probabilityA) < 0 || Number(node.config.probabilityA) > 1)) {
      errors.push({ code: 'config.random_probability_invalid', message: `${node.label} probability must be between 0 and 1`, path, nodeId: node.id });
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
