import { useEffect, useMemo, useRef, useState } from 'react';
import { parseResponseOptions } from './core/responseOptions.js';

const MSG = { en: 'Response', zh: '响应', ja: '反応' };
const CONTINUE = { en: 'Continue', zh: '继续', ja: '続行' };
const CORRECT = { en: 'Correct', zh: '正确', ja: '正解' };
const INCORRECT = { en: 'Incorrect', zh: '错误', ja: '不正解' };
const PRESS_KEY = { en: 'Press a response key', zh: '请按响应键', ja: '応答キーを押してください' };
const PRESSED = { en: 'Pressed', zh: '已按', ja: '押したキー' };

function normalizeKey(event) {
  if (event.code === 'Space') return 'space';
  if (event.code === 'Enter' || event.key === 'Enter') return 'enter';
  return event.key.toLowerCase();
}

// True keyboard-response runner: shows the stimulus, captures a key press (or a tap on
// an option button), measures reaction time, optionally scores it against `correctValue`,
// and submits value / key / RT / correctness / timeout. Feedback is rendered before
// advancing when `feedbackMode` is enabled.
export default function ResponseRunner({ config = {}, language = 'en', disabled = false, onSubmit }) {
  const [pressed, setPressed] = useState(null); // pending non-auto-advance press { key, value, rt }
  const [feedback, setFeedback] = useState(null); // { ok, value, key, rt } while feedback is shown
  const startAt = useRef(performance.now());
  const resolved = useRef(false);
  const msg = value => value?.[language] || value?.en || value?.zh || '';

  const prompt = config.prompt || 'Respond when you see the target';
  const options = useMemo(() => parseResponseOptions(config.options || []), [config.options]);
  const allowKeys = useMemo(
    () => String(config.allowKeys || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean),
    [config.allowKeys]
  );
  const correctValue = config.correctValue != null && config.correctValue !== '' ? String(config.correctValue) : null;
  const timeoutMs = Math.max(0, Number(config.timeoutMs || 0));
  const autoAdvance = config.autoAdvance !== false;
  const feedbackMode = config.feedbackMode || 'none';

  const optionFor = key => {
    const k = String(key).toLowerCase();
    return options.find(o => (o.key || '').toLowerCase() === k || String(o.value).toLowerCase() === k) || null;
  };

  const isAllowed = key => {
    if (allowKeys.length) return allowKeys.includes(key);
    if (options.length) return options.some(o => (o.key || '').toLowerCase() === key || String(o.value).toLowerCase() === key);
    return /^[a-z0-9]$/.test(key) || key === 'space' || key === 'enter';
  };

  const submit = outcome => {
    if (resolved.current) return;
    resolved.current = true;
    const value = outcome.value ?? null;
    const key = outcome.key ?? null;
    const rt = outcome.rt ?? null;
    const timedOut = outcome.timedOut || false;
    const correct = correctValue ? String(value) === correctValue : null;
    const values = { value, response_key: key, reaction_time_ms: rt, correct, timed_out: timedOut };
    const variableName = config.variable || 'response';
    onSubmit?.({
      values,
      outputs: { ...values, [variableName]: value },
      variables: { [variableName]: value, [`${variableName}_rt_ms`]: rt, last_response_key: key },
      metadata: { response: { key, value, rt, correct, timedOut } },
    });
  };

  const commitKey = key => {
    if (resolved.current || disabled) return;
    const rt = Math.max(0, Math.round(performance.now() - startAt.current));
    const option = optionFor(key);
    const value = option ? option.value : key;
    const outcome = { key, value, rt };
    const ok = correctValue ? String(value) === correctValue : null;
    if (feedbackMode !== 'none' && !(feedbackMode === 'correct_incorrect' && ok == null)) {
      setFeedback({ ok, value, key, rt });
      window.setTimeout(() => submit(outcome), 1000);
    } else if (autoAdvance) {
      submit(outcome);
    } else {
      setPressed({ key, value, rt });
    }
  };

  useEffect(() => {
    if (disabled) return undefined;
    startAt.current = performance.now();
    resolved.current = false;
    const keydown = event => {
      if (event.repeat || resolved.current) return;
      const key = normalizeKey(event);
      if (!isAllowed(key)) return;
      event.preventDefault();
      commitKey(key);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [disabled, allowKeys, options, autoAdvance, feedbackMode, correctValue]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (disabled || timeoutMs <= 0) return undefined;
    const timer = setTimeout(() => {
      if (resolved.current) return;
      submit({ key: null, value: null, rt: null, timedOut: true });
    }, timeoutMs);
    return () => clearTimeout(timer);
  }, [disabled, timeoutMs]); // eslint-disable-line react-hooks/exhaustive-deps

  if (feedback) {
    const ok = feedback.ok;
    return (
      <div className="response-runner result">
        {ok === true ? <><h1>✓</h1><p>{msg(CORRECT)}</p></> : ok === false ? <><h1>✕</h1><p>{msg(INCORRECT)}</p></> : <><h1>{feedback.key}</h1><p>{feedback.value}</p></>}
        {feedback.rt != null && <small>{feedback.rt} ms</small>}
      </div>
    );
  }
  if (pressed) {
    return (
      <div className="response-runner result">
        <p>{prompt}</p>
        <p className="response-pressed">{msg(PRESSED)} <strong>{pressed.key}</strong> — {pressed.value}</p>
        {pressed.rt != null && <small>{pressed.rt} ms</small>}
        <button type="button" className="participant-ui-button primary" disabled={disabled} onClick={() => submit({ key: pressed.key, value: pressed.value, rt: pressed.rt })}>{msg(CONTINUE)}</button>
      </div>
    );
  }
  return (
    <div className="response-runner">
      <span className="eyebrow">{msg(MSG)}</span>
      <div className="response-stimulus">{prompt}</div>
      {options.length > 0 ? (
        <div className="response-options">
          {options.map((o, i) => (
            <button key={i} type="button" className="participant-ui-button" disabled={disabled} onClick={() => commitKey(o.key || String(o.value).toLowerCase())}>
              {o.key ? <kbd>{o.key}</kbd> : null} {o.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="response-hint">{msg(PRESS_KEY)}</p>
      )}
    </div>
  );
}
