import { useState } from 'react';
import { uid } from './domain';

export const QUESTION_TYPES = ['sam_valence','sam_arousal','likert','single_choice','multiple_choice','number','short_text','long_text'];
const LANGS = [['zh','中文'],['ja','日本語'],['en','English']];
const newQuestion = () => ({ question_id: uid('question'), type: 'likert', required: true, prompt_i18n: { zh: '', ja: '', en: '' }, options_i18n: { zh: ['选项 1','选项 2'], ja: ['選択肢 1','選択肢 2'], en: ['Option 1','Option 2'] }, scale_min: 1, scale_max: 5, min_label_i18n: { zh: '非常不同意', ja: '全く同意しない', en: 'Strongly disagree' }, max_label_i18n: { zh: '非常同意', ja: '強く同意する', en: 'Strongly agree' } });

export function createQuestionnaire() { return { questionnaire_id: uid('questionnaire'), name: 'Questionnaire', questions: [newQuestion()] }; }

export default function QuestionnaireDesigner({ value, onChange, disabled }) {
  const questionnaire = value || createQuestionnaire();
  const updateQuestion = (index, key, next) => onChange({ ...questionnaire, questions: questionnaire.questions.map((q, i) => i === index ? { ...q, [key]: next } : q) });
  const removeQuestion = index => onChange({ ...questionnaire, questions: questionnaire.questions.filter((_, i) => i !== index) });
  return <details className="questionnaire-designer" open><summary>Questionnaire designer · 问卷设计 · アンケート設計</summary><label className="questionnaire-name">Questionnaire name<input value={questionnaire.name} disabled={disabled} onChange={e => onChange({ ...questionnaire, name: e.target.value })}/></label>{questionnaire.questions.map((q, index) => <QuestionEditor key={q.question_id} question={q} index={index} disabled={disabled} updateQuestion={updateQuestion} removeQuestion={removeQuestion} />)}<button type="button" disabled={disabled} onClick={() => onChange({ ...questionnaire, questions: [...questionnaire.questions, newQuestion()] })}>+ Add question</button></details>;
}

function QuestionEditor({ question: q, index, disabled, updateQuestion, removeQuestion }) {
  const [lang, setLang] = useState('zh');
  return <article key={q.question_id}>
    <div className="question-head">
      <b>Q{index + 1}</b>
      <select value={q.type} disabled={disabled} onChange={e => updateQuestion(index, 'type', e.target.value)}>{QUESTION_TYPES.map(type => <option key={type} value={type}>{type}</option>)}</select>
      <label><input type="checkbox" checked={q.required} disabled={disabled} onChange={e => updateQuestion(index, 'required', e.target.checked)}/> Required</label>
      <button type="button" disabled={disabled} onClick={() => removeQuestion(index)}>×</button>
    </div>
    {/* Language tabs */}
    <div style={{ display: 'flex', gap: '2px', marginBottom: '.4rem' }}>
      {LANGS.map(([code, label]) => (
        <button type="button" key={code} disabled={disabled}
          onClick={() => setLang(code)}
          style={{
            fontSize: '.65rem', padding: '.2rem .5rem', border: '1px solid var(--line)',
            borderRadius: '4px 4px 0 0', borderBottom: 0,
            background: lang === code ? 'var(--paper)' : '#eef1ec',
            color: lang === code ? 'var(--ink)' : '#7b867f',
            fontWeight: lang === code ? 700 : 400,
            cursor: 'pointer',
          }}
        >{label}</button>
      ))}
    </div>
    <label style={{ display: 'block', marginBottom: '.5rem' }}>
      <textarea placeholder={`Question prompt (${lang})`}
        value={q.prompt_i18n?.[lang] || ''}
        disabled={disabled}
        onChange={e => updateQuestion(index, 'prompt_i18n', { ...q.prompt_i18n, [lang]: e.target.value })}
        rows={2}
      />
    </label>
    {['likert','sam_valence','sam_arousal','number'].includes(q.type) && (
      <div className="scale-settings">
        <label>Minimum<input type="number" value={q.scale_min ?? 1} disabled={disabled} onChange={e => updateQuestion(index, 'scale_min', Number(e.target.value))}/></label>
        <label>Maximum<input type="number" value={q.scale_max ?? 5} disabled={disabled} onChange={e => updateQuestion(index, 'scale_max', Number(e.target.value))}/></label>
      </div>
    )}
    {['single_choice','multiple_choice'].includes(q.type) && (
      <div style={{ marginBottom: '.5rem' }}>
        <textarea
          disabled={disabled}
          value={(q.options_i18n?.[lang] || []).join('\n')}
          onChange={e => updateQuestion(index, 'options_i18n', { ...q.options_i18n, [lang]: e.target.value.split('\n') })}
          placeholder={`One option per line (${lang})`}
          rows={3}
        />
        <small style={{ display: 'block', fontSize: '.6rem', color: '#7b867f' }}>One option per line</small>
      </div>
    )}
  </article>;
}
