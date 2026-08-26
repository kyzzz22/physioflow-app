import { lazy, Suspense, useState } from 'react';
import { protocolIdOf, protocolNameOf, protocolStatusOf, validateProtocolGraph } from '../core/index.js';
import { useLanguage } from '../i18n';
import { createProjectComponentRegistry } from '../sdk/index.js';
import Header from './AppHeader.jsx';

const GuidePanel = lazy(() => import('../GuidePanel.jsx'));

export function ResumeBanner({ snapshot, onResume, onDiscard }) {
  return <div className="resume-banner">
    <div><span>UNFINISHED SESSION</span><b>{snapshot.session?.participant_id} · {snapshot.protocol?.name}</b><small>Saved {snapshot.saved_at}</small></div>
    <button className="primary" onClick={onResume}>Resume experiment</button>
    <button onClick={onDiscard}>Discard</button>
  </div>;
}

export function GraphSessionSetup({ protocol: p, onBack, onStart, storageInfo, onChooseDataDirectory, onGuide, guideOpen, guideTab, onCloseGuide }) {
  const { language } = useLanguage();
  const [participant, setParticipant] = useState('');
  const [operator, setOperator] = useState('');
  const [participantLanguage, setParticipantLanguage] = useState(language);
  const isFormal = protocolStatusOf(p) === 'frozen';
  const storageBlocked = isFormal && !storageInfo?.selected;
  const check = validateProtocolGraph(p, createProjectComponentRegistry(p));

  return <main><Header onGuide={onGuide} /><div className="narrow">
    <button onClick={onBack}>← Protocol</button>
    <span className="eyebrow">RUNTIME V2 SESSION SETUP</span>
    <h1>{protocolNameOf(p)}</h1>
    <p>Bind this run to an anonymous participant and the exact Protocol Graph version.</p>
    <label htmlFor="participant-id">Participant ID<input id="participant-id" autoFocus value={participant} onChange={event => setParticipant(event.target.value)} placeholder="P001" /></label>
    <label htmlFor="participant-lang">Participant language<select id="participant-lang" value={participantLanguage} onChange={event => setParticipantLanguage(event.target.value)}><option value="zh">中文</option><option value="ja">日本語</option><option value="en">English</option></select></label>
    <label htmlFor="operator-id">Operator ID<input id="operator-id" value={operator} onChange={event => setOperator(event.target.value)} placeholder="optional" /></label>
    <div className={`setup-note ${check.valid ? 'ok' : 'error'}`}><b>Protocol Graph validation</b><p>{check.valid ? `${p.graph.nodes.length} nodes · ${p.graph.edges.length} connections · ready to preview` : check.errors.slice(0, 3).map(error => error.message).join(' ')}</p></div>
    <div className={`setup-note storage-gate ${storageBlocked ? 'blocked' : storageInfo?.selected ? 'ready' : 'preview'}`}>
      <b>{storageBlocked ? 'Local data folder required' : storageInfo?.selected ? `Local data folder: ${storageInfo.name || 'selected'}` : 'Preview storage'}</b>
      <p>{storageBlocked ? 'Select a local data folder before formal collection.' : 'Runtime state, raw events, and responses are saved throughout the session.'}</p>
      {storageBlocked && onChooseDataDirectory && <button onClick={onChooseDataDirectory}>Select local data folder</button>}
    </div>
    <button className="primary wide" disabled={!participant.trim() || storageBlocked || !check.valid} onClick={() => onStart({
      session_id: crypto.randomUUID(),
      participant_id: participant.trim(),
      operator_id: operator.trim(),
      participant_language: participantLanguage,
      protocol_id: protocolIdOf(p),
      protocol_version: p.version.number,
      protocol_hash: p.freeze?.configHash || '',
      protocol_name: protocolNameOf(p),
      run_mode: isFormal ? 'formal' : 'preview',
      status: 'ready',
      started_at: new Date().toISOString(),
      ended_at: null,
    })}>Start session</button>
  </div>{guideOpen && <Suspense fallback={null}><GuidePanel initialTab={guideTab} onClose={onCloseGuide} /></Suspense>}</main>;
}

