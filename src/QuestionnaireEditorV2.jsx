import { useEffect, useMemo, useState } from 'react';
import { COMPARISON_OPS, LANGS, PRESETS, QUESTION_TYPES, createQuestionnaire, newQuestion, parseQuestionnaireCsv, removeQuestionnaireFromLibrary, saveQuestionnaireToLibrary } from './core/questionnaireModel.js';

// New-architecture questionnaire editor for Composer V2.
// Builds the schema questionnaire model (src/core/questionnaireModel.js) into
// node.config.questionnaire — pure, serializable, freeze-hash safe. No legacy dependency.
const PRESET_KEYS = Object.keys(PRESETS);

export default function QuestionnaireEditorV2({ value, onChange, library = [], onLibraryChange }) {
  const questionnaire = useMemo(() => value || createQuestionnaire(), [value]);
  const questions = questionnaire.questions || [];
  const [lang, setLang] = useState('en');
  const [dragOver, setDragOver] = useState(null);

  useEffect(() => {
    if (!value) onChange(questionnaire);
  }, [onChange, questionnaire, value]);

  const commit = next => onChange(next);
  const updateQuestion = (index, patch) => commit({ ...questionnaire, questions: questions.map((q, i) => i === index ? { ...q, ...patch } : q) });
  const removeQuestion = index => commit({ ...questionnaire, questions: questions.filter((_, i) => i !== index) });
  const addPreset = key => { const q = (PRESETS[key] || newQuestion)(); commit({ ...questionnaire, questions: [...questions, q] }); };
  const moveQuestion = (from, to) => {
    const next = [...questions];
    const [moving] = next.splice(from, 1);
    const adjusted = from < to ? to - 1 : to;
    next.splice(Math.max(0, Math.min(adjusted, next.length)), 0, moving);
    commit({ ...questionnaire, questions: next });
  };

  const importCsv = text => {
    const imported = parseQuestionnaireCsv(text);
    commit({ ...questionnaire, questions: [...questions, ...imported] });
  };

  return <details className="qe-editor" open>
    <summary>Questionnaire editor</summary>

    <div className="qe-settings">
      <label>Name<input value={questionnaire.name || ''} onChange={e => commit({ ...questionnaire, name: e.target.value })} /></label>
      <label className="qe-check"><input type="checkbox" checked={Boolean(questionnaire.shuffle_questions)} onChange={e => commit({ ...questionnaire, shuffle_questions: e.target.checked })} /> Shuffle</label>
      <label className="qe-check"><input type="checkbox" checked={questionnaire.show_progress !== false} onChange={e => commit({ ...questionnaire, show_progress: e.target.checked })} /> Progress</label>
    </div>

    <details className="qe-presets"><summary>+ Preset questions</summary>
      <div className="qe-preset-grid">{PRESET_KEYS.map(key => {
        const q = (PRESETS[key] || newQuestion)();
        return <button key={key} type="button" onClick={() => addPreset(key)} title={q.prompt_i18n?.en || key}><b>{key}</b><span>{q.prompt_i18n?.en || ''}</span></button>;
      })}</div>
    </details>

    <details className="qe-import"><summary>+ CSV import</summary>
      <CsvImport onImport={importCsv} />
    </details>

    {onLibraryChange && <details className="qe-library"><summary>Questionnaire library ({library.length})</summary>
      <div className="qe-library-row"><button type="button" onClick={() => onLibraryChange(saveQuestionnaireToLibrary(library, questionnaire))}>Save current to library</button></div>
      {library.map(item => (
        <div key={item.questionnaire_id} className="qe-library-row">
          <span>{item.name || item.questionnaire_id}</span>
          <button type="button" onClick={() => onChange(structuredClone(item))}>Load</button>
          <button type="button" className="qe-remove" onClick={() => onLibraryChange(removeQuestionnaireFromLibrary(library, item.questionnaire_id))}>×</button>
        </div>
      ))}
    </details>}

    {questions.length === 0 && <p className="qe-empty">No questions yet. Use presets or add manually.</p>}
    {questions.map((q, index) => (
      <QuestionRow key={q.question_id} q={q} index={index} total={questions.length} lang={lang}
        questions={questions} dragOver={dragOver} setDragOver={setDragOver}
        updateQuestion={updateQuestion} removeQuestion={removeQuestion} moveQuestion={moveQuestion} />
    ))}
    <div className="qe-add-row">
      <button type="button" onClick={() => commit({ ...questionnaire, questions: [...questions, newQuestion()] })}>+ Add question</button>
      <select value="" onChange={e => { if (e.target.value) setLang(e.target.value); }} aria-label="Edit language"><option value="">Language: {LANGS.find(l => l[0] === lang)?.[1] || lang}</option>{LANGS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select>
    </div>
  </details>;
}

function CsvImport({ onImport }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  return <div className="qe-csv">
    <textarea rows={4} value={text} onChange={e => setText(e.target.value)} placeholder="type,en,options,min,max,answer&#10;likert,Rate your experience,Not at all|Very,1,5,5" />
    <small>Format: type, en, options (| separated), min, max, answer</small>
    {error && <small className="qe-error">{error}</small>}
    <button type="button" disabled={!text.trim()} onClick={() => { try { onImport(text); setText(''); setError(''); } catch (nextError) { setError(nextError.message); } }}>Import</button>
  </div>;
}

function QuestionRow({ q, index, total, lang, questions, dragOver, setDragOver, updateQuestion, removeQuestion, moveQuestion }) {
  const field = (key, obj) => obj?.[key] || '';
  return <article className={`qe-card${dragOver?.index === index && dragOver.where === 'top' ? ' drag-top' : dragOver?.index === index && dragOver.where === 'bottom' ? ' drag-bottom' : ''}`}>
    <span className="qe-drag" draggable title="Drag to reorder"
      onDragStart={e => { e.dataTransfer.setData('text/plain', String(index)); e.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={e => { e.preventDefault(); const rect = e.currentTarget.closest('article').getBoundingClientRect(); setDragOver({ index, where: e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom' }); }}
      onDragLeave={() => setDragOver(null)}
      onDrop={e => { e.preventDefault(); const from = Number(e.dataTransfer.getData('text/plain')); const to = index + (dragOver?.where === 'bottom' ? 1 : 0); setDragOver(null); if (from >= 0 && from < total && from !== to && from + 1 !== to) moveQuestion(from, to); }}>⠿</span>
    <div className="qe-head">
      <b>Q{index + 1}</b>
      <select value={q.type} onChange={e => updateQuestion(index, { type: e.target.value })}>{QUESTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
      <label className="qe-check"><input type="checkbox" checked={Boolean(q.required)} onChange={e => updateQuestion(index, { required: e.target.checked })} /> Required</label>
      <label className="qe-check"><input type="checkbox" disabled={!['single_choice', 'multiple_choice'].includes(q.type)} checked={Boolean(q.shuffle)} onChange={e => updateQuestion(index, { shuffle: e.target.checked })} title="Shuffle options" /> ⇄</label>
      <button type="button" className="qe-remove" onClick={() => removeQuestion(index)}>×</button>
    </div>

    <details className="qe-cond"><summary>Conditional display</summary>
      {q.show_if ? <div className="qe-cond-row">
        <span>When</span>
        <select value={q.show_if.question_id} onChange={e => updateQuestion(index, { show_if: { ...q.show_if, question_id: e.target.value } })}>
          <option value="">— question —</option>
          {questions.filter(oq => oq.question_id !== q.question_id).map(oq => <option key={oq.question_id} value={oq.question_id}>Q{questions.indexOf(oq) + 1}</option>)}
        </select>
        <select value={q.show_if.operator || 'equals'} onChange={e => updateQuestion(index, { show_if: { ...q.show_if, operator: e.target.value } })}>{COMPARISON_OPS.map(op => <option key={op} value={op}>{op}</option>)}</select>
        <input value={q.show_if.value || ''} placeholder="value" onChange={e => updateQuestion(index, { show_if: { ...q.show_if, value: e.target.value } })} />
        <button type="button" onClick={() => updateQuestion(index, { show_if: null })}>×</button>
      </div> : <button type="button" onClick={() => updateQuestion(index, { show_if: { question_id: '', operator: 'equals', value: '' } })}>+ Add condition</button>}
    </details>

    <textarea className="qe-prompt" rows={2} value={field(lang, q.prompt_i18n)} placeholder={`Prompt (${lang})`} onChange={e => updateQuestion(index, { prompt_i18n: { ...q.prompt_i18n, [lang]: e.target.value } })} />

    {['likert', 'sam_valence', 'sam_arousal', 'number', 'vas_slider'].includes(q.type) && (
      <div className="qe-scale">
        <label>Min <input type="number" value={q.scale_min ?? 1} onChange={e => updateQuestion(index, { scale_min: Number(e.target.value) })} /></label>
        <label>Max <input type="number" value={q.scale_max ?? 5} onChange={e => updateQuestion(index, { scale_max: Number(e.target.value) })} /></label>
        {q.type !== 'number' && <><label>Min label <input value={field(lang, q.min_label_i18n)} onChange={e => updateQuestion(index, { min_label_i18n: { ...q.min_label_i18n, [lang]: e.target.value } })} /></label>
          <label>Max label <input value={field(lang, q.max_label_i18n)} onChange={e => updateQuestion(index, { max_label_i18n: { ...q.max_label_i18n, [lang]: e.target.value } })} /></label></>}
      </div>
    )}

    {['single_choice', 'multiple_choice'].includes(q.type) && (
      <textarea className="qe-options" rows={3} value={(q.options_i18n?.[lang] || []).join('\n')} placeholder="One option per line" onChange={e => updateQuestion(index, { options_i18n: { ...q.options_i18n, [lang]: e.target.value.split('\n') } })} />
    )}

    {['single_choice', 'number', 'likert'].includes(q.type) && (
      <label className="qe-answer">Correct answer (auto-score)<input value={q.correct_answer || ''} placeholder={q.type === 'likert' || q.type === 'number' ? 'e.g. 5' : 'matching option text'} onChange={e => updateQuestion(index, { correct_answer: e.target.value })} /></label>
    )}

    <label className="qe-time">Time limit (sec, optional)<input type="number" min={0} max={600} value={q.time_limit_sec ?? ''} placeholder="blank = no limit" onChange={e => updateQuestion(index, { time_limit_sec: e.target.value === '' ? null : Number(e.target.value) })} /></label>
  </article>;
}
