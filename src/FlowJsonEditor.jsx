// FlowJsonEditor.jsx — "Code" view of the flow editor.
// The canvas and this JSON editor are two projections of the SAME model (the
// trial object). Editing here parses back into the model; editing the canvas
// regenerates this text. Same pattern as AWS Infrastructure Composer's
// Canvas / Template views.
//
// Draft-buffer pattern: the textarea holds a local draft and only commits to the
// model on "Apply" (valid JSON). This keeps typing from fighting the model and
// prevents cursor jumps.

import { useEffect, useMemo, useState } from 'react';
import { normalizeFlow, validateFlow } from './flowEngine';

export default function FlowJsonEditor({ trial, onChange, disabled }) {
  const [draft, setDraft] = useState(() => JSON.stringify(trial, null, 2));

  // Resync when the underlying model changes (e.g. after "Apply").
  useEffect(() => {
    setDraft(JSON.stringify(trial, null, 2));
  }, [trial]);

  const parsed = useMemo(() => {
    try { return { ok: true, value: JSON.parse(draft) }; }
    catch (e) { return { ok: false, error: e.message }; }
  }, [draft]);

  const structureError = !parsed.ok
    ? parsed.error
    : !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)
      ? 'Root must be a JSON object'
      : !Array.isArray(parsed.value.steps)
        ? 'Missing "steps" array'
        : null;

  const flowCheck = useMemo(() => {
    if (!parsed.ok || structureError) return { errors: [], warnings: [] };
    try {
      const flow = normalizeFlow(parsed.value);
      return validateFlow(flow, parsed.value.steps || []);
    } catch { return { errors: [], warnings: [] }; }
  }, [parsed.ok, structureError, parsed.value]);

  const apply = () => {
    if (!parsed.ok || structureError || disabled) return;
    onChange(parsed.value);
  };

  const nodeCount = parsed.ok && !structureError ? (parsed.value.flow?.nodes?.length ?? 0) : 0;
  const stepCount = parsed.ok && !structureError ? (parsed.value.steps?.length ?? 0) : 0;

  return (
    <div className="flow-json-editor">
      <div className="flow-json-toolbar">
        <span className="flow-json-title">Trial JSON <small>flow · steps · layout</small></span>
        {structureError
          ? <span className="flow-json-status error" title={structureError}>✗ Invalid JSON</span>
          : <span className="flow-json-status ok">✓ {nodeCount} nodes · {stepCount} steps</span>}
        <button type="button" className="primary" disabled={disabled || !parsed.ok || !!structureError} onClick={apply}>Apply to canvas</button>
      </div>

      {structureError && <div className="flow-json-error">{structureError}</div>}

      <textarea
        className="flow-json-textarea"
        value={draft}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        onChange={e => setDraft(e.target.value)}
        aria-label="Trial JSON"
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
