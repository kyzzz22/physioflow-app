import { useEffect, useState } from 'react';
import { STEP_TYPES, block, freezeProtocol, moveItem, step, stepContentIssues, trial, validateProtocol } from '../domain';
import { STEP_DEFAULTS } from '../constants.js';
import { saveAsset } from '../fsStorage.js';
import { ConfirmDialog } from '../Modal.jsx';
import QuestionnaireDesigner, { createQuestionnaire } from '../QuestionnaireDesigner';
import Header from './AppHeader.jsx';
import { clone, parseResponseOptions, responseOptionsText, saveFile, showToast, stepDefaultExtras } from './uiHelpers.js';

export function Builder({ value, onChange, onSave, onBack, onRun, undo, redo, canUndo, canRedo, hasUnsaved, saveAnim, onSwitchToVisual, onUnfreeze, onGuide }) {
  const p = value;
  const check = validateProtocol(p);
  const locked = p.status === 'frozen';
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [dragState, setDragState] = useState(null);
  const [undoToast, setUndoToast] = useState(null);

  // Undo toast
  useEffect(() => {
    let timer;
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) setUndoToast(true);
    };
    window.addEventListener('keydown', handler);
    if (undoToast) { timer = setTimeout(() => setUndoToast(false), 2000); }
    return () => { window.removeEventListener('keydown', handler); clearTimeout(timer); };
  }, [undoToast, setUndoToast]);

  const update = (fn, shouldRecord = true) => {
    if (locked) return;
    const n = clone(p);
    fn(n);
    n.updated_at = new Date().toISOString();
    onChange(n, shouldRecord);
  };

  const addBlock = () => update(n => n.blocks.push(block()));
  const addTrial = bi => update(n => n.blocks[bi].trials.push(trial()));
  const addStep = (bi, ti, type) => update(n => n.blocks[bi].trials[ti].steps.push(step(type)));

  const confirmRemove = (bi, ti, si) => {
    let label = '';
    if (si !== undefined) label = `Delete step ${si + 1} ("${p.blocks[bi].trials[ti].steps[si].name}")?`;
    else if (ti !== undefined) label = `Delete trial ${ti + 1} ("${p.blocks[bi].trials[ti].name}") and all its steps?`;
    else label = `Delete block ${bi + 1} ("${p.blocks[bi].name}") and all its contents?`;
    setDeleteConfirm({
      title: 'Confirm delete',
      message: label,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: () => {
        update(n => {
          if (si !== undefined) n.blocks[bi].trials[ti].steps.splice(si, 1);
          else if (ti !== undefined) n.blocks[bi].trials.splice(ti, 1);
          else n.blocks.splice(bi, 1);
        });
        setDeleteConfirm(null);
        showToast('Item deleted');
      },
      onCancel: () => setDeleteConfirm(null),
    });
  };

  // Drag-and-drop for blocks
  const dragBlock = (e, index) => { if (locked) return; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('type', 'block'); e.dataTransfer.setData('index', String(index)); };
  const dragTrial = (e, blockIndex, trialIndex) => { if (locked) return; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('type', 'trial'); e.dataTransfer.setData('block_index', String(blockIndex)); e.dataTransfer.setData('trial_index', String(trialIndex)); };
  const dragStep = (e, blockIndex, trialIndex, stepIndex) => { if (locked) return; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('type', 'step'); e.dataTransfer.setData('block_index', String(blockIndex)); e.dataTransfer.setData('trial_index', String(trialIndex)); e.dataTransfer.setData('step_index', String(stepIndex)); };

  const dropOnBlock = (e, targetIndex) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('type');
    if (type === 'block') {
      const from = Number(e.dataTransfer.getData('index'));
      if (from === targetIndex) return;
      update(n => { const item = n.blocks.splice(from, 1)[0]; n.blocks.splice(targetIndex, 0, item); });
    }
    setDragState(null);
  };
  const dropOnTrial = (e, blockIndex, trialIndex) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('type');
    if (type === 'trial') {
      const fromBlock = Number(e.dataTransfer.getData('block_index'));
      const fromTrial = Number(e.dataTransfer.getData('trial_index'));
      if (fromBlock === blockIndex && fromTrial === trialIndex) return;
      update(n => {
        const item = n.blocks[fromBlock].trials.splice(fromTrial, 1)[0];
        n.blocks[blockIndex].trials.splice(trialIndex, 0, item);
      });
    }
    setDragState(null);
  };

  return <main>
    <Header saveAnim={saveAnim} hasUnsaved={hasUnsaved} canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} onSave={() => onSave(p)} onGuide={onGuide} />
    <div className="toolbar">
      <button onClick={onBack}>← Projects</button>
      <div>
        <button onClick={() => saveFile(`${p.name}.protocol.json`, JSON.stringify(p, null, 2))}>Export config</button>
        <button onClick={() => onSave(p)}>Save <kbd>{(navigator.userAgentData?.platform || navigator.platform || '').includes('Mac') ? '⌘S' : 'Ctrl+S'}</kbd></button>
        {!locked && <button onClick={async () => {
          if (!check.valid) { onRun(p); return; }
          try { const f = await freezeProtocol(p); onChange(f); onSave(f); showToast('Protocol frozen'); } catch (err) { showToast('Cannot freeze: ' + err.message); }
        }}>Freeze</button>}
        {locked && onUnfreeze && <button onClick={onUnfreeze} title="Make this protocol editable again">🔓 Unfreeze</button>}
        <button className="primary" onClick={() => onRun(p)}>Test run</button>
        {onSwitchToVisual && <button onClick={onSwitchToVisual} title="Switch to visual flow editor">⌘ Visual editor</button>}
      </div>
    </div>
    {!p.blocks.length && <div className="onboarding-hint">
      <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: '.5rem' }}>🧪</span>
      <h3 style={{ margin: '.3rem 0', fontSize: '1.3rem' }}>Start building your experiment</h3>
      <ol style={{ textAlign: 'left', padding: '0 1.5rem', lineHeight: 2, fontSize: '.9rem', color: '#5a6a61' }}>
        <li>Add a <b>Block</b> below — this is your top-level container</li>
        <li>Add <b>Trials</b> inside the Block — each Trial is one run-through</li>
        <li>Choose <b>Step types</b> for each Trial — instruction, video, questionnaire…</li>
      </ol>
      <button onClick={addBlock} style={{ marginTop: '.8rem' }}>+ Add Block</button>
    </div>}
    <div className="builder-grid">
      <aside>
        <h3>Step palette</h3>
        <p className="muted">Each trial owns its interface and media behavior.</p>
        {STEP_TYPES.map(t => <span className="type" key={t}>{t}</span>)}
        <div className="validation">
          <h3>Protocol check</h3>
          {check.valid ? <p className="ok">✓ Ready to run</p> : check.errors.map(x => <p className="error" key={x}>! {x}</p>)}
          {check.warnings.map(x => <p className="warn" key={x}>△ {x}</p>)}
          {check.valid && <TotalDuration protocol={p} />}
        </div>
      </aside>
      <section className="canvas">
        <div className="title-edit">
          <div>
            <span className={`badge ${p.status}`}>{p.status}</span>
            <input value={p.name} disabled={locked} onChange={e => update(n => n.name = e.target.value)} />
          </div>
          <p>Experiment → Block → Trial → Step</p>
        </div>
        {p.blocks.map((b, bi) => (
          <div className="block" key={b.block_id}
            draggable={!locked}
            onDragStart={e => dragBlock(e, bi)}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragState({ type: 'block', index: bi }); }}
            onDragLeave={() => setDragState(null)}
            onDrop={e => dropOnBlock(e, bi)}
            style={dragState?.type === 'block' && dragState?.index === bi ? { outline: '2px dashed var(--green)' } : {}}
          >
            <div className="node-head">
              <span className="move-btn">⠿</span>
              <b>BLOCK {bi + 1}</b>
              <input value={b.name} disabled={locked} onChange={e => update(n => n.blocks[bi].name = e.target.value)} />
              <select value={b.order_rule} disabled={locked} onChange={e => update(n => n.blocks[bi].order_rule = e.target.value)}>
                <option value="fixed">Fixed</option>
                <option value="random">Random</option>
                <option value="latin_square">Latin square</option>
                <option value="manual">Manual</option>
              </select>
              <select value={b.repeat_count ?? 1} disabled={locked} style={{ width: 70 }} onChange={e => update(n => n.blocks[bi].repeat_count = Number(e.target.value))} title="Repeat count">
                {[1, 2, 3, 4, 5, 6, 7, 8].map(v => <option key={v} value={v}>×{v}</option>)}
              </select>
              <label title="Practice block — excluded from analysis" style={{ fontSize: '.72rem', display: 'flex', alignItems: 'center', gap: '.2rem', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={b.is_practice || false} disabled={locked} onChange={e => update(n => n.blocks[bi].is_practice = e.target.checked)} /> Practice
              </label>
              {b.order_rule === 'random' && <>
                <label title="Max consecutive trials with same condition (0 = no limit)" style={{ fontSize: '.72rem', display: 'flex', alignItems: 'center', gap: '.2rem' }}>
                  <input type="number" min="0" max="10" value={b.max_consecutive_same || 0} disabled={locked} style={{ width: 36, padding: '.15rem' }} onChange={e => update(n => n.blocks[bi].max_consecutive_same = Number(e.target.value))} /> max same
                </label>
                <label title="No immediate repeat of the same condition" style={{ fontSize: '.72rem', display: 'flex', alignItems: 'center', gap: '.2rem', whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={b.no_immediate_repeat || false} disabled={locked} onChange={e => update(n => n.blocks[bi].no_immediate_repeat = e.target.checked)} /> no repeat
                </label>
              </>}
              <button className="move-btn" disabled={locked || bi === 0} onClick={() => update(n => { const items = moveItem(n.blocks, bi, -1); n.blocks = items; })} title="Move up">▲</button>
              <button className="move-btn" disabled={locked || bi === p.blocks.length - 1} onClick={() => update(n => { const items = moveItem(n.blocks, bi, 1); n.blocks = items; })} title="Move down">▼</button>
              <button className="icon" disabled={locked} onClick={() => confirmRemove(bi)}>×</button>
            </div>
            {b.trials.map((t, ti) => (
              <div className="trial" key={t.trial_id}
                draggable={!locked}
                onDragStart={e => dragTrial(e, bi, ti)}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                onDrop={e => dropOnTrial(e, bi, ti)}
              >
                <div className="node-head">
                  <span className="move-btn">⠿</span>
                  <b>TRIAL {ti + 1}</b>
                  <input value={t.name} disabled={locked} onChange={e => update(n => n.blocks[bi].trials[ti].name = e.target.value)} />
                  <input className="condition" placeholder="condition" value={t.condition} disabled={locked} onChange={e => update(n => n.blocks[bi].trials[ti].condition = e.target.value)} />
                  <select value={t.repeat_count || 1} disabled={locked} style={{ width: 70 }} onChange={e => update(n => n.blocks[bi].trials[ti].repeat_count = Number(e.target.value))} title="Repeat count">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(v => <option key={v} value={v}>×{v}</option>)}
                  </select>
                  <label title="ITI jitter (ms)" style={{ fontSize: '.72rem', display: 'flex', alignItems: 'center', gap: '.2rem' }}>
                    <input type="number" min="0" max="10000" step="50" value={t.iti_jitter_ms || 0} disabled={locked} style={{ width: 52, padding: '.15rem' }} onChange={e => update(n => n.blocks[bi].trials[ti].iti_jitter_ms = Number(e.target.value))} /> ms jitter
                  </label>
                  {Number(t.iti_jitter_ms || 0) > 0 && <select value={t.iti_jitter_distribution || 'fixed'} disabled={locked} style={{ width: 90, fontSize: '.72rem' }} onChange={e => update(n => n.blocks[bi].trials[ti].iti_jitter_distribution = e.target.value)} title="Jitter distribution">
                    {['fixed', 'uniform', 'normal', 'exponential'].map(d => <option key={d} value={d}>{d}</option>)}
                  </select>}
                  <button className="move-btn" disabled={locked || ti === 0} onClick={() => update(n => { n.blocks[bi].trials = moveItem(n.blocks[bi].trials, ti, -1); })} title="Move up">▲</button>
                  <button className="move-btn" disabled={locked || ti === b.trials.length - 1} onClick={() => update(n => { n.blocks[bi].trials = moveItem(n.blocks[bi].trials, ti, 1); })} title="Move down">▼</button>
                  <button className="icon" disabled={locked} onClick={() => confirmRemove(bi, ti)}>×</button>
                </div>
                <TrialAppearance trial={t} locked={locked} set={(k, v) => update(n => { n.blocks[bi].trials[ti].layout = { ...(n.blocks[bi].trials[ti].layout || {}), [k]: v }; })} previewKey={`${bi}-${ti}`} />
                {t.steps.map((s, si) => {
                  const issues = locked ? [] : stepContentIssues(s, p.stimuli || [], p.questionnaires || []);
                  return <StepRow
                    key={s.step_id}
                    s={s}
                    locked={locked}
                    blockIndex={bi}
                    trialIndex={ti}
                    stepIndex={si}
                    stepCount={t.steps.length}
                    set={(k, v) => update(n => { n.blocks[bi].trials[ti].steps[si][k] = v; })}
                    setMany={values => update(n => Object.assign(n.blocks[bi].trials[ti].steps[si], values))}
                    remove={() => confirmRemove(bi, ti, si)}
                    moveUp={() => update(n => { n.blocks[bi].trials[ti].steps = moveItem(n.blocks[bi].trials[ti].steps, si, -1); })}
                    moveDown={() => update(n => { n.blocks[bi].trials[ti].steps = moveItem(n.blocks[bi].trials[ti].steps, si, 1); })}
                    onDragStart={e => dragStep(e, bi, ti, si)}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                    onDrop={e => {
                      e.preventDefault();
                      const type = e.dataTransfer.getData('type');
                      if (type === 'step') {
                        const fromBi = Number(e.dataTransfer.getData('block_index'));
                        const fromTi = Number(e.dataTransfer.getData('trial_index'));
                        const fromSi = Number(e.dataTransfer.getData('step_index'));
                        update(n => {
                          const item = n.blocks[fromBi].trials[fromTi].steps.splice(fromSi, 1)[0];
                          n.blocks[bi].trials[ti].steps.splice(si, 0, item);
                        });
                      }
                    }}
                    issues={issues}
                  />;
                })}
                <div className="add-steps">
                  {STEP_TYPES.map(type => <button key={type} className="add-step" disabled={locked} onClick={() => addStep(bi, ti, type)}>+ {type}</button>)}
                </div>
              </div>
            ))}
            <button className="add-trial" disabled={locked} onClick={() => addTrial(bi)}>+ Add trial</button>
          </div>
        ))}
        <button className="add-block" disabled={locked} onClick={addBlock}>+ Add block</button>
      </section>
    </div>
    {deleteConfirm && <ConfirmDialog {...deleteConfirm} />}
    {undoToast && <div className="undo-toast"><span>Undo</span><button onClick={redo}>Redo</button></div>}
  </main>;
}

