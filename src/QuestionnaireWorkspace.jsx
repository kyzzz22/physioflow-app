import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { uid } from './domain';
import QuestionnaireForm from './QuestionnaireForm';
import { QUESTION_TYPES, COMPARISON_OPS, LANGS, newQuestion, createQuestionnaire, PRESETS, BatchImport } from './QuestionnaireDesigner';

export { createQuestionnaire };

export default function QuestionnaireWorkspace({ value, onChange, onClose, disabled, language = 'en' }) {
  const questionnaire = value || createQuestionnaire();
  const qs = questionnaire.questions || [];
  const [activeIndex, setActiveIndex] = useState(qs.length > 0 ? 0 : -1);
  const [previewLang, setPreviewLang] = useState(language);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const overlayRef = useRef(null);

  // Keep activeIndex in bounds when questions change
  useEffect(() => {
    if (activeIndex >= qs.length) setActiveIndex(qs.length - 1);
    if (activeIndex < 0 && qs.length > 0) setActiveIndex(0);
  }, [qs.length, activeIndex]);

  // ESC to close
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Focus trap
  useEffect(() => {
    const prev = document.activeElement;
    const el = overlayRef.current;
    if (el) {
      const focusable = el.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (focusable.length) focusable[0].focus();
    }
    return () => { if (prev && prev.focus) prev.focus(); };
  }, []);

  const commit = useCallback((nextQuestionnaire) => {
    onChange(nextQuestionnaire);
  }, [onChange]);

  const updateQuestion = (index, key, nextVal) => {
    commit({ ...questionnaire, questions: qs.map((q, i) => i === index ? { ...q, [key]: nextVal } : q) });
  };

  const removeQuestion = (index) => {
    commit({ ...questionnaire, questions: qs.filter((_, i) => i !== index) });
  };

  const addQuestion = () => {
    commit({ ...questionnaire, questions: [...qs, newQuestion()] });
    setActiveIndex(qs.length);
  };

  const addPreset = (key) => {
    const q = (PRESETS[key] || newQuestion)();
    commit({ ...questionnaire, questions: [...qs, q] });
    setActiveIndex(qs.length);
  };

  const moveQuestion = (from, to) => {
    const next = [...qs];
    [next[from], next[to]] = [next[to], next[from]];
    commit({ ...questionnaire, questions: next });
    if (activeIndex === from) setActiveIndex(to);
    else if (activeIndex === to) setActiveIndex(from);
  };

  const activeQuestion = qs[activeIndex] || null;

  // Build a single-question questionnaire for preview
  const previewQuestionnaire = activeQuestion
    ? { ...questionnaire, questions: [activeQuestion], questionnaire_id: questionnaire.questionnaire_id }
    : { ...questionnaire, questions: [], questionnaire_id: questionnaire.questionnaire_id };

  return createPortal(
    <div className="qw-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true">
      <div className="qw-workspace" ref={overlayRef}>
        {/* Header */}
        <div className="qw-header">
          <div className="qw-header-left">
            <span className="qw-badge">QUESTIONNAIRE EDITOR</span>
            <input
              className="qw-name-input"
              value={questionnaire.name}
              disabled={disabled}
              onChange={e => commit({ ...questionnaire, name: e.target.value })}
              placeholder="Questionnaire name"
            />
            <span className="qw-count">{qs.length} question{qs.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="qw-header-right">
            <div className="qw-header-checks">
              <label className="q-check">
                <input type="checkbox" checked={questionnaire.shuffle_questions || false} disabled={disabled}
                  onChange={e => commit({ ...questionnaire, shuffle_questions: e.target.checked })} />
                Shuffle
              </label>
              <label className="q-check">
                <input type="checkbox" checked={questionnaire.show_progress !== false} disabled={disabled}
                  onChange={e => commit({ ...questionnaire, show_progress: e.target.checked })} />
                Progress
              </label>
            </div>
            <button className="qw-close-btn" onClick={onClose} title="Close (Esc)">×</button>
          </div>
        </div>

        {/* Body */}
        <div className="qw-body">
          {/* Left panel — question list */}
          <div className="qw-left">
            <div className="qw-left-toolbar">
              <button disabled={disabled} onClick={addQuestion}>+ Add question</button>
              <details className="q-presets">
                <summary>+ Presets</summary>
                <div className="q-preset-grid">
                  {Object.entries(PRESETS).map(([key, fn]) => {
                    const q = fn();
                    return <button key={key} type="button" disabled={disabled} onClick={() => addPreset(key)}
                      title={q.prompt_i18n?.en || key}>
                      <b>{key}</b><span>{q.prompt_i18n?.en || ''}</span>
                    </button>;
                  })}
                </div>
              </details>
              <details className="q-import">
                <summary>+ CSV Import</summary>
                <BatchImport disabled={disabled} onImport={rows => {
                  const imported = rows.map(row => ({
                    question_id: uid('question'),
                    type: row.type || 'likert',
                    required: row.required !== 'false',
                    prompt_i18n: { zh: row.zh || row.en || '', ja: row.ja || row.en || '', en: row.en || '' },
                    options_i18n: row.options ? { zh: row.options.split('|'), ja: row.options.split('|'), en: row.options.split('|') } : undefined,
                    scale_min: row.min ? Number(row.min) : 1,
                    scale_max: row.max ? Number(row.max) : 5,
                    correct_answer: row.answer || '',
                  }));
                  commit({ ...questionnaire, questions: [...qs, ...imported] });
                }} />
              </details>
            </div>
            <div className="qw-list">
              {qs.length === 0 && <p className="qw-empty">No questions yet. Click "+ Add question" or choose a preset.</p>}
              {qs.map((q, index) => (
                <div
                  key={q.question_id}
                  className={`qw-list-card${index === activeIndex ? ' active' : ''}${index === dragOverIndex ? ' drag-over' : ''}`}
                  onClick={() => setActiveIndex(index)}
                  draggable={!disabled}
                  onDragStart={e => { e.dataTransfer.setData('text/plain', String(index)); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragOver={e => { e.preventDefault(); setDragOverIndex(index); }}
                  onDragLeave={() => setDragOverIndex(null)}
                  onDrop={e => {
                    e.preventDefault();
                    const from = Number(e.dataTransfer.getData('text/plain'));
                    setDragOverIndex(null);
                    if (from !== index && from >= 0 && from < qs.length) moveQuestion(from, index);
                  }}
                >
                  <span className="qw-list-num">Q{index + 1}</span>
                  <span className="qw-list-type">{q.type.replace(/_/g, ' ')}</span>
                  <span className="qw-list-prompt">{(q.prompt_i18n?.en || q.prompt_i18n?.zh || '(empty prompt)').slice(0, 60)}</span>
                  {q.required && <span className="qw-list-req">*</span>}
                  <button className="qw-list-del" disabled={disabled} onClick={e => { e.stopPropagation(); removeQuestion(index); }} title="Remove question">×</button>
                </div>
              ))}
            </div>
          </div>

          {/* Right panel — editor + preview */}
          <div className="qw-right">
            {activeQuestion ? (
              <>
                {/* Editor */}
                <div className="qw-editor">
                  <div className="qw-editor-head">
                    <h3>Q{activeIndex + 1} Editor</h3>
                    <span className="qw-editor-type">{activeQuestion.type.replace(/_/g, ' ')}</span>
                  </div>
                  <QuestionEditorPanel
                    question={activeQuestion}
                    index={activeIndex}
                    allQuestions={qs}
                    disabled={disabled}
                    updateQuestion={updateQuestion}
                  />
                </div>

                {/* Preview */}
                <div className="qw-preview">
                  <div className="qw-preview-head">
                    <h3>Preview</h3>
                    <div className="qw-preview-lang">
                      {LANGS.map(([code, label]) => (
                        <button key={code} className={`qw-lang-btn${previewLang === code ? ' active' : ''}`}
                          onClick={() => setPreviewLang(code)}>{label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="qw-preview-stage">
                    <QuestionnaireForm
                      questionnaire={previewQuestionnaire}
                      step={{}}
                      session={{}}
                      language={previewLang}
                      onSubmit={() => {}}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="qw-empty-state">
                <span className="qw-empty-icon">☷</span>
                <h3>No question selected</h3>
                <p>Add a question from the left panel, or click an existing question to edit it.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Question Editor Panel (in-workspace version) ──
function QuestionEditorPanel({ question: q, index, allQuestions, disabled, updateQuestion }) {
  const [lang, setLang] = useState('zh');

  return (
    <div className="qw-editor-body">
      {/* Type + required + shuffle */}
      <div className="qw-editor-row">
        <label>Type
          <select value={q.type} disabled={disabled} onChange={e => updateQuestion(index, 'type', e.target.value)}>
            {QUESTION_TYPES.map(type => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <label className="q-check"><input type="checkbox" checked={q.required} disabled={disabled} onChange={e => updateQuestion(index, 'required', e.target.checked)} /> Required</label>
        <label className="q-check"><input type="checkbox" checked={q.shuffle || false} disabled={disabled} onChange={e => updateQuestion(index, 'shuffle', e.target.checked)} title="Randomize options" /> Shuffle</label>
        {q.type !== 'number' && <label>Time limit (s) <input type="number" min={0} max={600} value={q.time_limit_sec || ''} disabled={disabled} placeholder="unlimited" style={{ width: 70 }}
          onChange={e => updateQuestion(index, 'time_limit_sec', e.target.value === '' ? null : Number(e.target.value))} /></label>}
      </div>

      {/* Conditional logic */}
      <details className="qw-conditional">
        <summary>Conditional display · 条件显示</summary>
        {q.show_if ? (
          <div className="qw-cond-row">
            <span>When</span>
            <select value={q.show_if.question_id} disabled={disabled} onChange={e => updateQuestion(index, 'show_if', { ...q.show_if, question_id: e.target.value })}>
              <option value="">-- select question --</option>
              {allQuestions.filter(oq => oq.question_id !== q.question_id).map(oq => (
                <option key={oq.question_id} value={oq.question_id}>
                  Q{allQuestions.indexOf(oq) + 1}: {(oq.prompt_i18n?.en || oq.prompt_i18n?.zh || '').slice(0, 30)}
                </option>
              ))}
            </select>
            <select value={q.show_if.operator || 'equals'} disabled={disabled} onChange={e => updateQuestion(index, 'show_if', { ...q.show_if, operator: e.target.value })}>
              {COMPARISON_OPS.map(op => <option key={op} value={op}>{op}</option>)}
            </select>
            <input value={q.show_if.value || ''} disabled={disabled} placeholder="value" onChange={e => updateQuestion(index, 'show_if', { ...q.show_if, value: e.target.value })} style={{ width: 80 }} />
            <button type="button" disabled={disabled} onClick={() => updateQuestion(index, 'show_if', null)}>×</button>
          </div>
        ) : (
          <button type="button" disabled={disabled} onClick={() => updateQuestion(index, 'show_if', { question_id: '', operator: 'equals', value: '' })}>+ Add condition</button>
        )}
      </details>

      {/* Language tabs */}
      <div className="q-lang-tabs">
        {LANGS.map(([code, label]) => (
          <button key={code} type="button" disabled={disabled} className={`q-lang-btn${lang === code ? ' active' : ''}`} onClick={() => setLang(code)}>{label}</button>
        ))}
      </div>

      {/* Prompt */}
      <textarea className="q-prompt" placeholder={`Question text (${lang})`}
        value={q.prompt_i18n?.[lang] || ''} disabled={disabled}
        onChange={e => updateQuestion(index, 'prompt_i18n', { ...q.prompt_i18n, [lang]: e.target.value })}
        rows={2} />

      {/* Scale settings */}
      {['likert', 'sam_valence', 'sam_arousal', 'number', 'vas_slider'].includes(q.type) && (
        <div className="q-scale">
          <label>Min <input type="number" value={q.scale_min ?? 1} disabled={disabled} onChange={e => updateQuestion(index, 'scale_min', Number(e.target.value))} /></label>
          <label>Max <input type="number" value={q.scale_max ?? 5} disabled={disabled} onChange={e => updateQuestion(index, 'scale_max', Number(e.target.value))} /></label>
          {q.type !== 'number' && <>
            <label>Min label <input value={q.min_label_i18n?.[lang] || ''} disabled={disabled} onChange={e => updateQuestion(index, 'min_label_i18n', { ...q.min_label_i18n, [lang]: e.target.value })} placeholder="min label" /></label>
            <label>Max label <input value={q.max_label_i18n?.[lang] || ''} disabled={disabled} onChange={e => updateQuestion(index, 'max_label_i18n', { ...q.max_label_i18n, [lang]: e.target.value })} placeholder="max label" /></label>
          </>}
        </div>
      )}

      {/* Choice options */}
      {['single_choice', 'multiple_choice'].includes(q.type) && (
        <div className="q-options">
          <textarea disabled={disabled}
            value={(q.options_i18n?.[lang] || []).join('\n')}
            onChange={e => updateQuestion(index, 'options_i18n', { ...q.options_i18n, [lang]: e.target.value.split('\n') })}
            placeholder={`One option per line (${lang})`} rows={4} />
        </div>
      )}

      {/* Correct answer */}
      {['single_choice', 'number', 'likert'].includes(q.type) && (
        <label className="q-answer">
          <span>Correct answer (auto-score)</span>
          <input value={q.correct_answer || ''} disabled={disabled} placeholder={q.type === 'likert' || q.type === 'number' ? 'e.g. 5' : 'match option text'}
            onChange={e => updateQuestion(index, 'correct_answer', e.target.value)} />
        </label>
      )}
    </div>
  );
}
