import { useMemo, useState } from 'react';
import ParticipantRenderer from './ParticipantRenderer.jsx';
import ParticipantUiCanvas from './ParticipantUiCanvas.jsx';
import {
  appendUiElement,
  createUiElement,
  insertUiElement,
  mapUiElement,
  moveUiElement,
  normalizeParticipantUi,
  participantUiTemplate,
  removeUiElement,
  resolveTheme,
  UI_STYLE_KEYS,
  validateParticipantUi,
} from './core/index.js';

const defaults = {
  Layout: { direction: 'column', gap: 16 },
  Text: { text: 'New text', variant: 'body' },
  Media: { mediaType: 'image', sourceUrl: '', alt: 'Stimulus' },
  Input: { name: 'response', inputType: 'text', label: 'Response', required: false },
  Button: { label: 'Continue', variant: 'primary' },
  Progress: { value: 0, max: 100, label: '' },
  Html: { html: '<div style="text-align:center">Custom HTML</div>' },
};

const TEMPLATE_KINDS = ['instruction', 'media', 'form', 'text', 'rating', 'fixation', 'attention', 'device', 'manual', 'html', 'calibration'];
const CONTAINERS = new Set(['Screen', 'Layout']);
const COLOR_TOKENS = ['ink', 'green', 'greenStrong', 'lime', 'mint', 'blue', 'amber', 'paper', 'paperSoft', 'surface', 'line', 'lineStrong', 'danger', 'warning', 'muted', 'mutedStrong'];
const FONT_TOKENS = ['fontFamily', 'headingFamily', 'fontSizeBase'];
const SPACING_TOKENS = ['spacingUnit', 'radius', 'maxWidth'];

const THEME_PRESETS_V2 = {
  'Physio Green': { green: '#197453', greenStrong: '#0f5c40', mint: '#e8f5ee', paper: '#ffffff', ink: '#17231d', radius: '12px' },
  'Ocean Blue': { green: '#356fae', greenStrong: '#2a5a92', mint: '#e8f0fa', paper: '#ffffff', ink: '#1c2a3a', radius: '10px' },
  'Warm Amber': { green: '#b66f15', greenStrong: '#96590f', mint: '#fbf1e2', paper: '#fffdf7', ink: '#33281c', radius: '14px' },
  'High Contrast': { green: '#0f5c40', greenStrong: '#0a3d2a', mint: '#e8f5ee', paper: '#ffffff', ink: '#000000', radius: '4px' },
  'Minimal Mono': { green: '#46564d', greenStrong: '#2e3a33', mint: '#f4f6f5', paper: '#fcfcfc', ink: '#222222', radius: '0px' },
};

function findParentAndIndex(root, id) {
  for (let i = 0; i < (root.children || []).length; i++) {
    const child = root.children[i];
    if (child.id === id) return { parentId: root.id, index: i };
    const found = findParentAndIndex(child, id);
    if (found) return found;
  }
  return null;
}

function flatten(root, depth = 0, result = [], parentId = null, childIndex = 0) {
  result.push({ element: root, depth, parentId, childIndex });
  (root.children || []).forEach((child, index) => flatten(child, depth + 1, result, root.id, index));
  return result;
}

function elementLabel(element) {
  return element.props?.label || element.props?.text || element.props?.name || '';
}

function normalizeColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
}

