import { useEffect, useRef, useState } from 'react';
import { buildExternalFormUrl } from './externalForms.js';

const MSG = { zh: '回答已记录', ja: '回答が記録されました', en: 'Responses recorded' };

export default function QuestionnaireForm({ questionnaire, step = {}, session = {}, language = 'en', onSubmit, onExternalEvent }) {
  const [answers, setAnswers] = useState({});
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [externalOpened, setExternalOpened] = useState(false);
  const [externalConfirmed, setExternalConfirmed] = useState(false);
  const firstInputRef = useRef(null);
  const externalMode = (step.questionnaire_mode || 'internal') === 'external';

  useEffect(() => {
    // Reset on new questionnaire
    setAnswers({});
    setErrors({});
    setSubmitted(false);
    setExternalOpened(false);
    setExternalConfirmed(false);
    // Auto-focus first input
    if (firstInputRef.current) firstInputRef.current.focus();
  }, [questionnaire?.questionnaire_id, step.step_id, externalMode]);

  if (externalMode) {
    const baseUrl = (step.external_form_url || '').trim();
    const url = buildExternalFormUrl(step, session);
    const openLabel = step.external_open_label || 'Open external form';
    const completionLabel = step.external_completion_label || 'I completed the external form';
    const metadata = { external_form_url: baseUrl, resolved_form_url: url, opened: externalOpened, confirmed: externalConfirmed, appended_context: step.external_append_context !== false };
    return (
      <div className="external-questionnaire" role="group" aria-label="External questionnaire">
        {step.external_embed && url && (
          <iframe
            title={step.name || 'External questionnaire'}
            src={url}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            onLoad={() => {
              if (!externalOpened) {
                setExternalOpened(true);
                onExternalEvent?.('external_questionnaire_opened', { external_form_url: baseUrl, resolved_form_url: url, embedded: true, appended_context: step.external_append_context !== false });
              }
            }}
          />
        )}
        {url ? (
          <a
            className="primary external-form-link"
            href={url}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              setExternalOpened(true);
              onExternalEvent?.('external_questionnaire_opened', { external_form_url: baseUrl, resolved_form_url: url, appended_context: step.external_append_context !== false });
            }}
          >
            {openLabel}
          </a>
        ) : (
          <div className="media-error" role="alert">External form URL is not configured.</div>
        )}
        <label className="external-confirm-row">
          <input type="checkbox" checked={externalConfirmed} disabled={!url} onChange={event => setExternalConfirmed(event.target.checked)} />
          {completionLabel}
        </label>
        <button
          className="primary"
          type="button"
          disabled={!url || !externalConfirmed}
          onClick={() => onExternalEvent?.('external_questionnaire_confirmed', metadata)}
        >
          Continue →
        </button>
      </div>
    );
  }

  if (!questionnaire?.questions?.length) return (
    <div className="media-error" role="alert">No questions configured for this questionnaire.</div>
  );

  const set = (id, value) => { setAnswers(a => ({ ...a, [id]: value })); setErrors(e => ({ ...e, [id]: false })); };

  const submit = event => {
    event.preventDefault();
    const missing = Object.fromEntries(
      questionnaire.questions
        .filter(q => q.required && (answers[q.question_id] === undefined || answers[q.question_id] === '' || (Array.isArray(answers[q.question_id]) && !answers[q.question_id].length)))
        .map(q => [q.question_id, true])
    );
    if (Object.keys(missing).length) {
      setErrors(missing);
      // Focus the first missing field
      const firstMissing = questionnaire.questions.find(q => missing[q.question_id]);
      if (firstMissing) {
        const el = document.querySelector(`[name="${firstMissing.question_id}"]`);
        if (el) el.focus();
      }
      return;
    }
    setSubmitted(true);
    onSubmit(questionnaire.questions.map(q => ({
      question_id: q.question_id,
      question_type: q.type,
      value: Array.isArray(answers[q.question_id]) ? answers[q.question_id].join('|') : answers[q.question_id] ?? '',
    })));
  };

  if (submitted) return (
    <div className="submitted-state" role="status">
      <span>✓</span>
      <p>{MSG[language] || MSG.en}</p>
    </div>
  );

  return (
    <form className="questionnaire-form" onSubmit={submit} noValidate>
      {questionnaire.questions.map((q, index) => (
        <fieldset className={errors[q.question_id] ? 'invalid' : ''} key={q.question_id}>
          <legend>
            {index + 1}. {q.prompt_i18n?.[language] || q.prompt_i18n?.en || `Question ${index + 1}`}
            {q.required && <sup aria-label="required">*</sup>}
          </legend>
          <QuestionInput
            question={q}
            language={language}
            value={answers[q.question_id]}
            onChange={value => set(q.question_id, value)}
            inputRef={index === 0 ? firstInputRef : undefined}
          />
          {errors[q.question_id] && (
            <small className="required-error" role="alert">Required / 必填 / 必須</small>
          )}
        </fieldset>
      ))}
      <button className="primary" type="submit">
        {language === 'zh' ? '提交回答' : language === 'ja' ? '回答を送信' : 'Submit response'}
      </button>
    </form>
  );
}

