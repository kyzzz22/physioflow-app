import { useEffect, useMemo, useState } from 'react';
import { loadSessions, loadSession } from './storage';
import { bundle, downloadBundle } from './exporter.js';
import TimelineView from './analysis/TimelineView.jsx';
import WindowCards from './analysis/WindowCards.jsx';
import ResponseCharts from './analysis/ResponseCharts.jsx';
import CrossSessionCompare from './analysis/CrossSessionCompare.jsx';
import { formatDateTime, STATUS_COLORS } from './analysis/charts.js';

// Analytics — Full-screen dashboard for session data visualization
export default function Analytics({ onBack, initialSessions = [], onGuide }) {
  const [sessions, setSessions] = useState(initialSessions || []);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('timeline'); // timeline | windows | responses | compare

  // Load sessions — use initialSessions if provided, otherwise load from storage
  useEffect(() => {
    if (initialSessions && initialSessions.length > 0) {
      setSessions(initialSessions);
      return;
    }
    (async () => {
      const s = await loadSessions();
      setSessions(s);
    })().catch(console.warn);
  }, [initialSessions]);

  // Load session detail when selected
  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    loadSession(selectedId).then(data => {
      setDetail(data);
      setLoading(false);
    }).catch(err => {
      console.warn('Failed to load session detail:', err);
      setLoading(false);
    });
  }, [selectedId]);

  const completedSessions = useMemo(() =>
    sessions.filter(s => s.status === 'completed' || s.status === 'aborted'),
    [sessions]
  );

  const handleExport = () => {
    if (!detail) return;
    const files = bundle(detail, detail.protocol_snapshot, detail.events || [], detail.responses || []);
    downloadBundle(files, detail.participant_id || 'session');
  };

  return (
    <div className="analytics-dashboard">
      <header className="analytics-head">
        <button onClick={onBack} className="icon-btn" title="Back">← Back</button>
        <div>
          <span>SESSION REVIEW</span>
          <h2>Analytics</h2>
        </div>
        <div className="analytics-head-actions">
          <button className="hint" onClick={() => onGuide?.('data')}>Data format</button>
          <small>
            {completedSessions.length} completed sessions
          </small>
        </div>
      </header>

      <div className="analytics-body">
        <aside className="analytics-sidebar">
          <div className="analytics-sidebar-inner">
            <h3>Sessions</h3>
            {completedSessions.length === 0 && (
              <p>No completed sessions yet. Run experiments to see data here.</p>
            )}
            {completedSessions.map(s => (
              <SessionRow
                key={s.session_id}
                session={s}
                selected={s.session_id === selectedId}
                onClick={() => setSelectedId(s.session_id)}
              />
            ))}
          </div>
        </aside>

        <main className="analytics-main">
          {!selectedId && <EmptyState count={completedSessions.length} />}

          {selectedId && loading && (
            <div className="analytics-loading">Loading session data...</div>
          )}

          {selectedId && detail && !loading && (
            <>
              <section className="analytics-card analytics-session-card">
                <div className="analytics-session-top">
                  <div>
                    <h3>
                      {detail.participant_id || 'Unknown participant'}
                    </h3>
                    <div className="analytics-session-meta">
                      Protocol: {detail.protocol_name || detail.protocol_id} &nbsp;|&nbsp;
                      Started: {formatDateTime(detail.started_at)} &nbsp;|&nbsp;
                      Events: {detail.event_count || 0}
                    </div>
                  </div>
                  <div className="analytics-session-actions">
                    <ValidityBadge validity={detail.integrity?.validity_status} />
                    <button className="hint" onClick={handleExport}>Export ZIP</button>
                  </div>
                </div>

                <div className="analytics-metrics">
                  <Metric label="Events" value={detail.event_count || 0} />
                  <Metric label="Responses" value={(detail.responses || []).length} />
                  <Metric label="Completed steps" value={detail.integrity?.facts?.completed_steps || 0} />
                  <Metric label="Pauses" value={detail.integrity?.facts?.pauses || 0} />
                  <Metric label="Skips" value={detail.integrity?.facts?.skips || 0} />
                  <Metric label="Retries" value={detail.integrity?.facts?.retries || 0} />
                  <Metric label="Media errors" value={detail.integrity?.facts?.media_errors || 0} color={STATUS_COLORS.invalid} />
                </div>
              </section>

              {detail.integrity && (detail.integrity.errors?.length > 0 || detail.integrity.warnings?.length > 0) && (
                <section className="analytics-card analytics-issues">
                  <h4>Integrity issues</h4>
                  {detail.integrity.errors?.map((e, i) => (
                    <div key={'err-' + i} className="invalid">
                      Error · {e}
                    </div>
                  ))}
                  {detail.integrity.warnings?.map((w, i) => (
                    <div key={'warn-' + i} className="attention">
                      Warning · {w}
                    </div>
                  ))}
                </section>
              )}

              <nav className="analytics-tabs" aria-label="Analytics views">
                {[
                  ['timeline', 'Timeline'],
                  ['windows', 'Analysis windows'],
                  ['responses', 'Responses'],
                  ['compare', 'Compare'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={tab === key ? 'active' : ''}
                  >
                    {label}
                  </button>
                ))}
              </nav>

              <section className="analytics-panel">
                {tab === 'timeline' && (
                  <TimelineView events={detail.events || []} protocol={detail.protocol_snapshot} />
                )}
                {tab === 'windows' && (
                  <WindowCards events={detail.events || []} protocol={detail.protocol_snapshot} />
                )}
                {tab === 'responses' && (
                  <ResponseCharts responses={detail.responses || []} protocol={detail.protocol_snapshot} />
                )}
                {tab === 'compare' && (
                  <CrossSessionCompare sessions={completedSessions} protocolId={detail.protocol_id} />
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function SessionRow({ session, selected, onClick }) {
  const statusColor = STATUS_COLORS[session.integrity?.validity_status] || STATUS_COLORS.unreviewed;

  return (
    <div
      onClick={onClick}
      className={`analytics-session-row ${selected ? 'selected' : ''}`}
    >
      <div>
        <b>{session.participant_id || 'Unknown'}</b>
        <span className="analytics-status-dot" style={{ background: statusColor }} />
      </div>
      <small>
        {session.protocol_name || session.protocol_id?.substring(0, 8)} &nbsp;|&nbsp;
        {session.event_count || 0} events &nbsp;|&nbsp;
        {formatDateTime(session.ended_at || session.started_at)}
      </small>
    </div>
  );
}

function ValidityBadge({ validity }) {
  const color = STATUS_COLORS[validity] || STATUS_COLORS.unreviewed;
  return (
    <span className="analytics-validity" style={{ background: color + '18', color }}>
      {validity ? validity.toUpperCase() : 'UNREVIEWED'}
    </span>
  );
}

function Metric({ label, value, color }) {
  return (
    <div className="analytics-metric">
      <b style={{ color: color || undefined }}>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function EmptyState({ count }) {
  return (
    <div className="analytics-empty">
      <h3>No session selected</h3>
      <p>
        {count > 0
          ? `Select a session from the sidebar to view its timeline, analysis windows, and response charts. ${count} completed sessions available.`
          : 'Complete an experiment to see analytics here. Your session data will be visualized with timelines, charts, and integrity reports.'}
      </p>
    </div>
  );
}
