import { useState, useCallback } from 'react';
import { uid } from './domain';

export const QUESTION_TYPES = ['likert','single_choice','multiple_choice','vas_slider','sam_valence','sam_arousal','number','short_text','long_text'];
export const COMPARISON_OPS = ['equals','not_equals','contains','greater_than','less_than'];
const LANGS = [['zh','中文'],['ja','日本語'],['en','English']];

const newQuestion = () => ({
  question_id: uid('question'), type: 'likert', required: true,
  prompt_i18n: { zh: '', ja: '', en: '' },
  options_i18n: { zh: ['选项 1','选项 2'], ja: ['選択肢 1','選択肢 2'], en: ['Option 1','Option 2'] },
  scale_min: 1, scale_max: 5,
  min_label_i18n: { zh: '非常不同意', ja: '全く同意しない', en: 'Strongly disagree' },
  max_label_i18n: { zh: '非常同意', ja: '強く同意する', en: 'Strongly agree' },
  correct_answer: '', show_if: null, shuffle: false, time_limit_sec: null,
});

export function createQuestionnaire() { return { questionnaire_id: uid('questionnaire'), name: 'Questionnaire', questions: [newQuestion()], shuffle_questions: false, show_progress: true }; }

// ── Presets ──
const PRESETS = {
  sam_valence: () => ({ question_id: uid('question'), type:'sam_valence', required: true, prompt_i18n:{zh:'此刻您的愉悦程度如何？',ja:'現在の快・不快の程度を教えてください。',en:'How pleasant do you feel right now?'}, scale_min:1, scale_max:9 }),
  sam_arousal: () => ({ question_id: uid('question'), type:'sam_arousal', required: true, prompt_i18n:{zh:'此刻您的唤醒程度如何？',ja:'現在の覚醒度を教えてください。',en:'How aroused do you feel right now?'}, scale_min:1, scale_max:9 }),
  likert5: () => ({ question_id: uid('question'), type:'likert', required: true, prompt_i18n:{zh:'请评价',ja:'評価してください',en:'Please rate'}, scale_min:1, scale_max:5, min_label_i18n:{zh:'非常不同意',ja:'全く同意しない',en:'Strongly disagree'}, max_label_i18n:{zh:'非常同意',ja:'強く同意する',en:'Strongly agree'} }),
  likert7: () => ({ question_id: uid('question'), type:'likert', required: true, prompt_i18n:{zh:'请评价',ja:'評価してください',en:'Please rate'}, scale_min:1, scale_max:7 }),
  nps: () => ({ question_id: uid('question'), type:'likert', required: true, prompt_i18n:{zh:'您向朋友推荐的可能性有多大？',ja:'友人に勧める可能性はどのくらいですか？',en:'How likely are you to recommend to a friend?'}, scale_min:0, scale_max:10, min_label_i18n:{zh:'完全不可能',ja:'全く勧めない',en:'Not at all likely'}, max_label_i18n:{zh:'非常可能',ja:'非常に勧める',en:'Extremely likely'} }),
  vas: () => ({ question_id: uid('question'), type:'vas_slider', required: true, prompt_i18n:{zh:'请拖动滑块',ja:'スライダーを動かしてください',en:'Drag the slider'}, scale_min:0, scale_max:100, min_label_i18n:{zh:'最低',ja:'最低',en:'Lowest'}, max_label_i18n:{zh:'最高',ja:'最高',en:'Highest'} }),
  single: () => ({ question_id: uid('question'), type:'single_choice', required: true, prompt_i18n:{zh:'请选择',ja:'選択してください',en:'Choose one'}, options_i18n:{zh:['选项1','选项2','选项3'],ja:['選択肢1','選択肢2','選択肢3'],en:['Option 1','Option 2','Option 3']} }),
  multiple: () => ({ question_id: uid('question'), type:'multiple_choice', required: true, prompt_i18n:{zh:'请选择（可多选）',ja:'選択してください（複数可）',en:'Choose (multiple allowed)'}, options_i18n:{zh:['选项1','选项2'],ja:['選択肢1','選択肢2'],en:['Option 1','Option 2']} }),
  short: () => ({ question_id: uid('question'), type:'short_text', required: false, prompt_i18n:{zh:'请输入',ja:'入力してください',en:'Please enter'} }),
  long: () => ({ question_id: uid('question'), type:'long_text', required: false, prompt_i18n:{zh:'请详细描述',ja:'詳しく記述してください',en:'Please describe in detail'} }),
  number: () => ({ question_id: uid('question'), type:'number', required: true, prompt_i18n:{zh:'请输入数字',ja:'数値を入力してください',en:'Enter a number'}, scale_min:0, scale_max:100 }),
};

