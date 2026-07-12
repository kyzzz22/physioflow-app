import { stepContentIssues } from './domain';
import QuestionnaireDesigner, { createQuestionnaire } from './QuestionnaireDesigner';
import { MEDIA_TYPES, PALETTE, STEP_DEFAULTS } from './constants.js';
import MediaSettings from './MediaSettings.jsx';

const stepDefaultExtras = defaults => Object.fromEntries(Object.entries(defaults).filter(([key]) => !['name', 'duration_mode', 'planned_duration_ms', 'recovery_behavior'].includes(key)));

export function Inspector({ node, edge, trial, stimuli, questionnaires, updateNode, updateStep, removeNode, deleteEdgeFromInspector, disabled, onCopyNode, onPasteNode, onDuplicateNode, hasClipboard, selectedCount, flow, updateFlow }) {
  if (edge) return <EdgeInspector edge={edge} flow={trial.flow} onDelete={deleteEdgeFromInspector} disabled={disabled} updateFlow={updateFlow} flowData={flow} />;
  if (!node) {
    if (selectedCount > 0) return <MultiSelectInspector count={selectedCount} hasClipboard={hasClipboard} onPasteNode={onPasteNode} />;
    return <EmptyInspector hasClipboard={hasClipboard} onPasteNode={onPasteNode} />;
  }
  const item = trial.steps.find(s => s.step_id === node.step_id);
  const sharedQ = questionnaires.find(q => q.questionnaire_id === item?.questionnaire_id);
  const resolvedItem = item?.type === 'questionnaire' && !item.questionnaire && sharedQ ? { ...item, questionnaire: sharedQ } : item;
  const questionVars = [
    ...trial.steps.filter(s => s.type === 'response').map(s => s.response_variable || 'response'),
    ...trial.steps.flatMap(s => s.questionnaire?.questions || questionnaires.find(q => q.questionnaire_id === s.questionnaire_id)?.questions || []).map(q => q.question_id),
  ];

  const _stepIssues = resolvedItem && !disabled ? stepContentIssues(resolvedItem, stimuli, questionnaires) : [];
  return <aside className="studio-inspector">
    <div className="inspector-title"><span>{node.type.toUpperCase()} NODE</span><h3>{node.label}</h3></div>
    <label>Label<input value={node.label || ''} disabled={disabled} onChange={e => updateNode({ label: e.target.value })} /></label>
    {_stepIssues.length > 0 && (
      <div className={`inspector-issues ${_stepIssues.some(i => i.kind === 'error') ? 'error' : 'warning'}`}>
        <b>{_stepIssues.some(i => i.kind === 'error') ? 'Missing required content' : 'Needs attention'}</b>
        {_stepIssues.map((iss, ii) => <div key={ii}>{iss.kind === 'error' ? 'Error' : 'Warning'} · {iss.message}</div>)}
      </div>
    )}
    {/* Note node settings */}
    {node.type === 'note' && <>
      <label>Note content
        <textarea value={node.content || ''} disabled={disabled} rows={4} onChange={e => updateNode({ content: e.target.value })} style={{ fontFamily: '"Comic Sans MS", cursive', fontSize: '14px' }} />
      </label>
      <div style={{ display: 'flex', gap: '.5rem' }}>
        <label style={{ flex: 1 }}>Width<input type="number" min="120" max="400" value={node.width || 180} disabled={disabled} onChange={e => updateNode({ width: Number(e.target.value) })} /></label>
        <label style={{ flex: 1 }}>Height<input type="number" min="60" max="400" value={node.height || 100} disabled={disabled} onChange={e => updateNode({ height: Number(e.target.value) })} /></label>
      </div>
      <ColorField label="Background color" value={node.color} fallback="#fff9c4" disabled={disabled} onChange={v => updateNode({ color: v })} />
    </>}
    {/* Event node settings */}
    {node.type === 'event' && resolvedItem && <EventFullSettings item={resolvedItem} trial={trial} stimuli={stimuli} questionnaires={questionnaires} disabled={disabled} updateStep={updateStep} questionVars={questionVars} />}
    {/* Condition/loop settings */}
    {['condition', 'loop'].includes(node.type) && (
      <details className="inspector-section" open><summary className="inspector-summary"><h4>Rule settings</h4></summary>
        <RuleFields node={node} questionVariables={questionVars} disabled={disabled} updateNode={updateNode} />
        {node.type === 'loop' && <label>Maximum iterations<input type="number" min="0" value={node.max_iterations ?? 1} disabled={disabled} onChange={e => updateNode({ max_iterations: Number(e.target.value) })} /></label>}
      </details>
    )}
    {/* Node color (all non-start/end types) */}
    {!['start', 'end'].includes(node.type) && node.type !== 'note' && (
      <details className="inspector-section"><summary className="inspector-summary"><h4>Node style</h4></summary>
        <ColorField label="Node color" value={node.color} fallback="" disabled={disabled} onChange={v => updateNode({ color: v || null })} />
        <label className="check-row" style={{ marginTop: '.5rem' }}>
          <input type="checkbox" checked={node.enabled !== false} disabled={disabled} onChange={e => updateNode({ enabled: e.target.checked })} />
          Enabled (skip node when disabled)
        </label>
      </details>
    )}
    {/* Action buttons */}
    {!['start', 'end'].includes(node.type) && (
      <div className="inspector-actions">
        <button className="delete-action" disabled={disabled} onClick={removeNode}>Delete node</button>
        <button onClick={onCopyNode} disabled={disabled} title="Ctrl+C">Copy</button>
        {hasClipboard && <button onClick={onPasteNode} disabled={disabled} title="Ctrl+V">Paste</button>}
        {onDuplicateNode && <button onClick={onDuplicateNode} disabled={disabled} title="Ctrl+D">Duplicate</button>}
      </div>
    )}
  </aside>;
}

