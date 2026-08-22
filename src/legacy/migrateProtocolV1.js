import { createEdge, createNode, createProtocolGraph } from '../core/protocolGraph.js';
import { createParticipantScreen, createUiElement } from '../core/participantUi.js';

const EXACT_COMPONENT_MAP = {
  instruction: 'display.screen',
  image: 'display.media',
  video: 'display.media',
  audio: 'display.media',
  fixation: 'timing.wait',
  timer: 'timing.wait',
  rest: 'timing.wait',
  response: 'input.rating',
  questionnaire: 'input.questionnaire',
};

function reportIssue(code, message, path, severity = 'warning') {
  return { code, message, path, severity };
}

export function isLegacyProtocolV1(value) {
  return value?.schema_version === '1.0.0' && Array.isArray(value.blocks);
}

export function inspectLegacyProtocolV1(protocol) {
  const issues = [];
  let trialCount = 0;
  let stepCount = 0;
  let customCodeCount = 0;
  for (const [blockIndex, block] of (protocol?.blocks || []).entries()) {
    const blockPath = `blocks.${blockIndex}`;
    if (block.order_rule !== 'fixed') issues.push(reportIssue('block.order_requires_semantic_migration', `Order rule ${block.order_rule} needs a container policy`, `${blockPath}.order_rule`));
    if (Number(block.repeat_count || 1) !== 1) issues.push(reportIssue('block.repeat_requires_semantic_migration', 'Block repeat needs a container policy', `${blockPath}.repeat_count`));
    for (const [trialIndex, trial] of (block.trials || []).entries()) {
      trialCount += 1;
      const trialPath = `${blockPath}.trials.${trialIndex}`;
      if (Number(trial.repeat_count || 1) !== 1) issues.push(reportIssue('trial.repeat_requires_semantic_migration', 'Trial repeat needs a container policy', `${trialPath}.repeat_count`));
      if (trial.flow?.nodes?.some(node => !['start', 'event', 'end'].includes(node.type))) {
        issues.push(reportIssue('trial.control_flow_requires_review', 'Conditions, loops or junctions need graph-aware migration review', `${trialPath}.flow`));
      }
      for (const [stepIndex, step] of (trial.steps || []).entries()) {
        stepCount += 1;
        if (step.type === 'custom_html' || step.appearance?.custom_css) {
          customCodeCount += 1;
          issues.push(reportIssue('step.custom_code_requires_review', 'Custom HTML or CSS requires sandbox compatibility review', `${trialPath}.steps.${stepIndex}`));
        }
        if (!EXACT_COMPONENT_MAP[step.type]) {
          issues.push(reportIssue('step.legacy_adapter', `Step type ${step.type} will use the legacy adapter`, `${trialPath}.steps.${stepIndex}.type`, 'info'));
        }
      }
    }
  }
  return {
    sourceSchemaVersion: protocol?.schema_version || null,
    counts: {
      blocks: protocol?.blocks?.length || 0,
      trials: trialCount,
      steps: stepCount,
      stimuli: protocol?.stimuli?.length || 0,
      questionnaires: protocol?.questionnaires?.length || 0,
      customCode: customCodeCount,
    },
    issues,
    requiresReview: issues.some(item => item.severity === 'warning' || item.severity === 'error'),
  };
}

function instructionUi(step, idFactory) {
  const content = step.content || step.content_i18n?.en || step.content_i18n?.zh || step.content_i18n?.ja || '';
  return createParticipantScreen({ idFactory, children: [
    createUiElement('Text', { idFactory, props: { text: step.name || 'Instructions', variant: 'heading' } }),
    createUiElement('Text', { idFactory, props: { text: content, variant: 'body' } }),
    createUiElement('Button', { idFactory, props: { label: 'Continue', variant: 'primary' }, actions: [{ event: 'click', action: 'submit' }] }),
  ] });
}

function questionnaireUi(step, context, idFactory) {
  const questionnaire = step.questionnaire || context.source.questionnaires?.find(item => item.questionnaire_id === step.questionnaire_id) || { questions: [] };
  const children = [createUiElement('Text', { idFactory, props: { text: questionnaire.title || step.name || 'Questionnaire', variant: 'heading' } })];
  for (const [index, question] of (questionnaire.questions || []).entries()) {
    const options = question.options || question.options_i18n?.en || [];
    const rating = ['single_choice', 'scale', 'likert', 'rating'].includes(question.type);
    children.push(createUiElement('Input', { idFactory, props: {
      name: question.question_id || `question_${index + 1}`,
      label: question.text || question.prompt || question.text_i18n?.en || question.text_i18n?.zh || `Question ${index + 1}`,
      inputType: rating ? 'rating' : question.type === 'long_text' ? 'textarea' : 'text',
      min: 1,
      max: Math.max(2, options.length || Number(question.max || 7)),
      required: question.required !== false,
    } }));
  }
  children.push(createUiElement('Button', { idFactory, props: { label: 'Submit', variant: 'primary' }, actions: [{ event: 'click', action: 'submit' }] }));
  return createParticipantScreen({ idFactory, children });
}

