import { useEffect, useMemo, useRef, useState } from 'react';
import { questionnaireScore, seededShuffle } from './core/index.js';

const MSG = { en: 'Responses recorded', zh: '回答已记录', ja: '回答が記録されました' };
const REQUIRED = { en: 'Required', zh: '必填', ja: '必須' };
const PREV = { en: '← Previous', zh: '← 上一题', ja: '← 前へ' };
const NEXT = { en: 'Next →', zh: '下一题 →', ja: '次へ →' };
const SUBMIT = { en: 'Submit', zh: '提交', ja: '送信' };
const NO_QUESTIONS = { en: 'No questions', zh: '没有题目', ja: '質問がありません' };
const CONTINUE = { en: 'Continue', zh: '继续', ja: '次へ' };
const SCORE = { en: 'Score', zh: '得分', ja: '得点' };
const TIME = { en: 'Time left', zh: '剩余时间', ja: '残り時間' };

function isMissing(value) { return value === undefined || value === '' || (Array.isArray(value) && value.length === 0); }

export default function QuestionnaireFormV2({ questionnaire, language = 'en', randomSeed = '', onSubmit }) {
  const questions = useMemo(() => questionnaire?.questions || [], [questionnaire?.questions]);
  const [answers, setAnswers] = useState({});
  const [current, setCurrent] = useState(0);
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [timedOut, setTimedOut] = useState([]);
  const [remaining, setRemaining] = useState(null);
  const deadlineRef = useRef(null);
  const answersRef = useRef(answers);
  useEffect(() => { answersRef.current = answers; }, [answers]);
  const msg = value => value?.[language] || value?.en || value?.zh || '';

  const baseOrder = useMemo(() => questionnaire?.shuffle_questions
    ? seededShuffle(questions, `${randomSeed}:${questionnaire?.questionnaire_id || ''}:questions`)
    : [...questions], [questionnaire?.questionnaire_id, questionnaire?.shuffle_questions, questions, randomSeed]);

  const isVisible = question => {
    if (!question.show_if?.question_id) return true;
    const actual = answers[question.show_if.question_id];
    const expected = question.show_if.value;
    switch (question.show_if.operator || 'equals') {
      case 'not_equals': return String(actual ?? '') !== String(expected ?? '');
      case 'contains': return Array.isArray(actual) ? actual.map(String).includes(String(expected)) : String(actual ?? '').includes(String(expected ?? ''));
      case 'greater_than': return Number(actual) > Number(expected);
      case 'less_than': return Number(actual) < Number(expected);
      default: return String(actual ?? '') === String(expected ?? '');
    }
  };
  const ordered = baseOrder.filter(isVisible);
  const currentQ = ordered[Math.min(current, Math.max(0, ordered.length - 1))] || null;

  useEffect(() => {
    if (current >= ordered.length && ordered.length) setCurrent(ordered.length - 1);
  }, [current, ordered.length]);

  const setAnswer = (question, value) => {
    setAnswers(previous => ({ ...previous, [question.question_id]: value }));
    setErrors(previous => ({ ...previous, [question.question_id]: false }));
  };

  const finish = (nextAnswers = answersRef.current, timeoutIds = timedOut) => {
    const visibleIds = new Set(ordered.map(question => question.question_id));
    const submittedAnswers = Object.fromEntries(Object.entries(nextAnswers).filter(([id]) => visibleIds.has(id)));
    const score = questionnaireScore(questionnaire, submittedAnswers);
    const metadata = { score, timedOutQuestionIds: [...timeoutIds], questionOrder: ordered.map(question => question.question_id) };
    setSubmitted(true);
    onSubmit?.(submittedAnswers, metadata);
  };

  const validateCurrent = () => {
    if (!currentQ?.required || !isMissing(answers[currentQ.question_id]) || timedOut.includes(currentQ.question_id)) return true;
    setErrors(previous => ({ ...previous, [currentQ.question_id]: true }));
    return false;
  };

  const next = () => { if (validateCurrent()) setCurrent(index => Math.min(index + 1, ordered.length - 1)); };
  const submit = () => {
    const missing = Object.fromEntries(ordered.filter(question => question.required && !timedOut.includes(question.question_id) && isMissing(answers[question.question_id])).map(question => [question.question_id, true]));
    if (Object.keys(missing).length) {
      setErrors(missing);
      const first = ordered.findIndex(question => missing[question.question_id]);
      if (first >= 0) setCurrent(first);
      return;
    }
    finish();
  };

  useEffect(() => {
    const limit = Number(currentQ?.time_limit_sec || 0);
    if (!limit) { deadlineRef.current = null; setRemaining(null); return undefined; }
    deadlineRef.current = performance.now() + limit * 1000;
    setRemaining(limit);
    const timer = setInterval(() => {
      const left = Math.max(0, (deadlineRef.current - performance.now()) / 1000);
      setRemaining(left);
      if (left > 0) return;
      clearInterval(timer);
      const id = currentQ.question_id;
      const nextTimeouts = timedOut.includes(id) ? timedOut : [...timedOut, id];
      setTimedOut(nextTimeouts);
      if (current >= ordered.length - 1) finish(answersRef.current, nextTimeouts);
      else setCurrent(index => index + 1);
    }, 100);
    return () => clearInterval(timer);
  }, [currentQ?.question_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = question => {
    const values = question.options_i18n?.[language] || question.options_i18n?.en || question.options_i18n?.zh || [];
    return question.shuffle ? seededShuffle(values, `${randomSeed}:${question.question_id}:options`) : values;
  };

  const renderQuestion = question => {
    if (['likert', 'sam_valence', 'sam_arousal'].includes(question.type)) {
      const min = question.scale_min ?? 1;
      const max = question.scale_max ?? (question.type.startsWith('sam_') ? 9 : 5);
      return <div className="qf-scale">{Array.from({ length: max - min + 1 }, (_, index) => min + index).map(value => <button key={value} type="button" className={`qf-scale-btn${answers[question.question_id] === value ? ' selected' : ''}`} onClick={() => setAnswer(question, value)}>{value}</button>)}</div>;
    }
    if (question.type === 'number') return <input className="qf-text" type="number" min={question.scale_min} max={question.scale_max} value={answers[question.question_id] ?? ''} onChange={event => setAnswer(question, event.target.value === '' ? '' : Number(event.target.value))} />;
    if (question.type === 'single_choice') return <div className="qf-options">{options(question).map(option => <label key={option} className="qf-option"><input type="radio" name={question.question_id} checked={answers[question.question_id] === option} onChange={() => setAnswer(question, option)} />{option}</label>)}</div>;
    if (question.type === 'multiple_choice') return <div className="qf-options">{options(question).map(option => <label key={option} className="qf-option"><input type="checkbox" checked={(answers[question.question_id] || []).includes(option)} onChange={event => { const values = answers[question.question_id] || []; setAnswer(question, event.target.checked ? [...values, option] : values.filter(value => value !== option)); }} />{option}</label>)}</div>;
    if (question.type === 'vas_slider') {
      const min = question.scale_min ?? 0, max = question.scale_max ?? 100;
      return <div className="qf-vas"><input type="range" min={min} max={max} value={answers[question.question_id] ?? min} onChange={event => setAnswer(question, Number(event.target.value))} /><div className="qf-vas-labels"><span>{msg(question.min_label_i18n) || String(min)}</span><span>{msg(question.max_label_i18n) || String(max)}</span></div><div className="qf-vas-value">{answers[question.question_id] ?? min}</div></div>;
    }
    if (question.type === 'long_text') return <textarea className="qf-textarea" value={answers[question.question_id] || ''} onChange={event => setAnswer(question, event.target.value)} rows={4} />;
    if (question.type === 'short_text') return <input className="qf-text" type="text" value={answers[question.question_id] || ''} onChange={event => setAnswer(question, event.target.value)} />;
    return null;
  };

  const score = questionnaireScore(questionnaire, answers);
  if (submitted) return <div className="participant-ui-screen" style={{ textAlign: 'center', padding: 32, margin: 'auto', maxWidth: 640 }}><h1>✓</h1><p>{msg(MSG)}</p>{score.total > 0 && <p>{msg(SCORE)}: {score.correct}/{score.total} ({score.pct}%)</p>}</div>;
  if (!currentQ) return <div className="participant-ui-screen" style={{ textAlign: 'center', padding: 32, margin: 'auto', maxWidth: 640 }}><p>{msg(NO_QUESTIONS)}</p><button type="button" className="participant-ui-button primary" onClick={() => onSubmit?.({}, { score: { correct: 0, total: 0, pct: null }, timedOutQuestionIds: [], questionOrder: [] })}>{msg(CONTINUE)}</button></div>;

  return <div className="participant-ui-screen" style={{ maxWidth: 640, padding: 32, margin: 'auto' }}>
    {questionnaire?.show_progress !== false && <div className="qf-progress"><progress value={current + 1} max={ordered.length} /><span>{current + 1}/{ordered.length}</span></div>}
    {remaining !== null && <div className="qf-time" role="timer">{msg(TIME)}: {remaining.toFixed(1)}s</div>}
    <p className="qf-prompt">{msg(currentQ.prompt_i18n)}</p>
    {renderQuestion(currentQ)}
    {errors[currentQ.question_id] && <small className="qf-error">{msg(REQUIRED)}</small>}
    <div className="qf-nav">
      {current > 0 && <button type="button" className="participant-ui-button secondary" onClick={() => setCurrent(index => index - 1)}>{msg(PREV)}</button>}
      {current < ordered.length - 1 ? <button type="button" className="participant-ui-button primary" onClick={next}>{msg(NEXT)}</button> : <button type="button" className="participant-ui-button primary" onClick={submit}>{msg(SUBMIT)}</button>}
    </div>
  </div>;
}