function QuestionInput({ question: q, language, value, onChange, inputRef }) {
  const min = q.scale_min ?? 1, max = q.scale_max ?? (q.type.startsWith('sam_') ? 9 : 5);

  if (['likert', 'sam_valence', 'sam_arousal'].includes(q.type)) return (
    <div className="scale-input" role="radiogroup" aria-label={q.prompt_i18n?.[language] || ''}>
      <div>{Array.from({ length: max - min + 1 }, (_, i) => min + i).map(n => (
        <label className={value === n ? 'selected' : ''} key={n}>
          <input type="radio" name={q.question_id} value={n} checked={value === n}
            onChange={() => onChange(n)}
            ref={!inputRef && value === undefined && n === min ? inputRef : undefined}
          />
          <span>{n}</span>
        </label>
      ))}</div>
      <small>{q.min_label_i18n?.[language] || ''}<i />{q.max_label_i18n?.[language] || ''}</small>
    </div>
  );

  if (q.type === 'single_choice') return (
    <div className="choice-list" role="radiogroup" aria-label={q.prompt_i18n?.[language] || ''}>
      {(q.options_i18n?.[language] || q.options_i18n?.en || []).map((option, i) => (
        <label key={option}>
          <input type="radio" name={q.question_id} value={option} checked={value === option}
            onChange={() => onChange(option)}
            ref={i === 0 ? inputRef : undefined}
          />
          {option}
        </label>
      ))}
    </div>
  );

  if (q.type === 'multiple_choice') return (
    <div className="choice-list" role="group" aria-label={q.prompt_i18n?.[language] || ''}>
      {(q.options_i18n?.[language] || q.options_i18n?.en || []).map((option, i) => (
        <label key={option}>
          <input type="checkbox" name={q.question_id} value={option}
            checked={(value || []).includes(option)}
            onChange={e => onChange(e.target.checked ? [...(value || []), option] : (value || []).filter(x => x !== option))}
            ref={i === 0 ? inputRef : undefined}
          />
          {option}
        </label>
      ))}
    </div>
  );

  if (q.type === 'number') return (
    <input type="number" min={q.scale_min} max={q.scale_max} value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      ref={inputRef} aria-label={q.prompt_i18n?.[language] || ''}
    />
  );

  if (q.type === 'long_text') return (
    <textarea value={value ?? ''} onChange={e => onChange(e.target.value)}
      ref={inputRef} aria-label={q.prompt_i18n?.[language] || ''}
      rows={4}
    />
  );

  return (
    <input type="text" value={value ?? ''} onChange={e => onChange(e.target.value)}
      ref={inputRef} aria-label={q.prompt_i18n?.[language] || ''}
    />
  );
}
