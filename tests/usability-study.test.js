import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeUsabilityStudy } from '../src/usability/studyMetrics.js';

function validStudy() {
  const observations = [];
  for (const cohort of ['novice', 'experienced']) {
    for (let participant = 1; participant <= 5; participant += 1) {
      for (let task = 1; task <= 5; task += 1) {
        observations.push({
          participantCode: `${cohort}-${participant}`,
          cohort,
          task,
          success: true,
          successWithoutHelp: !(cohort === 'novice' && participant === 1 && task <= 2),
          ...(task === 1 ? { elapsedSeconds: cohort === 'novice' ? 540 : 360 } : {}),
          ...(task === 2 ? { primaryOperations: 8 } : {}),
          ...(task === 3 ? { errorLocationUnderstood: true } : {}),
        });
      }
    }
  }
  return {
    appCommit: 'abc1234', observations, defects: [],
    signoffs: {
      designer: { accepted: true, reviewer: 'D01' },
      operator: { accepted: true, reviewer: 'O01' },
      dataAnalyst: { accepted: true, reviewer: 'A01' },
    },
  };
}

test('usability verifier accepts a complete study meeting every release threshold', () => {
  const report = summarizeUsabilityStudy(validStudy());
  assert.equal(report.complete, true);
  assert.equal(report.passed, true);
  assert.equal(report.participantCount, 10);
  assert.equal(report.observationCount, 50);
  assert.equal(report.metrics.task1MedianSeconds, 450);
  assert.equal(report.metrics.successWithoutHelpRate, 0.96);
});

test('usability verifier distinguishes incomplete evidence from failed metrics', () => {
  const study = validStudy();
  study.observations = study.observations.filter(item => item.participantCode !== 'novice-5');
  study.observations.find(item => item.task === 1).elapsedSeconds = 900;
  study.observations.filter(item => item.task === 2).forEach(item => { item.primaryOperations = 10; });
  study.defects.push({ severity: 'data_integrity', status: 'open' });
  study.signoffs.operator = { accepted: false, reviewer: '' };
  const report = summarizeUsabilityStudy(study);
  assert.equal(report.complete, false);
  assert.equal(report.passed, false);
  assert.ok(report.issues.some(issue => issue.includes('novice cohort')));
  assert.ok(report.issues.some(issue => issue.includes('operator sign-off')));
  assert.ok(report.failures.some(failure => failure.includes('operations')));
  assert.ok(report.failures.some(failure => failure.includes('data-integrity')));
});
