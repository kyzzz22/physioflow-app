const REQUIRED_TASKS = [1, 2, 3, 4, 5];
const REQUIRED_COHORTS = ['novice', 'experienced'];
const REQUIRED_SIGNOFFS = ['designer', 'operator', 'dataAnalyst'];

const isFiniteNonNegative = value => Number.isFinite(value) && value >= 0;

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeUsabilityStudy(study) {
  const issues = [];
  const failures = [];
  const observations = Array.isArray(study?.observations) ? study.observations : [];
  if (typeof study?.appCommit !== 'string' || !study.appCommit.trim()) issues.push('appCommit is required');
  if (!observations.length) issues.push('observations are required');

  const participants = new Map();
  const observationKeys = new Set();
  observations.forEach((observation, index) => {
    const label = `observations[${index}]`;
    const code = typeof observation?.participantCode === 'string' ? observation.participantCode.trim() : '';
    if (!code) issues.push(`${label}.participantCode is required`);
    if (!REQUIRED_COHORTS.includes(observation?.cohort)) issues.push(`${label}.cohort must be novice or experienced`);
    if (!REQUIRED_TASKS.includes(observation?.task)) issues.push(`${label}.task must be an integer from 1 to 5`);
    if (typeof observation?.success !== 'boolean') issues.push(`${label}.success must be boolean`);
    if (typeof observation?.successWithoutHelp !== 'boolean') issues.push(`${label}.successWithoutHelp must be boolean`);
    if (observation?.successWithoutHelp && !observation?.success) issues.push(`${label} cannot succeed without help when success is false`);
    if (observation?.task === 1 && !isFiniteNonNegative(observation.elapsedSeconds)) issues.push(`${label}.elapsedSeconds is required for task 1`);
    if (observation?.task === 2 && !isFiniteNonNegative(observation.primaryOperations)) issues.push(`${label}.primaryOperations is required for task 2`);
    if (observation?.task === 3 && typeof observation.errorLocationUnderstood !== 'boolean') issues.push(`${label}.errorLocationUnderstood is required for task 3`);
    if (!code || !REQUIRED_TASKS.includes(observation?.task)) return;
    const key = `${code}:${observation.task}`;
    if (observationKeys.has(key)) issues.push(`duplicate observation ${key}`);
    observationKeys.add(key);
    const participant = participants.get(code) || { code, cohort: observation.cohort, tasks: new Set() };
    if (participant.cohort !== observation.cohort) issues.push(`${code} has inconsistent cohorts`);
    participant.tasks.add(observation.task);
    participants.set(code, participant);
  });

  participants.forEach(participant => {
    const missing = REQUIRED_TASKS.filter(task => !participant.tasks.has(task));
    if (missing.length) issues.push(`${participant.code} is missing tasks ${missing.join(', ')}`);
  });
  const cohortCounts = Object.fromEntries(REQUIRED_COHORTS.map(cohort => [cohort, [...participants.values()].filter(participant => participant.cohort === cohort).length]));
  REQUIRED_COHORTS.forEach(cohort => {
    if (cohortCounts[cohort] < 5) issues.push(`${cohort} cohort needs at least 5 participants`);
  });

  const task1Times = observations.filter(item => item.task === 1 && isFiniteNonNegative(item.elapsedSeconds)).map(item => item.elapsedSeconds);
  const task2Operations = observations.filter(item => item.task === 2 && isFiniteNonNegative(item.primaryOperations)).map(item => item.primaryOperations);
  const noHelpRate = observations.length ? observations.filter(item => item.successWithoutHelp === true).length / observations.length : null;
  const task1MedianSeconds = median(task1Times);
  const task2MaximumOperations = task2Operations.length ? Math.max(...task2Operations) : null;
  const task3Observations = observations.filter(item => item.task === 3);
  const task3LocationsUnderstood = task3Observations.length ? task3Observations.every(item => item.errorLocationUnderstood === true) : null;
  const coreTasksSuccessful = observations.length ? observations.every(item => item.success === true) : null;

  if (task1MedianSeconds != null && task1MedianSeconds > 600) failures.push(`task 1 median is ${task1MedianSeconds}s, above 600s`);
  if (task2MaximumOperations != null && task2MaximumOperations > 8) failures.push(`task 2 maximum is ${task2MaximumOperations} operations, above 8`);
  if (noHelpRate != null && noHelpRate < 0.8) failures.push(`success-without-help rate is ${(noHelpRate * 100).toFixed(1)}%, below 80%`);
  if (task3LocationsUnderstood === false) failures.push('not every task 3 error location was understood');
  if (coreTasksSuccessful === false) failures.push('not every core task was completed successfully');

  const defects = Array.isArray(study?.defects) ? study.defects : [];
  if (study?.defects != null && !Array.isArray(study.defects)) issues.push('defects must be an array');
  const unresolvedCriticalDefects = defects.filter(defect => ['blocking', 'data_integrity'].includes(defect.severity) && defect.status !== 'resolved');
  if (unresolvedCriticalDefects.length) failures.push(`${unresolvedCriticalDefects.length} blocking or data-integrity defects remain unresolved`);
  REQUIRED_SIGNOFFS.forEach(role => {
    const signoff = study?.signoffs?.[role];
    if (signoff?.accepted !== true || typeof signoff?.reviewer !== 'string' || !signoff.reviewer.trim()) issues.push(`${role} sign-off with reviewer is required`);
  });

  return {
    schemaVersion: '1.0.0',
    complete: issues.length === 0,
    passed: issues.length === 0 && failures.length === 0,
    appCommit: study?.appCommit || '',
    participantCount: participants.size,
    cohortCounts,
    observationCount: observations.length,
    metrics: {
      task1MedianSeconds,
      task2MaximumOperations,
      successWithoutHelpRate: noHelpRate,
      task3LocationsUnderstood,
      coreTasksSuccessful,
      unresolvedCriticalDefects: unresolvedCriticalDefects.length,
    },
    issues,
    failures,
  };
}