export default function QuestionnaireDesigner({ value, onChange, disabled }) {
  const questionnaire = value || createQuestionnaire();
  const qs = questionnaire.questions || [];

  const updateQuestion = (index, key, next) => onChange({ ...questionnaire, questions: qs.map((q, i) => i === index ? { ...q, [key]: next } : q) });
  const removeQuestion = index => onChange({ ...questionnaire, questions: qs.filter((_, i) => i !== index) });
  const moveQuestion = useCallback((from, to) => {
    const next = [...qs]; [next[from], next[to]] = [next[to], next[from]];
    onChange({ ...questionnaire, questions: next });
  }, [qs, onChange, questionnaire]);
  const addPreset = useCallback((key) => {
    const q = (PRESETS[key] || newQuestion)();
    onChange({ ...questionnaire, questions: [...qs, q] });
  }, [qs, onChange, questionnaire]);

  return <details className="questionnaire-designer" open>
    <summary>问卷设计器 · Questionnaire designer · アンケート設計</summary>

    {/* Questionnaire-level settings */}
    <div className="q-settings-row">
      <label>名称 <input value={questionnaire.name} disabled={disabled} onChange={e => onChange({ ...questionnaire, name: e.target.value })} /></label>
      <label className="q-check"><input type="checkbox" checked={questionnaire.shuffle_questions || false} disabled={disabled} onChange={e => onChange({ ...questionnaire, shuffle_questions: e.target.checked })} /> 随机题目顺序</label>
      <label className="q-check"><input type="checkbox" checked={questionnaire.show_progress !== false} disabled={disabled} onChange={e => onChange({ ...questionnaire, show_progress: e.target.checked })} /> 显示进度</label>
    </div>

    {/* Question presets */}
    <details className="q-presets"><summary>+ 快速添加预设问题</summary>
      <div className="q-preset-grid">
        {Object.entries(PRESETS).map(([key, fn]) => {
          const q = fn();
          return <button key={key} type="button" disabled={disabled} onClick={() => addPreset(key)} title={q.prompt_i18n?.en || key}>
            <b>{key}</b><span>{q.prompt_i18n?.en || ''}</span>
          </button>;
        })}
      </div>
    </details>

    {/* Batch import */}
    <details className="q-import"><summary>+ 批量导入 (CSV)</summary>
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
        onChange({ ...questionnaire, questions: [...qs, ...imported] });
      }} />
    </details>

    {/* Question list */}
    {qs.length === 0 && <p style={{ color: 'var(--muted)', fontSize: '.8rem', padding: '.5rem' }}>暂无问题。使用上方预设或手动添加。</p>}
    {qs.map((q, index) => (
      <QuestionEditor key={q.question_id} question={q} index={index} total={qs.length}
        disabled={disabled} updateQuestion={updateQuestion} removeQuestion={removeQuestion}
        moveQuestion={moveQuestion} allQuestions={qs}
      />
    ))}
    <button type="button" disabled={disabled} onClick={() => onChange({ ...questionnaire, questions: [...qs, newQuestion()] })}>+ 添加问题</button>
  </details>;
}

// ── Batch import ──
function BatchImport({ disabled, onImport }) {
  const [text, setText] = useState('');
  const parse = () => {
    const lines = text.trim().split('\n').filter(Boolean);
    if (lines.length < 2) return;
    const headers = lines[0].split(',').map(h => h.trim());
    const rows = lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim());
      return Object.fromEntries(headers.map((h, i) => [h, vals[i] || '']));
    });
    onImport(rows);
    setText('');
  };
  return <div className="batch-import">
    <textarea rows={4} value={text} disabled={disabled}
      placeholder="type,en,options,min,max,answer&#10;likert,How satisfied?,Very dissatisfied|Neutral|Very satisfied,1,5,3&#10;single_choice,Choose one,Yes|No|Maybe,,,Yes"
      onChange={e => setText(e.target.value)} />
    <small>格式: type, en, options(用|分隔), min, max, answer</small>
    <button type="button" disabled={disabled || !text.trim()} onClick={parse}>导入</button>
  </div>;
}

