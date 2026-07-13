import { useEffect, useMemo, useRef, useState } from 'react';
import { buildExternalFormUrl } from './externalForms.js';

const MSG = { zh: '回答已记录', ja: '回答が記録されました', en: 'Responses recorded' };

export default function QuestionnaireForm({ questionnaire, step = {}, session = {}, language = 'en', onSubmit, onExternalEvent }) {
  const [answers, setAnswers] = useState({});
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [externalOpened, setExternalOpened] = useState(false);
  const [externalConfirmed, setExternalConfirmed] = useState(false);
  const [timeLeft, setTimeLeft] = useState({});
  const firstInputRef = useRef(null);
  const externalMode = (step.questionnaire_mode || 'internal') === 'external';

  const allQuestions = questionnaire?.questions || [];
  const enabledQuestions = useMemo(() => {
    return allQuestions.filter(q => {
      if (!q.show_if?.question_id) return true;
      const targetAnswer = answers[q.show_if.question_id];
      const op = q.show_if.operator || 'equals';
      const val = String(q.show_if.value ?? '');
      const ans = String(targetAnswer ?? '');
      switch (op) {
        case 'not_equals': return ans !== val;
        case 'contains': return ans.includes(val);
        case 'greater_than': return Number(ans) > Number(val);
        case 'less_than': return Number(ans) < Number(val);
        default: return ans === val;
      }
    });
  }, [allQuestions, answers]);

  const orderedQuestions = useMemo(() => {
    if (questionnaire?.shuffle_questions) {
      let seed = 1;
      const arr = [...enabledQuestions];
      for (let i = arr.length - 1; i > 0; i--) { seed = (seed * 1664525 + 1013904223) >>> 0; const j = seed % (i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
      return arr;
    }
    return enabledQuestions;
  }, [enabledQuestions, questionnaire?.shuffle_questions]);

  useEffect(() => {
    setAnswers({}); setErrors({}); setSubmitted(false);
    setExternalOpened(false); setExternalConfirmed(false);
    setTimeLeft({});
    if (firstInputRef.current) firstInputRef.current.focus();
  }, [questionnaire?.questionnaire_id, step.step_id, externalMode]);

  useEffect(() => {
    if (submitted) return;
    const intervals = [];
    orderedQuestions.forEach(q => {
      if (q.time_limit_sec && q.time_limit_sec > 0 && answers[q.question_id] === undefined) {
        const start = performance.now();
        const limit = q.time_limit_sec * 1000;
        setTimeLeft(prev => ({ ...prev, [q.question_id]: q.time_limit_sec }));
        const id = setInterval(() => {
          const elapsed = performance.now() - start;
          const remaining = Math.max(0, Math.ceil((limit - elapsed) / 1000));
          setTimeLeft(prev => ({ ...prev, [q.question_id]: remaining }));
          if (remaining <= 0) { clearInterval(id); setAnswers(a => ({ ...a, [q.question_id]: a[q.question_id] ?? '' })); }
        }, 500);
        intervals.push(id);
      }
    });
    return () => intervals.forEach(clearInterval);
  }, [orderedQuestions, submitted]);

  const calculateScore = () => {
    let correct = 0, total = 0;
    allQuestions.forEach(q => {
      if (!q.correct_answer) return;
      total++;
      const userAnswer = answers[q.question_id];
      if (userAnswer != null && String(userAnswer) === String(q.correct_answer)) correct++;
    });
    return { correct, total, pct: total > 0 ? Math.round(correct / total * 100) : null };
  };

  if (externalMode) {
    const baseUrl = (step.external_form_url || '').trim();
    const url = buildExternalFormUrl(step, session);
    const openLabel = step.external_open_label || 'Open external form';
    const completionLabel = step.external_completion_label || 'I completed the external form';
    const metadata = { external_form_url: baseUrl, resolved_form_url: url, opened: externalOpened, confirmed: externalConfirmed, appended_context: step.external_append_context !== false };
    return (
      <div className="external-questionnaire" role="group" aria-label="External questionnaire">
        {step.external_embed && url && <iframe title={step.name || 'External questionnaire'} src={url} loading="lazy" referrerPolicy="no-referrer-when-downgrade" onLoad={() => { if (!externalOpened) { setExternalOpened(true); onExternalEvent?.('external_questionnaire_opened', { external_form_url: baseUrl, resolved_form_url: url, embedded: true, appended_context: step.external_append_context !== false }); } }} />}
        {url ? <a className="primary external-form-link" href={url} target="_blank" rel="noreferrer" onClick={() => { setExternalOpened(true); onExternalEvent?.('external_questionnaire_opened', { external_form_url: baseUrl, resolved_form_url: url, appended_context: step.external_append_context !== false }); }}>{openLabel}</a> : <div className="media-error" role="alert">External form URL is not configured.</div>}
        <label className="external-confirm-row"><input type="checkbox" checked={externalConfirmed} disabled={!url} onChange={event => setExternalConfirmed(event.target.checked)} />{completionLabel}</label>
        <button className="primary" type="button" disabled={!url || !externalConfirmed} onClick={() => onExternalEvent?.('external_questionnaire_confirmed', metadata)}>Continue →</button>
      </div>
    );
  }

  if (!questionnaire?.questions?.length) return <div className="media-error" role="alert">No questions configured for this questionnaire.</div>;

  const set = (id, value) => { setAnswers(a => ({ ...a, [id]: value })); setErrors(e => ({ ...e, [id]: false })); };

  const submit = event => {
    event.preventDefault();
    const missing = Object.fromEntries(
      orderedQuestions.filter(q => q.required && (answers[q.question_id] === undefined || answers[q.question_id] === '' || (Array.isArray(answers[q.question_id]) && !answers[q.question_id].length)))
        .map(q => [q.question_id, true])
    );
    if (Object.keys(missing).length) {
      setErrors(missing);
      const firstMissing = orderedQuestions.find(q => missing[q.question_id]);
      if (firstMissing) { const el = document.querySelector(`[name="${firstMissing.question_id}"]`); if (el) el.focus(); }
      return;
    }
    setSubmitted(true);
    const score = calculateScore();
    const rows = orderedQuestions.map(q => ({
      question_id: q.question_id, question_type: q.type,
      value: Array.isArray(answers[q.question_id]) ? answers[q.question_id].join('|') : answers[q.question_id] ?? '',
      correct_answer: q.correct_answer || '',
      is_correct: q.correct_answer ? (String(answers[q.question_id] ?? '') === String(q.correct_answer)) : null,
    }));
    onSubmit(rows, score);
  };

  if (submitted) {
    const score = calculateScore();
    return <div className="submitted-state" role="status">
      <span>✓</span><p>{MSG[language] || MSG.en}</p>
      {score.total > 0 && <small>得分: {score.correct}/{score.total} ({score.pct}%)</small>}
    </div>;
  }

  const answeredCount = orderedQuestions.filter(q => answers[q.question_id] !== undefined && answers[q.question_id] !== '').length;
  const progressPct = orderedQuestions.length > 0 ? Math.round(answeredCount / orderedQuestions.length * 100) : 0;

  return (
    <form className="questionnaire-form" onSubmit={submit} noValidate>
      {questionnaire.show_progress !== false && (
        <div className="q-progress" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
          <div className="q-progress-bar" style={{ width: `${progressPct}%` }} />
          <span>{answeredCount}/{orderedQuestions.length}</span>
        </div>
      )}
      {orderedQuestions.map((q, index) => (
        <fieldset className={errors[q.question_id] ? 'invalid' : ''} key={q.question_id}>
          <legend>
            {index + 1}. {q.prompt_i18n?.[language] || q.prompt_i18n?.en || `Question ${index + 1}`}
            {q.required && <sup aria-label="required">*</sup>}
            {(timeLeft[q.question_id] ?? 0) > 0 && <span className="q-timer">⏱ {timeLeft[q.question_id]}s</span>}
            {answers[q.question_id] !== undefined && answers[q.question_id] !== '' && <span className="q-done">✓</span>}
          </legend>
          <QuestionInput question={q} language={language} value={answers[q.question_id]}
            onChange={value => set(q.question_id, value)}
            inputRef={index === 0 ? firstInputRef : undefined}
            shuffle={q.shuffle || false} />
          {errors[q.question_id] && <small className="required-error" role="alert">必填 / Required / 必須</small>}
        </fieldset>
      ))}
      <button className="primary" type="submit">{language === 'zh' ? '提交回答' : language === 'ja' ? '回答を送信' : 'Submit response'}</button>
    </form>
  );
}

function QuestionInput({ question: q, language, value, onChange, inputRef, shuffle }) {
  const min = q.scale_min ?? 1, max = q.scale_max ?? (q.type.startsWith('sam_') ? 9 : 5);

  const [shuffled, setShuffled] = useState(null);
  useEffect(() => {
    if (shuffle && ['single_choice','multiple_choice'].includes(q.type)) {
      const opts = q.options_i18n?.[language] || q.options_i18n?.en || [];
      let seed = 1; const arr = [...opts];
      for (let i = arr.length - 1; i > 0; i--) { seed = (seed * 1664525 + 1013904223) >>> 0; const j = seed % (i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
      setShuffled(arr);
    } else setShuffled(null);
  }, [q.question_id, shuffle, language]);

  const options = shuffled || (q.options_i18n?.[language] || q.options_i18n?.en || []);

  if (q.type === 'vas_slider') return (
    <div className="vas-slider">
      <div className="vas-track">
        <input type="range" min={min} max={max} value={value ?? Math.round((min + max) / 2)}
          onChange={e => onChange(Number(e.target.value))} ref={inputRef}
          aria-label={q.prompt_i18n?.[language] || ''} />
        <div className="vas-ticks">
          <span>{min}</span><span className="vas-val">{value ?? '-'}</span><span>{max}</span>
        </div>
      </div>
      <small>{q.min_label_i18n?.[language] || ''}<i />{q.max_label_i18n?.[language] || ''}</small>
    </div>
  );

  if (['likert', 'sam_valence', 'sam_arousal'].includes(q.type)) return (
    <div className="scale-input" role="radiogroup" aria-label={q.prompt_i18n?.[language] || ''}>
      <div>{Array.from({ length: max - min + 1 }, (_, i) => min + i).map(n => (
        <label className={value === n ? 'selected' : ''} key={n}>
          <input type="radio" name={q.question_id} value={n} checked={value === n}
            onChange={() => onChange(n)} ref={!inputRef && value === undefined && n === min ? inputRef : undefined} /><span>{n}</span>
        </label>
      ))}</div>
      <small>{q.min_label_i18n?.[language] || ''}<i />{q.max_label_i18n?.[language] || ''}</small>
    </div>
  );

  if (q.type === 'single_choice') return (
    <div className="choice-list" role="radiogroup" aria-label={q.prompt_i18n?.[language] || ''}>
      {options.map((option, i) => (
        <label key={option}><input type="radio" name={q.question_id} value={option} checked={value === option}
          onChange={() => onChange(option)} ref={i === 0 ? inputRef : undefined} />{option}</label>
      ))}
    </div>
  );

  if (q.type === 'multiple_choice') return (
    <div className="choice-list" role="group" aria-label={q.prompt_i18n?.[language] || ''}>
      {options.map((option, i) => (
        <label key={option}><input type="checkbox" name={q.question_id} value={option}
          checked={(value || []).includes(option)}
          onChange={e => onChange(e.target.checked ? [...(value || []), option] : (value || []).filter(x => x !== option))}
          ref={i === 0 ? inputRef : undefined} />{option}</label>
      ))}
    </div>
  );

  if (q.type === 'number') return (
    <input type="number" min={q.scale_min} max={q.scale_max} value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      ref={inputRef} aria-label={q.prompt_i18n?.[language] || ''} />
  );

  if (q.type === 'long_text') return (
    <textarea value={value ?? ''} onChange={e => onChange(e.target.value)}
      ref={inputRef} aria-label={q.prompt_i18n?.[language] || ''} rows={4} />
  );

  return (<input type="text" value={value ?? ''} onChange={e => onChange(e.target.value)}
    ref={inputRef} aria-label={q.prompt_i18n?.[language] || ''} />);
}
