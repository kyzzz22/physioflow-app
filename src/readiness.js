import { stepContentIssues, validateProtocol } from './domain.js';

const MEDIA_TYPES = new Set(['video', 'audio', 'image']);

function countHierarchy(protocol) {
  const blocks = protocol?.blocks || [];
  const trials = blocks.flatMap(block => block.trials || []);
  const steps = trials.flatMap(trial => trial.steps || []);
  return { blocks: blocks.length, trials: trials.length, steps };
}

function mediaHasSource(step, stimuli) {
  const resource = stimuli.find(item => item.stimulus_id === step.stimulus_id);
  return Boolean(step.source_url || step.asset_id || resource?.source_url || resource?.asset_id);
}

function sessionMatchesProtocol(session, protocol) {
  return session.protocol_id === protocol.protocol_id ||
    (session.protocol_name === protocol.name && Number(session.protocol_version) === Number(protocol.version));
}

export function assessProtocolReadiness(protocol, { sessions = [], storageInfo = {} } = {}) {
  const validation = validateProtocol(protocol);
  const stimuli = protocol?.stimuli || [];
  const questionnaires = protocol?.questionnaires || [];
  const { blocks, trials, steps } = countHierarchy(protocol);
  const mediaSteps = steps.filter(step => MEDIA_TYPES.has(step.type));
  const missingMedia = mediaSteps.filter(step => !mediaHasSource(step, stimuli));
  const analysisWindows = steps.filter(step => step.is_analysis_window);
  const contentIssues = steps.flatMap(step => stepContentIssues(step, stimuli, questionnaires).map(issue => ({ ...issue, step })));
  const contentErrors = contentIssues.filter(issue => issue.kind === 'error');
  const contentWarnings = contentIssues.filter(issue => issue.kind === 'warn');
  const matchingSessions = sessions.filter(session => sessionMatchesProtocol(session, protocol));
  const completedSessions = matchingSessions.filter(session => session.status === 'completed');
  const formalSessions = completedSessions.filter(session => session.run_mode === 'formal');
  const previewSessions = completedSessions.filter(session => session.run_mode === 'preview');

  const items = [
    {
      id: 'structure',
      label: 'Experiment structure',
      passed: blocks > 0 && trials > 0 && steps.length > 0,
      severity: 'error',
      detail: `${blocks} blocks, ${trials} trials, ${steps.length} steps.`,
      action: 'Add at least one block, trial, and event node.',
    },
    {
      id: 'validation',
      label: 'Protocol validation',
      passed: validation.errors.length === 0,
      severity: 'error',
      detail: validation.errors.length ? `${validation.errors.length} blocking issue(s).` : 'No blocking validation errors.',
      action: validation.errors.slice(0, 3).join(' '),
    },
    {
      id: 'content',
      label: 'Required content',
      passed: contentErrors.length === 0,
      severity: 'error',
      detail: contentErrors.length ? `${contentErrors.length} step content error(s).` : `${contentWarnings.length} optional warning(s).`,
      action: contentErrors[0]?.message || contentWarnings[0]?.message || 'Participant-facing content is ready.',
    },
    {
      id: 'media',
      label: 'Stimulus media',
      passed: missingMedia.length === 0,
      severity: 'error',
      detail: mediaSteps.length ? `${mediaSteps.length - missingMedia.length}/${mediaSteps.length} media step(s) have sources.` : 'No media steps in this protocol.',
      action: missingMedia.length ? 'Attach a URL, uploaded file, or reusable stimulus to every media step.' : 'Media sources are assigned.',
    },
    {
      id: 'analysis',
      label: 'Analysis windows',
      passed: analysisWindows.length > 0,
      severity: 'warning',
      detail: analysisWindows.length ? `${analysisWindows.length} analysis window(s) will be exported.` : 'No analysis windows configured.',
      action: 'Enable Generate analysis window on baseline, stimulus, task, or recovery steps that need physiological analysis.',
    },
    {
      id: 'freeze',
      label: 'Frozen reproducible version',
      passed: protocol.status === 'frozen' && Boolean(protocol.config_hash),
      severity: 'warning',
      detail: protocol.status === 'frozen' ? `Hash ${String(protocol.config_hash || '').slice(0, 12)}...` : 'Current version is editable draft.',
      action: 'Freeze a validated version before formal collection.',
    },
    {
      id: 'test-session',
      label: 'Pilot run evidence',
      passed: previewSessions.length > 0 || formalSessions.length > 0,
      severity: 'warning',
      detail: `${previewSessions.length} preview, ${formalSessions.length} formal completed session(s).`,
      action: 'Run one preview session and inspect the export before handing the tool to operators.',
    },
    {
      id: 'storage',
      label: 'Local data storage',
      passed: Boolean(storageInfo?.selected),
      severity: protocol.status === 'frozen' ? 'error' : 'warning',
      detail: storageInfo?.selected ? `Folder: ${storageInfo.name || 'selected'}` : 'No local data folder selected.',
      action: protocol.status === 'frozen'
        ? 'Formal collection requires the desktop app or a selected local data folder.'
        : 'Use the desktop app or select a local folder before formal collection.',
    },
  ];

  const blocking = items.filter(item => !item.passed && item.severity === 'error').length;
  const warnings = items.filter(item => !item.passed && item.severity === 'warning').length + validation.warnings.length + contentWarnings.length;
  const passed = items.filter(item => item.passed).length;
  const score = Math.round((passed / items.length) * 100);
  const status = blocking ? 'blocked' : warnings ? 'attention' : 'ready';

  return {
    status,
    score,
    blocking,
    warnings,
    passed,
    total: items.length,
    items,
    facts: {
      blocks,
      trials,
      steps: steps.length,
      media_steps: mediaSteps.length,
      missing_media: missingMedia.length,
      analysis_windows: analysisWindows.length,
      validation_errors: validation.errors.length,
      validation_warnings: validation.warnings.length,
      content_errors: contentErrors.length,
      content_warnings: contentWarnings.length,
      completed_sessions: completedSessions.length,
      preview_sessions: previewSessions.length,
      formal_sessions: formalSessions.length,
    },
  };
}

export function summarizeWorkspaceReadiness(protocols, sessions, storageInfo) {
  const active = (protocols || []).filter(protocol => protocol.status !== 'retired' && !protocol.archived_at);
  const assessments = active.map(protocol => assessProtocolReadiness(protocol, { sessions, storageInfo }));
  return {
    total: active.length,
    ready: assessments.filter(item => item.status === 'ready').length,
    attention: assessments.filter(item => item.status === 'attention').length,
    blocked: assessments.filter(item => item.status === 'blocked').length,
    averageScore: assessments.length ? Math.round(assessments.reduce((sum, item) => sum + item.score, 0) / assessments.length) : 0,
  };
}
