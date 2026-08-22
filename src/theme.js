// ── Theme utilities & presets ──

function hexToHsl(hex) {
  let r = 0, g = 0, b = 0;
  const h = hex.replace('#', '');
  if (h.length === 3) { r = parseInt(h[0] + h[0], 16); g = parseInt(h[1] + h[1], 16); b = parseInt(h[2] + h[2], 16); }
  else if (h.length >= 6) { r = parseInt(h.substring(0, 2), 16); g = parseInt(h.substring(2, 4), 16); b = parseInt(h.substring(4, 6), 16); }
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue = 0, sat = 0, lum = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    sat = lum > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: hue = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: hue = ((b - r) / d + 2) / 6; break;
      case b: hue = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: Math.round(hue * 360), s: Math.round(sat * 100), l: Math.round(lum * 100) };
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + h / 30) % 12; return Math.round((l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)) * 255); };
  return `#${[f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, '0')).join('')}`;
}

function darken(hex, amount) {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, s, Math.max(0, l - amount));
}

// ── Apply theme to DOM by setting CSS custom properties ──
export function applyThemeToDOM(theme) {
  if (!theme) return;
  const root = document.documentElement;
  const primary = theme.primary_color || '#197453';
  const primaryDark = theme.primary_color_dark || '#5ed0a2';
  const { h, s } = hexToHsl(primary);

  root.style.setProperty('--green', primary);
  root.style.setProperty('--green-strong', darken(primary, 8));
  root.style.setProperty('--mint', hslToHex(h, Math.min(s, 40), 92));
  root.style.setProperty('--line', hslToHex(h, 15, 85));
  root.style.setProperty('--line-strong', hslToHex(h, 12, 75));
  root.style.setProperty('--surface', hslToHex(h, 20, 95));
  root.style.setProperty('--paper-soft', hslToHex(h, 20, 97));

  // Typography
  if (theme.font_family) {
    root.style.setProperty('--font-sans', theme.font_family);
    if (theme.font_family !== 'system-ui') {
      document.body.style.fontFamily = theme.font_family;
    }
  }

  // Font scale
  if (theme.font_scale && theme.font_scale !== 1.0) {
    root.style.setProperty('--font-scale', theme.font_scale);
    root.style.fontSize = `${theme.font_scale * 100}%`;
  }

  // Border radius
  if (theme.border_radius != null) {
    root.style.setProperty('--r-md', `${theme.border_radius}px`);
    root.style.setProperty('--r-lg', `${theme.border_radius + 4}px`);
    root.style.setProperty('--r-xl', `${theme.border_radius + 8}px`);
  }

  // Dark mode
  if (theme.primary_color_dark) {
    // Dark mode overrides are set via CSS cascade, but we pre-set here for JS apply
    root.style.setProperty('--green-dark', primaryDark);
  }
}

// ── Reset theme to defaults ──
export function resetThemeToDOM() {
  const root = document.documentElement;
  const vars = ['--green', '--green-strong', '--mint', '--line', '--line-strong', '--surface', '--paper-soft', '--font-scale', '--r-md', '--r-lg', '--r-xl', '--font-sans'];
  vars.forEach(v => root.style.removeProperty(v));
  root.style.removeProperty('fontSize');
  root.style.removeProperty('fontFamily');
  document.body.style.removeProperty('fontFamily');
}

// ── Theme presets ──
export const THEME_PRESETS = {
  'physio-green': {
    name: 'Physio Green',
    primary_color: '#197453',
    primary_color_dark: '#5ed0a2',
    font_family: 'system-ui',
    font_scale: 1.0,
    border_radius: 8,
    description: 'Default green — clean, professional',
  },
  'ocean-blue': {
    name: 'Ocean Blue',
    primary_color: '#2563eb',
    primary_color_dark: '#60a5fa',
    font_family: 'system-ui',
    font_scale: 1.0,
    border_radius: 8,
    description: 'Cool blue tones — calm, focused',
  },
  'warm-amber': {
    name: 'Warm Amber',
    primary_color: '#d97706',
    primary_color_dark: '#fbbf24',
    font_family: 'Georgia, serif',
    font_scale: 1.0,
    border_radius: 10,
    description: 'Warm earthy tones — inviting, natural',
  },
  'high-contrast': {
    name: 'High Contrast',
    primary_color: '#1e40af',
    primary_color_dark: '#93c5fd',
    font_family: 'system-ui',
    font_scale: 1.05,
    border_radius: 4,
    description: 'Bold blues, larger text — accessible',
  },
  'soft-lavender': {
    name: 'Soft Lavender',
    primary_color: '#7c3aed',
    primary_color_dark: '#c4b5fd',
    font_family: 'system-ui',
    font_scale: 1.0,
    border_radius: 12,
    description: 'Gentle purple — creative, relaxed',
  },
  'minimal-mono': {
    name: 'Minimal Mono',
    primary_color: '#374151',
    primary_color_dark: '#d1d5db',
    font_family: 'system-ui',
    font_scale: 0.95,
    border_radius: 6,
    description: 'Neutral gray — minimal distraction',
  },
};

// ── Layout presets (trial layout defaults) ──
export const LAYOUT_PRESETS = {
  'warm-paper': {
    name: 'Warm Paper',
    background: '#fffef9',
    foreground: '#17221d',
    padding: 48,
    gap: 24,
    border_radius: 12,
  },
  'clean-white': {
    name: 'Clean White',
    background: '#ffffff',
    foreground: '#1a1a1a',
    padding: 60,
    gap: 32,
    border_radius: 8,
  },
  'dark-focus': {
    name: 'Dark Focus',
    background: '#1a1a2e',
    foreground: '#e0e0e0',
    padding: 48,
    gap: 24,
    border_radius: 8,
  },
  'compact': {
    name: 'Compact',
    background: '#ffffff',
    foreground: '#111111',
    padding: 24,
    gap: 16,
    border_radius: 4,
  },
  'soft-mint': {
    name: 'Soft Mint',
    background: '#f5faf7',
    foreground: '#1a2e24',
    padding: 48,
    gap: 28,
    border_radius: 12,
  },
};
