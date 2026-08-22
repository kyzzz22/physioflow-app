import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { buildExternalFormUrl } from './externalForms.js';

const MSG = { zh: '回答已记录', ja: '回答が記録されました', en: 'Responses recorded' };
const BACK_LABEL = { zh: '← 上一题', ja: '← 前の問題', en: '← Previous' };

export default function QuestionnaireForm({ questionnaire, step = {}, session = {}, language = 'en', onSubmit, onExternalEvent }) {
  const [answers, setAnswers] = useState({});
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [externalOpened, setExternalOpened] = useState(false);
  const [externalConfirmed, setExternalConfirmed] = useState(false);
  const [timeLeft, setTimeLeft] = useState({});
  const [history, setHistory] = useState([]); // track answered question order for "back"
  const firstInputRef = useRef(null);
  const formRef = useRef(null);
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

  // Current question index for step-by-step navigation (when using back button)
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    setAnswers({}); setErrors({}); setSubmitted(false);
    setExternalOpened(false); setExternalConfirmed(false);
    setTimeLeft({}); setHistory([]); setCurrentStep(0);
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

  // Keyboard navigation
  useEffect(() => {
    if (submitted || externalMode) return;
    const handler = (e) => {
      // Number keys 1-9 for Likert/SAM scales
      if (e.key >= '1' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const activeEl = document.activeElement;
        if (activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA' || activeEl?.tagName === 'SELECT') return;
        const q = orderedQuestions[currentStep];
        if (q && ['likert', 'sam_valence', 'sam_arousal', 'vas_slider', 'number'].includes(q.type)) {
          const num = parseInt(e.key);
          const min = q.scale_min ?? 1;
          const max = q.scale_max ?? (q.type.startsWith('sam_') ? 9 : 5);
          if (num >= min && num <= max) {
            setAnswers(a => ({ ...a, [q.question_id]: num }));
            setErrors(e2 => ({ ...e2, [q.question_id]: false }));
          }
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [submitted, externalMode, orderedQuestions, currentStep]);

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

  // Back button handler
  const goBack = useCallback(() => {
    if (currentStep > 0) setCurrentStep(prev => prev - 1);
  }, [currentStep]);

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
      if (firstMissing) { const idx = orderedQuestions.indexOf(firstMissing); setCurrentStep(idx); const el = document.querySelector(`[name="${firstMissing.question_id}"]`); if (el) el.focus(); }
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

  const nextStep = () => {
    if (currentStep < orderedQuestions.length - 1) {
      setHistory(prev => [...prev, currentStep]);
      setCurrentStep(prev => prev + 1);
    }
  };

  if (submitted) {
    const score = calculateScore();
    return <div className="submitted-state" role="status">
      <span>✓</span><p>{MSG[language] || MSG.en}</p>
      {score.total > 0 && <small>得分: {score.correct}/{score.total} ({score.pct}%)</small>}
    </div>;
  }

  const answeredCount = orderedQuestions.filter(q => answers[q.question_id] !== undefined && answers[q.question_id] !== '').length;
  const currentQ = orderedQuestions[currentStep];

  return (
    <form className="questionnaire-form" onSubmit={submit} noValidate ref={formRef}>
      {/* Step indicator progress dots */}
      <StepIndicator current={currentStep} total={orderedQuestions.length} answered={answeredCount} />

      {/* Current question */}
      {currentQ && (
        <fieldset className={errors[currentQ.question_id] ? 'invalid' : ''} key={currentQ.question_id}>
          <legend>
            <span className="q-num">{currentStep + 1}/{orderedQuestions.length}</span>
            {currentQ.prompt_i18n?.[language] || currentQ.prompt_i18n?.en || `Question ${currentStep + 1}`}
            {currentQ.required && <sup aria-label="required">*</sup>}
            {(timeLeft[currentQ.question_id] ?? 0) > 0 && <span className="q-timer">⏱ {timeLeft[currentQ.question_id]}s</span>}
            {answers[currentQ.question_id] !== undefined && answers[currentQ.question_id] !== '' && <span className="q-done">✓</span>}
          </legend>
          <QuestionInput question={currentQ} language={language} value={answers[currentQ.question_id]}
            onChange={value => { set(currentQ.question_id, value); }}
            inputRef={currentStep === 0 ? firstInputRef : undefined}
            shuffle={currentQ.shuffle || false} />
          {errors[currentQ.question_id] && <small className="required-error" role="alert">必填 / Required / 必須</small>}
        </fieldset>
      )}

      {/* Navigation */}
      <div className="q-nav">
        {currentStep > 0 && (
          <button type="button" className="q-back-btn" onClick={goBack}>{BACK_LABEL[language] || BACK_LABEL.en}</button>
        )}
        {currentStep < orderedQuestions.length - 1 ? (
          <button type="button" className="primary q-next-btn" onClick={nextStep}>
            {language === 'zh' ? '下一题 →' : language === 'ja' ? '次へ →' : 'Next →'}
          </button>
        ) : (
          <button className="primary q-submit-btn" type="submit">
            {language === 'zh' ? '提交回答' : language === 'ja' ? '回答を送信' : 'Submit response'}
          </button>
        )}
      </div>
    </form>
  );
}

// ── Step Indicator Progress Dots ──
function StepIndicator({ current, total, answered }) {
  return (
    <div className="step-indicator" role="progressbar" aria-valuenow={answered} aria-valuemin={0} aria-valuemax={total}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className={`step-dot${i < current ? ' done' : i === current ? ' active' : ''}`}>
          <span>{i < current ? '✓' : i + 1}</span>
        </div>
      ))}
    </div>
  );
}

// ── Question Input Router ──
function QuestionInput({ question: q, language, value, onChange, inputRef, shuffle }) {
  const [shuffled, setShuffled] = useState(null);
  useEffect(() => {
    if (shuffle && ['single_choice', 'multiple_choice'].includes(q.type)) {
      const opts = q.options_i18n?.[language] || q.options_i18n?.en || [];
      let seed = 1; const arr = [...opts];
      for (let i = arr.length - 1; i > 0; i--) { seed = (seed * 1664525 + 1013904223) >>> 0; const j = seed % (i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
      setShuffled(arr);
    } else setShuffled(null);
  }, [q.question_id, shuffle, language]);

  const options = shuffled || (q.options_i18n?.[language] || q.options_i18n?.en || []);

  if (q.type === 'vas_slider') return <VasSlider q={q} language={language} value={value} onChange={onChange} inputRef={inputRef} />;
  if (['likert', 'sam_valence', 'sam_arousal'].includes(q.type)) return <LikertScale q={q} language={language} value={value} onChange={onChange} inputRef={inputRef} />;
  if (q.type === 'single_choice') return <ChoiceCards options={options} value={value} onChange={onChange} multiple={false} inputRef={inputRef} />;
  if (q.type === 'multiple_choice') return <ChoiceCards options={options} value={value} onChange={onChange} multiple={true} inputRef={inputRef} />;
  if (q.type === 'number') return <input type="number" min={q.scale_min} max={q.scale_max} value={value ?? ''}
    onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
    ref={inputRef} aria-label={q.prompt_i18n?.[language] || ''} className="q-number-input" />;
  if (q.type === 'long_text') return <textarea value={value ?? ''} onChange={e => onChange(e.target.value)}
    ref={inputRef} aria-label={q.prompt_i18n?.[language] || ''} rows={4} className="q-long-text" />;
  return <input type="text" value={value ?? ''} onChange={e => onChange(e.target.value)}
    ref={inputRef} aria-label={q.prompt_i18n?.[language] || ''} className="q-short-text" />;
}

// ── Likert / SAM Gradient Scale ──
function LikertScale({ q, language, value, onChange, inputRef }) {
  const min = q.scale_min ?? 1;
  const max = q.scale_max ?? (q.type.startsWith('sam_') ? 9 : 5);
  const isSam = q.type.startsWith('sam_');
  const numbers = Array.from({ length: max - min + 1 }, (_, i) => min + i);

  // Gradient from cool blue (low) to warm red (high)
  const getColor = (n) => {
    const t = (n - min) / Math.max(1, max - min);
    const h = 220 - t * 220; // blue(220) → red(0)
    const s = 55 + t * 30;
    const l = 55 - t * 15;
    return `hsl(${h}, ${s}%, ${l}%)`;
  };

  return (
    <div className="likert-bar-group" role="radiogroup" aria-label={q.prompt_i18n?.[language] || ''}>
      <div className="likert-bars">
        {numbers.map((n, i) => (
          <button
            key={n}
            type="button"
            className={`likert-bar${value === n ? ' selected' : ''}`}
            style={{ '--bar-color': getColor(n) }}
            onClick={() => onChange(n)}
            ref={!inputRef && value === undefined && n === min ? inputRef : undefined}
            aria-label={`${n}`}
            title={`${n}${q.min_label_i18n?.[language] && n === min ? ` — ${q.min_label_i18n[language]}` : ''}${q.max_label_i18n?.[language] && n === max ? ` — ${q.max_label_i18n[language]}` : ''}`}
          >
            {isSam ? <SamFigure type={q.type} value={n} min={min} max={max} /> : <span className="likert-num">{n}</span>}
          </button>
        ))}
      </div>
      <div className="likert-labels">
        <span>{q.min_label_i18n?.[language] || ''}</span>
        <span>{q.max_label_i18n?.[language] || ''}</span>
      </div>
    </div>
  );
}

// ── SAM Manikin SVG Figures ──
function SamFigure({ type, value, min, max }) {
  const t = (value - min) / Math.max(1, max - min); // 0..1
  const size = 32;

  if (type === 'sam_valence') {
    // Face: frown → neutral → smile
    const mouthCurve = -12 + t * 24; // -12 (sad) → +12 (happy)
    const eyeSize = 2.5 + t * 0.5;
    const eyeY = 11;
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" className="sam-figure-svg">
        <circle cx={16} cy={16} r={14} fill="none" stroke="currentColor" strokeWidth="1.5" />
        {/* Eyes */}
        <circle cx={10} cy={eyeY} r={eyeSize} fill="currentColor" />
        <circle cx={22} cy={eyeY} r={eyeSize} fill="currentColor" />
        {/* Mouth */}
        <path d={`M ${8} ${18} Q ${16} ${18 + mouthCurve} ${24} ${18}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  // sam_arousal: body shape — calm (small circle) → excited (expanding starburst)
  const bodyR = 4 + t * 8; // 4 → 12
  const limbSpread = 3 + t * 9; // 3 → 12
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="sam-figure-svg">
      {/* Body */}
      <ellipse cx={16} cy={16} rx={bodyR} ry={bodyR * 1.3} fill="currentColor" />
      {/* Limbs — spread more as arousal increases */}
      <line x1={16} y1={8} x2={16 - limbSpread} y2={16 - bodyR} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1={16} y1={8} x2={16 + limbSpread} y2={16 - bodyR} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1={16} y1={24} x2={16 - limbSpread} y2={16 + bodyR} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1={16} y1={24} x2={16 + limbSpread} y2={16 + bodyR} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ── VAS Custom Slider ──
function VasSlider({ q, language, value, onChange, inputRef }) {
  const min = q.scale_min ?? 0;
  const max = q.scale_max ?? 100;
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const pct = value != null ? ((value - min) / (max - min)) * 100 : 50;

  const updateFromEvent = (e) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onChange(Math.round(min + x * (max - min)));
  };

  const handlePointerDown = (e) => {
    e.preventDefault();
    setDragging(true);
    updateFromEvent(e);
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e) => updateFromEvent(e);
    const up = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging, min, max]);

  return (
    <div className="vas-custom">
      <div className="vas-custom-track" ref={trackRef} onPointerDown={handlePointerDown} role="slider" aria-valuenow={value ?? Math.round((min + max) / 2)} aria-valuemin={min} aria-valuemax={max} tabIndex={0}
        onKeyDown={e => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(max, (value ?? Math.round((min + max) / 2)) + 1)); }
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(min, (value ?? Math.round((min + max) / 2)) - 1)); }
        }}>
        <div className="vas-custom-fill" style={{ width: `${pct}%` }} />
        <div className="vas-custom-thumb" style={{ left: `${pct}%` }} ref={inputRef}>
          <span className="vas-custom-val">{value ?? '-'}</span>
        </div>
      </div>
      <div className="vas-custom-labels">
        <span>{min}{q.min_label_i18n?.[language] ? ` — ${q.min_label_i18n[language]}` : ''}</span>
        <span>{max}{q.max_label_i18n?.[language] ? ` — ${q.max_label_i18n[language]}` : ''}</span>
      </div>
    </div>
  );
}

// ── Animated Choice Cards ──
function ChoiceCards({ options, value, onChange, multiple, inputRef }) {
  return (
    <div className="choice-cards" role={multiple ? 'group' : 'radiogroup'}>
      {options.map((option, i) => {
        const selected = multiple ? (value || []).includes(option) : value === option;
        return (
          <label key={option} className={`choice-card${selected ? ' selected' : ''}`}>
            <input
              type={multiple ? 'checkbox' : 'radio'}
              name={multiple ? undefined : 'choice'}
              value={option}
              checked={selected}
              onChange={e => {
                if (multiple) {
                  onChange(e.target.checked ? [...(value || []), option] : (value || []).filter(x => x !== option));
                } else {
                  onChange(option);
                }
              }}
              ref={i === 0 ? inputRef : undefined}
            />
            <span className="choice-card-indicator">{multiple ? (selected ? '☑' : '☐') : (selected ? '●' : '○')}</span>
            <span className="choice-card-label">{option}</span>
          </label>
        );
      })}
    </div>
  );
}
