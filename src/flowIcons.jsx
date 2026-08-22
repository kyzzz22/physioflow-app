// flowIcons.jsx — Unified SVG icon set + semantic per-type colors.
// Mirrors the AWS Infrastructure Composer "service icon" convention:
// every step / control-node kind gets a consistent glyph + distinct hue.

const STEP_COLORS = {
  instruction: '#2563eb',       // blue
  fixation: '#64748b',          // slate
  timer: '#d97706',             // amber
  rest: '#0d9488',              // teal
  video: '#ea580c',             // orange
  audio: '#7c3aed',             // violet
  image: '#db2777',             // pink
  questionnaire: '#16a34a',     // green
  response: '#0891b2',          // cyan
  attention_check: '#dc2626',   // red
  manual_event: '#4f46e5',      // indigo
  device_check: '#059669',      // emerald
  screen_calibration: '#65a30d', // lime
  custom_html: '#6366f1'        // indigo
};

const CONTROL_COLORS = {
  start: '#16a34a',             // green
  end: '#dc2626',               // red
  condition: '#d97706',         // amber
  loop: '#2563eb',              // blue
  note: '#eab308',              // yellow
  junction: '#7c3aed',          // violet
  group: '#0ea5e9'              // sky
};

export function nodeColor(type) {
  return STEP_COLORS[type] || CONTROL_COLORS[type] || '#64748b';
}

// hex -> rgba tint used for icon badge backgrounds
export function tint(hex, alpha = 0.14) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Inline style for a badge wrapping a glyph (background tint + glyph color)
export function nodeBadgeStyle(type) {
  const c = nodeColor(type);
  return { background: tint(c), color: c };
}

// One small, stroke-based SVG glyph per type. Uses currentColor so the
// surrounding badge controls the color.
export function NodeGlyph({ type, size = 16 }) {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true
  };

  switch (type) {
    // ── Step types ──
    case 'instruction':
      return <svg {...p}><path d="M5 6h14" /><path d="M5 12h9" /><path d="M5 18h14" /></svg>;
    case 'fixation':
      return <svg {...p}><path d="M12 4v16" /><path d="M4 12h16" /></svg>;
    case 'timer':
      return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case 'rest':
      return <svg {...p}><path d="M9 5v14" /><path d="M15 5v14" /></svg>;
    case 'video':
      return <svg {...p} fill="currentColor" stroke="none"><path d="M7 5l12 7-12 7V5z" /></svg>;
    case 'audio':
      return <svg {...p}><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16 9a4 4 0 0 1 0 6" /></svg>;
    case 'image':
      return <svg {...p}><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="M4 17l5-5 4 4 3-3 4 4" /></svg>;
    case 'questionnaire':
      return <svg {...p}><path d="M8 6h12" /><path d="M8 12h12" /><path d="M8 18h12" /><path d="M4 6h.01" /><path d="M4 12h.01" /><path d="M4 18h.01" /></svg>;
    case 'response':
      return <svg {...p}><path d="M9 5l7 7-7 7" /><path d="M16 12H4" /></svg>;
    case 'attention_check':
      return <svg {...p}><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v5" /><path d="M12 18h.01" /></svg>;
    case 'manual_event':
      return <svg {...p}><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" transform="rotate(45 12 12)" /></svg>;
    case 'device_check':
      return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></svg>;
    case 'screen_calibration':
      return <svg {...p}><path d="M4 9V4h5" /><path d="M15 4h5v5" /><path d="M20 15v5h-5" /><path d="M9 20H4v-5" /></svg>;
    case 'custom_html':
      return <svg {...p}><path d="M9 6l-5 6 5 6" /><path d="M15 6l5 6-5 6" /></svg>;

    // ── Control nodes ──
    case 'start':
      return <svg {...p}><circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" /></svg>;
    case 'end':
      return <svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" /></svg>;
    case 'condition':
      return <svg {...p}><path d="M12 3l9 9-9 9-9-9 9-9z" /></svg>;
    case 'loop':
      return <svg {...p}><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v4h-4" /></svg>;
    case 'note':
      return <svg {...p}><path d="M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" /><path d="M4 8h16" /></svg>;
    case 'junction':
      return <svg {...p}><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></svg>;
    case 'group':
      return <svg {...p}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M3 10h18" /></svg>;

    default:
      return <svg {...p}><circle cx="12" cy="12" r="6" /></svg>;
  }
}
