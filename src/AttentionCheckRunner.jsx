import { useEffect, useRef, useState } from 'react';

const MSG = { en: 'Attention check', zh: '注意力检查', ja: '注意チェック' };
const START = { en: 'Start', zh: '开始', ja: '開始' };
const PASSED = { en: 'Passed', zh: '通过', ja: '合格' };
const MISSED = { en: 'Missed / too slow', zh: '未通过 / 超时', ja: '不合格 / 遅すぎ' };

// True attention-check runner: shows the prompt, listens for the expected key with a
// reaction-time measurement and a timeout, then submits passed / RT / outcome.
export default function AttentionCheckRunner({ config, language = 'en', disabled = false, onSubmit }) {
  const [phase, setPhase] = useState('ready');
  const [result, setResult] = useState(null);
  const startAt = useRef(0);
  const resolved = useRef(false);
  const msg = value => value?.[language] || value?.en || value?.zh || '';
  const prompt = config?.prompt || 'Press the key when you see the target';
  const expectedKey = String(config?.expectedKey || 'space').toLowerCase();
  const timeoutMs = Math.max(250, Number(config?.timeoutMs || 3000));

  const finish = resultValue => {
    setResult(resultValue);
    setPhase('done');
    // Show the pass/fail feedback briefly before advancing, like a catch trial.
    window.setTimeout(() => {
      const values = {
        attention_passed: resultValue.passed,
        attention_key_pressed: resultValue.keyPressed,
        attention_expected_key: resultValue.expectedKey,
        attention_reaction_time_ms: resultValue.reactionTimeMs,
        attention_outcome: resultValue.outcome,
      };
      onSubmit?.({
        values,
        outputs: values,
        variables: { last_attention_passed: resultValue.passed, last_attention_rt_ms: resultValue.reactionTimeMs },
        metadata: { attentionCheck: resultValue },
      });
    }, 1200);
  };

  useEffect(() => {
    if (phase !== 'showing' || disabled) return undefined;
    startAt.current = performance.now();
    resolved.current = false;
    const keydown = event => {
      if (event.repeat || resolved.current) return;
      resolved.current = true;
      const key = event.code === 'Space' ? 'space' : event.key.toLowerCase();
      const passed = key === expectedKey;
      finish({ passed, keyPressed: key, expectedKey, reactionTimeMs: Math.max(0, Math.round(performance.now() - startAt.current)), outcome: passed ? 'correct' : 'incorrect' });
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [disabled, expectedKey, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== 'showing' || disabled) return undefined;
    const timer = setTimeout(() => {
      if (resolved.current) return;
      resolved.current = true;
      finish({ passed: false, keyPressed: null, expectedKey, reactionTimeMs: null, outcome: 'omission' });
    }, timeoutMs);
    return () => clearTimeout(timer);
  }, [disabled, phase, timeoutMs]); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === 'ready') return <div className="attention-check"><span className="eyebrow">{msg(MSG)}</span><p>{prompt}</p><button type="button" className="participant-ui-button primary" disabled={disabled} onClick={() => setPhase('showing')}>{msg(START)}</button></div>;
  if (phase === 'showing') return <div className="attention-check showing"><div className="attention-stimulus">{prompt}</div></div>;
  return <div className="attention-check result">{result?.passed ? <><h1>✓</h1><p>{msg(PASSED)}</p></> : <><h1>✕</h1><p>{msg(MISSED)}</p></>}{result?.reactionTimeMs != null && <small>{result.reactionTimeMs} ms</small>}</div>;
}
