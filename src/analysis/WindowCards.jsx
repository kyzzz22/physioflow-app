import { useRef, useEffect } from 'react';
import { COLORS, STATUS_COLORS, formatMs } from './charts.js';

// WindowCards — Analysis window summary with bar charts
export default function WindowCards({ events, protocol, onExportChart }) {
  const windows = computeWindows(events, protocol);

  if (!windows.length) {
    return <div className="empty" style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
      No analysis windows defined. Mark steps as "Analysis window" in the protocol editor.
    </div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <h3 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Analysis Windows ({windows.length})</h3>

      {/* Summary stats */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <StatBadge label="Valid" value={windows.filter(w => w.validity === 'valid').length} color={STATUS_COLORS.valid} />
        <StatBadge label="Attention" value={windows.filter(w => w.validity === 'attention').length} color={STATUS_COLORS.attention} />
        <StatBadge label="Invalid" value={windows.filter(w => w.validity === 'invalid').length} color={STATUS_COLORS.invalid} />
        <StatBadge label="Avg Duration" value={formatMs(average(windows.map(w => w.durationMs)))} color={COLORS.blue} />
      </div>

      {/* Bar chart: expected vs actual */}
      <WindowBarChart windows={windows} />

      {/* Individual window list */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
        {windows.map((w, i) => (
          <WindowCard key={w.windowId || i} window={w} />
        ))}
      </div>

      {onExportChart && (
        <button className="hint" onClick={onExportChart} style={{ alignSelf: 'flex-end' }}>
          ⤓ Export chart as PNG
        </button>
      )}
    </div>
  );
}

function WindowBarChart({ windows }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !windows.length) return;
    const canvas = canvasRef.current;
    const width = 600;
    const height = 260;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = '100%';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const pad = { top: 40, right: 20, bottom: 60, left: 60 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;
    const maxDur = Math.max(...windows.map(w => Math.max(w.expectedMs || 0, w.durationMs || 0)), 1);

    ctx.fillStyle = '#fafbfc';
    ctx.fillRect(0, 0, width, height);

    // Title
    ctx.font = '600 12px system-ui';
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.fillText('Expected vs Actual Duration', width / 2, 20);

    // Grid
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (chartH / 4) * i;
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + chartW, y); ctx.stroke();
      ctx.font = '10px system-ui';
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = 'right';
      ctx.fillText(formatMs(maxDur - (maxDur / 4) * i), pad.left - 6, y + 4);
    }

    // Bars
    const barGap = 6;
    const groupGap = 16;
    const itemsToShow = Math.min(windows.length, 12);
    const groupW = (chartW - groupGap * (itemsToShow - 1)) / itemsToShow;
    const barW = Math.max(3, (groupW - barGap) / 2);

    itemsToShow.forEach((_, i) => {
      const w = windows[i];
      const gx = pad.left + i * (groupW + groupGap);

      // Expected (lighter)
      const eh = Math.max(1, ((w.expectedMs || 0) / maxDur) * chartH);
      ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';
      ctx.fillRect(gx, pad.top + chartH - eh, barW, eh);

      // Actual
      const ah = Math.max(1, (w.durationMs / maxDur) * chartH);
      ctx.fillStyle = w.validity === 'valid' ? STATUS_COLORS.valid :
        w.validity === 'attention' ? STATUS_COLORS.attention : STATUS_COLORS.invalid;
      ctx.fillRect(gx + barW + barGap, pad.top + chartH - ah, barW, ah);

      // Label
      ctx.font = '9px system-ui';
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = 'center';
      const lbl = (w.label || '').substring(0, 6);
      ctx.fillText(lbl, gx + groupW / 2, pad.top + chartH + 14);
    });

    // Legend
    ctx.fillStyle = 'rgba(59, 130, 246, 0.4)';
    ctx.fillRect(pad.left + 10, height - 20, 12, 12);
    ctx.font = '10px system-ui';
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'left';
    ctx.fillText('Expected', pad.left + 26, height - 10);

    ctx.fillStyle = STATUS_COLORS.valid;
    ctx.fillRect(pad.left + 100, height - 20, 12, 12);
    ctx.fillText('Actual', pad.left + 116, height - 10);
  }, [windows]);

  return <canvas ref={canvasRef} />;
}

