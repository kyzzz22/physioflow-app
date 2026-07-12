import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createLogger } from './engine';
import { bundle, downloadBundle } from './exporter';
import { MARKER_TYPES } from './constants.js';
import { clearCurrentRun, saveCurrentRun, saveSession } from './storage';
import { completeRuntimeStep, createRuntime, currentRuntimeItem, restoreRuntime, retryRuntimeStep, runtimeBoundaryEvents, runtimeProgress, skipRuntimeStep } from './runtimeMachine';
import RuntimeContent from './RuntimeContent';
import { LanguageToggle } from './i18n';
import { captureRunnerState, recoverySchedule } from './runnerState.js';
import { ConfirmDialog, PromptDialog } from './Modal.jsx';
import { withSessionIntegrity } from './sessionReview.js';

const contextOf = item => item ? ({ block_id: item.block.block_id, block_order: item.blockOrder + 1, block_repeat: (item.blockRepeat ?? 0) + 1, trial_id: item.trial.trial_id, trial_order: item.trialOrder + 1, trial_repeat: (item.trialRepeat ?? 0) + 1, step_id: item.step.step_id, step_order: item.trial.steps.findIndex(s => s.step_id === item.step.step_id) + 1, node_id: item.node?.id || '', condition: item.trial.condition, stimulus_id: item.step.stimulus_id || '' }) : {};
// Browser compatibility check
const checkCompat = () => {
  const issues = [];
  if (!window.crypto?.subtle) issues.push('Web Crypto API not available — protocol hashing disabled');
  if (!window.indexedDB) issues.push('IndexedDB not available — session storage disabled');
  if (typeof structuredClone !== 'function') issues.push('structuredClone not available — data operations may fail');
  return issues;
};