export function SessionSetup({ protocol: p, onBack, onStart, storageInfo, onChooseDataDirectory, onGuide, guideOpen, guideTab, onCloseGuide }) {
  const { language } = useLanguage();
  const [participant, setParticipant] = useState('');
  const [operator, setOperator] = useState('');
  const [device, setDevice] = useState('');
  const [index, setIndex] = useState(0);
  const [participantLanguage, setParticipantLanguage] = useState(language);
  const [manualText, setManualText] = useState({});
  const [sync, setSync] = useState({ sync_method: 'same_computer_clock', offset_ms: 0, device_time_column: '', device_time_format: 'epoch_ms', timezone: 'Asia/Tokyo', sampling_rate: '' });
  const isFormal = p.status === 'frozen';
  const storageBlocked = isFormal && !storageInfo?.selected;

  const manualOrders = Object.fromEntries(p.blocks.map(block => [block.block_id, (manualText[block.block_id] || '').split(',').map(token => token.trim()).filter(Boolean).map(token => { const position = Number(token); return Number.isInteger(position) && position > 0 ? block.trials[position - 1]?.trial_id : token; }).filter(id => block.trials.some(trial => trial.trial_id === id))]));

  const preview = block => {
    const trials = [...block.trials], manual = manualOrders[block.block_id];
    if (block.order_rule === 'latin_square' && trials.length) { const offset = ((index % trials.length) + trials.length) % trials.length; return [...trials.slice(offset), ...trials.slice(0, offset)]; }
    if (block.order_rule === 'random') { let seed = (index + 1) * 2654435761; for (let i = trials.length - 1; i > 0; i--) { seed = (seed * 1664525 + 1013904223) >>> 0; const j = seed % (i + 1); [trials[i], trials[j]] = [trials[j], trials[i]]; } }
    if (block.order_rule === 'manual' && manual.length) { const rank = new Map(manual.map((id, pos) => [id, pos])); trials.sort((a, b) => (rank.get(a.trial_id) ?? manual.length + block.trials.indexOf(a)) - (rank.get(b.trial_id) ?? manual.length + block.trials.indexOf(b))); }
    return trials;
  };

  return <main><Header onGuide={onGuide} /><div className="narrow">
    <button onClick={onBack}>← Protocol</button>
    <span className="eyebrow">SESSION SETUP</span>
    <h1>{p.name}</h1>
    <p>Bind this run to an anonymous participant and an exact protocol version.</p>
    <label htmlFor="participant-id">Participant ID<input id="participant-id" autoFocus value={participant} onChange={e => setParticipant(e.target.value)} placeholder="P001" /></label>
    <label htmlFor="participant-lang">Participant language<select id="participant-lang" value={participantLanguage} onChange={e => setParticipantLanguage(e.target.value)}><option value="zh">中文</option><option value="ja">日本語</option><option value="en">English</option></select></label>
    <label htmlFor="operator-id">Operator ID<input id="operator-id" value={operator} onChange={e => setOperator(e.target.value)} placeholder="optional" /></label>
    <label htmlFor="device-ref">Device start reference<input id="device-ref" value={device} onChange={e => setDevice(e.target.value)} placeholder="MyBeat file / sync note" /></label>
    <details className="setup-note">
      <summary><b>Device synchronization</b> (advanced)</summary>
      <label htmlFor="sync-method">Sync method<select id="sync-method" value={sync.sync_method} onChange={ev => setSync({ ...sync, sync_method: ev.target.value })}><option value="same_computer_clock">Same computer clock</option><option value="manual_offset">Manual offset</option><option value="manual_marker">Manual sync marker</option></select></label>
      <label htmlFor="sync-offset">Offset (ms)<input id="sync-offset" type="number" value={sync.offset_ms} onChange={ev => setSync({ ...sync, offset_ms: Number(ev.target.value) })} /></label>
      <label htmlFor="sync-col">Device time column<input id="sync-col" value={sync.device_time_column} placeholder="timestamp" onChange={ev => setSync({ ...sync, device_time_column: ev.target.value })} /></label>
      <label htmlFor="sync-fmt">Time format<select id="sync-fmt" value={sync.device_time_format} onChange={ev => setSync({ ...sync, device_time_format: ev.target.value })}><option value="epoch_ms">Epoch milliseconds</option><option value="epoch_s">Epoch seconds</option><option value="iso8601">ISO 8601</option><option value="relative_ms">Relative milliseconds</option></select></label>
      <label htmlFor="sync-tz">Timezone<input id="sync-tz" value={sync.timezone} onChange={ev => setSync({ ...sync, timezone: ev.target.value })} /></label>
      <label htmlFor="sync-rate">Sampling rate (Hz)<input id="sync-rate" type="number" min="0" value={sync.sampling_rate} onChange={ev => setSync({ ...sync, sampling_rate: ev.target.value === '' ? '' : Number(ev.target.value) })} /></label>
    </details>
    <label htmlFor="order-row">Order row <small title="Starting offset for Latin square / random seed">(trial rotation index)</small><input id="order-row" type="number" min="0" value={index} onChange={e => setIndex(Number(e.target.value))} /></label>
    {p.blocks.filter(block => block.order_rule === 'manual').map(block => (
      <label key={block.block_id} htmlFor={`manual-${block.block_id}`}>Manual order · {block.name}<input id={`manual-${block.block_id}`} value={manualText[block.block_id] || ''} placeholder="e.g. 1, 2, 3 (position numbers)" onChange={e => setManualText({ ...manualText, [block.block_id]: e.target.value })} /></label>
    ))}
    <div className="setup-note"><b>Actual Trial order preview</b>
      {p.blocks.map(block => <div key={block.block_id}><small>{block.name} · {block.order_rule}</small><p>{preview(block).map(trial => trial.name).join(' → ') || '(empty)'}</p></div>)}
    </div>
    <div className="setup-note"><b>Protocol integrity</b><code>{p.config_hash || 'Draft test run — no frozen hash'}</code></div>
    <div className={`setup-note storage-gate ${storageBlocked ? 'blocked' : storageInfo?.selected ? 'ready' : 'preview'}`}>
      <b>{storageBlocked ? 'Local data folder required' : storageInfo?.selected ? `Local data folder: ${storageInfo.name || 'selected'}` : 'Preview storage'}</b>
      <p>{storageBlocked ? 'This is a frozen formal session. Select a local data folder before starting so data is not stored only in browser-managed storage.' : storageInfo?.selected ? 'Session data, recovery snapshots, and exports can be written to the selected local folder.' : 'Draft preview runs can continue without a local folder, but select one before formal collection.'}</p>
      {storageBlocked && onChooseDataDirectory && <button onClick={onChooseDataDirectory}>Select local data folder</button>}
    </div>
    <button className="primary wide" disabled={!participant.trim() || storageBlocked} onClick={() => onStart({ session_id: crypto.randomUUID(), participant_id: participant.trim(), operator_id: operator, device_start_reference: device, participant_language: participantLanguage, protocol_id: p.protocol_id, protocol_version: p.version, protocol_hash: p.config_hash || '', protocol_name: p.name, run_mode: p.status === 'frozen' ? 'formal' : 'preview', order_row: index, manual_orders: manualOrders, actual_trial_order: Object.fromEntries(p.blocks.map(block => [block.block_id, preview(block).map(trial => trial.trial_id)])), status: 'ready', started_at: null, ended_at: null, ...sync })}>{storageBlocked ? 'Select data folder first' : 'Start session'}</button>
  </div>{guideOpen && <Suspense fallback={null}><GuidePanel initialTab={guideTab} onClose={onCloseGuide} /></Suspense>}</main>;
}