function StepRow({ s, set, setMany, remove, locked, blockIndex: _bi, trialIndex: _ti, stepIndex, stepCount, moveUp, moveDown, onDragStart, onDragOver, onDrop, issues = [] }) {
  const media = ['video', 'audio', 'image'].includes(s.type);
  const hasError = issues.some(i => i.kind === 'error');
  const hasWarn = issues.some(i => i.kind === 'warn');
  const content = s.content_i18n || { zh: '', ja: '', en: '' };
  const setContent = (language, value) => set('content_i18n', { ...content, [language]: value });
  const changeType = type => {
    const defaults = STEP_DEFAULTS[type] || STEP_DEFAULTS.instruction;
    const timedMedia = ['video', 'audio'].includes(type);
    setMany({
      type,
      ...stepDefaultExtras(defaults),
      source_mode: ['video', 'audio', 'image'].includes(type) ? (s.source_mode === 'none' ? 'url' : s.source_mode || 'url') : 'none',
      duration_mode: defaults.duration_mode || (timedMedia ? 'media' : type === 'questionnaire' ? 'manual' : 'fixed'),
      planned_duration_ms: defaults.planned_duration_ms ?? s.planned_duration_ms,
      recovery_behavior: defaults.recovery_behavior || (timedMedia ? 'restart' : 'resume_remaining'),
      ...(type === 'questionnaire' && !s.questionnaire ? { questionnaire: createQuestionnaire() } : {}),
      name: s.name === s.type || s.name === STEP_DEFAULTS[s.type]?.name ? defaults.name : s.name,
    });
  };
  return <div className="step-card"
    draggable={!locked}
    onDragStart={onDragStart}
    onDragOver={onDragOver}
    onDrop={onDrop}
    style={hasError ? { borderLeft: '3px solid #a32e25', paddingLeft: '.5rem' } : hasWarn ? { borderLeft: '3px solid #f4d77e', paddingLeft: '.5rem' } : {}}
  >
    <div className="step">
      <span className="step-index" style={{ position: 'relative' }}>
        {s.type.slice(0, 2).toUpperCase()}
        {hasError && <span style={{ position: 'absolute', top: -4, right: -4, background: '#a32e25', color: 'white', borderRadius: '50%', width: 14, height: 14, fontSize: 9, display: 'grid', placeItems: 'center', lineHeight: 1 }} title={issues.filter(i => i.kind === 'error').map(i => i.message).join('; ')}>!</span>}
        {!hasError && hasWarn && <span style={{ position: 'absolute', top: -4, right: -4, background: '#f4d77e', color: '#111', borderRadius: '50%', width: 14, height: 14, fontSize: 9, display: 'grid', placeItems: 'center', lineHeight: 1 }} title={issues.map(i => i.message).join('; ')}>△</span>}
      </span>
      <select value={s.type} disabled={locked} onChange={e => changeType(e.target.value)}>
        {STEP_TYPES.map(x => <option key={x}>{x}</option>)}
      </select>
      <input value={s.name} disabled={locked} onChange={e => set('name', e.target.value)} aria-label="Step name" />
      <select value={s.role} disabled={locked} onChange={e => set('role', e.target.value)} aria-label="Analysis role">
        {['baseline', 'stimulus', 'recovery', 'task', 'exclude', 'custom'].map(x => <option key={x}>{x}</option>)}
      </select>
      <label title="Generate an analysis window for this step in the exported CSV"><input type="checkbox" checked={s.is_analysis_window} disabled={locked} onChange={e => set('is_analysis_window', e.target.checked)} /> ↗ analysis</label>
      <div style={{ display: 'flex', gap: 2 }}>
        <button className="move-btn" disabled={locked || stepIndex === 0} onClick={moveUp} title="Move up">▲</button>
        <button className="move-btn" disabled={locked || stepIndex === stepCount - 1} onClick={moveDown} title="Move down">▼</button>
        <button className="icon" disabled={locked} onClick={remove} aria-label="Delete step">×</button>
      </div>
    </div>
    <div className="step-settings">
      <label>End mode
        <select value={s.duration_mode} disabled={locked} onChange={e => set('duration_mode', e.target.value)}>
          <option value="fixed">Fixed time</option>
          {media && <option value="media">When media ends</option>}
          <option value="manual">Manual continue</option>
        </select>
      </label>
      {s.duration_mode === 'fixed' && <label>Duration (ms)<input type="number" min="0" value={s.planned_duration_ms} disabled={locked} onChange={e => set('planned_duration_ms', Number(e.target.value))} aria-label="Duration in milliseconds" /></label>}
      {['fixation','rest','timer'].includes(s.type) && s.duration_mode === 'fixed' && <label><input type="checkbox" checked={s.show_countdown_ring !== false} disabled={locked} onChange={e => set('show_countdown_ring', e.target.checked)} /> Countdown ring</label>}
      <label>Start
        <select value={s.start_mode || 'auto'} disabled={locked} onChange={e => set('start_mode', e.target.value)}>
          <option value="auto">Automatic</option>
          <option value="manual">Participant click</option>
        </select>
      </label>
      <label><input type="checkbox" checked={s.auto_advance !== false} disabled={locked} onChange={e => set('auto_advance', e.target.checked)} /> Auto advance</label>
    </div>
    {['instruction', 'questionnaire', 'response', 'manual_event', 'device_check'].includes(s.type) && (
      <details className="localized-content" open>
        <summary>Participant content · 中 / 日 / EN</summary>
        <div>
          <label>中文<textarea value={content.zh || ''} disabled={locked} onChange={e => setContent('zh', e.target.value)} aria-label="Chinese content" /></label>
          <label>日本語<textarea value={content.ja || ''} disabled={locked} onChange={e => setContent('ja', e.target.value)} aria-label="Japanese content" /></label>
          <label>English<textarea value={content.en || ''} disabled={locked} onChange={e => setContent('en', e.target.value)} aria-label="English content" /></label>
        </div>
      </details>
    )}
    {s.type === 'response' && (
      <div className="media-settings">
        <label>Response variable<input value={s.response_variable || 'response'} disabled={locked} placeholder="response or rating" onChange={e => set('response_variable', e.target.value)} /></label>
        <label style={{ minWidth: 280 }}>Options <small>value | label | key</small><textarea rows={4} value={responseOptionsText(s.response_options || [])} disabled={locked} placeholder={'yes | Yes | 1\nno | No | 2'} onChange={e => set('response_options', parseResponseOptions(e.target.value))} /></label>
        <label><input type="checkbox" checked={s.response_required !== false} disabled={locked} onChange={e => set('response_required', e.target.checked)} /> Required response</label>
        <label><input type="checkbox" checked={s.response_auto_advance !== false} disabled={locked} onChange={e => set('response_auto_advance', e.target.checked)} /> Continue after response</label>
      </div>
    )}
    {s.type === 'questionnaire' && (
      <div className="media-settings">
        <label>Questionnaire mode
          <select value={s.questionnaire_mode || 'internal'} disabled={locked} onChange={e => setMany({ questionnaire_mode: e.target.value, duration_mode: 'manual' })}>
            <option value="internal">Built-in questions</option>
            <option value="external">External form link</option>
          </select>
        </label>
        {(s.questionnaire_mode || 'internal') === 'external' ? <>
          <label>External form URL<input type="url" value={s.external_form_url || ''} disabled={locked} placeholder="https://docs.google.com/forms/..." onChange={e => set('external_form_url', e.target.value)} /></label>
          <label>Open label<input value={s.external_open_label || ''} disabled={locked} placeholder="Open external form" onChange={e => set('external_open_label', e.target.value)} /></label>
          <label>Completion label<input value={s.external_completion_label || ''} disabled={locked} placeholder="I completed the external form" onChange={e => set('external_completion_label', e.target.value)} /></label>
          <label><input type="checkbox" checked={Boolean(s.external_embed)} disabled={locked} onChange={e => set('external_embed', e.target.checked)} /> Try embedded preview</label>
          <label><input type="checkbox" checked={s.external_append_context !== false} disabled={locked} onChange={e => set('external_append_context', e.target.checked)} /> Append participant/session to URL</label>
          {s.external_append_context !== false && <>
            <label>Participant param<input value={s.external_participant_param || ''} disabled={locked} placeholder="participant_id or entry.xxxxx" onChange={e => set('external_participant_param', e.target.value)} /></label>
            <label>Session param<input value={s.external_session_param || ''} disabled={locked} placeholder="session_id or entry.xxxxx" onChange={e => set('external_session_param', e.target.value)} /></label>
          </>}
        </> : <QuestionnaireDesigner value={s.questionnaire || createQuestionnaire()} disabled={locked} onChange={value => set('questionnaire', value)} />}
      </div>
    )}
    {media && (
      <div className="media-settings">
        <label>Media source
          <select value={s.source_mode || 'url'} disabled={locked} onChange={e => set('source_mode', e.target.value)}>
            <option value="url">Direct URL</option>
            {s.type === 'video' && <option value="youtube">YouTube embed</option>}
            <option value="upload">Upload local file</option>
          </select>
        </label>
        {s.source_mode === 'upload' ? (
          <label className="file-picker">{s.file_name || 'Choose media file'}<input type="file" hidden disabled={locked} accept={s.type === 'audio' ? 'audio/*' : s.type === 'image' ? 'image/*' : 'video/*'} onChange={async e => { const file = e.target.files?.[0]; if (file) setMany(await saveAsset(file)); }} /></label>
        ) : (
          <label>Source URL<input type="url" value={s.source_url || ''} disabled={locked} placeholder={s.source_mode === 'youtube' ? 'https://youtu.be/...' : 'https://...'} onChange={e => set('source_url', e.target.value)} /></label>
        )}
        <label>Volume<input type="range" min="0" max="1" step="0.05" value={s.volume ?? 1} disabled={locked} onChange={e => set('volume', Number(e.target.value))} title={`${Math.round((s.volume ?? 1) * 100)}%`} /></label>
        <label><input type="checkbox" checked={s.show_controls !== false} disabled={locked} onChange={e => set('show_controls', e.target.checked)} /> Controls</label>
        <label><input type="checkbox" checked={Boolean(s.muted)} disabled={locked} onChange={e => set('muted', e.target.checked)} /> Muted</label>
        <label><input type="checkbox" checked={Boolean(s.loop)} disabled={locked} onChange={e => set('loop', e.target.checked)} /> Loop</label>
      </div>
    )}
  </div>;
}