function WindowCard({ window: w }) {
  const statusColor = STATUS_COLORS[w.validity] || COLORS.muted;
  const ratio = w.expectedMs ? ((w.durationMs / w.expectedMs) * 100).toFixed(0) : '—';

  return (
    <div style={{
      background: '#fff', border: '1px solid var(--line)', borderRadius: 8,
      padding: '0.75rem', borderLeft: `3px solid ${statusColor}`,
      fontSize: '0.8rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
        <b style={{ color: COLORS.text }}>{w.label || w.stepName || 'Window'}</b>
        <span style={{
          fontSize: '0.65rem', fontWeight: 600, padding: '2px 6px', borderRadius: 4,
          background: statusColor + '20', color: statusColor,
        }}>{w.validity.toUpperCase()}</span>
      </div>
      <div style={{ color: COLORS.muted, fontSize: '0.7rem' }}>
        <div>Expected: <b>{formatMs(w.expectedMs)}</b> &nbsp; Actual: <b>{formatMs(w.durationMs)}</b></div>
        <div>Ratio: <b>{ratio}%</b> &nbsp; Pauses: <b>{w.pauseCount}</b></div>
        {w.reason && <div style={{ color: STATUS_COLORS.invalid }}>⚠ {w.reason}</div>}
        {w.condition && <div>Condition: {w.condition}</div>}
      </div>
    </div>
  );
}

function StatBadge({ label, value, color }) {
  return (
    <div style={{
      background: '#fff', border: `1px solid ${color}30`, borderRadius: 8,
      padding: '0.5rem 0.75rem', textAlign: 'center', minWidth: 80,
    }}>
      <div style={{ fontSize: '1.2rem', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: '0.65rem', color: COLORS.muted }}>{label}</div>
    </div>
  );
}

// ── Window computation (mirrors exporter.js logic) ──
function computeWindows(events, protocol) {
  if (!events?.length) return [];

  const stepMap = new Map();
  try {
    (protocol?.blocks || []).forEach(b =>
      (b.trials || []).forEach(t =>
        (t.steps || []).forEach(s => stepMap.set(s.step_id, s))
      ));
  } catch { /* ignore */ }

  const ordered = [...events].sort((a, b) => a.elapsed_monotonic_ms - b.elapsed_monotonic_ms);
  const open = new Map();
  const pairs = new Map();

  ordered.forEach(ev => {
    const step = stepMap.get(ev.step_id);
    const isMedia = ['video', 'audio'].includes(step?.type) && step?.source_mode !== 'youtube';
    const startType = isMedia ? 'media_play_started' : 'step_entered';
    const endTypes = isMedia ? ['media_ended', 'step_skipped', 'step_retried'] : ['step_completed', 'step_skipped', 'step_retried'];

    if (ev.event_type === startType) {
      const queue = open.get(ev.step_id) || [];
      queue.push(ev);
      open.set(ev.step_id, queue);
    }
    if (endTypes.includes(ev.event_type)) {
      const queue = open.get(ev.step_id) || [];
      const start = queue.shift();
      if (start) pairs.set(start.event_id, ev);
    }
  });

  const pauses = ordered.filter(e => e.event_type === 'session_paused');

  return ordered.filter(ev => {
    const step = stepMap.get(ev.step_id);
    const isMedia = ['video', 'audio'].includes(step?.type) && step?.source_mode !== 'youtube';
    return ev.event_type === (isMedia ? 'media_play_started' : 'step_entered') && step?.is_analysis_window;
  }).map(start => {
    const step = stepMap.get(start.step_id);
    const end = pairs.get(start.event_id);
    const pauseCount = pauses.filter(p =>
      p.elapsed_monotonic_ms >= start.elapsed_monotonic_ms &&
      p.elapsed_monotonic_ms <= (end?.elapsed_monotonic_ms || Infinity)
    ).length;

    const validity = !end ? 'invalid' :
      end.event_type === 'step_skipped' ? 'invalid' :
      pauseCount ? 'attention' :
      end.event_type === 'step_retried' ? 'attention' :
      'valid';

    return {
      windowId: start.event_id,
      label: step?.analysis_label || step?.role || step?.name || '',
      stepName: step?.name || '',
      condition: start.condition || '',
      expectedMs: step?.planned_duration_ms || 0,
      durationMs: end ? end.elapsed_monotonic_ms - start.elapsed_monotonic_ms : 0,
      pauseCount,
      validity,
      reason: !end ? 'Missing end event' :
        end.event_type === 'step_skipped' ? 'Step skipped' :
        pauseCount ? 'Contains pauses' :
        end.event_type === 'step_retried' ? 'Step retried' : '',
    };
  });
}

function average(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
