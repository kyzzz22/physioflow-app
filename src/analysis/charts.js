// charts.js — Pure Canvas 2D chart utilities (zero external dependencies)

// ── Color palette ──
export const COLORS = {
  blue: '#3b82f6',
  green: '#22c55e',
  red: '#ef4444',
  yellow: '#eab308',
  purple: '#8b5cf6',
  orange: '#f97316',
  teal: '#14b8a6',
  gray: '#6b7280',
  dark: '#1e293b',
  light: '#f8fafc',
  white: '#ffffff',
  bg: '#fafbfc',
  grid: '#e2e8f0',
  text: '#334155',
  muted: '#94a3b8',
};

export const STATUS_COLORS = {
  valid: '#22c55e',
  attention: '#eab308',
  invalid: '#ef4444',
  unreviewed: '#94a3b8',
  completed: '#3b82f6',
  aborted: '#f97316',
  paused: '#8b5cf6',
};

// ── Canvas helpers ──
export function setupCanvas(canvas, width, height, dpr = window.devicePixelRatio || 1) {
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}

export function drawTitle(ctx, text, x, y, maxWidth) {
  ctx.font = '600 13px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'left';
  ctx.fillText(text, x, y, maxWidth);
}

export function drawGrid(ctx, x, y, w, h, rows, cols, color = COLORS.grid) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= rows; i++) {
    const yy = y + (h / rows) * i;
    ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke();
  }
  for (let i = 0; i <= cols; i++) {
    const xx = x + (w / cols) * i;
    ctx.beginPath(); ctx.moveTo(xx, y); ctx.lineTo(xx, y + h); ctx.stroke();
  }
}

export function drawBar(ctx, x, y, w, h, color, radius = 3) {
  ctx.fillStyle = color;
  if (radius > 0 && h > 6) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillRect(x, y, w, h);
  }
}

// ── Bar Chart ──
export function drawBarChart(canvas, { data, labels, width = 600, height = 300, padding = 40, color = COLORS.blue, title = '', valueFormatter = v => String(v) }) {
  const ctx = setupCanvas(canvas, width, height);
  const chartW = width - padding * 2;
  const chartH = height - padding * 2 - 30;
  const maxVal = Math.max(...data, 1);

  // Background
  ctx.fillStyle = COLORS.white;
  ctx.fillRect(0, 0, width, height);

  // Title
  if (title) {
    ctx.font = '600 13px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.fillText(title, width / 2, padding / 2, width - 20);
  }

  // Grid
  const gridRows = 4;
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= gridRows; i++) {
    const y = padding + (chartH / gridRows) * i;
    ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(padding + chartW, y); ctx.stroke();
    ctx.font = '10px system-ui';
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'right';
    const val = maxVal - (maxVal / gridRows) * i;
    ctx.fillText(Math.round(val).toString(), padding - 6, y + 4);
  }

  // Bars
  const gap = 8;
  const barW = Math.max(6, (chartW - gap * (data.length - 1)) / data.length);
  data.forEach((val, i) => {
    const bh = (val / maxVal) * chartH;
    const bx = padding + i * (barW + gap);
    const by = padding + chartH - bh;
    drawBar(ctx, bx, by, barW, bh, color);

    // Label
    if (labels?.[i]) {
      ctx.font = '10px system-ui';
      ctx.fillStyle = COLORS.muted;
      ctx.textAlign = 'center';
      ctx.fillText(String(labels[i]).substring(0, 10), bx + barW / 2, padding + chartH + 15, barW + gap);
    }

    // Value on top
    ctx.font = 'bold 10px system-ui';
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.fillText(valueFormatter(val), bx + barW / 2, by - 4);
  });

  // Axes
  ctx.strokeStyle = COLORS.text;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padding, padding); ctx.lineTo(padding, padding + chartH); ctx.lineTo(padding + chartW, padding + chartH); ctx.stroke();

  return ctx;
}

// ── Scatter Plot ──
export function drawScatterPlot(canvas, { points, width = 400, height = 400, padding = 45, xLabel = '', yLabel = '', title = '', xMax = 9, yMax = 9, pointSize = 8, color = COLORS.blue }) {
  const ctx = setupCanvas(canvas, width, height);
  const chartW = width - padding * 2;
  const chartH = height - padding * 2 - 30;

  ctx.fillStyle = COLORS.white;
  ctx.fillRect(0, 0, width, height);

  if (title) {
    ctx.font = '600 13px system-ui';
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.fillText(title, width / 2, padding / 3);
  }

  // Grid
  drawGrid(ctx, padding, padding, chartW, chartH, 8, 8);

  // Labels
  ctx.font = '11px system-ui';
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = 'center';
  ctx.fillText(xLabel, width / 2, height - 5);
  ctx.save();
  ctx.translate(12, height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();

  // Points
  points.forEach(p => {
    const px = padding + (p.x / xMax) * chartW;
    const py = padding + chartH - (p.y / yMax) * chartH;
    ctx.beginPath();
    ctx.arc(px, py, pointSize, 0, Math.PI * 2);
    ctx.fillStyle = p.color || color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  // Axes
  ctx.strokeStyle = COLORS.text;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padding, padding); ctx.lineTo(padding, padding + chartH); ctx.lineTo(padding + chartW, padding + chartH); ctx.stroke();

  return ctx;
}

// ── Horizontal bar (timeline item) ──
export function drawTimelineItem(ctx, x, y, w, h, color, label, startLabel, endLabel) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);

  if (label) {
    ctx.font = '11px system-ui';
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 6, y + h / 2 + 4, w - 12);
  }

  if (startLabel && endLabel) {
    ctx.font = '9px monospace';
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'right';
    ctx.fillText(`${startLabel} – ${endLabel}`, x + w - 6, y + h / 2 + 4);
  }
}

// ── Formatting helpers ──
export function formatMs(ms) {
  if (ms == null || isNaN(ms)) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatEpoch(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString();
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export function percentOf(part, total) {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}