function MultiSelectInspector({ count, hasClipboard: _hasClipboard, onPasteNode: _onPasteNode }) {
  return <aside className="studio-inspector empty-inspector">
    <h3>{count} nodes selected</h3>
    <p>Drag to move together · Delete to remove · Ctrl+D to duplicate</p>
  </aside>;
}

function EmptyInspector({ hasClipboard, onPasteNode }) {
  return <aside className="studio-inspector empty-inspector">
    <h3>No node selected</h3>
    <p>Click a node to edit · Click an edge to delete</p>
    {hasClipboard && <button className="paste-ghost" onClick={onPasteNode}>Paste (Ctrl+V)</button>}
  </aside>;
}

function EdgeInspector({ edge, flow: flowProp, onDelete, disabled, updateFlow, flowData }) {
  const source = (flowProp || flowData)?.nodes?.find(n => n.id === edge.source);
  const target = (flowProp || flowData)?.nodes?.find(n => n.id === edge.target);
  const handleUpdateEdge = (values) => {
    if (updateFlow && flowData) {
      updateFlow({ ...flowData, edges: flowData.edges.map(e => e.id === edge.id ? { ...e, ...values } : e) });
    }
  };
  return <aside className="studio-inspector">
    <div className="inspector-title"><span>EDGE</span><h3>{edge.branch}</h3></div>
    <p className="inspector-help">{source?.label || edge.source} → {target?.label || edge.target}</p>
    <label>Label<input value={edge.label || ''} disabled={disabled} placeholder="Optional" onChange={e => handleUpdateEdge({ label: e.target.value })} /></label>
    <button className="delete-action" disabled={disabled} onClick={onDelete}>Delete</button>
  </aside>;
}

