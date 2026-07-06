import { useRef, useEffect, useMemo } from 'react';
import { COLORS, STATUS_COLORS, formatMs } from './charts.js';

// CrossSessionCompare — Compare multiple sessions side-by-side
export default function CrossSessionCompare({ sessions, protocolId }) {
  const relevant = useMemo(() => {
    if (!sessions?.length) return [];
    return sessions
      .filter(s => !protocolId || s.protocol_id === protocolId)
      .filter(s => s.status === 'completed' || s.status === 'aborted')
      .slice(0, 15); // limit for readability
  }, [sessions, protocolId]);

  if (!relevant.length) {
    return <div className="empty" style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
      Select completed sessions to compare
    </div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <h3 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Cross-Session Comparison ({relevant.length} sessions)</h3>

      <ComparisonBarChart sessions={relevant} />
      <ComparisonTable sessions={relevant} />
    </div>
  );
}

function ComparisonBarChart({ sessions }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !sessions.length) return;
    const canvas = canvasRef.current;
    const width = Math.min(700, canvas.parentElement?.clientWidth || 700);
    const height = 280;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = '100%';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const pad = { top: 40, right: 30, bottom: 80, left: 60 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;

    // Three metrics per session: total events, completed steps, pauses
    const metrics = sessions.map(s => ({
      label: (s.participant_id || '').substring(0, 8) || '?',
      events: s.event_count || 0,
      completed: s.integrity?.facts?.completed_steps || 0,
      pauses: s.integrity?.facts?.pauses || 0,
    }));

    const maxVal = Math.max(...metrics.map(m => Math.max(m.events, m.completed, m.pauses)), 1);

    ctx.fillStyle = '#fafbfc';
    ctx.fillRect(0, 0, width, height);

    ctx.font = '600 12px system-ui';
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.fillText('Session Metrics Comparison', width / 2, 20);

    // Grid
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (chartH / 4) * i;
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + chartW, y); ctx.stroke();
      ctx.font = '9px system-ui';
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = 'right';
      ctx.fillText(String(Math.round(maxVal - (maxVal / 4) * i)), pad.left - 6, y + 4);
    }

    // Bars
    const itemsToShow = Math.min(metrics.length, 12);
    const groupGap = 12;
    const barGap = 3;
    const groupW = (chartW - groupGap * (itemsToShow - 1)) / itemsToShow;
    const barW = Math.max(2, (groupW - barGap * 2) / 3);

    const colors = [COLORS.blue, STATUS_COLORS.valid, STATUS_COLORS.attention];

    itemsToShow.forEach((_, i) => {
      const m = metrics[i];
      const vals = [m.events, m.completed, m.pauses];
      const gx = pad.left + i * (groupW + groupGap);

      vals.forEach((val, vi) => {
        const bh = Math.max(1, (val / maxVal) * chartH);
        const bx = gx + vi * (barW + barGap);
        const by = pad.top + chartH - bh;
        ctx.fillStyle = colors[vi];
        ctx.fillRect(bx, by, barW, bh);
      });

      // Label
      ctx.font = '9px system-ui';
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = 'center';
      const lbl = m.label.substring(0, 6);
      ctx.save();
      ctx.translate(gx + groupW / 2, pad.top + chartH + 12);
      ctx.rotate(-0.5);
      ctx.fillText(lbl, 0, 0);
      ctx.restore();
    });

    // Legend
    const legendItems = ['Total events', 'Completed steps', 'Pauses'];
    const legendColors = [COLORS.blue, STATUS_COLORS.valid, STATUS_COLORS.attention];
    legendItems.forEach((item, i) => {
      const lx = pad.left + i * 110;
      ctx.fillStyle = legendColors[i];
      ctx.fillRect(lx, height - 22, 10, 10);
      ctx.font = '10px system-ui';
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = 'left';
      ctx.fillText(item, lx + 14, height - 12);
    });

    // Axes
    ctx.strokeStyle = COLORS.text;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.left, pad.top); ctx.lineTo(pad.left, pad.top + chartH); ctx.lineTo(pad.left + chartW, pad.top + chartH); ctx.stroke();
  }, [sessions]);

  return <canvas ref={canvasRef} />;
}

function ComparisonTable({ sessions }) {
  return (
    <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: '#f8fafc' }}>
          <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid var(--line)' }}>Participant</th>
          <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '2px solid var(--line)' }}>Status</th>
          <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '2px solid var(--line)' }}>Events</th>
          <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '2px solid var(--line)' }}>Steps done</th>
          <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '2px solid var(--line)' }}>Pauses</th>
          <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '2px solid var(--line)' }}>Skips</th>
          <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '2px solid var(--line)' }}>Validity</th>
          <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '2px solid var(--line)' }}>Duration</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map(s => {
          const validityColor = STATUS_COLORS[s.integrity?.validity_status] || COLORS.muted;
          const startMs = s.started_at ? new Date(s.started_at).getTime() : null;
          const endMs = s.ended_at ? new Date(s.ended_at).getTime() : null;
          const durMs = startMs && endMs ? endMs - startMs : null;

          return (
            <tr key={s.session_id} style={{ borderBottom: '1px solid var(--line)' }}>
              <td style={{ padding: '4px 8px', fontWeight: 500 }}>{s.participant_id || '—'}</td>
              <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                <span style={{
                  fontSize: '0.65rem', padding: '2px 6px', borderRadius: 4,
                  background: (STATUS_COLORS[s.status] || COLORS.muted) + '20',
                  color: STATUS_COLORS[s.status] || COLORS.muted,
                }}>{s.status}</span>
              </td>
              <td style={{ padding: '4px 8px', textAlign: 'center' }}>{s.event_count || 0}</td>
              <td style={{ padding: '4px 8px', textAlign: 'center' }}>{s.integrity?.facts?.completed_steps || 0}</td>
              <td style={{ padding: '4px 8px', textAlign: 'center' }}>{s.integrity?.facts?.pauses || 0}</td>
              <td style={{ padding: '4px 8px', textAlign: 'center' }}>{s.integrity?.facts?.skips || 0}</td>
              <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                <span style={{ color: validityColor, fontWeight: 600 }}>
                  {s.integrity?.validity_status || 'unreviewed'}
                </span>
              </td>
              <td style={{ padding: '4px 8px', textAlign: 'center', fontSize: '0.7rem' }}>
                {durMs ? formatMs(durMs) : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
