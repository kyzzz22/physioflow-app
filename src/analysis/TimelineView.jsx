import { useRef, useEffect, useState } from 'react';
import { COLORS, STATUS_COLORS, formatMs } from './charts.js';

// TimelineView — renders a horizontal SVG/CSS timeline of a session's steps
export default function TimelineView({ events, protocol, width = 800 }) {
  const containerRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  // Build timeline data from events
  const timeline = buildTimeline(events, protocol);

  useEffect(() => {
    if (!containerRef.current) return;
    renderCanvas(containerRef.current, timeline, width, setTooltip);
  }, [timeline, width]);

  if (!timeline.items.length) {
    return <div className="empty" style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>No events to display</div>;
  }

  return (
    <div className="analysis-chart-scroll">
      <div
        ref={containerRef}
        className="analysis-timeline-canvas"
        onMouseMove={e => handleHover(e, timeline, width, setTooltip)}
        onMouseLeave={() => setTooltip(null)}
      />
      {tooltip && (
        <div className="analysis-tooltip" style={{ left: tooltip.x + 10, top: tooltip.y - 10 }}>
          <b>{tooltip.label}</b><br />
          Duration: {tooltip.duration}<br />
          Status: {tooltip.status}
        </div>
      )}
    </div>
  );
}

function buildTimeline(events, protocol) {
  if (!events?.length) return { items: [], startTime: 0, endTime: 0, totalMs: 1 };

  const stepMap = new Map();
  try {
    (protocol?.blocks || []).forEach(b =>
      (b.trials || []).forEach(t =>
        (t.steps || []).forEach(s => stepMap.set(s.step_id, s))
      ));
  } catch { /* ignore */ }

  const startTime = events[0]?.elapsed_monotonic_ms || 0;
  const endTime = events[events.length - 1]?.elapsed_monotonic_ms || startTime + 1;
  const totalMs = endTime - startTime || 1;

  // Group events by step occurrence (entered → completed/skipped)
  const entered = new Map();
  const items = [];

  events.forEach(ev => {
    if (ev.event_type === 'step_entered') {
      entered.set(ev.step_id + '_' + ev.elapsed_monotonic_ms, ev);
    }
    const isTerminal = ['step_completed', 'step_skipped', 'step_retried'].includes(ev.event_type);
    if (isTerminal) {
      // Find matching entered event
      let startEv = null;
      for (const [key, val] of entered) {
        if (key.startsWith(ev.step_id) && !val._paired) {
          startEv = val;
          val._paired = true;
          break;
        }
      }
      const step = stepMap.get(ev.step_id);
      items.push({
        stepId: ev.step_id,
        name: step?.name || ev.step_id?.substring(0, 8) || '?',
        type: step?.type || 'unknown',
        role: step?.role || 'custom',
        startMs: startEv?.elapsed_monotonic_ms || ev.elapsed_monotonic_ms - (step?.planned_duration_ms || 5000),
        endMs: ev.elapsed_monotonic_ms,
        status: ev.event_type === 'step_completed' ? 'completed' : ev.event_type === 'step_skipped' ? 'skipped' : 'retried',
        isAnalysis: step?.is_analysis_window || false,
        condition: ev.condition || '',
        blockOrder: ev.block_order,
        trialOrder: ev.trial_order,
        stepOrder: ev.step_order,
      });
    }
  });

  // Sort by start time
  items.sort((a, b) => a.startMs - b.startMs);

  return { items, startTime, endTime, totalMs };
}

function renderCanvas(container, timeline, width, setTooltip) {
  const { items, startTime, totalMs } = timeline;
  if (!items.length) return;

  const rowH = 32;
  const gap = 4;
  const topPad = 10;
  const leftPad = 140;
  const rightPad = 20;
  const chartW = width - leftPad - rightPad;
  const height = items.length * (rowH + gap) + topPad + 20;

  const canvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  canvas.style.cursor = 'pointer';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Background
  ctx.fillStyle = '#fafbfc';
  ctx.fillRect(0, 0, width, height);

  // Title
  ctx.font = '600 13px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = COLORS.text;
  ctx.fillText('Session Timeline', 10, 18);

  // Header
  ctx.font = '10px system-ui';
  ctx.fillStyle = COLORS.muted;
  ctx.fillText('Step', leftPad - 135, topPad - 2);

  // Render each item
  items.forEach((item, i) => {
    const y = topPad + i * (rowH + gap);
    const startPct = Math.max(0, (item.startMs - startTime) / totalMs);
    const endPct = Math.min(1, (item.endMs - startTime) / totalMs);
    const x = leftPad + startPct * chartW;
    const w = Math.max(4, (endPct - startPct) * chartW);

    // Row background
    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(241,245,249,0.5)';
      ctx.fillRect(leftPad, y - 2, chartW, rowH + gap);
    }

    // Label
    ctx.font = '10px system-ui';
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'right';
    const label = item.name.length > 15 ? item.name.substring(0, 14) + '…' : item.name;
    ctx.fillText(label, leftPad - 6, y + rowH * 0.65);

    // Analysis indicator
    if (item.isAnalysis) {
      ctx.fillStyle = COLORS.teal;
      ctx.fillRect(leftPad - 2, y - 1, 3, rowH + 2);
    }

    // Timeline bar
    const statusColor = STATUS_COLORS[item.status] || COLORS.blue;
    ctx.fillStyle = statusColor;
    ctx.fillRect(x, y + 4, w, rowH - 8);

    // Lighter fill for analysis windows
    if (item.isAnalysis) {
      ctx.fillStyle = 'rgba(20, 184, 166, 0.15)';
      ctx.fillRect(x, y, w, rowH);
    }

    // Duration text
    const dur = formatMs(item.endMs - item.startMs);
    ctx.font = '9px monospace';
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'left';
    ctx.fillText(dur, x + w + 4, y + rowH * 0.65);

    // Data attributes for tooltip
    item._x = x;
    item._y = y;
    item._w = w;
    item._h = rowH;
  });

  // Time axis
  const axisY = topPad + items.length * (rowH + gap) + 5;
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(leftPad, axisY);
  ctx.lineTo(leftPad + chartW, axisY);
  ctx.stroke();

  // Time ticks
  const tickCount = 5;
  ctx.font = '9px monospace';
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = 'center';
  for (let i = 0; i <= tickCount; i++) {
    const tickX = leftPad + (chartW / tickCount) * i;
    const tickMs = startTime + (totalMs / tickCount) * i;
    ctx.fillText(formatMs(tickMs), tickX, axisY + 14);
    ctx.beginPath();
    ctx.moveTo(tickX, axisY - 3);
    ctx.lineTo(tickX, axisY + 3);
    ctx.stroke();
  }

  // Replace canvas content
  container.innerHTML = '';
  container.appendChild(canvas);

  // Store timeline data for hover
  canvas._timeline = items;
  canvas._setTooltip = setTooltip;
}

function handleHover(e, timelineData, width, setTooltip) {
  const rect = e.target.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const hit = timelineData.items?.find(item =>
    mx >= item._x && mx <= item._x + item._w &&
    my >= item._y && my <= item._y + item._h
  );

  if (hit) {
    setTooltip({
      x: e.clientX,
      y: e.clientY,
      label: `${hit.name} (${hit.type})`,
      duration: formatMs(hit.endMs - hit.startMs),
      status: hit.status,
    });
  } else {
    setTooltip(null);
  }
}
