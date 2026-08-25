import { useEffect, useState } from 'react';
import RuntimeContent from '../RuntimeContent';

/** Full-screen preview + inline editing */
export function NodePreviewModal({ step, trialLayout, onClose, onUpdate, onOpenQuestionnaireWorkspace }) {
  const [editMode, setEditMode] = useState(false);
  const [editing, setEditing] = useState(structuredClone(step));
  const layout = trialLayout || {};
  const app = (step.appearance && typeof step.appearance === 'object') ? step.appearance : {};
  const bg = app.background ?? layout.background ?? '#fafbf8';
  const fg = app.color ?? layout.foreground ?? '#17221d';
  const align = app.alignment ?? layout.alignment ?? 'center';
  const contentWidth = layout.content_width || 900;
  const pad = layout.padding ?? 48;
  const gap = layout.gap ?? 24;
  const media = ['video', 'audio', 'image'].includes(step.type);
  const hasText = ['instruction', 'response', 'manual_event', 'device_check', 'attention_check'].includes(step.type);

  // Sync editing state with step changes
  useEffect(() => { setEditing(structuredClone(step)); }, [step]);

  const applyEdit = (key, value) => {
    const next = { ...editing, [key]: value };
    setEditing(next);
    onUpdate?.({ [key]: value });
  };

  return <div className="node-preview-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="node-preview-header">
      <div>
        <span className="preview-badge">{step.type}</span>
        {editMode ? <input value={editing.name || ''} onChange={e => applyEdit('name', e.target.value)}
          style={{ background:'transparent',border:'none',borderBottom:'1px dashed var(--green)',color:'#fff',fontSize:'1rem',fontWeight:700,width:200,padding:0 }} /> :
        <b>{step.name}</b>}
        <small>{step.duration_mode === 'fixed' ? `${step.planned_duration_ms || 0}ms` : step.duration_mode} · {step.start_mode || 'auto'} start{step.is_analysis_window ? ' ↗ analysis' : ''}</small>
      </div>
      <div style={{ display:'flex',gap:'.5rem',alignItems:'center' }}>
        {onUpdate && <button onClick={() => setEditMode(e => !e)} className={editMode ? 'primary' : ''}
          style={{ fontSize:'.75rem',padding:'.3rem .7rem' }}>{editMode ? '✓ Done' : '✎ Edit'}</button>}
        <button onClick={onClose} title="Close">×</button>
      </div>
    </div>

    <div className="node-preview-stage" style={{ background: bg, color: fg, textAlign: align, padding: pad, gap, position:'relative',overflow:'auto' }}>
      {editMode ? (
        /* ── Edit mode: editor panel ── */
        <div className="preview-edit-panel" style={{ maxWidth:700,margin:'0 auto',width:'100%',background:'var(--paper)',borderRadius:12,padding:'1.5rem',color:'var(--ink)',textAlign:'left' }}>
          {/* Name */}
          <label style={{ display:'grid',gap:'.2rem',marginBottom:'.8rem' }}><b>Name</b>
            <input value={editing.name || ''} onChange={e => applyEdit('name', e.target.value)}
              style={{ padding:'.4rem',border:'1px solid var(--line)',borderRadius:6,fontSize:'.9rem' }} />
          </label>

          {/* Content (text-based steps) */}
          {hasText && <div style={{marginBottom:'.8rem'}}>
            <b>Content</b>
            {['zh','ja','en'].map(lang => (
              <label key={lang} style={{ display:'grid',gap:'.15rem',marginTop:'.4rem' }}>
                <small style={{color:'var(--muted)'}}>{lang==='zh'?'中文':lang==='ja'?'日本語':'English'}</small>
                <textarea rows={3} value={editing.content_i18n?.[lang] || ''}
                  onChange={e => applyEdit('content_i18n', {...editing.content_i18n, [lang]: e.target.value})}
                  style={{ padding:'.4rem',border:'1px solid var(--line)',borderRadius:6,fontSize:'.82rem',resize:'vertical' }} />
              </label>
            ))}
          </div>}

          {/* Response settings */}
          {step.type === 'response' && <>
            <div style={{marginBottom:'.8rem'}}>
              <b>Response variable</b>
              <input value={editing.response_variable || 'response'} onChange={e => applyEdit('response_variable', e.target.value)}
                style={{ width:'100%',padding:'.4rem',border:'1px solid var(--line)',borderRadius:6,fontSize:'.82rem' }} />
            </div>
            <div style={{marginBottom:'.8rem'}}>
              <b>Options (value | label | key)</b>
              <textarea rows={4}
                value={(editing.response_options || []).map(o => [o.value||'', o.label_i18n?.en||o.value||'', o.key||''].join(' | ')).join('\n')}
                onChange={e => {
                  const opts = e.target.value.split('\n').filter(Boolean).map(line => {
                    const [v='', l='', k=''] = line.split('|').map(s => s.trim());
                    return { value: v||l, key: k, label_i18n: { zh: l||v, ja: l||v, en: l||v } };
                  });
                  applyEdit('response_options', opts);
                }}
                style={{ width:'100%',padding:'.4rem',border:'1px solid var(--line)',borderRadius:6,fontSize:'.78rem',fontFamily:'monospace' }} />
            </div>
          </>}

          {/* Attention check */}
          {step.type === 'attention_check' && <div style={{marginBottom:'.8rem'}}>
            <label style={{ display:'grid',gap:'.15rem' }}><b>Expected key</b>
              <input value={editing.attention_expected_key || ' '} onChange={e => applyEdit('attention_expected_key', e.target.value)}
                style={{ padding:'.4rem',border:'1px solid var(--line)',borderRadius:6 }} />
            </label>
          </div>}

          {/* Questionnaire */}
          {step.type === 'questionnaire' && (editing.questionnaire_mode || 'internal') === 'internal' && (
            <div style={{ marginBottom: '.8rem' }}>
              <button type="button" className="primary" style={{ width: '100%' }}
                onClick={() => onOpenQuestionnaireWorkspace?.(editing.questionnaire, q => applyEdit('questionnaire', q))}>
                Open full questionnaire editor ↗<br />
                <small style={{ fontWeight: 400, opacity: .8 }}>{(editing.questionnaire?.questions?.length || 0)} question{((editing.questionnaire?.questions?.length || 0)) !== 1 ? 's' : ''}</small>
              </button>
            </div>
          )}

          {/* Media source */}
          {media && <div style={{marginBottom:'.8rem'}}>
            <b>Media source</b>
            <label style={{ display:'grid',gap:'.15rem',marginTop:'.4rem' }}>
              <small style={{color:'var(--muted)'}}>Source URL</small>
              <input value={editing.source_url || ''} onChange={e => applyEdit('source_url', e.target.value)}
                placeholder="https://..." style={{ padding:'.4rem',border:'1px solid var(--line)',borderRadius:6 }} />
            </label>
          </div>}

          {/* Duration & timing */}
          <div style={{ display:'flex',gap:'1rem',flexWrap:'wrap',marginBottom:'.8rem' }}>
            <label style={{ display:'grid',gap:'.15rem' }}><b>End mode</b>
              <select value={editing.duration_mode} onChange={e => applyEdit('duration_mode', e.target.value)}
                style={{ padding:'.4rem',border:'1px solid var(--line)',borderRadius:6 }}>
                <option value="fixed">Fixed time</option>
                {media && <option value="media">When media ends</option>}
                <option value="manual">Manual continue</option>
              </select>
            </label>
            {editing.duration_mode === 'fixed' && <label style={{ display:'grid',gap:'.15rem' }}><b>Duration (ms)</b>
              <input type="number" min={0} value={editing.planned_duration_ms || 0}
                onChange={e => applyEdit('planned_duration_ms', Number(e.target.value))}
                style={{ width:100,padding:'.4rem',border:'1px solid var(--line)',borderRadius:6 }} />
            </label>}
            <label style={{ display:'grid',gap:'.15rem' }}><b>Start mode</b>
              <select value={editing.start_mode || 'auto'} onChange={e => applyEdit('start_mode', e.target.value)}
                style={{ padding:'.4rem',border:'1px solid var(--line)',borderRadius:6 }}>
                <option value="auto">Automatic</option>
                <option value="manual">Participant click</option>
              </select>
            </label>
          </div>

          {/* Analysis window */}
          <label style={{ display:'flex',alignItems:'center',gap:'.3rem',marginBottom:'.4rem' }}>
            <input type="checkbox" checked={editing.is_analysis_window || false}
              onChange={e => applyEdit('is_analysis_window', e.target.checked)} />
            <b style={{fontSize:'.85rem'}}>Generate analysis window</b>
          </label>
        </div>
      ) : (
        /* ── Preview mode: actual runtime view ── */
        <div className="trial-content" style={{ width: '100%', maxWidth: contentWidth, marginInline: 'auto', textAlign: align, gap }}>
          {layout.show_step_type !== false && !['fixation','rest','timer'].includes(step.type) && (
            <span className="eyebrow" style={{ display:'block',fontSize:'.65rem',fontWeight:700,letterSpacing:'.14em',textTransform:'uppercase',color:'var(--muted)',marginBottom:'.8rem' }}>{step.type}</span>
          )}
          {!['fixation','rest','timer'].includes(step.type) && (
            <h1 style={{ fontFamily:"'Instrument Serif',Georgia,serif",fontSize:'clamp(1.6rem,4vw,2.6rem)',fontWeight:400,margin:'0 0 1.5rem',lineHeight:1.2,maxWidth:700 }}>{step.name_i18n?.en || step.name}</h1>
          )}
          <RuntimeContent step={step} session={{ participant_language: 'en' }} language="en"
            timing={{ current: { remaining: 0, started_at: 0, active: false } }}
            onComplete={() => {}} onQuestionnaireSubmit={() => {}} onResponseSubmit={() => {}}
            onMediaEvent={() => {}} onQuestionnaireExternalEvent={() => {}} fontSize={app.font_size || null} />
          {!['questionnaire', 'response', 'manual_event', 'device_check'].includes(step.type) && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '1.2rem 0 0' }}>
              <button className="primary" onClick={onClose} style={{ minWidth: 180, fontSize: '1rem', padding: '.6rem 1.5rem', borderRadius: 8 }}>Continue →</button>
            </div>
          )}
        </div>
      )}
    </div>

    <div className="node-preview-footer">
      <div>
        <span>End: <b>{step.duration_mode}</b></span>
        {step.duration_mode === 'fixed' && <span><b>{step.planned_duration_ms}ms</b></span>}
        <span>Start: <b>{step.start_mode || 'auto'}</b></span>
        <span>Auto: <b>{step.auto_advance !== false ? 'yes' : 'no'}</b></span>
        {step.is_analysis_window && <span className="preview-analysis-badge">↗ analysis</span>}
      </div>
      <button onClick={onClose}>Close</button>
    </div>
  </div>;
}
