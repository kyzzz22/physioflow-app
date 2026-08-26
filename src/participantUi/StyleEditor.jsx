import { useEffect, useRef } from 'react';
import { UI_STYLE_KEYS } from '../core/index.js';

function StyleField({ propKey, value, theme, tokenNames, onChange }) {
  const isToken = Boolean(value) && typeof value === 'object' && !Array.isArray(value) && typeof value.$token === 'string';
  const tokenValue = isToken ? value.$token : '';
  const literalValue = isToken ? '' : String(value ?? '');
  return <div className="ui-style-field">
    <span>{propKey}</span>
    <select aria-label={`${propKey} source`} value={isToken ? `token:${tokenValue}` : 'literal'} onChange={event => {
      if (event.target.value.startsWith('token:')) onChange({ $token: event.target.value.slice(6) });
      else onChange(literalValue || '');
    }}>
      <option value="literal">literal</option>
      {tokenNames.map(name => <option key={name} value={`token:${name}`}>{name}</option>)}
    </select>
    {isToken ? <code>{theme[tokenValue] ?? tokenValue}</code> : <input value={literalValue} onChange={event => onChange(event.target.value)} />}
    <button className="danger" aria-label={`Remove ${propKey} style`} onClick={() => onChange(undefined)}>×</button>
  </div>;
}

export function StyleEditor({ element, theme, onSetStyle, forceOpen = false, onToggle }) {
  const style = element.style || {};
  const detailsRef = useRef(null);
  const setKey = (key, value) => {
    const next = { ...style };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onSetStyle(next);
  };
  const activeKeys = UI_STYLE_KEYS.filter(key => key in style);
  const availableKeys = UI_STYLE_KEYS.filter(key => !(key in style));
  const tokenNames = Object.keys(theme);
  useEffect(() => {
    if (forceOpen && detailsRef.current && !detailsRef.current.open) detailsRef.current.open = true;
  }, [forceOpen, element.id]);
  return <details ref={detailsRef} className="ui-style-editor" open={activeKeys.length > 0} onToggle={event => { if (!event.currentTarget.open && onToggle) onToggle(false); }}>
    <summary>Style ({activeKeys.length})</summary>
    {activeKeys.map(key => <StyleField key={key} propKey={key} value={style[key]} theme={theme} tokenNames={tokenNames} onChange={value => setKey(key, value)} />)}
    {availableKeys.length > 0 && <label className="ui-style-add">Add style<select value="" onChange={event => event.target.value && setKey(event.target.value, '')}><option value="">— choose —</option>{availableKeys.map(key => <option key={key} value={key}>{key}</option>)}</select></label>}
    <small>Dynamic bindings (variables.*) win over static style for color and background.</small>
  </details>;
}