function EventFullSettings({ item, trial: _trial, stimuli, questionnaires, disabled, updateStep }) {
  const media = ['video', 'audio', 'image'].includes(item.type);
  const timed = ['video', 'audio'].includes(item.type);
  const names = item.name_i18n || { zh: '', ja: '', en: '' };
  const sharedQ = questionnaires.find(q => q.questionnaire_id === item.questionnaire_id);
  const resolvedQ = item.questionnaire || sharedQ;
  const triggerTypeChange = type => {
    const defaults = STEP_DEFAULTS[type] || STEP_DEFAULTS.instruction;
    const previousDefaultName = STEP_DEFAULTS[item.type]?.name || item.type;
    const isMedia = MEDIA_TYPES.includes(type), isTimed = ['video', 'audio'].includes(type);
    updateStep({ type, ...stepDefaultExtras(defaults), name: item.name === item.type || item.name === previousDefaultName ? defaults.name : item.name, source_mode: isMedia ? (item.source_mode === 'none' ? 'url' : item.source_mode || 'url') : 'none', duration_mode: defaults.duration_mode, planned_duration_ms: defaults.planned_duration_ms, recovery_behavior: defaults.recovery_behavior || (isTimed ? 'restart' : 'resume_remaining'), ...(type === 'questionnaire' && !item.questionnaire && !sharedQ ? { questionnaire: createQuestionnaire() } : {}) });
  };

  return <div className="inspector-fields">
    <label>Event type
      <select value={item.type} disabled={disabled} onChange={e => triggerTypeChange(e.target.value)}>
        {PALETTE.flatMap(g => g.items).map(([t, , lbl]) => <option value={t} key={t}>{lbl}</option>)}
      </select>
    </label>
    <details className="i18n-group"><summary>Participant title · 中 / 日 / EN</summary>
      {[['zh', '中文标题'], ['ja', '日本語タイトル'], ['en', 'English title']].map(([lang, lbl]) => <label key={lang}>{lbl}<input value={names[lang] || ''} disabled={disabled} onChange={e => updateStep({ name_i18n: { ...names, [lang]: e.target.value } })} /></label>)}
    </details>
    {['instruction', 'response', 'manual_event', 'device_check'].includes(item.type) && <I18nContentEditor content={item.content_i18n || { zh: '', ja: '', en: '' }} disabled={disabled} updateStep={updateStep} />}
    <AppearanceOverrides item={item} disabled={disabled} updateStep={updateStep} />
    {media && <MediaSettings item={item} disabled={disabled} updateStep={updateStep} stimuli={stimuli} />}
    <TimingBehavior item={item} timed={timed} disabled={disabled} updateStep={updateStep} />
    <fieldset className="inspector-fieldset"><legend>Recovery after interruption</legend>
      <label>Behavior
        <select value={item.recovery_behavior || (timed ? 'restart' : 'resume_remaining')} disabled={disabled} onChange={e => updateStep({ recovery_behavior: e.target.value })}>
          <option value="resume_remaining">Resume remaining time</option>
          <option value="restart">Restart this event</option>
          <option value="wait_operator">Wait for operator</option>
        </select>
      </label>
    </fieldset>
    <fieldset className="inspector-fieldset"><legend>Operator controls</legend>
      <div className="check-row-group">
        <label className="check-row"><input type="checkbox" checked={item.allow_skip !== false} disabled={disabled} onChange={e => updateStep({ allow_skip: e.target.checked })} /> Allow skip</label>
        <label className="check-row"><input type="checkbox" checked={Boolean(item.allow_retry)} disabled={disabled} onChange={e => updateStep({ allow_retry: e.target.checked })} /> Allow retry</label>
      </div>
    </fieldset>
    {item.type === 'manual_event' && <ManualEventSettings item={item} disabled={disabled} updateStep={updateStep} />}
    {item.type === 'device_check' && <DeviceCheckSettings item={item} disabled={disabled} updateStep={updateStep} />}
    {item.type === 'response' && <ResponseSettings item={item} disabled={disabled} updateStep={updateStep} />}
    <AnalysisSection item={item} disabled={disabled} updateStep={updateStep} />
    {item.type === 'questionnaire' && <>
      <QuestionnaireModeSettings item={item} disabled={disabled} updateStep={updateStep} />
      {(item.questionnaire_mode || 'internal') !== 'external' && <>
        <div className="questionnaire-in-inspector"><label>Questionnaire</label><QuestionnaireDesigner value={resolvedQ || createQuestionnaire()} disabled={disabled} onChange={q => updateStep({ questionnaire: q, questionnaire_id: q.questionnaire_id })} /></div>
        <SharedQuestionnaireSelect item={item} questionnaires={questionnaires} disabled={disabled} updateStep={updateStep} />
      </>}
    </>}
    {media && <SharedResourceSelect item={item} stimuli={stimuli} disabled={disabled} updateStep={updateStep} />}
  </div>;
}

const responseOptionsText = options => (options || []).map(option => {
  const label = option.label_i18n?.en || option.label_i18n?.zh || option.label_i18n?.ja || option.value || '';
  return [option.value || '', label, option.key || ''].join(' | ');
}).join('\n');

const parseResponseOptions = text => text.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
  const [valueRaw, labelRaw, keyRaw] = line.split('|').map(part => part.trim());
  const value = valueRaw || labelRaw || '';
  const label = labelRaw || value;
  return { value, key: keyRaw || '', label_i18n: { zh: label, ja: label, en: label } };
});

