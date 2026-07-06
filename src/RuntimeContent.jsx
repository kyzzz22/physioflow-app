import { useCallback, useEffect, useRef, useState } from 'react';
import MediaStep from './MediaStep';
import QuestionnaireForm from './QuestionnaireForm';

const FALLBACK = {
  instruction: { zh: '请按照研究员给出的指示操作。', ja: '研究者の指示に従ってください。', en: 'Follow the instructions shown by the researcher.' },
  manual_event: { zh: '等待操作员确认。', ja: 'オペレーターの確認を待っています。', en: 'Waiting for operator confirmation.' },
  device_check: { zh: '设备检查中…请等待操作员。', ja: 'デバイスをチェックしています…', en: 'Device check in progress. Please wait for the operator.' },
};

export default function RuntimeContent({ step, session, language, timing: _timing, onComplete, onQuestionnaireSubmit, onQuestionnaireExternalEvent, onResponseSubmit, onMediaEvent, preview, fontSize }) {
  const localized = step.content_i18n?.[language] || step.content || '';
  const fb = FALLBACK[step.type]?.en || '';
  const fixedMs = step.duration_mode === 'fixed' ? (Number(step.planned_duration_ms) || 0) : 0;
  const showRing = step.show_countdown_ring !== false && ['fixation','rest','timer'].includes(step.type);

  // ── Ref-based countdown: writes directly to SVG circle DOM, bypassing React batching ──
  const totalMs = Math.max(1, fixedMs);
  const [seconds, setSeconds] = useState(Math.ceil(totalMs / 1000));
  const ringCircleRef = useRef(null);
  const rafRef = useRef(null);
  const startRef = useRef(0);

  const animateRing = useCallback(() => {
    const el = ringCircleRef.current;
    if (!el || !el._circ) return;
    const pct = Math.min(1, (performance.now() - startRef.current) / totalMs);
    el.style.strokeDashoffset = el._circ * (1 - pct);
    if (pct >= 1) { el.style.strokeDashoffset = el._circ; return; }
    rafRef.current = requestAnimationFrame(animateRing);
  }, [totalMs]);

  // Init ring geometry on mount (once DOM is painted), then start RAF
  const initAndStartRing = useCallback(() => {
    const el = ringCircleRef.current;
    if (!el) return;
    const r = el.r.baseVal.value;
    const c = 2 * Math.PI * r;
    el._circ = c;
    el.style.strokeDasharray = c;
    el.style.strokeDashoffset = '0';
    el.style.transition = 'none';
    startRef.current = performance.now();
    rafRef.current = requestAnimationFrame(animateRing);
  }, [animateRing]);

  useEffect(() => {
    if (preview || fixedMs <= 0 || !showRing) return;
    // Defer one frame so the SVG circle is in the DOM
    const id = requestAnimationFrame(initAndStartRing);
    return () => {
      cancelAnimationFrame(id);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [preview, fixedMs, showRing, initAndStartRing]);

  // Seconds ticker — reads startRef for accuracy, updates every 250ms
  useEffect(() => {
    if (fixedMs <= 0 || preview) return;
    startRef.current = performance.now();
    const interval = setInterval(() => {
      setSeconds(Math.ceil(Math.max(0, totalMs - (performance.now() - startRef.current)) / 1000));
    }, 250);
    return () => clearInterval(interval);
  }, [preview, fixedMs, totalMs]);

  // Shared ring SVG sizes used by fixation / rest
  const ringSvgSize = preview ? 60 : 100;
  const ringR = preview ? 24 : 42;
  const ringC = 2 * Math.PI * ringR;

  // ── Media (video / audio / image) ──
  if (['video', 'audio', 'image'].includes(step.type)) {
    return <MediaStep step={step} onComplete={onComplete} onMediaEvent={onMediaEvent} preview={preview} />;
  }

  // ── Questionnaire ──
  if (step.type === 'questionnaire') {
    return <QuestionnaireForm questionnaire={step.questionnaire} step={step} session={session} language={language} onSubmit={onQuestionnaireSubmit} onExternalEvent={onQuestionnaireExternalEvent} />;
  }

  if (step.type === 'response') {
    return <ResponsePrompt step={step} language={language} onSubmit={onResponseSubmit} preview={preview} fontSize={fontSize} />;
  }

  // ── Fixation ──
  if (step.type === 'fixation') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: preview ? '.5rem' : '1.5rem' }}>
        <div style={{ position: 'relative', width: ringSvgSize, height: ringSvgSize, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {showRing && (
            <svg viewBox={`0 0 ${ringSvgSize} ${ringSvgSize}`} style={{ width: ringSvgSize, height: ringSvgSize, rotate: '-90deg', position: 'absolute', inset: 0 }}>
              <circle cx={ringSvgSize / 2} cy={ringSvgSize / 2} r={ringR} fill="none" stroke="var(--ring-track, #e5ebe4)" strokeWidth="3" />
              <circle ref={ringCircleRef} cx={ringSvgSize / 2} cy={ringSvgSize / 2} r={ringR} fill="none" stroke="var(--green)" strokeWidth="3" strokeDasharray={ringC} strokeDashoffset="0" strokeLinecap="round" />
            </svg>
          )}
          <div className="fixation" style={{ width: preview ? 48 : 80, height: preview ? 48 : 80, position: 'relative', zIndex: 1 }}>
            <span className="fixation-h" /><span className="fixation-v" />
          </div>
        </div>
        {!preview && <small style={{ color: 'var(--muted)', fontSize: '.8rem' }}>{seconds}s</small>}
      </div>
    );
  }

  // ── Rest / Recovery ──
  if (step.type === 'rest') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: preview ? '.5rem' : '1.5rem' }}>
        <div style={{ position: 'relative', width: ringSvgSize, height: ringSvgSize, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {showRing && (
            <svg viewBox={`0 0 ${ringSvgSize} ${ringSvgSize}`} style={{ width: ringSvgSize, height: ringSvgSize, rotate: '-90deg', position: 'absolute', inset: 0 }}>
              <circle cx={ringSvgSize / 2} cy={ringSvgSize / 2} r={ringR} fill="none" stroke="var(--ring-track, #e5ebe4)" strokeWidth="3" />
              <circle ref={ringCircleRef} cx={ringSvgSize / 2} cy={ringSvgSize / 2} r={ringR} fill="none" stroke="#7aac8a" strokeWidth="3" strokeDasharray={ringC} strokeDashoffset="0" strokeLinecap="round" />
            </svg>
          )}
          <div className="fixation rest-icon" style={{ fontSize: preview ? '1.8rem' : '2.8rem', position: 'relative', zIndex: 1, width: 'auto', height: 'auto' }}>☕</div>
        </div>
        {!preview && <small style={{ color: 'var(--muted)', fontSize: '.8rem' }}>{seconds}s</small>}
      </div>
    );
  }

  // ── Instruction ── multi-line text
  if (step.type === 'instruction') {
    const text = localized || FALLBACK.instruction[language] || fb;
    return (
      <div className="instruction" style={preview ? { fontSize: '0.85rem', maxWidth: 400 } : { fontSize: fontSize || 'clamp(1.1rem, 2.5vw, 1.8rem)', maxWidth: 'min(800px, 90vw)', lineHeight: 1.6, textAlign: 'left', padding: '0 1rem' }} role="status">
        {text.split('\n').map((line, i) => <p key={i} style={{ margin: '.5rem 0' }}>{line}</p>)}
      </div>
    );
  }

  // ── Manual event ── operator confirmation needed
  if (step.type === 'manual_event') {
    const text = localized || FALLBACK.manual_event[language] || fb;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', padding: '2rem' }}>
        <span style={{ fontSize: preview ? '1.5rem' : '3rem', opacity: 0.4 }}>◆</span>
        <p className="instruction" style={preview ? { fontSize: '0.85rem', maxWidth: 400 } : { fontSize: fontSize || '1.3rem', maxWidth: 'min(700px, 85vw)', textAlign: 'center' }} role="status">
          {text}
        </p>
      </div>
    );
  }

  // ── Device check ── distinct from manual_event: shows checklist icon
  if (step.type === 'device_check') {
    const text = localized || FALLBACK.device_check[language] || fb;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', padding: '2rem' }}>
        <span style={{ fontSize: preview ? '1.5rem' : '3rem', opacity: 0.4 }}>✓</span>
        <p className="instruction" style={preview ? { fontSize: '0.85rem', maxWidth: 400 } : { fontSize: fontSize || '1.3rem', maxWidth: 'min(700px, 85vw)', textAlign: 'center' }} role="status">
          {text}
        </p>
      </div>
    );
  }

  // ── Timer ── large countdown with optional ring
  const tSvgSize = preview ? 90 : 160;
  const tR = preview ? 38 : 68;
  const tC = 2 * Math.PI * tR;
  return (
    <div className="timer-circle" style={preview ? { width: tSvgSize, height: tSvgSize } : {}} role="timer" aria-label={`Countdown: ${seconds} seconds remaining`}>
      {showRing && (
        <svg viewBox={`0 0 ${tSvgSize} ${tSvgSize}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', rotate: '-90deg' }}>
          <circle className="track" cx={tSvgSize / 2} cy={tSvgSize / 2} r={tR} fill="none" stroke="var(--ring-track, #e5ebe4)" strokeWidth="4" />
          <circle ref={ringCircleRef} cx={tSvgSize / 2} cy={tSvgSize / 2} r={tR} fill="none" stroke="var(--green)" strokeWidth="4" strokeDasharray={tC} strokeDashoffset="0" strokeLinecap="round" />
        </svg>
      )}
      <span style={preview ? { fontSize: '1.4rem' } : fontSize ? { fontSize } : {}}>{seconds}</span>
      <small>seconds</small>
    </div>
  );
}

function ResponsePrompt({ step, language, onSubmit, preview, fontSize }) {
  const startRef = useRef(performance.now());
  const [selected, setSelected] = useState(null);
  const options = step.response_options?.length ? step.response_options : [
    { value: 'yes', key: '1', label_i18n: { en: 'Yes' } },
    { value: 'no', key: '2', label_i18n: { en: 'No' } },
  ];
  const prompt = step.content_i18n?.[language] || step.content_i18n?.en || step.content || 'Choose a response.';
  const variable = step.response_variable || 'response';

  useEffect(() => {
    startRef.current = performance.now();
    setSelected(null);
  }, [step.step_id]);

  const buildAnswer = option => {
    const label = option.label_i18n?.[language] || option.label_i18n?.en || option.label_i18n?.zh || option.value;
    return {
      question_id: variable,
      question_type: 'response_choice',
      value: option.value,
      option_label: label,
      response_key: option.key || '',
      reaction_time_ms: Math.max(0, Math.round(performance.now() - startRef.current)),
    };
  };

  const choose = option => {
    if (preview || selected) return;
    const answer = buildAnswer(option);
    setSelected(answer);
    if (step.response_auto_advance !== false) onSubmit?.([answer], { response_variable: variable, response_value: answer.value, option_label: answer.option_label, response_key: answer.response_key, reaction_time_ms: answer.reaction_time_ms });
  };

  useEffect(() => {
    if (preview || selected) return;
    const handler = event => {
      const key = event.key?.toLowerCase();
      const option = options.find(item => String(item.key || '').toLowerCase() === key);
      if (!option) return;
      event.preventDefault();
      choose(option);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [options, preview, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="response-node" role="group" aria-label="Response options">
    <p className="instruction" style={preview ? { fontSize: '0.85rem', maxWidth: 400 } : { fontSize: fontSize || '1.35rem', maxWidth: 'min(760px, 88vw)', textAlign: 'center' }}>{prompt}</p>
    <div className="response-options">
      {options.map(option => {
        const label = option.label_i18n?.[language] || option.label_i18n?.en || option.label_i18n?.zh || option.value;
        const active = selected?.value === option.value;
        return <button type="button" className={active ? 'selected' : ''} key={`${option.value}-${option.key || ''}`} disabled={preview || Boolean(selected)} onClick={() => choose(option)}>
          {option.key && <kbd>{option.key}</kbd>}
          <span>{label}</span>
        </button>;
      })}
    </div>
    {selected && step.response_auto_advance === false && <button className="primary" type="button" onClick={() => onSubmit?.([selected], { response_variable: variable, response_value: selected.value, option_label: selected.option_label, response_key: selected.response_key, reaction_time_ms: selected.reaction_time_ms })}>Continue →</button>}
  </div>;
}
