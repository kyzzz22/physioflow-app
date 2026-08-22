// FlowJsonEditor.jsx — "Code" view of the flow editor.
// The canvas and this JSON editor are two projections of the SAME model (the
// trial object). Editing here parses back into the model; editing the canvas
// regenerates this text. Same pattern as AWS Infrastructure Composer's
// Canvas / Template views.
//
// Live-edit model: the textarea holds a local draft and auto-syncs to the model
// (debounced, only when the JSON is valid). No mandatory "Apply" gate — invalid
// JSON just shows an inline error and leaves the model untouched, so the cursor
// never jumps and you can keep typing freely.

import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeFlow, validateFlow } from './flowEngine';
import { useT } from './i18n.jsx';

export default function FlowJsonEditor({ trial, onChange, disabled }) {
  const t = useT();
  const [draft, setDraft] = useState(() => JSON.stringify(trial, null, 2));
  const [dirty, setDirty] = useState(false);
  const lastAppliedRef = useRef(JSON.stringify(trial));

  const parsed = useMemo(() => {
    try { return { ok: true, value: JSON.parse(draft) }; }
    catch (e) { return { ok: false, error: e.message }; }
  }, [draft]);

  const structureError = !parsed.ok
    ? parsed.error
    : !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)
      ? 'Root must be a JSON object'
      : null;

  // Normalize so the canvas never receives a malformed trial (missing steps -> [])
  const normalized = useMemo(() => {
    if (!parsed.ok || structureError) return null;
    return { ...parsed.value, steps: Array.isArray(parsed.value.steps) ? parsed.value.steps : [] };
  }, [parsed.ok, structureError, parsed.value]);

  const flowCheck = useMemo(() => {
    if (!normalized) return { errors: [], warnings: [] };
    try { return validateFlow(normalizeFlow(normalized), normalized.steps || []); }
    catch { return { errors: [], warnings: [] }; }
  }, [normalized]);

  const apply = () => {
    if (disabled || !normalized) return;
    onChange(normalized);
    lastAppliedRef.current = draft;
    setDirty(false);
  };

  // Debounced live-apply: sync to the model ~500ms after valid edits stop.
  useEffect(() => {
    if (!normalized || disabled || draft === lastAppliedRef.current) return;
    const id = setTimeout(() => {
      onChange(normalized);
      lastAppliedRef.current = draft;
      setDirty(false);
    }, 500);
    return () => clearTimeout(id);
  }, [draft, normalized, disabled, onChange]);

  const nodeCount = normalized ? (normalized.flow?.nodes?.length ?? 0) : 0;
  const stepCount = normalized ? (normalized.steps?.length ?? 0) : 0;

  return (
    <div className="flow-json-editor">
      <div className="flow-json-toolbar">
        <span className="flow-json-title">Trial JSON <small>flow · steps · layout</small></span>
        {structureError
          ? <span className="flow-json-status error" title={structureError}>{t('✗ Invalid JSON')}</span>
          : dirty
            ? <span className="flow-json-status">{t('… syncing')}</span>
            : <span className="flow-json-status ok">✓ {nodeCount} {t('nodes')} · {stepCount} {t('steps')}</span>}
        <button type="button" className="primary" disabled={disabled || !normalized} onClick={apply}>Apply now</button>
      </div>

      {structureError && <div className="flow-json-error">{structureError}</div>}

      <textarea
        className="flow-json-textarea"
        value={draft}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        onChange={e => { setDraft(e.target.value); setDirty(true); }}
        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') apply(); }}
        aria-label={t('Trial JSON')}
      />

      {(flowCheck.errors.length > 0 || flowCheck.warnings.length > 0) && (
        <div className="flow-json-issues">
          {flowCheck.errors.slice(0, 10).map((m, i) => <div key={`e${i}`} className="error">✗ {m}</div>)}
          {flowCheck.warnings.slice(0, 10).map((m, i) => <div key={`w${i}`} className="warn">△ {m}</div>)}
        </div>
      )}
    </div>
  );
}