function ResponseSettings({ item, disabled, updateStep }) {
  const options = item.response_options || [];
  return <fieldset className="inspector-fieldset"><legend>Response capture</legend>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      <label>Response variable
        <input value={item.response_variable || 'response'} disabled={disabled} placeholder="response or rating" onChange={event => updateStep({ response_variable: event.target.value })} />
      </label>
      <label>Options <small style={{ color: 'var(--muted)' }}>value | label | key</small>
        <textarea rows={Math.max(3, options.length + 1)} value={responseOptionsText(options)} disabled={disabled} placeholder={'yes | Yes | 1\nno | No | 2'} onChange={event => updateStep({ response_options: parseResponseOptions(event.target.value) })} />
      </label>
      <div className="check-row-group">
        <label className="check-row"><input type="checkbox" checked={item.response_required !== false} disabled={disabled} onChange={event => updateStep({ response_required: event.target.checked })} /> Required response</label>
        <label className="check-row"><input type="checkbox" checked={item.response_auto_advance !== false} disabled={disabled} onChange={event => updateStep({ response_auto_advance: event.target.checked })} /> Continue immediately after response</label>
      </div>
      <small style={{ color: 'var(--muted)', fontSize: '.72rem' }}>Keyboard keys are optional. The selected value is exported and can be used by Condition nodes.</small>
    </div>
  </fieldset>;
}

function QuestionnaireModeSettings({ item, disabled, updateStep }) {
  const mode = item.questionnaire_mode || 'internal';
  return <fieldset className="inspector-fieldset"><legend>Questionnaire mode</legend>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      <label>Mode
        <select value={mode} disabled={disabled} onChange={event => updateStep({ questionnaire_mode: event.target.value, duration_mode: 'manual' })}>
          <option value="internal">Built-in questions</option>
          <option value="external">External form link</option>
        </select>
      </label>
      {mode === 'external' && <>
        <label>External form URL
          <input type="url" value={item.external_form_url || ''} disabled={disabled} placeholder="https://docs.google.com/forms/..." onChange={event => updateStep({ external_form_url: event.target.value })} />
        </label>
        <label>Open button label
          <input value={item.external_open_label || ''} disabled={disabled} placeholder="Open external form" onChange={event => updateStep({ external_open_label: event.target.value })} />
        </label>
        <label>Completion checkbox label
          <input value={item.external_completion_label || ''} disabled={disabled} placeholder="I completed the external form" onChange={event => updateStep({ external_completion_label: event.target.value })} />
        </label>
        <label className="check-row">
          <input type="checkbox" checked={Boolean(item.external_embed)} disabled={disabled} onChange={event => updateStep({ external_embed: event.target.checked })} />
          Try embedded preview
        </label>
        <label className="check-row">
          <input type="checkbox" checked={item.external_append_context !== false} disabled={disabled} onChange={event => updateStep({ external_append_context: event.target.checked })} />
          Append participant/session to URL
        </label>
        {item.external_append_context !== false && <div style={{ display: 'flex', gap: '.5rem' }}>
          <label style={{ flex: 1 }}>Participant param
            <input value={item.external_participant_param || ''} disabled={disabled} placeholder="participant_id or entry.xxxxx" onChange={event => updateStep({ external_participant_param: event.target.value })} />
          </label>
          <label style={{ flex: 1 }}>Session param
            <input value={item.external_session_param || ''} disabled={disabled} placeholder="session_id or entry.xxxxx" onChange={event => updateStep({ external_session_param: event.target.value })} />
          </label>
        </div>}
        <small style={{ color: 'var(--muted)', fontSize: '.72rem' }}>External answers stay in the form service. PhysioFlow records opened/confirmed timing and the original/resolved URL in events.csv.</small>
      </>}
    </div>
  </fieldset>;
}

function ManualEventSettings({ item, disabled, updateStep }) {
  return <fieldset className="inspector-fieldset"><legend>Manual event confirmation</legend>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      <label>Confirmation label
        <input value={item.operator_confirm_label || ''} disabled={disabled} placeholder="Confirm event" onChange={e => updateStep({ operator_confirm_label: e.target.value })} />
      </label>
      <label className="check-row">
        <input type="checkbox" checked={Boolean(item.operator_note_required)} disabled={disabled} onChange={e => updateStep({ operator_note_required: e.target.checked })} />
        Require operator note
      </label>
      <small style={{ color: 'var(--muted)', fontSize: '.72rem' }}>The confirmation and note are written into the event log for audit and device-alignment records.</small>
    </div>
  </fieldset>;
}

