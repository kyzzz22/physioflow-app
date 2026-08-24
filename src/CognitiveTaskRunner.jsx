import { useEffect, useRef, useState } from 'react';

const STROOP_KEYS = [
  { key: 'r', label: 'R · Red', color: '#d32f2f' },
  { key: 'g', label: 'G · Green', color: '#198754' },
  { key: 'b', label: 'B · Blue', color: '#1565c0' },
  { key: 'y', label: 'Y · Yellow', color: '#c28b00' },
];

export default function CognitiveTaskRunner({ config, disabled = false, onSubmit, onTrialEvent }) {
  const trials = config?.trials || [];
  const [phase, setPhase] = useState('instructions');
  const [index, setIndex] = useState(0);
  const resultsRef = useRef([]);
  const stimulusStartedAt = useRef(0);
  const resolved = useRef(false);
  const trial = trials[index] || null;
  const kind = config?.taskKind;

  const finishTask = finalResults => {
    const correct = finalResults.filter(result => result.correct).length;
    const reactionTimes = finalResults.filter(result => Number.isFinite(result.reactionTimeMs)).map(result => result.reactionTimeMs);
    const accuracyPct = finalResults.length ? Math.round((correct / finalResults.length) * 1000) / 10 : 0;
    const meanRt = reactionTimes.length ? Math.round(reactionTimes.reduce((sum, value) => sum + value, 0) / reactionTimes.length) : null;
    const omissions = finalResults.filter(result => result.outcome === 'omission' || result.outcome === 'commission').length;
    const commissionCount = finalResults.filter(result => result.outcome === 'commission').length;
    const values = {
      task_kind: kind,
      practice: Boolean(config?.practice),
      trial_results: finalResults,
      accuracy_pct: accuracyPct,
      mean_rt_ms: meanRt,
      omissions,
      commissions: commissionCount,
    };
    setPhase('complete');
    onSubmit?.({
      values,
      outputs: values,
      variables: { mean_rt_ms: meanRt, accuracy_pct: accuracyPct, omissions, commissions: commissionCount },
      metadata: { taskKind: kind, practice: Boolean(config?.practice), trialCount: finalResults.length },
    });
  };

  const resolveTrial = response => {
    if (!trial || resolved.current) return;
    resolved.current = true;
    const reactionTimeMs = response ? Math.max(0, Math.round(performance.now() - stimulusStartedAt.current)) : null;
    let correct;
    let outcome;
    if (kind === 'stroop') {
      correct = response === trial.expectedKey;
      outcome = response ? (correct ? 'correct' : 'incorrect') : 'omission';
    } else if (trial.trialType === 'go') {
      correct = response === 'space';
      outcome = correct ? 'hit' : 'omission';
    } else {
      correct = response === null;
      outcome = correct ? 'correct_rejection' : 'commission';
    }
    const result = { ...trial, practice: Boolean(config?.practice), response, reactionTimeMs, correct, outcome, trialIndex: index };
    resultsRef.current = [...resultsRef.current, result];
    onTrialEvent?.('trial_response', result);
    setPhase('iti');
  };

  useEffect(() => {
    if (!trial || disabled) return undefined;
    if (phase === 'fixation') {
      const timer = setTimeout(() => {
        resolved.current = false;
        stimulusStartedAt.current = performance.now();
        onTrialEvent?.('trial_started', { trialId: trial.trialId, trialIndex: index, taskKind: kind, trialType: trial.trialType, congruent: trial.congruent });
        setPhase('stimulus');
      }, Math.max(0, Number(trial.fixationMs || 0)));
      return () => clearTimeout(timer);
    }
    if (phase === 'stimulus') {
      const timer = setTimeout(() => resolveTrial(null), Math.max(1, Number(trial.responseWindowMs || 1000)));
      return () => clearTimeout(timer);
    }
    if (phase === 'iti') {
      const timer = setTimeout(() => {
        if (index >= trials.length - 1) finishTask(resultsRef.current);
        else { setIndex(value => value + 1); setPhase('fixation'); }
      }, Math.max(0, Number(trial.itiMs || 0)));
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [disabled, index, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== 'stimulus' || disabled) return undefined;
    const keydown = event => {
      if (event.repeat) return;
      const key = event.code === 'Space' ? 'space' : event.key.toLowerCase();
      if (kind === 'stroop' && STROOP_KEYS.some(item => item.key === key)) resolveTrial(key);
      if (kind === 'gonogo' && key === 'space') { event.preventDefault(); resolveTrial('space'); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [disabled, kind, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!trials.length) return <div className="cognitive-task"><p>Task has no trials.</p></div>;
  if (phase === 'instructions') return <div className="cognitive-task instructions"><span className="eyebrow">{config?.practice ? 'PRACTICE' : 'TASK'}</span><h1>{kind === 'stroop' ? 'Color-word Stroop' : 'Go / No-Go'}</h1><p>{kind === 'stroop' ? 'Respond to the ink color, not the word. Use R, G, B, or Y.' : 'Press Space for X (Go). Do not press for O (No-Go).'}</p><button type="button" className="participant-ui-button primary" disabled={disabled} onClick={() => setPhase('fixation')}>Start {config?.practice ? 'practice' : 'task'}</button></div>;
  if (phase === 'complete') return <div className="cognitive-task"><h1>✓</h1><p>Task complete</p></div>;

  return <div className="cognitive-task" aria-live="polite">
    <div className="cognitive-progress">Trial {index + 1}/{trials.length}</div>
    {phase === 'fixation' && <div className="cognitive-fixation" aria-label="Fixation">+</div>}
    {phase === 'stimulus' && kind === 'stroop' && <><div className="stroop-word" style={{ color: trial.inkColor }}>{trial.word}</div><div className="cognitive-response-buttons">{STROOP_KEYS.map(item => <button key={item.key} type="button" disabled={disabled} style={{ borderColor: item.color }} onClick={() => resolveTrial(item.key)}>{item.label}</button>)}</div></>}
    {phase === 'stimulus' && kind === 'gonogo' && <><div className="gonogo-stimulus">{trial.stimulus}</div><button type="button" className="participant-ui-button primary gonogo-response" disabled={disabled} onClick={() => resolveTrial('space')}>SPACE · Go</button></>}
    {phase === 'iti' && <div className="cognitive-iti" aria-label="Inter-trial interval" />}
  </div>;
}
