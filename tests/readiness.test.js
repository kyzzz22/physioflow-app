import assert from 'node:assert/strict';
import test from 'node:test';
import { block, protocol, step, trial } from '../src/domain.js';
import { assessProtocolReadiness, summarizeWorkspaceReadiness } from '../src/readiness.js';

test('draft protocol readiness exposes blocking content and handoff warnings', () => {
  const p = protocol();
  const result = assessProtocolReadiness(p, { sessions: [], storageInfo: { selected: false } });

  assert.equal(result.status, 'attention');
  assert.equal(result.items.find(item => item.id === 'structure').passed, true);
  assert.equal(result.items.find(item => item.id === 'content').passed, true);
  assert.equal(result.items.find(item => item.id === 'freeze').passed, false);
  assert.equal(result.items.find(item => item.id === 'test-session').passed, false);
  assert.equal(result.items.find(item => item.id === 'storage').passed, false);
  assert.equal(result.facts.analysis_windows, 0);
});

test('missing media makes a protocol blocked for lab readiness', () => {
  const p = protocol({
    blocks: [block({ trials: [trial({ steps: [step('video', { name: 'Stimulus video' })] })] })],
  });
  const result = assessProtocolReadiness(p, { sessions: [], storageInfo: { selected: true, name: 'Lab Data' } });

  assert.equal(result.status, 'blocked');
  assert.equal(result.items.find(item => item.id === 'media').passed, false);
  assert.equal(result.facts.missing_media, 1);
});

test('frozen protocol with source, analysis window, pilot session, and local storage is ready', () => {
  const p = protocol({
    status: 'frozen',
    config_hash: 'abcdef1234567890',
    blocks: [block({ trials: [trial({ steps: [
      step('fixation', { name: 'Baseline', is_analysis_window: true, role: 'baseline', planned_duration_ms: 1000 }),
      step('video', { name: 'Stimulus', source_url: 'https://example.test/stimulus.mp4', is_analysis_window: true, role: 'stimulus' }),
    ] })] })],
  });
  const result = assessProtocolReadiness(p, {
    sessions: [{ protocol_id: p.protocol_id, status: 'completed', run_mode: 'preview' }],
    storageInfo: { selected: true, name: 'PhysioFlow Data' },
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.blocking, 0);
  assert.equal(result.items.every(item => item.passed), true);
});

test('frozen protocol without local storage is blocked for formal collection', () => {
  const p = protocol({
    status: 'frozen',
    config_hash: 'abcdef1234567890',
    blocks: [block({ trials: [trial({ steps: [
      step('timer', { name: 'Task', is_analysis_window: true, role: 'task', planned_duration_ms: 1000 }),
    ] })] })],
  });
  const result = assessProtocolReadiness(p, {
    sessions: [{ protocol_id: p.protocol_id, status: 'completed', run_mode: 'preview' }],
    storageInfo: { selected: false },
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.items.find(item => item.id === 'storage').severity, 'error');
  assert.equal(result.items.find(item => item.id === 'storage').passed, false);
});

test('workspace readiness summarizes active protocol states', () => {
  const blocked = protocol({
    name: 'Blocked',
    blocks: [block({ trials: [trial({ steps: [step('audio')] })] })],
  });
  const ready = protocol({
    name: 'Ready',
    status: 'frozen',
    config_hash: 'hash',
    blocks: [block({ trials: [trial({ steps: [step('timer', { is_analysis_window: true, role: 'task', planned_duration_ms: 1000 })] })] })],
  });
  const summary = summarizeWorkspaceReadiness([blocked, ready], [{ protocol_id: ready.protocol_id, status: 'completed', run_mode: 'preview' }], { selected: true });

  assert.equal(summary.total, 2);
  assert.equal(summary.ready, 1);
  assert.equal(summary.blocked, 1);
});