function TrialAppearance({ trial: t, set, locked, previewKey: _pk }) {
  const l = t.layout || {};
  return <details className="appearance" open>
    <summary>Trial layout & colors (background, spacing, progress bar)</summary>
    <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 280 }}>
        <label>Background <code style={{ display: 'inline' }}>{l.background || '#fffef9'}</code><input type="color" value={l.background || '#fffef9'} disabled={locked} onChange={e => set('background', e.target.value)} /></label>
        <label>Text color <code style={{ display: 'inline' }}>{l.foreground || '#17221d'}</code><input type="color" value={l.foreground || '#17221d'} disabled={locked} onChange={e => set('foreground', e.target.value)} /></label>
        <label>Content width<input type="number" min="320" max="1800" value={l.content_width || 900} disabled={locked} onChange={e => set('content_width', Number(e.target.value))} /></label>
        <label>Alignment<select value={l.alignment || 'center'} disabled={locked} onChange={e => set('alignment', e.target.value)}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
        <label>Padding<input type="number" min="0" value={l.padding ?? 48} disabled={locked} onChange={e => set('padding', Number(e.target.value))} /></label>
        <label>Spacing<input type="number" min="0" value={l.gap ?? 24} disabled={locked} onChange={e => set('gap', Number(e.target.value))} /></label>
        <label>Border radius<input type="number" min={0} max={48} value={l.border_radius ?? 12} disabled={locked} onChange={e => set('border_radius', Number(e.target.value))} /></label>
        <label><input type="checkbox" checked={l.show_progress !== false} disabled={locked} onChange={e => set('show_progress', e.target.checked)} /> Progress</label>
        <label><input type="checkbox" checked={l.show_step_type !== false} disabled={locked} onChange={e => set('show_step_type', e.target.checked)} /> Step label</label>
      </div>
      <div className="trial-preview" style={{
        background: l.background || '#fffef9',
        color: l.foreground || '#17221d',
        padding: (l.padding ?? 48) + 'px',
        textAlign: l.alignment || 'center',
        borderRadius: 10,
        flex: 1,
        minWidth: 260,
        minHeight: 160,
        display: 'flex',
        flexDirection: 'column',
        alignItems: l.alignment === 'center' ? 'center' : l.alignment === 'right' ? 'flex-end' : 'flex-start',
        justifyContent: 'center',
        gap: (l.gap ?? 24) + 'px',
      }}>
        {l.show_progress !== false && <div style={{ width: '100%', height: 4, background: '#dce2dc', borderRadius: 2 }}><div style={{ width: '40%', height: '100%', background: 'var(--lime)', borderRadius: 2 }} /></div>}
        {l.show_step_type !== false && <span style={{ fontSize: '.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--green)' }}>PREVIEW</span>}
        <span style={{ fontFamily: "'Instrument Serif', serif", fontSize: 'clamp(1.4rem, 3vw, 2.2rem)' }}>Trial appearance</span>
        <span style={{ fontSize: '.8rem', opacity: .6 }}>This preview shows how the participant will see this trial</span>
      </div>
    </div>
  </details>;
}

function TotalDuration({ protocol: p }) {
  const estimate = (step) => ['video', 'audio'].includes(step.type) ? 0 : Number(step.planned_duration_ms || 0);
  const total = p.blocks.reduce((sum, b) => {
    const blockRepeats = Math.max(0, Number(b.repeat_count ?? 1));
    return sum + blockRepeats * b.trials.reduce((tSum, t) => {
      const trialRepeats = Math.max(0, Number(t.repeat_count ?? 1));
      return tSum + trialRepeats * t.steps.reduce((sSum, s) => sSum + (s.duration_mode === 'fixed' ? estimate(s) : 0), 0);
    }, 0);
  }, 0);
  if (total <= 0) return null;
  const mins = Math.round(total / 60000);
  const secs = Math.round((total % 60000) / 1000);
  return <p className="ok" style={{ marginTop: '.5rem', fontSize: '.72rem' }}>
    ⏱ Estimated minimum: {mins > 0 ? `${mins}m ` : ''}{secs}s
    <br /><small>(fixed-duration steps only; media &amp; manual steps extend runtime)</small>
  </p>;
}
