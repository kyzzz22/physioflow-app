import { useEffect, useMemo, useState } from 'react';
import { useT } from './i18n';
import { loadSettings } from './fsStorage.js';
import { listBioDBParticipants, readBioDBData, listBioDBEvents, createBioDBEvent, deleteBioDBEvent } from './bioDBClient.js';

// D3 data management panel: pick a participant + time window, read back sensor
// data from BioDB into a table / SVG series, and browse the event list.
const SHORTCUTS = [
  { label: '1h', ms: 3600000 },
  { label: '6h', ms: 6 * 3600000 },
  { label: '24h', ms: 24 * 3600000 },
];

const localInputValue = d => {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function DataPanel({ settings: propSettings, onClose }) {
  const t = useT();
  const [settings, setSettings] = useState(propSettings && propSettings.biodb ? propSettings.biodb : null);
  const [participants, setParticipants] = useState([]);
  const [participantId, setParticipantId] = useState('');
  const [channels, setChannels] = useState('eda,hr');
  const [start, setStart] = useState(() => localInputValue(new Date(Date.now() - 3600000)));
  const [end, setEnd] = useState(() => localInputValue(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);       // { time: [...], [channel]: [...] } from BioDB
  const [events, setEvents] = useState(null);
  const [newEventName, setNewEventName] = useState('');
  const [activeChannel, setActiveChannel] = useState('');
  const [maxRows, setMaxRows] = useState(500);

  useEffect(() => {
    if (settings) return;
    loadSettings()
      .then(s => setSettings((s && s.biodb) || null))
      .catch(() => setSettings(null));
  }, [settings]);

  useEffect(() => {
    if (!settings) return;
    setBusy(true);
    setError(null);
    listBioDBParticipants(settings)
      .then(list => {
        const names = list
          .map(p => p.participant_id || p.participantId || p.id || p.name || p.user_id)
          .filter(Boolean);
        setParticipants(names);
        if (names.length) setParticipantId(prev => prev || names[0]);
        else setError(t('No participants found'));
      })
      .catch(err => setError(err.message || String(err)))
      .finally(() => setBusy(false));
  }, [settings]);

  const channelKeys = useMemo(() => {
    if (!data || !data.time || !data.time.length) return [];
    return Object.keys(data).filter(k => k !== 'time');
  }, [data]);

  const applyShortcut = ms => {
    const endDt = new Date();
    setEnd(localInputValue(endDt));
    setStart(localInputValue(new Date(endDt.getTime() - ms)));
  };

  const readData = async () => {
    if (!settings) return;
    setBusy(true);
    setError(null);
    try {
      const rows = channels.split(',').map(s => s.trim()).filter(Boolean);
      const result = await readBioDBData(settings, {
        participantId,
        startTime: new Date(start).toISOString(),
        endTime: new Date(end).toISOString(),
        rows,
      });
      setData(result);
      setActiveChannel(channelKeysOf(result)[0] || '');
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const readEvents = async () => {
    if (!settings) return;
    setBusy(true);
    setError(null);
    try {
      const list = await listBioDBEvents(settings, {
        participantId,
        startTime: new Date(start).toISOString(),
        endTime: new Date(end).toISOString(),
      });
      setEvents(list);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const rowCount = data && data.time ? data.time.length : 0;

  const createEvent = async () => {
    if (!settings || !newEventName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const mid = new Date((new Date(start).getTime() + new Date(end).getTime()) / 2);
      await createBioDBEvent(settings, {
        participantId,
        startTime: mid.toISOString(),
        endTime: new Date(mid.getTime() + 60000).toISOString(),
        event: newEventName.trim(),
        description: 'created from PF Data panel (D3)',
      });
      setNewEventName('');
      await readEvents();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const removeEvent = async ev => {
    if (!settings) return;
    setBusy(true);
    setError(null);
    try {
      const st = ev.start_time || ev.startTime;
      const en = ev.end_time || ev.endTime || st;
      await deleteBioDBEvent(settings, {
        participantId,
        eventId: ev.event_id || ev.eventId,
        startTime: st,
        endTime: en,
      });
      await readEvents();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="qw-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true">
      <div className="theme-settings-panel d3-panel">
        <div className="qw-header">
          <div className="qw-header-left">
            <span className="qw-badge">DATA</span>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>{t('Data management')}</h3>
          </div>
          <button className="qw-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="theme-body">
          {!settings && (
            <p className="field-hint">{t('connect BioDB first hint')}</p>
          )}

          <section className="theme-section">
            <h4>{t('Query')}</h4>
            <label className="field-label">
              {t('Participant')}
              <select className="field-input" value={participantId}
                onChange={e => setParticipantId(e.target.value)} disabled={!participants.length}>
                {participants.length === 0 && <option value="">{t('Loading participants...')}</option>}
                {participants.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>

            <label className="field-label">
              {t('Channels')}
              <input className="field-input" value={channels}
                onChange={e => setChannels(e.target.value)}
                placeholder="eda,hr" />
            </label>

            <div className="d3-range-row">
              <label className="field-label">
                {t('Start time')}
                <input className="field-input" type="datetime-local" value={start}
                  onChange={e => setStart(e.target.value)} />
              </label>
              <label className="field-label">
                {t('End time')}
                <input className="field-input" type="datetime-local" value={end}
                  onChange={e => setEnd(e.target.value)} />
              </label>
            </div>
            <div className="d3-shortcuts">
              {SHORTCUTS.map(s => (
                <button key={s.label} className="qbtn" onClick={() => applyShortcut(s.ms)}>{t(`Last ${s.label}`)}</button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginTop: '.6rem' }}>
              <button className="qbtn" onClick={readData} disabled={busy || !settings || !participantId}>
                {busy ? '…' : t('Read data')}
              </button>
              <button className="qbtn" onClick={readEvents} disabled={busy || !settings || !participantId}>
                {busy ? '…' : t('Read events')}
              </button>
            </div>
          </section>

          {error && <p className="bio-status-err">✗ {error}</p>}

          {data && (
            <section className="theme-section">
              <h4>{t('Sensor data')} · {t('rows')}: {rowCount} · {t('channels')}: {channelKeys.length}</h4>
              {rowCount === 0 && <p className="field-hint">{t('No data in this range')}</p>}

              {rowCount > 0 && channelKeys.length > 0 && (
                <div className="d3-chart-block">
                  <label className="field-label d3-channel-pick">
                    {t('Series')}
                    <select className="field-input" value={activeChannel}
                      onChange={e => setActiveChannel(e.target.value)}>
                      {channelKeys.map(ch => <option key={ch} value={ch}>{ch}</option>)}
                    </select>
                  </label>
                  <SeriesChart time={data.time} series={data[activeChannel]} channel={activeChannel} />
                </div>
              )}

              {rowCount > 0 && (
                <div className="d3-table-wrap">
                  <label className="field-label d3-maxrows">
                    {t('Max rows shown')}
                    <input className="field-input" type="number" min="10" max="5000" step="10"
                      value={maxRows} onChange={e => setMaxRows(Number(e.target.value) || 500)} />
                  </label>
                  <table className="d3-table">
                    <thead>
                      <tr><th>{t('Time')}</th>{channelKeys.map(ch => <th key={ch}>{ch}</th>)}</tr>
                    </thead>
                    <tbody>
                      {data.time.slice(0, maxRows).map((ts, i) => (
                        <tr key={i}>
                          <td className="d3-time">{ts}</td>
                          {channelKeys.map(ch => <td key={ch}>{data[ch] && data[ch][i] !== undefined ? Number(data[ch][i]).toFixed(3) : ''}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {events && (
            <section className="theme-section">
              <h4>{t('Event list')} · {events.length}</h4>
              <div className="d3-event-create">
                <input className="field-input" placeholder={t('Event name')} value={newEventName}
                  onChange={e => setNewEventName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') createEvent(); }} />
                <button className="qbtn" onClick={createEvent} disabled={busy || !newEventName.trim()}>
                  {t('New event')}
                </button>
              </div>
              {events.length === 0 && <p className="field-hint">{t('No events in this range')}</p>}
              {events.length > 0 && (
                <table className="d3-table">
                  <thead>
                    <tr><th>{t('Start time')}</th><th>{t('End time')}</th><th>{t('Event')}</th><th>{t('Description')}</th><th>{t('Experiment')}</th><th></th></tr>
                  </thead>
                  <tbody>
                    {events.map((ev, i) => (
                      <tr key={i}>
                        <td className="d3-time">{ev.start_time || ev.startTime}</td>
                        <td className="d3-time">{ev.end_time || ev.endTime || ''}</td>
                        <td>{ev.event}</td>
                        <td>{ev.description || ''}</td>
                        <td>{ev.experiment_id || ev.experimentId || ''}</td>
                        <td>
                          <button className="qbtn d3-del" onClick={() => removeEvent(ev)} disabled={busy}>
                            {t('Delete')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem', marginTop: '1rem' }}>
            <button className="qbtn" onClick={onClose}>{t('Close')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function channelKeysOf(cols) {
  if (!cols || !cols.time) return [];
  return Object.keys(cols).filter(k => k !== 'time');
}

// Minimal dependency-free SVG line chart.
function SeriesChart({ time, series, channel }) {
  const W = 640;
  const H = 180;
  const PAD = { l: 46, r: 10, t: 10, b: 24 };
  if (!time || !time.length || !series) return null;
  const values = series.map(v => Number(v)).filter(Number.isFinite);
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = i => PAD.l + (i / (time.length - 1)) * (W - PAD.l - PAD.r);
  const y = v => PAD.t + (1 - (v - min) / span) * (H - PAD.t - PAD.b);
  const pts = series.map((v, i) => `${x(i).toFixed(1)},${y(Number(v)).toFixed(1)}`).join(' ');
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map(f => min + f * span);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="d3-chart" role="img" aria-label={channel}>
      {gridVals.map((v, i) => (
        <g key={i}>
          <line x1={PAD.l} y1={y(v)} x2={W - PAD.r} y2={y(v)} className="d3-grid" />
          <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" className="d3-axis">{Number(v).toFixed(2)}</text>
        </g>
      ))}
      <polyline points={pts} fill="none" className="d3-line" />
      {time.length > 1 && (
        <text x={PAD.l} y={H - 6} className="d3-axis">{time[0].slice(11, 19)}</text>
      )}
      {time.length > 1 && (
        <text x={W - PAD.r} y={H - 6} textAnchor="end" className="d3-axis">{time[time.length - 1].slice(11, 19)}</text>
      )}
    </svg>
  );
}
