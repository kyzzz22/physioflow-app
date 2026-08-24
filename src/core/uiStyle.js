import {
  UI_STYLE_KEYS,
  createParticipantUiTheme,
  isUiTokenRef,
  resolveUiBinding,
} from './participantUi.js';

// Maps legacy `props` keys onto the style-allowlist keys so old schemas render identically.
const LEGACY_PROP_MAP = {
  color: 'color',
  background: 'background',
  fontSize: 'fontSize',
  align: 'textAlign',
  maxWidth: 'maxWidth',
  padding: 'padding',
  gap: 'gap',
  justify: 'justifyContent',
  alignItems: 'alignItems',
};

const BOUND_PROP_KEYS = new Set(['color', 'background']);

export function resolveTheme(schema) {
  return createParticipantUiTheme(schema?.theme);
}

export function resolveStyleValue(value, theme) {
  if (isUiTokenRef(value)) return theme[value.$token];
  return value;
}

export function resolveUiStyle(element, theme, context = {}) {
  const props = element?.props || {};
  const style = {};

  // 1. Legacy props baseline. `color`/`background` keep the historic `boundProp` semantics
  //    (a runtime binding wins over props) so existing schemas render byte-identical.
  for (const [propKey, styleKey] of Object.entries(LEGACY_PROP_MAP)) {
    const binding = BOUND_PROP_KEYS.has(propKey) ? element?.bindings?.[propKey] : undefined;
    if (binding) style[styleKey] = resolveUiBinding(binding, context);
    else if (props[propKey] !== undefined) style[styleKey] = props[propKey];
  }

  // 2. Per-element `style` is the authoritative static layer; token references resolve here.
  for (const key of UI_STYLE_KEYS) {
    if (!(key in (element?.style || {}))) continue;
    const resolved = resolveStyleValue(element.style[key], theme);
    if (resolved !== undefined) style[key] = resolved;
    else delete style[key];
  }

  // 3. Runtime bindings re-win over the static style layer (dynamic beats static).
  for (const key of BOUND_PROP_KEYS) {
    const binding = element?.bindings?.[key];
    if (binding) style[key] = resolveUiBinding(binding, context);
  }

  return style;
}