export default function RuntimeRunnerPage({ data, onDone }) {
  const protocol = data.protocol;
  const initial = useMemo(() => data.restore?.runtime ? restoreRuntime(data.restore.runtime, protocol, data.session) : createRuntime(protocol, data.session), [protocol, data.session, data.restore]);
  const units = initial.units;
  const restoredRunner = data.restore?.runner_state || {};
  const [runtime, setRuntime] = useState(initial.state);
  const [session, setSession] = useState(data.session);
  const [responses, setResponses] = useState(data.restore?.responses || []);
  const [eventCount, setEventCount] = useState(data.restore?.events?.length || 0);
  const [paused, setPaused] = useState(Boolean(restoredRunner.paused));
  const [awaitingStart, setAwaitingStart] = useState(Boolean(restoredRunner.awaiting_start));
  const [timedOut, setTimedOut] = useState(Boolean(restoredRunner.timed_out));
  const [mediaEnded, setMediaEnded] = useState(Boolean(restoredRunner.media_ended));
  const [markerType, setMarkerType] = useState('movement');
  const [activeMarker, setActiveMarker] = useState(restoredRunner.active_marker || null);
  const [done, setDone] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [saveFlash, setSaveFlash] = useState(false);
  const [finalSave, setFinalSave] = useState({ status: 'idle', message: '' });
  const [confirmAbort, setConfirmAbort] = useState(null);
  const [promptMarker, setPromptMarker] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  const [compatIssues] = useState(() => checkCompat());
  const [markerHistory, setMarkerHistory] = useState([]);
  const [operatorNote, setOperatorNote] = useState('');
  const [deviceCheckState, setDeviceCheckState] = useState({});

  const logger = useRef(createLogger(data.session, data.restore?.events || []));
  const timer = useRef(null);
  const timing = useRef({ remaining: Number(restoredRunner.remaining_ms || 0), started_at: 0, active: false });
  const started = useRef(false);
  // Refs to prevent stale closures in the persist effect
  const runtimeRef = useRef(runtime);
  const responsesRef = useRef(responses);
  const sessionRef = useRef(session);
  useEffect(() => { runtimeRef.current = runtime; }, [runtime]);
  useEffect(() => { responsesRef.current = responses; }, [responses]);
  useEffect(() => { sessionRef.current = session; }, [session]);

  const item = currentRuntimeItem(runtime, units);
  const progress = runtimeProgress(runtime, units);

  // Dark mode toggle effect
  useEffect(() => {
    document.documentElement.classList.toggle('dark-mode', darkMode);
    return () => document.documentElement.classList.remove('dark-mode');
  }, [darkMode]);

  const log = (type, context = {}, metadata = {}) => {
    const event = logger.current.append(type, context, metadata);
    setEventCount(logger.current.snapshot().length);
    // Track markers in history
    if (type.startsWith('marker') || type === 'manual_marker') {
      setMarkerHistory(prev => [...prev.slice(-49), { ...event, type, context, metadata }]);
    }
    return event;
  };
  const logCompletedBoundaries = (previous, nextRuntime) => {
    runtimeBoundaryEvents(previous, nextRuntime, units).forEach(e => log(e.type, contextOf(previous), e.metadata));
  };

  const markSaved = useCallback(() => {
    setLastSaved(new Date().toLocaleTimeString());
    setSaveFlash(true);
    setTimeout(() => setSaveFlash(false), 800);
  }, []);

  // persist always uses refs to get the latest state values
  const persist = useCallback((nextRuntime, nextResponses, nextSession, runnerOverrides = {}) => {
    const rt = nextRuntime ?? runtimeRef.current;
    const rsp = nextResponses ?? responsesRef.current;
    const ses = nextSession ?? sessionRef.current;
    const rs = captureRunnerState(timing.current, { paused, awaiting_start: awaitingStart, timed_out: timedOut, media_ended: mediaEnded, active_marker: activeMarker, current_step_entered: true, ...runnerOverrides }, performance.now());
    saveCurrentRun({ session: ses, protocol, runtime: rt, runner_state: rs, events: logger.current.snapshot(), responses: rsp, saved_at: new Date().toISOString() });
    markSaved();
  }, [protocol, paused, awaitingStart, timedOut, mediaEnded, activeMarker, markSaved]);

  const persistFinishedSession = useCallback(async (finished) => {
    setFinalSave({ status: 'saving', message: 'Saving the completed session to local storage...' });
    try {
      await saveSession(finished);
      await clearCurrentRun();
      setFinalSave({ status: 'saved', message: 'Saved to local storage. The export bundle is ready.' });
    } catch (error) {
      console.warn('Final session save failed:', error);
      setFinalSave({
        status: 'error',
        message: error?.message || 'Could not save the completed session. Export the bundle now, then retry saving.',
      });
    }
  }, []);

  useEffect(() => {
    if (!started.current || done) return;
    persist();
  }, [eventCount, persist, done]);

  // Cleanup timer on unmount to prevent callback on dead component
  useEffect(() => () => clearTimeout(timer.current), []);

  const schedule = (ms, callback) => {
    clearTimeout(timer.current);
    timing.current = { remaining: ms, started_at: performance.now(), active: true };
    timer.current = setTimeout(() => { timing.current.active = false; timing.current.remaining = 0; callback(); }, ms);
  };

  const finish = (status = 'completed', nextResponses, finalRuntime) => {
    const rsp = nextResponses ?? responsesRef.current;
    const rt = finalRuntime ?? runtimeRef.current;
    clearTimeout(timer.current);
    timing.current.active = false;
    if (activeMarker) { log('marker_interval_ended', contextOf(currentRuntimeItem(rt, units)), { marker_id: activeMarker.marker_id, marker_type: activeMarker.marker_type, note: activeMarker.note, forced: true, status: 'interrupted' }); setActiveMarker(null); }
    log(status === 'aborted' ? 'session_aborted' : 'session_completed');
    const ses = sessionRef.current;
    const base = { ...ses, run_mode: ses.run_mode || (protocol.status === 'frozen' ? 'formal' : 'preview'), status, ended_at: new Date().toISOString(), event_count: logger.current.snapshot().length, protocol_snapshot: protocol, runtime_snapshot: rt, events: logger.current.snapshot(), responses: rsp };
    const finished = withSessionIntegrity(base);
    setSession(finished);
    setDone(true);
    persistFinishedSession(finished);
  };

  const activate = (nextRuntime, prevItem = null, nextResponses, nextSession) => {
    const nsp = nextResponses ?? responsesRef.current;
    const nse = nextSession ?? sessionRef.current;
    setRuntime(nextRuntime);
    setTimedOut(false);
    setMediaEnded(false);
    setOperatorNote('');
    setDeviceCheckState({});
    if (nextRuntime.status === 'completed') return finish('completed', nsp, nextRuntime);
    if (nextRuntime.status === 'invalid') return finish('invalid', nsp, nextRuntime);
    const next = currentRuntimeItem(nextRuntime, units);
    if (!next) return finish('invalid', nsp, nextRuntime);
    const ctx = contextOf(next);
    if (!prevItem || prevItem.blockOrder !== next.blockOrder || prevItem.blockRepeat !== next.blockRepeat) log('block_started', ctx, { repeat_index: next.blockRepeat });
    if (!prevItem || prevItem.unit_index !== next.unit_index) log('trial_started', ctx, { repeat_index: next.trialRepeat });
    log('step_entered', ctx, { planned_duration_ms: next.step.planned_duration_ms, node_id: next.node.id });
    if (['video', 'audio', 'image'].includes(next.step.type)) log('media_play_requested', ctx, { source_mode: next.step.source_mode });
    const manual = next.step.start_mode === 'manual';
    setAwaitingStart(manual);
    if (!manual && next.step.duration_mode === 'fixed' && next.step.planned_duration_ms >= 0) schedule(next.step.planned_duration_ms, () => fixedElapsed(nextRuntime, nsp));
    persist(nextRuntime, nsp, nse, { paused: false, awaiting_start: manual, timed_out: false, media_ended: false, active_marker: activeMarker });
  };

  const completeCurrent = (answers = [], sourceRuntime, sourceResponses, completionMetadata = {}) => {
    const sr = sourceRuntime ?? runtimeRef.current;
    const srs = sourceResponses ?? responsesRef.current;
    const cur = currentRuntimeItem(sr, units);
    if (!cur) return;
    clearTimeout(timer.current);
    timing.current.active = false;
    const ctx = contextOf(cur);
    const nextResps = answers.length ? [...srs, ...answers.map(a => ({ response_id: crypto.randomUUID(), session_id: sessionRef.current.session_id, participant_id: sessionRef.current.participant_id, block_id: ctx.block_id, trial_id: ctx.trial_id, step_id: ctx.step_id, condition: ctx.condition, questionnaire_id: cur.step.type === 'response' ? '' : cur.step.questionnaire?.questionnaire_id || cur.step.questionnaire_id || '', question_id: a.question_id, question_type: a.question_type, value: a.value, option_label: a.option_label || '', response_key: a.response_key || '', reaction_time_ms: a.reaction_time_ms ?? '', submitted_epoch_ms: Date.now() }))] : srs;
    if (answers.length) {
      setResponses(nextResps);
      log(cur.step.type === 'response' ? 'response_recorded' : 'questionnaire_submitted', ctx, { response_count: answers.length, ...(cur.step.type === 'response' ? completionMetadata : {}) });
    }
    log('step_completed', ctx, { answer_count: answers.length, ...completionMetadata });
    const advanced = completeRuntimeStep(sr, units, answers);
    logCompletedBoundaries(cur, advanced.state);
    activate(advanced.state, cur, nextResps);
  };

  const fixedElapsed = (sourceRuntime, sourceResponses) => {
    const sr = sourceRuntime ?? runtimeRef.current;
    const srs = sourceResponses ?? responsesRef.current;
    const cur = currentRuntimeItem(sr, units);
    if (cur?.step.type === 'response') {
      const metadata = { response_variable: cur.step.response_variable || 'response', response_missed: true, timeout_ms: Number(cur.step.planned_duration_ms || 0) };
      const missedAnswer = cur.step.response_required === false ? [] : [{ question_id: cur.step.response_variable || 'response', question_type: 'response_choice', value: '', option_label: '', response_key: '', reaction_time_ms: '' }];
      log('response_missed', contextOf(cur), metadata);
      completeCurrent(missedAnswer, sr, srs, metadata);
      return;
    }
    if (cur?.step.auto_advance === false) { setTimedOut(true); persist(sr, srs, undefined, { timed_out: true }); }
    else completeCurrent([], sr, srs);
  };

  const begin = () => {
    if (compatIssues.length) return;
    started.current = true;
    const running = { ...session, status: 'running', started_at: session.started_at || new Date().toISOString() };
    setSession(running);
    log(data.restore ? 'session_resumed' : 'session_started', {}, { protocol_hash: protocol.config_hash || '', recovered: Boolean(data.restore) });
    if (data.restore?.runner_state?.current_step_entered) {
      const cur = currentRuntimeItem(runtime, units);
      const delay = recoverySchedule(cur?.step, data.restore.runner_state);
      const rb = cur?.step.recovery_behavior || (['video', 'audio'].includes(cur?.step.type) ? 'restart' : 'resume_remaining');
      log('step_recovered', contextOf(cur), { recovery_behavior: rb });
      if (rb === 'wait_operator') setAwaitingStart(true);
      if (delay !== null) schedule(delay, () => fixedElapsed(runtime, responses));
      persist(runtime, responses, running, { ...data.restore.runner_state, awaiting_start: rb === 'wait_operator' || data.restore.runner_state.awaiting_start });
    } else activate(runtime, null, responses, running);
  };

  const startCurrent = () => {
    if (!item) return;
    setAwaitingStart(false);
    log('step_started', contextOf(item));
    if (item.step.duration_mode === 'fixed' && item.step.planned_duration_ms >= 0) schedule(item.step.planned_duration_ms, () => fixedElapsed());
    persist(undefined, undefined, undefined, { awaiting_start: false });
  };

  const togglePause = () => {
    if (!item) return;
    const next = !paused;
    setPaused(next);
    log(next ? 'session_paused' : 'session_resumed', contextOf(item));
    window.dispatchEvent(new CustomEvent(next ? 'physioflow:pause' : 'physioflow:resume'));
    if (next) { clearTimeout(timer.current); if (timing.current.active) timing.current.remaining = Math.max(0, timing.current.remaining - (performance.now() - timing.current.started_at)); timing.current.active = false; }
    else if (!awaitingStart && item.step.duration_mode === 'fixed' && timing.current.remaining > 0) schedule(timing.current.remaining, () => fixedElapsed());
    persist(undefined, undefined, undefined, { paused: next });
  };

  const skip = () => {
    if (!item) return;
    clearTimeout(timer.current);
    timing.current.active = false;
    if (activeMarker) { log('marker_interval_ended', contextOf(item), { marker_id: activeMarker.marker_id, marker_type: activeMarker.marker_type, note: activeMarker.note, forced: true, status: 'interrupted' }); setActiveMarker(null); }
    log('step_skipped', contextOf(item));
    const advanced = skipRuntimeStep(runtimeRef.current, units);
    logCompletedBoundaries(item, advanced.state);
    activate(advanced.state, item, responsesRef.current);
  };
  const retry = () => {
    if (!item) return;
    clearTimeout(timer.current);
    timing.current.active = false;
    if (activeMarker) { log('marker_interval_ended', contextOf(item), { marker_id: activeMarker.marker_id, marker_type: activeMarker.marker_type, note: activeMarker.note, forced: true, status: 'interrupted' }); setActiveMarker(null); }
    const next = retryRuntimeStep(runtimeRef.current);
    setRuntime(next);
    log('step_retried', contextOf(item), { retry_count: next.retries[`${next.unit_index}:${next.node_id}`] });
    activate(next, item, responsesRef.current);
  };

  const completeManualEvent = () => {
    if (!item) return;
    const note = operatorNote.trim();
    if (step.operator_note_required && !note) return;
    const metadata = {
      confirmation_label: step.operator_confirm_label || 'Confirm event',
      operator_note: note,
      note_required: Boolean(step.operator_note_required),
    };
    log('manual_event_confirmed', contextOf(item), metadata);
    completeCurrent([], undefined, undefined, metadata);
  };

  const completeDeviceCheck = () => {
    if (!item || !deviceReady) return;
    const checks = deviceItems.map((label, index) => ({ label, checked: Boolean(deviceCheckState[index]) }));
    const metadata = {
      checks,
      all_checked: checks.every(check => check.checked),
      required_all: step.require_all_device_checks !== false,
      operator_note: operatorNote.trim(),
    };
    log('device_check_completed', contextOf(item), metadata);
    completeCurrent([], undefined, undefined, metadata);
  };

  const handleExternalQuestionnaireEvent = (type, metadata = {}) => {
    if (!item) return;
    if (type === 'external_questionnaire_confirmed') {
      log(type, contextOf(item), metadata);
      completeCurrent([], undefined, undefined, { questionnaire_mode: 'external', ...metadata });
      return;
    }
    log(type, contextOf(item), metadata);
  };

  const addMarker = type => {
    if (['operator_note', 'custom'].includes(type)) {
      setPromptMarker({
        title: `${type} text`,
        placeholder: 'Enter note...',
        onSubmit: note => {
          setPromptMarker(null);
          log('manual_marker', contextOf(item), { marker_type: type, note: note || '' });
          persist();
        },
        onCancel: () => setPromptMarker(null),
      });
    } else {
      log('manual_marker', contextOf(item), { marker_type: type, note: '' });
      persist();
    }
  };

  const toggleMarkerInterval = () => {
    if (activeMarker) {
      log('marker_interval_ended', contextOf(item), { marker_id: activeMarker.marker_id, marker_type: activeMarker.marker_type, note: activeMarker.note });
      setActiveMarker(null);
      persist(undefined, undefined, undefined, { active_marker: null });
      return;
    }
    if (['operator_note', 'custom'].includes(markerType)) {
      setPromptMarker({
        title: `${markerType} interval note`,
        placeholder: 'Enter note...',
        onSubmit: note => {
          setPromptMarker(null);
          const m = { marker_id: crypto.randomUUID(), marker_type: markerType, note: note || '' };
          log('marker_interval_started', contextOf(item), m);
          setActiveMarker(m);
          persist(undefined, undefined, undefined, { active_marker: m });
        },
        onCancel: () => setPromptMarker(null),
      });
    } else {
      const m = { marker_id: crypto.randomUUID(), marker_type: markerType, note: '' };
      log('marker_interval_started', contextOf(item), m);
      setActiveMarker(m);
      persist(undefined, undefined, undefined, { active_marker: m });
    }
  };

  // Estimated remaining time
  const [remainingTick, setRemainingTick] = useState(0);
  useEffect(() => {
    if (done || !item) return;
    const interval = setInterval(() => setRemainingTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [done, item]);

  const remainingEstimate = useMemo(() => {
    if (done || !item) return null;
    let remaining = 0;
    for (let i = runtime.unit_index; i < units.length; i++) {
      const unit = units[i];
      unit.trial.steps.forEach(s => {
        if (s.duration_mode === 'fixed') remaining += Number(s.planned_duration_ms || 0);
      });
    }
    // Add current step remaining (reads ref + performance.now() for accuracy)
    if (item.step.duration_mode === 'fixed' && timing.current.active) {
      remaining += Math.max(0, timing.current.remaining - (performance.now() - timing.current.started_at));
    }
    const mins = Math.round(remaining / 60000);
    const secs = Math.round((remaining % 60000) / 1000);
    return mins > 0 ? `~${mins}m ${secs}s remaining` : `~${secs}s remaining`;
    // remainingTick triggers recalculation every 1s; reads happen via refs & performance.now()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, item, runtime.unit_index, units, remainingTick]);

  // Compatibility warning
  if (!started.current && compatIssues.length > 0) {
    return <main>
      <RunnerHeader darkMode={darkMode} onToggleDark={() => setDarkMode(d => !d)} />
      <div className="start-screen">
        <span className="eyebrow">COMPATIBILITY WARNING</span>
        <h1>Browser Issues</h1>
        <div style={{ background: '#ffe9e6', padding: '1.5rem', borderRadius: 8, margin: '1rem auto', maxWidth: 500 }}>
          {compatIssues.map((issue, i) => <p key={i} style={{ color: '#922b24' }}>⚠ {issue}</p>)}
          <p style={{ marginTop: '.5rem', fontSize: '.8rem', color: '#7b867f' }}>Please use a modern browser (Chrome 90+, Firefox 90+, Edge 90+, Safari 15+).</p>
        </div>
      </div>
    </main>;
  }

  if (!started.current) return <main>
    <RunnerHeader darkMode={darkMode} onToggleDark={() => setDarkMode(d => !d)} />
    <div className="start-screen">
      <span className="eyebrow">{data.restore ? 'RECOVERY READY' : 'READY'}</span>
      <h1>{session.participant_id}</h1>
      <p>{data.restore ? 'A saved runtime snapshot and its append-only event history were found.' : `${units.length} trial instances · runtime branching enabled · dual-clock logging enabled`}</p>
      <button className="primary" onClick={begin}>{data.restore ? 'Resume experiment' : 'Begin experiment'}</button>
      {data.restore && <button style={{ marginTop: '.5rem' }} onClick={() => setConfirmAbort({ title: 'Discard recovery?', message: 'This will delete the recovery snapshot.', confirmLabel: 'Discard', danger: true, onConfirm: () => { setConfirmAbort(null); onDone(); }, onCancel: () => setConfirmAbort(null) })}>Cancel & return</button>}
    </div>
  </main>;

  if (done) {
    const files = bundle(session, protocol, logger.current.snapshot(), responses);
    const completedSteps = session.runtime_snapshot?.completed_steps?.length ?? runtime.completed_steps.length;
    const canReturn = finalSave.status === 'saved';
    return <main>
      <RunnerHeader darkMode={darkMode} onToggleDark={() => setDarkMode(d => !d)} />
      <div className="narrow summary">
        <span className="eyebrow">SESSION COMPLETE</span>
        <h1>{session.status}</h1>
        <div className="metrics">
          <div><b>{eventCount}</b><span>events</span></div>
          <div><b>{completedSteps}</b><span>steps</span></div>
          <div><b>{Object.keys(files).length}</b><span>export files</span></div>
        </div>
        <div className={`final-save-status ${finalSave.status}`}>
          <b>{finalSave.status === 'saved' ? 'Session saved' : finalSave.status === 'error' ? 'Save needs attention' : 'Saving session'}</b>
          <span>{finalSave.message}</span>
        </div>
        <button className="primary wide" onClick={() => downloadBundle(files, session.participant_id)}>Export complete bundle</button>
        {finalSave.status === 'error' && <button className="wide" onClick={() => persistFinishedSession(session)}>Retry local save</button>}
        <button className="wide" disabled={!canReturn} title={canReturn ? 'Return to projects' : 'Wait until the completed session is saved locally'} onClick={onDone}>Return to projects</button>
      </div>
    </main>;
  }

  if (!item) return null;

  const resource = (protocol.stimuli || []).find(s => s.stimulus_id === item.step.stimulus_id);
  const sharedQ = (protocol.questionnaires || []).find(q => q.questionnaire_id === item.step.questionnaire_id);
  const step = {
    ...item.step,
    name: item.step.name_i18n?.[session.participant_language] || item.step.name,
    questionnaire: item.step.questionnaire || sharedQ,
    source_mode: item.step.source_url || item.step.asset_id ? item.step.source_mode : resource?.source_mode || item.step.source_mode,
    source_url: item.step.source_url || resource?.source_url || '',
    asset_id: item.step.asset_id || resource?.asset_id || '',
    file_name: item.step.file_name || resource?.file_name || '',
    checksum: item.step.checksum || resource?.checksum || '',
  };
  const deviceItems = step.type === 'device_check' ? (step.device_checks?.length ? step.device_checks : ['Sensor connected', 'Recording software ready', 'Sync reference prepared']) : [];
  const deviceReady = step.type !== 'device_check' || step.require_all_device_checks === false || deviceItems.every((_, index) => deviceCheckState[index]);
  const layout = item.trial.layout || {};
  const app = (item.step.appearance && typeof item.step.appearance === 'object') ? item.step.appearance : {};
  const ctx = contextOf(item);
  const participantStyle = { background: app.background ?? layout.background, color: app.color ?? layout.foreground, padding: layout.padding, gap: layout.gap, textAlign: app.alignment ?? layout.alignment, pointerEvents: paused ? 'none' : 'auto', filter: paused ? 'grayscale(.35) brightness(.8)' : 'none' };
  const contentStyle = { width: '100%', maxWidth: layout.content_width || 900, marginInline: 'auto', textAlign: app.alignment ?? (layout.alignment || 'center') };

  return <main className="runner">
    <div className="operator" role="toolbar" aria-label="Operator controls">
      <div><b>{item.block.name}</b><span>{item.trial.name} · {item.trial.condition}</span><span className={`badge ${step.type}`} style={{ marginLeft: '.5rem', fontSize: '.6rem', background: '#2a3b32', color: '#a9c4b4' }}>{step.type}</span></div>
      <div style={{ textAlign: 'center' }}>
        Trial {progress.current_unit}/{progress.total_units} · {runtime.completed_steps.length} steps done
        {remainingEstimate && <span style={{ display: 'block', fontSize: '.7rem', color: '#a9b4ae' }}>{remainingEstimate}</span>}
        <div className={`save-indicator ${saveFlash ? 'saved' : ''}`}>{lastSaved ? `Saved ${lastSaved}` : ''}</div>
      </div>
      <div className="operator-actions">
        <button onClick={() => { document.querySelector('.participant')?.requestFullscreen?.().catch(() => { }); }} title="Participant fullscreen (F)">⛶ Fullscreen</button>
        <button onClick={togglePause} aria-label={paused ? 'Resume' : 'Pause'}>{paused ? '▶ Resume' : '⏸ Pause'}</button>
        <button onClick={retry} disabled={!step.allow_retry} aria-label="Retry step">↺ Retry</button>
        <button onClick={skip} disabled={!step.allow_skip} aria-label="Skip step">⏭ Skip</button>
        <button onClick={() => setConfirmAbort({ title: 'Abort session?', message: 'This will mark the session as aborted. All data so far will be preserved.', confirmLabel: 'Abort', danger: true, onConfirm: () => { setConfirmAbort(null); finish('aborted'); }, onCancel: () => setConfirmAbort(null) })} title="Abort session">⏹ Abort</button>
      </div>
    </div>

    <div className="participant" style={participantStyle} role="region" aria-label="Participant view">
      {paused && <div className="pause-overlay" role="status">⏸ Paused</div>}
      {layout.show_progress !== false && <div className="trial-progress"><i style={{ width: `${(progress.current_unit / progress.total_units) * 100}%` }} /></div>}
      <div className="trial-content" style={contentStyle}>
        {layout.show_step_type !== false && !['fixation','rest','timer'].includes(step.type) && <span className="eyebrow">{step.type}</span>}
        {!['fixation','rest','timer'].includes(step.type) && <h1>{step.name}</h1>}
        {awaitingStart ? (
          <div className="manual-start">
            <span>Ready when you are</span>
            <button className="primary" onClick={startCurrent} autoFocus>Start</button>
          </div>
        ) : (
          <RuntimeContent step={step} session={session} language={session.participant_language || 'en'} timing={timing} fontSize={step.appearance?.font_size || null} onComplete={() => completeCurrent()} onQuestionnaireSubmit={answers => completeCurrent(answers)} onQuestionnaireExternalEvent={handleExternalQuestionnaireEvent} onResponseSubmit={(answers, metadata) => completeCurrent(answers, undefined, undefined, metadata)} onMediaEvent={(type, md) => { if (type === 'media_ended') setMediaEnded(true); log(type, ctx, md); }} />
        )}
      </div>
      {step.type === 'manual_event' && !awaitingStart && (
        <ManualEventPanel
          step={step}
          note={operatorNote}
          setNote={setOperatorNote}
          onConfirm={completeManualEvent}
        />
      )}
      {step.type === 'device_check' && !awaitingStart && (
        <DeviceCheckPanel
          items={deviceItems}
          checked={deviceCheckState}
          setChecked={setDeviceCheckState}
          note={operatorNote}
          setNote={setOperatorNote}
          ready={deviceReady}
          requireAll={step.require_all_device_checks !== false}
          onConfirm={completeDeviceCheck}
        />
      )}
      {/* Continue button — shows whenever a generic step can advance */}
      {!awaitingStart && !['questionnaire', 'response', 'manual_event', 'device_check'].includes(step.type) && (
        <div className="continue-bar">
          <button className="primary" onClick={() => completeCurrent()} autoFocus>Continue →</button>
        </div>
      )}
    </div>

    {/* Markers sidebar */}
    <aside className="markers" role="complementary" aria-label="Event markers">
      {/* Quick operator note */}
      <div className="quick-note">
        <b>Quick note</b>
        <textarea
          rows={2}
          value={operatorNote}
          onChange={e => setOperatorNote(e.target.value)}
          placeholder="Timestamped operator note..."
          style={{ width: '100%', fontSize: '.72rem', resize: 'vertical' }}
        />
        <button onClick={() => { if (operatorNote.trim()) { log('manual_marker', contextOf(item), { marker_type: 'operator_note', note: operatorNote.trim() }); persist(); setOperatorNote(''); } }} style={{ width: '100%', fontSize: '.72rem', marginTop: '.2rem' }} disabled={!operatorNote.trim()}>
          ＋ Log note
        </button>
      </div>
      <b>Instant markers</b>
      {MARKER_TYPES.map(type => <button key={type} onClick={() => addMarker(type)} title={`Mark: ${type}`}>{type}</button>)}
      <div className="interval-marker">
        <b>Interval marker</b>
        <select value={activeMarker?.marker_type || markerType} disabled={Boolean(activeMarker)} onChange={e => setMarkerType(e.target.value)} aria-label="Interval marker type">
          {MARKER_TYPES.map(type => <option value={type} key={type}>{type}</option>)}
        </select>
        <button className={activeMarker ? 'danger' : 'primary'} onClick={toggleMarkerInterval}>{activeMarker ? '⏹ End interval' : '▶ Start interval'}</button>
        {activeMarker && <small>● Recording {activeMarker.marker_type}</small>}
      </div>
      <small>{eventCount} events captured</small>

      {/* Marker history */}
      {markerHistory.length > 0 && (
        <details className="marker-history" open>
          <summary>Recent markers ({markerHistory.length})</summary>
          <div className="marker-list">
            {markerHistory.slice(-20).reverse().map((m, i) => (
              <div key={i} className="marker-item" title={JSON.stringify(m.metadata)}>
                <span className={`marker-dot ${m.type}`} />
                <small>{m.metadata?.marker_type || m.type}{m.metadata?.note ? `: ${m.metadata.note.slice(0, 40)}` : ''}</small>
              </div>
            ))}
          </div>
        </details>
      )}
    </aside>

    {confirmAbort && <ConfirmDialog {...confirmAbort} />}
    {promptMarker && <PromptDialog {...promptMarker} />}
  </main>;
}

function ManualEventPanel({ step, note, setNote, onConfirm }) {
  const required = Boolean(step.operator_note_required);
  const blocked = required && !note.trim();
  return <div className="operator-step-panel continue-bar">
    <label>Operator note {required && <sup>*</sup>}
      <textarea rows={2} value={note} onChange={event => setNote(event.target.value)} placeholder={required ? 'Required confirmation note' : 'Optional note'} />
    </label>
    <button className="primary" disabled={blocked} onClick={onConfirm} autoFocus>{step.operator_confirm_label || 'Confirm event'} →</button>
  </div>;
}

function DeviceCheckPanel({ items, checked, setChecked, note, setNote, ready, requireAll, onConfirm }) {
  return <div className="operator-step-panel continue-bar">
    <div className="device-check-runtime">
      <b>Device checklist</b>
      {items.map((label, index) => (
        <label className="check-row" key={`${label}-${index}`}>
          <input type="checkbox" checked={Boolean(checked[index])} onChange={event => setChecked(prev => ({ ...prev, [index]: event.target.checked }))} />
          {label}
        </label>
      ))}
      <label>Operator note
        <textarea rows={2} value={note} onChange={event => setNote(event.target.value)} placeholder="Optional setup note" />
      </label>
      {requireAll && !ready && <small className="required-error">Complete every checklist item before continuing.</small>}
    </div>
    <button className="primary" disabled={!ready} onClick={onConfirm} autoFocus>Complete device check →</button>
  </div>;
}

function RunnerHeader({ darkMode, onToggleDark }) {
  return <header>
    <div className="brand"><span>PF</span> PhysioFlow</div>
    <div className="header-tools">
      <div className="local">● Runtime state machine</div>
      <button className="dark-mode-toggle" style={{ position: 'static', marginRight: '.5rem' }} onClick={onToggleDark} title="Toggle dark mode">{darkMode ? '☀ Light' : '🌙 Dark'}</button>
      <LanguageToggle />
    </div>
  </header>;
}
