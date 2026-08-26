// Shared UI helpers used by App shell, legacy Builder, and session setup pages.

export const clone = x => structuredClone(x);

export const stepDefaultExtras = defaults => Object.fromEntries(Object.entries(defaults).filter(([key]) => !['name', 'duration_mode', 'planned_duration_ms', 'recovery_behavior'].includes(key)));

export const responseOptionsText = options => (options || []).map(option => {
  const label = option.label_i18n?.en || option.label_i18n?.zh || option.label_i18n?.ja || option.value || '';
  return [option.value || '', label, option.key || ''].join(' | ');
}).join('\n');

export const parseResponseOptions = text => text.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
  const [valueRaw, labelRaw, keyRaw] = line.split('|').map(part => part.trim());
  const value = valueRaw || labelRaw || '';
  const label = labelRaw || value;
  return { value, key: keyRaw || '', label_i18n: { zh: label, ja: label, en: label } };
});

export function saveFile(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => { try { URL.revokeObjectURL(a.href); } catch { /* ignore */ } }, 30000);
}

// Toast helper — uses globally injected container for cross-view availability
export function showToast(message) {
  const container = document.getElementById('toast-root');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 2500);
}
