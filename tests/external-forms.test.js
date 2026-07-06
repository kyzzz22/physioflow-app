import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExternalFormUrl } from '../src/externalForms.js';

test('external form URLs append participant and session context', () => {
  const url = buildExternalFormUrl(
    { external_form_url: 'https://docs.google.com/forms/d/example/viewform?existing=1' },
    { participant_id: 'P 01', session_id: 'S-123' }
  );
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('existing'), '1');
  assert.equal(parsed.searchParams.get('participant_id'), 'P 01');
  assert.equal(parsed.searchParams.get('session_id'), 'S-123');
});

test('external form URLs support Google Forms prefill entry parameter names', () => {
  const url = buildExternalFormUrl(
    {
      external_form_url: 'https://docs.google.com/forms/d/example/viewform?entry.111=old',
      external_participant_param: 'entry.111',
      external_session_param: 'entry.222',
    },
    { participant_id: 'P02', session_id: 'S02' }
  );
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('entry.111'), 'P02');
  assert.equal(parsed.searchParams.get('entry.222'), 'S02');
});

test('external form URL context appending can be disabled', () => {
  assert.equal(
    buildExternalFormUrl(
      { external_form_url: 'https://example.test/form', external_append_context: false },
      { participant_id: 'P03', session_id: 'S03' }
    ),
    'https://example.test/form'
  );
});