function migrateStep(step, context, idFactory, x, y) {
  const componentType = EXACT_COMPONENT_MAP[step.type] || 'legacy.step';
  let config;
  if (componentType === 'display.media') {
    config = {
      mediaType: step.type,
      assetId: step.asset_id || step.stimulus_id || null,
      sourceMode: step.source_mode || 'none',
      sourceUrl: step.source_url || '',
      completion: { mode: step.duration_mode || 'manual', durationMs: Number(step.planned_duration_ms || 0) },
      legacyStep: structuredClone(step),
    };
  } else if (componentType === 'timing.wait') {
    config = { durationMs: Number(step.planned_duration_ms || 0), legacyType: step.type, legacyStep: structuredClone(step) };
  } else if (componentType === 'display.screen') {
    config = {
      ui: instructionUi(step, idFactory),
      completion: { mode: step.duration_mode || 'manual', durationMs: Number(step.planned_duration_ms || 0) },
      legacyStep: structuredClone(step),
    };
  } else if (componentType === 'input.rating') {
    config = {
      required: step.response_required !== false,
      variable: step.response_variable || 'response',
      options: structuredClone(step.response_options || []),
      legacyStep: structuredClone(step),
    };
  } else if (componentType === 'input.questionnaire') {
    config = { questionnaire: structuredClone(step.questionnaire || context.source.questionnaires?.find(item => item.questionnaire_id === step.questionnaire_id) || null), ui: questionnaireUi(step, context, idFactory), legacyStep: structuredClone(step) };
  } else {
    config = { legacyStep: structuredClone(step) };
  }
  return createNode(componentType, {
    id: idFactory('node'),
    label: step.name || step.type,
    config,
    layout: { x, y },
    metadata: {
      legacy: {
        blockId: context.block.block_id,
        trialId: context.trial.trial_id,
        stepId: step.step_id,
        stepType: step.type,
      },
    },
  });
}

export function migrateLegacyProtocolV1(source, options = {}) {
  if (!isLegacyProtocolV1(source)) throw new Error('Expected a legacy PhysioFlow 1.0.0 protocol');
  const idFactory = options.idFactory;
  if (typeof idFactory !== 'function') throw new Error('Migration requires an explicit ID factory');
  const now = options.now || new Date().toISOString();
  const protocol = createProtocolGraph({
    idFactory,
    now,
    protocolId: options.protocolId || idFactory('protocol'),
    projectId: source.project_id || idFactory('project'),
    name: source.name,
    description: source.description || '',
  });
  protocol.metadata.tags = ['migrated-v1'];
  protocol.version = {
    number: Number(source.version || 1),
    label: `${source.version_name || `Version ${source.version || 1}`} (migrated)`,
    status: 'draft',
  };
  protocol.assets = structuredClone(source.stimuli || []);
  protocol.templates = structuredClone(source.questionnaires || []);
  protocol.participantUi.theme = structuredClone(source.theme || {});
  protocol.legacy = {
    sourceSchemaVersion: source.schema_version,
    sourceProtocolId: source.protocol_id,
    sourceProjectId: source.project_id,
    migratedAt: now,
  };

  const start = protocol.graph.nodes.find(node => node.component.type === 'core.start');
  const end = protocol.graph.nodes.find(node => node.component.type === 'core.end');
  const nodes = [start, end];
  const edges = [];
  const idMap = { blocks: {}, trials: {}, steps: {} };
  let previous = { nodeId: start.id, portId: 'next' };
  let order = 0;
  for (const block of source.blocks || []) {
    idMap.blocks[block.block_id] = idFactory('container');
    for (const trial of block.trials || []) {
      idMap.trials[trial.trial_id] = idFactory('subflow');
      for (const step of trial.steps || []) {
        const node = migrateStep(step, { block, trial, source }, idFactory, 280 + order * 220, 180);
        order += 1;
        nodes.push(node);
        idMap.steps[step.step_id] = node.id;
        edges.push(createEdge('control', previous, { nodeId: node.id, portId: 'in' }, { idFactory }));
        previous = { nodeId: node.id, portId: 'next' };
      }
    }
  }
  edges.push(createEdge('control', previous, { nodeId: end.id, portId: 'in' }, { idFactory }));
  protocol.graph.nodes = nodes;
  protocol.graph.edges = edges;
  end.layout.x = 280 + order * 220;

  const inspection = inspectLegacyProtocolV1(source);
  const report = {
    ...inspection,
    targetSchemaVersion: protocol.schemaVersion,
    migratedAt: now,
    idMap,
    executionMode: 'linear-safe-draft',
    formalRunAllowed: false,
    coverage: {
      mappedSteps: inspection.counts.steps - inspection.issues.filter(issue => issue.code === 'step.legacy_adapter').length,
      totalSteps: inspection.counts.steps,
      mappedPercent: inspection.counts.steps ? Math.round(((inspection.counts.steps - inspection.issues.filter(issue => issue.code === 'step.legacy_adapter').length) / inspection.counts.steps) * 1000) / 10 : 100,
      payloadPreservedPercent: 100,
    },
  };
  protocol.legacy.migrationReport = report;
  return { protocol, report };
}