function DeviceCheckSettings({ item, disabled, updateStep }) {
  const text = (item.device_checks || []).join('\n');
  return <fieldset className="inspector-fieldset"><legend>Device checklist</legend>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      <label>Checklist items
        <textarea rows={4} value={text} disabled={disabled} placeholder="One item per line" onChange={e => updateStep({ device_checks: e.target.value.split('\n').map(line => line.trim()).filter(Boolean) })} />
      </label>
      <label className="check-row">
        <input type="checkbox" checked={item.require_all_device_checks !== false} disabled={disabled} onChange={e => updateStep({ require_all_device_checks: e.target.checked })} />
        Require all items before continuing
      </label>
      <small style={{ color: 'var(--muted)', fontSize: '.72rem' }}>Each checked item is exported in device_check_completed metadata.</small>
    </div>
  </fieldset>;
}

function I18nContentEditor({ content, disabled, updateStep }) {
  return <details className="i18n-group" open><summary>Participant content · 中 / 日 / EN</summary>
    {[['zh', '中文'], ['ja', '日本語'], ['en', 'English']].map(([lang, lbl]) => <label key={lang}>{lbl}<textarea value={content[lang] || ''} disabled={disabled} onChange={e => updateStep({ content_i18n: { ...content, [lang]: e.target.value } })} rows={2} /></label>)}
  </details>;
}

function AppearanceOverrides({ item, disabled, updateStep }) {
  return <details className="inspector-section"><summary className="inspector-summary"><h4>Appearance overrides</h4></summary>
    <small style={{ display: 'block', marginBottom: '.5rem', color: '#7b867f', fontSize: '.65rem' }}>Override trial-level appearance for this step only.</small>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      <label style={{ display: 'grid', gap: '.25rem', fontSize: '.72rem', fontWeight: 600 }}>Font size
        <select value={item.appearance?.font_size ?? ''} disabled={disabled} onChange={e => updateStep({ appearance: { ...item.appearance, font_size: e.target.value || null } })}>
          <option value="">Trial default</option><option value="0.7rem">Small (0.7rem)</option><option value="1rem">Medium (1rem)</option><option value="1.5rem">Large (1.5rem)</option><option value="2rem">Extra large (2rem)</option>
        </select>
      </label>
      <label style={{ display: 'grid', gap: '.25rem', fontSize: '.72rem', fontWeight: 600 }}>Alignment
        <select value={item.appearance?.alignment ?? ''} disabled={disabled} onChange={e => updateStep({ appearance: { ...item.appearance, alignment: e.target.value || null } })}>
          <option value="">Trial default</option><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
        </select>
      </label>
      <ColorField label="Text color" value={item.appearance?.color} fallback="#17221d" disabled={disabled} onChange={v => updateStep({ appearance: { ...item.appearance, color: v } })} />
      <ColorField label="Background" value={item.appearance?.background} fallback="#fffef9" disabled={disabled} onChange={v => updateStep({ appearance: { ...item.appearance, background: v } })} />
    </div>
  </details>;
}

function ColorField({ label, value, fallback, disabled, onChange }) {
  return <label style={{ display: 'grid', gap: '.25rem', fontSize: '.72rem', fontWeight: 600 }}>{label}
    <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
      <input type="color" value={value || fallback} disabled={disabled} onChange={e => onChange(e.target.value)} style={{ width: 36, height: 30, padding: 2, border: '1px solid var(--line)', borderRadius: 4, cursor: 'pointer' }} />
      <button type="button" disabled={disabled || !value} onClick={() => onChange(null)} style={{ fontSize: '.62rem', padding: '.2rem .4rem' }}>Reset</button>
    </div>
  </label>;
}

function TimingBehavior({ item, timed, disabled, updateStep }) {
  return <fieldset className="inspector-fieldset"><legend>Timing & behavior</legend>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      <div style={{ display: 'flex', gap: '.5rem' }}>
        <label style={{ flex: 1 }}>Start mode
          <select value={item.start_mode || 'auto'} disabled={disabled} onChange={e => updateStep({ start_mode: e.target.value })}>
            <option value="auto">Automatic</option>
            {!['questionnaire'].includes(item.type) && <option value="manual">Participant click</option>}
          </select>
        </label>
        <label style={{ flex: 1 }}>End mode
          <select value={item.duration_mode || (timed ? 'media' : 'fixed')} disabled={disabled} onChange={e => updateStep({ duration_mode: e.target.value })}>
            <option value="fixed">Fixed time</option>
            {timed && <option value="media">When media ends</option>}
            <option value="manual">Manual continue</option>
          </select>
        </label>
      </div>
      {item.duration_mode === 'fixed' && <label>Duration (ms)<input type="number" min="0" value={item.planned_duration_ms || (timed ? 0 : 5000)} disabled={disabled} onChange={e => updateStep({ planned_duration_ms: Number(e.target.value) })} /></label>}
      <div className="check-row-group"><label className="check-row"><input type="checkbox" checked={item.auto_advance !== false} disabled={disabled} onChange={e => updateStep({ auto_advance: e.target.checked })} /> Auto advance</label></div>
    </div>
  </fieldset>;
}

