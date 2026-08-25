// Shared helpers for `input.response` response options.
// Editor stores options as a line-based string (`value=label,key=1` per line);
// the registry keeps an array form for migration fidelity and runtime use.

export function parseResponseOptionLine(line) {
  const text = String(line || '').trim();
  if (!text) return null;
  const parts = text.split(',');
  const key = parts.find((p) => /^key=/i.test(p))?.slice(4).trim() || null;
  const head = parts.find((p) => !/^key=/i.test(p)) || text;
  const eq = head.indexOf('=');
  const value = eq > -1 ? head.slice(0, eq).trim() : text.trim();
  const label = eq > -1 ? head.slice(eq + 1).trim() : text.trim();
  return { value, label, ...(key ? { key } : {}) };
}

export function parseResponseOptions(input) {
  if (Array.isArray(input)) {
    return input
      .map((item) => {
        if (!item) return null;
        if (typeof item === 'string') return parseResponseOptionLine(item);
        const { value, label, key } = item;
        return { value: String(value ?? ''), label: String(label ?? value ?? ''), ...(key ? { key: String(key) } : {}) };
      })
      .filter(Boolean);
  }
  return String(input || '')
    .split('\n')
    .map(parseResponseOptionLine)
    .filter(Boolean);
}

export function serializeResponseOptions(options) {
  const list = Array.isArray(options) ? options : [];
  return list
    .map((item) => {
      if (!item) return '';
      if (typeof item === 'string') return item;
      const { value, label, key } = item;
      const head = value === label || label == null ? String(value ?? '') : `${value ?? ''}=${label ?? ''}`;
      return key ? `${head},key=${key}` : head;
    })
    .filter(Boolean)
    .join('\n');
}
