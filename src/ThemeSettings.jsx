import { useEffect, useMemo } from 'react';
import { THEME_PRESETS, LAYOUT_PRESETS, applyThemeToDOM, resetThemeToDOM } from './theme.js';

export default function ThemeSettings({ value, onChange, onClose, disabled }) {
  const theme = useMemo(() => value || {}, [value]);

  // Apply theme on mount for preview
  useEffect(() => {
    if (Object.keys(theme).length > 0) applyThemeToDOM(theme);
    return () => { resetThemeToDOM(); };
  }, [theme]);

  const update = (key, val) => {
    const next = { ...theme, [key]: val };
    applyThemeToDOM(next);
    onChange(next);
  };

  const applyPreset = (key) => {
    const preset = THEME_PRESETS[key];
    if (!preset) return;
    const { name: _name, description: _description, ...themeValues } = preset;
    applyThemeToDOM(themeValues);
    onChange({ ...theme, ...themeValues });
  };

  const applyLayoutPreset = (key) => {
    const preset = LAYOUT_PRESETS[key];
    if (!preset) return;
    onChange({ ...theme, ...preset });
  };

  return (
    <div className="qw-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true">
      <div className="theme-settings-panel">
        {/* Header */}
        <div className="qw-header">
          <div className="qw-header-left">
            <span className="qw-badge">THEME SETTINGS</span>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>Protocol theme &amp; style presets</h3>
          </div>
          <button className="qw-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="theme-body">
          {/* Theme presets */}
          <section className="theme-section">
            <h4>Color theme</h4>
            <div className="theme-preset-grid">
              {Object.entries(THEME_PRESETS).map(([key, preset]) => (
                <button key={key} type="button" disabled={disabled}
                  className={`theme-preset-card${theme.primary_color === preset.primary_color ? ' active' : ''}`}
                  onClick={() => applyPreset(key)}
                  title={preset.description}
                >
                  <span className="theme-swatch" style={{ background: preset.primary_color }} />
                  <span className="theme-preset-name">{preset.name}</span>
                </button>
              ))}
            </div>

            {/* Custom color */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginTop: '.8rem', fontSize: '.82rem' }}>
              Custom primary color:
              <input type="color" value={theme.primary_color || '#197453'} disabled={disabled}
                onChange={e => update('primary_color', e.target.value)}
                style={{ width: 36, height: 30, padding: 2, border: '1px solid var(--line)', borderRadius: 4, cursor: 'pointer' }} />
              <code style={{ fontSize: '.78rem' }}>{theme.primary_color || '#197453'}</code>
            </label>
          </section>

          {/* Typography */}
          <section className="theme-section">
            <h4>Typography</h4>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <label style={{ fontSize: '.82rem', display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
                Font family
                <select value={theme.font_family || 'system-ui'} disabled={disabled}
                  onChange={e => update('font_family', e.target.value)}
                  style={{ padding: '.35rem .5rem', border: '1px solid var(--line)', borderRadius: 4, fontSize: '.82rem' }}>
                  <option value="system-ui">System UI (default)</option>
                  <option value="Georgia, serif">Georgia (serif)</option>
                  <option value="'SF Mono', 'Cascadia Code', monospace">Monospace</option>
                  <option value="'Inter', system-ui, sans-serif">Inter</option>
                </select>
              </label>
              <label style={{ fontSize: '.82rem', display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
                Font scale
                <select value={theme.font_scale || 1.0} disabled={disabled}
                  onChange={e => update('font_scale', parseFloat(e.target.value))}
                  style={{ padding: '.35rem .5rem', border: '1px solid var(--line)', borderRadius: 4, fontSize: '.82rem' }}>
                  <option value={0.9}>Compact (0.9x)</option>
                  <option value={1.0}>Normal (1.0x)</option>
                  <option value={1.1}>Large (1.1x)</option>
                  <option value={1.15}>Extra large (1.15x)</option>
                </select>
              </label>
              <label style={{ fontSize: '.82rem', display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
                Border radius
                <input type="number" min={2} max={20} value={theme.border_radius ?? 8} disabled={disabled}
                  onChange={e => update('border_radius', Number(e.target.value))}
                  style={{ width: 80, padding: '.35rem .5rem', border: '1px solid var(--line)', borderRadius: 4, fontSize: '.82rem' }} />
              </label>
            </div>
          </section>

          {/* Layout presets */}
          <section className="theme-section">
            <h4>Default trial layout</h4>
            <div className="theme-preset-grid">
              {Object.entries(LAYOUT_PRESETS).map(([key, preset]) => (
                <button key={key} type="button" disabled={disabled}
                  className="theme-preset-card layout-preset"
                  onClick={() => applyLayoutPreset(key)}
                >
                  <span className="layout-swatch" style={{ background: preset.background, border: `2px solid ${preset.foreground}22` }}>
                    <span style={{ color: preset.foreground, fontSize: '.55rem' }}>Aa</span>
                  </span>
                  <span className="theme-preset-name">{preset.name}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Dark mode default */}
          <section className="theme-section">
            <label className="q-check" style={{ fontSize: '.82rem' }}>
              <input type="checkbox" checked={theme.dark_mode_default || false} disabled={disabled}
                onChange={e => update('dark_mode_default', e.target.checked)} />
              Dark mode by default (participant view)
            </label>
          </section>
        </div>
      </div>
    </div>
  );
}