function AnalysisSection({ item, disabled, updateStep }) {
  return <fieldset className="inspector-fieldset"><legend>Analysis</legend>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      <div className="check-row-group"><label className="check-row"><input type="checkbox" checked={item.required !== false} disabled={disabled} onChange={e => updateStep({ required: e.target.checked })} /> Required for valid session</label></div>
      <label className="check-row"><input type="checkbox" checked={Boolean(item.is_analysis_window)} disabled={disabled} onChange={e => updateStep({ is_analysis_window: e.target.checked })} /> Generate analysis window</label>
      {item.is_analysis_window && <div style={{ display: 'flex', gap: '.5rem' }}>
        <label style={{ flex: 1 }}>Role<select value={item.role || 'custom'} disabled={disabled} onChange={e => updateStep({ role: e.target.value })}>{['baseline', 'stimulus', 'recovery', 'task', 'exclude', 'custom'].map(r => <option value={r} key={r}>{r}</option>)}</select></label>
        <label style={{ flex: 1 }}>Label<input value={item.analysis_label || ''} disabled={disabled} onChange={e => updateStep({ analysis_label: e.target.value })} /></label>
      </div>}
    </div>
  </fieldset>;
}
function SharedResourceSelect({ item, stimuli, updateStep, disabled }) {
  const compatible = stimuli.filter(r => r.type === item.type);
  if (!compatible.length) return null;
  return <fieldset className="inspector-fieldset"><legend>Stimulus library</legend>
    <label>Reusable resource<select value={item.stimulus_id || ''} disabled={disabled} onChange={e => updateStep({ stimulus_id: e.target.value })}><option value="">None</option>{compatible.map(r => <option value={r.stimulus_id} key={r.stimulus_id}>{r.name}</option>)}</select></label>
    {item.stimulus_id && <small>Node URL/upload overrides the shared resource.</small>}
  </fieldset>;
}

function SharedQuestionnaireSelect({ item, questionnaires, updateStep, disabled }) {
  return <fieldset className="inspector-fieldset"><legend>Questionnaire library</legend>
    <label>Reusable questionnaire<select value={item.questionnaire && !questionnaires.some(q => q.questionnaire_id === item.questionnaire_id) ? '' : item.questionnaire_id || ''} disabled={disabled} onChange={e => { const id = e.target.value; updateStep({ questionnaire_id: id, questionnaire: id ? undefined : item.questionnaire }); }}><option value="">Node-local</option>{questionnaires.map(q => <option value={q.questionnaire_id} key={q.questionnaire_id}>{q.name}</option>)}</select></label>
    {item.questionnaire_id && <button type="button" disabled={disabled} onClick={() => { const src = questionnaires.find(q => q.questionnaire_id === item.questionnaire_id); if (src) updateStep({ questionnaire: { ...structuredClone(src), questionnaire_id: `questionnaire_${crypto.randomUUID()}` }, questionnaire_id: '' }); }}>Detach as editable copy</button>}
  </fieldset>;
}

function RuleFields({ node, questionVariables, updateNode, disabled }) {
  const listId = `rule-vars-${node.id}`;
  return <>
    <div className="rule-caption">Continue when</div>
    <label>Variable<input list={listId} value={node.rule?.variable || ''} disabled={disabled} placeholder="Participant field or question ID" onChange={e => updateNode({ rule: { ...node.rule, variable: e.target.value } })} />
      <datalist id={listId}><option value="participant_language" /><option value="participant_id" /><option value="order_row" /><option value="condition" />{questionVariables.map(v => <option value={v} key={v} />)}</datalist>
      <small>Question IDs from this Trial are listed automatically.</small>
    </label>
    <label>Comparison<select value={node.rule?.operator || 'equals'} disabled={disabled} onChange={e => updateNode({ rule: { ...node.rule, operator: e.target.value } })}><option value="equals">Equals</option><option value="not_equals">Does not equal</option><option value="contains">Contains</option><option value="greater_than">Greater than</option><option value="less_than">Less than</option></select></label>
    <label>Value<input value={node.rule?.value || ''} disabled={disabled} onChange={e => updateNode({ rule: { ...node.rule, value: e.target.value } })} /></label>
  </>;
}