// ── Question Editor ──
function QuestionEditor({ question: q, index, total, disabled, updateQuestion, removeQuestion, moveQuestion, allQuestions }) {
  const [lang, setLang] = useState('zh');
  const [dragOver, setDragOver] = useState(null);

  return <article className={`q-card${dragOver === 'top' ? ' drag-over-top' : dragOver === 'bottom' ? ' drag-over-bottom' : ''}`}>
    {/* Drag handle */}
    {!disabled && <span className="q-drag-handle" draggable
      onDragStart={e => { e.dataTransfer.setData('text/plain', String(index)); e.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={e => { e.preventDefault(); const rect = e.currentTarget.closest('article').getBoundingClientRect(); setDragOver(e.clientY < rect.top + rect.height/2 ? 'top' : 'bottom'); }}
      onDragLeave={() => setDragOver(null)}
      onDrop={e => { e.preventDefault(); const from = Number(e.dataTransfer.getData('text/plain')); setDragOver(null); if (from !== index && from >= 0 && from < total) moveQuestion(from, index); }}
      title="拖拽排序">⠿</span>}

    <div className="q-head">
      <b>Q{index + 1}</b>
      <select value={q.type} disabled={disabled} onChange={e => updateQuestion(index, 'type', e.target.value)}>
        {QUESTION_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
      </select>
      <label className="q-check"><input type="checkbox" checked={q.required} disabled={disabled} onChange={e => updateQuestion(index, 'required', e.target.checked)} /> Required</label>
      <label className="q-check"><input type="checkbox" checked={q.shuffle || false} disabled={disabled} onChange={e => updateQuestion(index, 'shuffle', e.target.checked)} title="随机选项顺序" /> ⇄</label>
      <button type="button" disabled={disabled} onClick={() => removeQuestion(index)} className="q-remove">×</button>
    </div>

    {/* Conditional logic */}
    <details className="q-conditional"><summary>条件显示 · 跳题逻辑</summary>
      {q.show_if ? <div className="q-cond-row">
        <span>当</span>
        <select value={q.show_if.question_id} disabled={disabled} onChange={e => updateQuestion(index, 'show_if', { ...q.show_if, question_id: e.target.value })}>
          <option value="">-- 选择问题 --</option>
          {allQuestions.filter(oq => oq.question_id !== q.question_id).map(oq => <option key={oq.question_id} value={oq.question_id}>Q{allQuestions.indexOf(oq)+1}: {(oq.prompt_i18n?.en || oq.prompt_i18n?.zh || '').slice(0, 30)}</option>)}
        </select>
        <select value={q.show_if.operator || 'equals'} disabled={disabled} onChange={e => updateQuestion(index, 'show_if', { ...q.show_if, operator: e.target.value })}>
          {COMPARISON_OPS.map(op => <option key={op} value={op}>{op}</option>)}
        </select>
        <input value={q.show_if.value || ''} disabled={disabled} placeholder="值" onChange={e => updateQuestion(index, 'show_if', { ...q.show_if, value: e.target.value })} style={{ width: 80 }} />
        <button type="button" disabled={disabled} onClick={() => updateQuestion(index, 'show_if', null)}>×</button>
      </div> : <button type="button" disabled={disabled} onClick={() => updateQuestion(index, 'show_if', { question_id: '', operator: 'equals', value: '' })}>+ 添加条件</button>}
    </details>

    {/* Language tabs */}
    <div className="q-lang-tabs">
      {LANGS.map(([code, label]) => (
        <button type="button" key={code} disabled={disabled}
          className={`q-lang-btn${lang === code ? ' active' : ''}`}
          onClick={() => setLang(code)}
        >{label}</button>
      ))}
    </div>

    {/* Prompt */}
    <textarea className="q-prompt" placeholder={`题目文字 (${lang})`}
      value={q.prompt_i18n?.[lang] || ''} disabled={disabled}
      onChange={e => updateQuestion(index, 'prompt_i18n', { ...q.prompt_i18n, [lang]: e.target.value })}
      rows={2} />

    {/* Scale settings */}
    {['likert','sam_valence','sam_arousal','number','vas_slider'].includes(q.type) && (
      <div className="q-scale">
        <label>最小 <input type="number" value={q.scale_min ?? 1} disabled={disabled} onChange={e => updateQuestion(index, 'scale_min', Number(e.target.value))} /></label>
        <label>最大 <input type="number" value={q.scale_max ?? 5} disabled={disabled} onChange={e => updateQuestion(index, 'scale_max', Number(e.target.value))} /></label>
        {q.type !== 'number' && <>
          <label>最小标签 <input value={q.min_label_i18n?.[lang] || ''} disabled={disabled} onChange={e => updateQuestion(index, 'min_label_i18n', { ...q.min_label_i18n, [lang]: e.target.value })} placeholder="最低标签" /></label>
          <label>最大标签 <input value={q.max_label_i18n?.[lang] || ''} disabled={disabled} onChange={e => updateQuestion(index, 'max_label_i18n', { ...q.max_label_i18n, [lang]: e.target.value })} placeholder="最高标签" /></label>
        </>}
      </div>
    )}

    {/* Choice options */}
    {['single_choice','multiple_choice'].includes(q.type) && (
      <div className="q-options">
        <textarea disabled={disabled}
          value={(q.options_i18n?.[lang] || []).join('\n')}
          onChange={e => updateQuestion(index, 'options_i18n', { ...q.options_i18n, [lang]: e.target.value.split('\n') })}
          placeholder={`每行一个选项 (${lang})`} rows={3} />
      </div>
    )}

    {/* Correct answer / scoring */}
    {['single_choice','number','likert'].includes(q.type) && (
      <label className="q-answer">
        <span>正确答案 (自动计分)</span>
        <input value={q.correct_answer || ''} disabled={disabled} placeholder={q.type==='likert'||q.type==='number'?'e.g. 5':'匹配选项文字'}
          onChange={e => updateQuestion(index, 'correct_answer', e.target.value)} />
      </label>
    )}

    {/* Time limit */}
    <label className="q-time">
      <span>答题时限 (可选)</span>
      <input type="number" min={0} max={600} value={q.time_limit_sec || ''} disabled={disabled} placeholder="秒，留空=不限时"
        onChange={e => updateQuestion(index, 'time_limit_sec', e.target.value === '' ? null : Number(e.target.value))} />
    </label>
  </article>;
}