export default function ParticipantUiBuilder({ schema, onChange, defaultTemplate = 'instruction' }) {
  const normalized = useMemo(() => normalizeParticipantUi(schema), [schema]);
  const theme = useMemo(() => resolveTheme(normalized), [normalized]);
  const [selectedId, setSelectedId] = useState(normalized.root.id);
  const [preview, setPreview] = useState(false);
  const [structureOpen, setStructureOpen] = useState(false);
  const [dragOver, setDragOver] = useState(null);
  const elements = flatten(normalized.root);
  const selected = elements.find(item => item.element.id === selectedId)?.element || normalized.root;
  const validation = validateParticipantUi(normalized);
  const selectedParent = selectedId !== normalized.root.id ? findParentAndIndex(normalized.root, selectedId) : null;
  const selectedParentElement = selectedParent ? elements.find(item => item.element.id === selectedParent.parentId)?.element : null;
  const showPosition = Boolean(selectedParentElement?.props?.free) || (selected.props?.x != null && selected.props?.y != null);

  const updateProps = patch => onChange(mapUiElement(normalized, selected.id, element => ({ ...element, props: { ...element.props, ...patch } })));

  // Toggle free layout on a container. Turning it on immediately staggers the direct
  // children into draggable x/y positions so the change is visible; turning it off
  // clears coordinates so children flow normally again.
  const toggleFree = containerElement => {
    const free = !containerElement.props?.free;
    const children = (containerElement.children || []).map((child, index) => {
      if (free) {
        if (child.props?.x != null && child.props?.y != null) return child;
        const props = { ...child.props, x: 32 + (index % 2) * 140, y: 36 + index * 72 };
        return { ...child, props };
      }
      const props = { ...child.props };
      delete props.x;
      delete props.y;
      return { ...child, props };
    });
    onChange(mapUiElement(normalized, containerElement.id, element => ({ ...element, props: { ...element.props, free }, children })));
  };
  const setStyle = next => onChange(mapUiElement(normalized, selected.id, element => {
    const copy = { ...element };
    if (next && Object.keys(next).length) copy.style = next;
    else delete copy.style;
    return copy;
  }));
  const bindingTarget = { Text: 'text', Media: 'sourceUrl', Progress: 'value' }[selected.type];

  const addToRoot = type => {
    const freeRoot = normalized.root.props?.free;
    const index = normalized.root.children?.length || 0;
    const props = freeRoot ? { ...defaults[type], x: 32 + (index % 2) * 140, y: 36 + index * 72 } : defaults[type];
    const element = createUiElement(type, { props, actions: type === 'Button' ? [{ event: 'click', action: 'submit' }] : [] });
    onChange(appendUiElement(normalized, normalized.root.id, element));
    setSelectedId(element.id);
  };

  const dropElement = (type, targetElementId, x, y) => {
    const target = elements.find(item => item.element.id === targetElementId)?.element;
    if (!target) return;
    const props = { ...defaults[type], ...(x != null && y != null ? { x, y } : {}) };
    const element = createUiElement(type, { props, actions: type === 'Button' ? [{ event: 'click', action: 'submit' }] : [] });
    try {
      const parentId = CONTAINERS.has(target.type) ? target.id : findParentAndIndex(normalized.root, target.id)?.parentId;
      if (!parentId) return;
      const index = CONTAINERS.has(target.type) ? (target.children || []).length : (findParentAndIndex(normalized.root, target.id)?.index || 0) + 1;
      onChange(insertUiElement(normalized, parentId, index, element));
      setSelectedId(element.id);
    } catch { /* invalid drop ignored */ }
  };

  const moveElement = (elementId, targetElementId, x, y) => {
    // Free-layout drag: reposition in place instead of reordering the flex tree.
    if (x != null && y != null) {
      try {
        onChange(mapUiElement(normalized, elementId, element => ({ ...element, props: { ...element.props, x, y } })));
        setSelectedId(elementId);
      } catch { /* invalid position ignored */ }
      return;
    }
    const target = elements.find(item => item.element.id === targetElementId)?.element;
    if (!target) return;
    try {
      const parentId = CONTAINERS.has(target.type) ? target.id : findParentAndIndex(normalized.root, target.id)?.parentId;
      if (!parentId) return;
      const index = CONTAINERS.has(target.type) ? (target.children || []).length : (findParentAndIndex(normalized.root, target.id)?.index || 0) + 1;
      onChange(moveUiElement(normalized, elementId, parentId, index));
      setSelectedId(elementId);
    } catch { /* invalid move ignored */ }
  };

  const moveBy = delta => {
    if (!selectedParent) return;
    try { onChange(moveUiElement(normalized, selected.id, selectedParent.parentId, selectedParent.index + delta)); } catch { /* ignored */ }
  };

  const removeSelected = () => {
    if (selected.id === normalized.root.id) return;
    onChange(removeUiElement(normalized, selected.id));
    setSelectedId(normalized.root.id);
  };

  return <section className="participant-ui-builder">
    <div className="ui-builder-toolbar">
      <b>Participant interface</b>
      <select aria-label="Template" value={defaultTemplate} onChange={event => { const next = participantUiTemplate(event.target.value); onChange(next); setSelectedId(next.root.id); }}>
        {TEMPLATE_KINDS.map(kind => <option key={kind} value={kind}>{kind}</option>)}
      </select>
      <button onClick={() => { const next = participantUiTemplate(defaultTemplate); onChange(next); setSelectedId(next.root.id); }}>Reset template</button>
      <button onClick={() => setPreview(value => !value)}>{preview ? 'Edit' : 'Preview'}</button>
      <button onClick={() => setStructureOpen(value => !value)}>Structure</button>
      <ThemeEditor schema={normalized} theme={theme} onChange={onChange} />
    </div>

    {preview ? <div className="ui-builder-preview"><ParticipantRenderer schema={normalized} context={{ progress: { percent: 40 } }} preview /></div>
      : <div className="ui-canvas-layout">
        <div className="ui-element-library">
          <b>Elements</b>
          {Object.keys(defaults).map(type => (
            <div key={type} className="ui-library-block" draggable
              onClick={() => addToRoot(type)}
              onDragStart={event => {
                event.dataTransfer.setData('application/x-physioflow-ui', JSON.stringify({ action: 'add', type }));
                event.dataTransfer.effectAllowed = 'copy';
              }}
              title="Drag onto the canvas or click to append">＋ {type}</div>
          ))}
        </div>
        <div className="ui-canvas-wrap">
          <ParticipantUiCanvas schema={normalized} selectedId={selectedId} onSelect={setSelectedId} onDropElement={dropElement} onMoveElement={moveElement} />
        </div>
        <aside className="ui-inspector">
          <div className="ui-inspector-head"><b>{selected.type}</b>
            {selected.id !== normalized.root.id && <div className="ui-inspector-actions">
              <button disabled={!selectedParent} onClick={() => moveBy(-1)}>↑</button>
              <button disabled={!selectedParent} onClick={() => moveBy(1)}>↓</button>
              <button className="danger" onClick={removeSelected}>×</button>
            </div>}
          </div>
          <UiPropertyEditor element={selected} onUpdate={updateProps} onToggleFree={toggleFree} />
          {showPosition && <div className="ui-property-grid"><b>Position</b>
            <label>X<input type="number" value={selected.props?.x ?? 0} onChange={event => onChange(mapUiElement(normalized, selected.id, element => ({ ...element, props: { ...element.props, x: Number(event.target.value) } })))} /></label>
            <label>Y<input type="number" value={selected.props?.y ?? 0} onChange={event => onChange(mapUiElement(normalized, selected.id, element => ({ ...element, props: { ...element.props, y: Number(event.target.value) } })))} /></label>
          </div>}
          <StyleEditor element={selected} theme={theme} onSetStyle={setStyle} />
          {bindingTarget && <label className="ui-binding-field">Runtime binding for {bindingTarget}<input value={selected.bindings?.[bindingTarget] || ''} placeholder="e.g. variables.score" onChange={event => onChange(mapUiElement(normalized, selected.id, element => ({ ...element, bindings: { ...element.bindings, [bindingTarget]: event.target.value } })))} /></label>}
          {selected.type === 'Button' && <div className="ui-property-grid">
            <label>Click action<select value={selected.actions?.[0]?.action || 'submit'} onChange={event => onChange(mapUiElement(normalized, selected.id, element => ({ ...element, actions: [{ ...(element.actions?.[0] || { event: 'click' }), action: event.target.value }] })))}><option value="submit">submit</option><option value="next">next</option><option value="setVariable">setVariable</option></select></label>
            {selected.actions?.[0]?.action === 'setVariable' && <><label>Variable name<input value={selected.actions[0].name || ''} onChange={event => onChange(mapUiElement(normalized, selected.id, element => ({ ...element, actions: [{ ...element.actions[0], name: event.target.value }] })))} /></label><label>Value<input value={selected.actions[0].value ?? ''} onChange={event => onChange(mapUiElement(normalized, selected.id, element => ({ ...element, actions: [{ ...element.actions[0], value: event.target.value }] })))} /></label></>}
          </div>}
        </aside>
      </div>}

    {structureOpen && <div className="ui-tree">
      {elements.map(entry => {
        const { element, depth } = entry;
        const isDropBefore = dragOver?.where === 'before' && dragOver.parentId === entry.parentId && dragOver.index === entry.childIndex;
        const isDropAfter = dragOver?.where === 'after' && dragOver.parentId === entry.parentId && dragOver.index === entry.childIndex + 1;
        return <div key={element.id} className={`ui-row${isDropBefore ? ' drop-before' : ''}${isDropAfter ? ' drop-after' : ''}`}
          draggable={element.id !== normalized.root.id}
          onDragStart={event => {
            if (element.id === normalized.root.id) return;
            event.dataTransfer.setData('application/x-physioflow-ui', JSON.stringify({ action: 'move', elementId: element.id }));
            event.dataTransfer.effectAllowed = 'move';
            setSelectedId(element.id);
          }}
          onDragOver={event => {
            event.preventDefault();
            if (!CONTAINERS.has(element.type)) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const before = event.clientY < rect.top + rect.height / 2;
            if (entry.parentId === null) return;
            setDragOver({ parentId: entry.parentId, index: before ? entry.childIndex : entry.childIndex + 1, where: before ? 'before' : 'after' });
          }}
          onDrop={event => {
            event.preventDefault();
            const raw = event.dataTransfer.getData('application/x-physioflow-ui');
            setDragOver(null);
            if (!raw || !dragOver) return;
            try {
              const payload = JSON.parse(raw);
              if (payload.action === 'add' && payload.type) {
                const elementToAdd = createUiElement(payload.type, { props: defaults[payload.type], actions: payload.type === 'Button' ? [{ event: 'click', action: 'submit' }] : [] });
                onChange(insertUiElement(normalized, dragOver.parentId, dragOver.index, elementToAdd));
                setSelectedId(elementToAdd.id);
              } else if (payload.action === 'move' && payload.elementId) {
                onChange(moveUiElement(normalized, payload.elementId, dragOver.parentId, dragOver.index));
              }
            } catch { /* ignored */ }
          }}
          onDragLeave={() => setDragOver(null)}>
          <button className={`ui-tree-node${selectedId === element.id ? ' selected' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => setSelectedId(element.id)}>
            <span>{element.type}</span><small>{elementLabel(element)}</small>
          </button>
        </div>;
      })}
    </div>}

    <small className={validation.valid ? 'ui-valid' : 'ui-invalid'}>{validation.valid ? `${elements.length} elements · schema valid` : validation.errors[0]?.message}</small>
  </section>;
}


function ThemeEditor({ schema, theme, onChange }) {
  const updateToken = (key, value) => onChange({ ...schema, theme: { ...(schema.theme || {}), [key]: value } });
  const reset = () => { const next = { ...schema }; delete next.theme; onChange(next); };
  const applyPreset = name => onChange({ ...schema, theme: { ...(schema.theme || {}), ...THEME_PRESETS_V2[name] } });
  const colorInput = key => <label key={key} className="ui-theme-token"><span>{key}</span>
    <input type="color" value={normalizeColor(theme[key])} onChange={event => updateToken(key, event.target.value)} />
    <input value={theme[key] || ''} onChange={event => updateToken(key, event.target.value)} /></label>;
  const textInput = key => <label key={key} className="ui-theme-token"><span>{key}</span>
    <input value={theme[key] || ''} onChange={event => updateToken(key, event.target.value)} /></label>;
  return <details className="ui-theme-editor">
    <summary>Theme{schema.theme ? ' (custom)' : ' (defaults)'}</summary>
    <div className="ui-theme-presets">{Object.keys(THEME_PRESETS_V2).map(name => <button key={name} type="button" onClick={() => applyPreset(name)}>{name}</button>)}</div>
    <div className="ui-theme-group"><b>Colors</b>{COLOR_TOKENS.map(colorInput)}</div>
    <div className="ui-theme-group"><b>Fonts</b>{FONT_TOKENS.map(textInput)}</div>
    <div className="ui-theme-group"><b>Spacing</b>{SPACING_TOKENS.map(textInput)}</div>
    {schema.theme && <button onClick={reset}>Reset to defaults</button>}
  </details>;
}

function StyleEditor({ element, theme, onSetStyle }) {
  const style = element.style || {};
  const setKey = (key, value) => {
    const next = { ...style };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onSetStyle(next);
  };
  const activeKeys = UI_STYLE_KEYS.filter(key => key in style);
  const availableKeys = UI_STYLE_KEYS.filter(key => !(key in style));
  const tokenNames = Object.keys(theme);
  return <details className="ui-style-editor" open={activeKeys.length > 0}>
    <summary>Style ({activeKeys.length})</summary>
    {activeKeys.map(key => <StyleField key={key} propKey={key} value={style[key]} theme={theme} tokenNames={tokenNames} onChange={value => setKey(key, value)} />)}
    {availableKeys.length > 0 && <label className="ui-style-add">Add style<select value="" onChange={event => event.target.value && setKey(event.target.value, '')}><option value="">— choose —</option>{availableKeys.map(key => <option key={key} value={key}>{key}</option>)}</select></label>}
    <small>Dynamic bindings (variables.*) win over static style for color and background.</small>
  </details>;
}

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

function UiPropertyEditor({ element, onUpdate, onToggleFree }) {
  const props = element.props || {};
  if (element.type === 'Screen') return <div className="ui-property-grid">
    <label><input type="checkbox" checked={Boolean(props.free)} onChange={() => onToggleFree(element)} /> Free layout (drag anywhere)</label>
    <label>Max width<input type="number" value={props.maxWidth ?? 800} onChange={event => onUpdate({ maxWidth: Number(event.target.value) })} /></label>
    <label>Padding<input type="number" value={props.padding ?? 32} onChange={event => onUpdate({ padding: Number(event.target.value) })} /></label>
    <label>Background<input type="color" value={props.background || '#ffffff'} onChange={event => onUpdate({ background: event.target.value })} /></label>
    <label>Text color<input type="color" value={props.color || '#17211b'} onChange={event => onUpdate({ color: event.target.value })} /></label>
  </div>;
  if (element.type === 'Layout') return <div className="ui-property-grid"><label><input type="checkbox" checked={Boolean(props.free)} onChange={() => onToggleFree(element)} /> Free layout</label><label>Direction<select value={props.direction || 'column'} onChange={event => onUpdate({ direction: event.target.value })}><option>column</option><option>row</option></select></label><label>Gap<input type="number" value={props.gap ?? 16} onChange={event => onUpdate({ gap: Number(event.target.value) })} /></label></div>;
  if (element.type === 'Text') return <div className="ui-property-grid"><label>Text<textarea value={props.text || ''} onChange={event => onUpdate({ text: event.target.value })} /></label><label>Variant<select value={props.variant || 'body'} onChange={event => onUpdate({ variant: event.target.value })}><option>body</option><option>heading</option></select></label><label>Font size<input value={props.fontSize || ''} placeholder="e.g. 20px" onChange={event => onUpdate({ fontSize: event.target.value })} /></label></div>;
  if (element.type === 'Media') return <div className="ui-property-grid"><label>Media type<select value={props.mediaType || 'image'} onChange={event => onUpdate({ mediaType: event.target.value })}><option>image</option><option>audio</option><option>video</option></select></label><label>Source URL<input value={props.sourceUrl || ''} onChange={event => onUpdate({ sourceUrl: event.target.value })} /></label><label>Alt text<input value={props.alt || ''} onChange={event => onUpdate({ alt: event.target.value })} /></label></div>;
  if (element.type === 'Input') return <div className="ui-property-grid"><label>Response name<input value={props.name || ''} onChange={event => onUpdate({ name: event.target.value })} /></label><label>Label<input value={props.label || ''} onChange={event => onUpdate({ label: event.target.value })} /></label><label>Input type<select value={props.inputType || 'text'} onChange={event => onUpdate({ inputType: event.target.value })}><option>text</option><option>textarea</option><option>number</option><option>rating</option></select></label><label><input type="checkbox" checked={Boolean(props.required)} onChange={event => onUpdate({ required: event.target.checked })} /> Required</label>{props.inputType === 'rating' && <><label>Min<input type="number" value={props.min ?? 1} onChange={event => onUpdate({ min: Number(event.target.value) })} /></label><label>Max<input type="number" value={props.max ?? 7} onChange={event => onUpdate({ max: Number(event.target.value) })} /></label></>}</div>;
  if (element.type === 'Button') return <div className="ui-property-grid"><label>Label<input value={props.label || ''} onChange={event => onUpdate({ label: event.target.value })} /></label><label>Variant<select value={props.variant || 'primary'} onChange={event => onUpdate({ variant: event.target.value })}><option>primary</option><option>secondary</option></select></label></div>;
  if (element.type === 'Progress') return <div className="ui-property-grid"><label>Label<input value={props.label || ''} onChange={event => onUpdate({ label: event.target.value })} /></label><label>Value<input type="number" value={props.value ?? 0} onChange={event => onUpdate({ value: Number(event.target.value) })} /></label><label>Maximum<input type="number" value={props.max ?? 100} onChange={event => onUpdate({ max: Number(event.target.value) })} /></label></div>;
  if (element.type === 'Html') return <div className="ui-property-grid"><label>HTML fragment<textarea value={props.html || ''} rows={5} onChange={event => onUpdate({ html: event.target.value })} /></label></div>;
  return null;
}
