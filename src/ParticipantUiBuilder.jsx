import { useMemo, useState } from 'react';
import ParticipantRenderer from './ParticipantRenderer.jsx';
import {
  appendUiElement,
  createUiElement,
  mapUiElement,
  normalizeParticipantUi,
  participantUiTemplate,
  removeUiElement,
  validateParticipantUi,
} from './core/index.js';

const defaults = {
  Layout: { direction: 'column', gap: 16 },
  Text: { text: 'New text', variant: 'body' },
  Media: { mediaType: 'image', sourceUrl: '', alt: 'Stimulus' },
  Input: { name: 'response', inputType: 'text', label: 'Response', required: false },
  Button: { label: 'Continue', variant: 'primary' },
  Progress: { value: 0, max: 100, label: '' },
};

function flatten(root, depth = 0, result = []) {
  result.push({ element: root, depth });
  (root.children || []).forEach(child => flatten(child, depth + 1, result));
  return result;
}

export default function ParticipantUiBuilder({ schema, onChange }) {
  const normalized = useMemo(() => normalizeParticipantUi(schema), [schema]);
  const [selectedId, setSelectedId] = useState(normalized.root.id);
  const [preview, setPreview] = useState(false);
  const elements = flatten(normalized.root);
  const selected = elements.find(item => item.element.id === selectedId)?.element || normalized.root;
  const validation = validateParticipantUi(normalized);
  const updateElement = updater => onChange(mapUiElement(normalized, selected.id, updater));
  const updateProps = patch => onChange(mapUiElement(normalized, selected.id, element => ({ ...element, props: { ...element.props, ...patch } })));
  const bindingTarget = { Text: 'text', Media: 'sourceUrl', Progress: 'value' }[selected.type];
  const add = type => {
    const parent = ['Screen', 'Layout'].includes(selected.type) ? selected : normalized.root;
    const element = createUiElement(type, { props: defaults[type], actions: type === 'Button' ? [{ event: 'click', action: 'submit' }] : [] });
    onChange(appendUiElement(normalized, parent.id, element));
    setSelectedId(element.id);
  };

  return <section className="participant-ui-builder">
    <div className="ui-builder-head"><b>Participant interface</b><button onClick={() => setPreview(value => !value)}>{preview ? 'Edit tree' : 'Preview'}</button></div>
    <div className="ui-template-row">
      {['instruction', 'media', 'form'].map(kind => <button key={kind} onClick={() => { const next = participantUiTemplate(kind); onChange(next); setSelectedId(next.root.id); }}>{kind}</button>)}
    </div>
    {preview ? <div className="ui-builder-preview"><ParticipantRenderer schema={normalized} context={{ progress: { percent: 40 } }} preview /></div> : <>
      <div className="ui-tree">
        {elements.map(({ element, depth }) => <button key={element.id} className={selected.id === element.id ? 'selected' : ''} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => setSelectedId(element.id)}><span>{element.type}</span><small>{element.props?.label || element.props?.text || element.props?.name || ''}</small></button>)}
      </div>
      <div className="ui-add-row">{Object.keys(defaults).map(type => <button key={type} onClick={() => add(type)}>＋ {type}</button>)}</div>
      <UiPropertyEditor element={selected} onUpdate={updateProps} />
      {bindingTarget && <label className="ui-binding-field">Runtime binding for {bindingTarget}<input value={selected.bindings?.[bindingTarget] || ''} placeholder="e.g. variables.score" onChange={event => updateElement(element => ({ ...element, bindings: { ...element.bindings, [bindingTarget]: event.target.value } }))} /></label>}
      {selected.type === 'Button' && <div className="ui-property-grid">
        <label>Click action<select value={selected.actions?.[0]?.action || 'submit'} onChange={event => updateElement(element => ({ ...element, actions: [{ ...(element.actions?.[0] || { event: 'click' }), action: event.target.value }] }))}><option value="submit">submit</option><option value="next">next</option><option value="setVariable">setVariable</option></select></label>
        {selected.actions?.[0]?.action === 'setVariable' && <><label>Variable name<input value={selected.actions[0].name || ''} onChange={event => updateElement(element => ({ ...element, actions: [{ ...element.actions[0], name: event.target.value }] }))} /></label><label>Value<input value={selected.actions[0].value ?? ''} onChange={event => updateElement(element => ({ ...element, actions: [{ ...element.actions[0], value: event.target.value }] }))} /></label></>}
      </div>}
      {selected.id !== normalized.root.id && <button className="danger" onClick={() => { onChange(removeUiElement(normalized, selected.id)); setSelectedId(normalized.root.id); }}>Remove UI element</button>}
    </>}
    <small className={validation.valid ? 'ui-valid' : 'ui-invalid'}>{validation.valid ? `${elements.length} elements · schema valid` : validation.errors[0]?.message}</small>
  </section>;
}

function UiPropertyEditor({ element, onUpdate }) {
  const props = element.props || {};
  if (element.type === 'Screen') return <div className="ui-property-grid">
    <label>Max width<input type="number" value={props.maxWidth ?? 800} onChange={event => onUpdate({ maxWidth: Number(event.target.value) })} /></label>
    <label>Padding<input type="number" value={props.padding ?? 32} onChange={event => onUpdate({ padding: Number(event.target.value) })} /></label>
    <label>Background<input type="color" value={props.background || '#ffffff'} onChange={event => onUpdate({ background: event.target.value })} /></label>
    <label>Text color<input type="color" value={props.color || '#17211b'} onChange={event => onUpdate({ color: event.target.value })} /></label>
  </div>;
  if (element.type === 'Layout') return <div className="ui-property-grid"><label>Direction<select value={props.direction || 'column'} onChange={event => onUpdate({ direction: event.target.value })}><option>column</option><option>row</option></select></label><label>Gap<input type="number" value={props.gap ?? 16} onChange={event => onUpdate({ gap: Number(event.target.value) })} /></label></div>;
  if (element.type === 'Text') return <div className="ui-property-grid"><label>Text<textarea value={props.text || ''} onChange={event => onUpdate({ text: event.target.value })} /></label><label>Variant<select value={props.variant || 'body'} onChange={event => onUpdate({ variant: event.target.value })}><option>body</option><option>heading</option></select></label><label>Font size<input value={props.fontSize || ''} placeholder="e.g. 20px" onChange={event => onUpdate({ fontSize: event.target.value })} /></label></div>;
  if (element.type === 'Media') return <div className="ui-property-grid"><label>Media type<select value={props.mediaType || 'image'} onChange={event => onUpdate({ mediaType: event.target.value })}><option>image</option><option>audio</option><option>video</option></select></label><label>Source URL<input value={props.sourceUrl || ''} onChange={event => onUpdate({ sourceUrl: event.target.value })} /></label><label>Alt text<input value={props.alt || ''} onChange={event => onUpdate({ alt: event.target.value })} /></label></div>;
  if (element.type === 'Input') return <div className="ui-property-grid"><label>Response name<input value={props.name || ''} onChange={event => onUpdate({ name: event.target.value })} /></label><label>Label<input value={props.label || ''} onChange={event => onUpdate({ label: event.target.value })} /></label><label>Input type<select value={props.inputType || 'text'} onChange={event => onUpdate({ inputType: event.target.value })}><option>text</option><option>textarea</option><option>number</option><option>rating</option></select></label><label><input type="checkbox" checked={Boolean(props.required)} onChange={event => onUpdate({ required: event.target.checked })} /> Required</label>{props.inputType === 'rating' && <><label>Min<input type="number" value={props.min ?? 1} onChange={event => onUpdate({ min: Number(event.target.value) })} /></label><label>Max<input type="number" value={props.max ?? 7} onChange={event => onUpdate({ max: Number(event.target.value) })} /></label></>}</div>;
  if (element.type === 'Button') return <div className="ui-property-grid"><label>Label<input value={props.label || ''} onChange={event => onUpdate({ label: event.target.value })} /></label><label>Variant<select value={props.variant || 'primary'} onChange={event => onUpdate({ variant: event.target.value })}><option>primary</option><option>secondary</option></select></label></div>;
  if (element.type === 'Progress') return <div className="ui-property-grid"><label>Label<input value={props.label || ''} onChange={event => onUpdate({ label: event.target.value })} /></label><label>Value<input type="number" value={props.value ?? 0} onChange={event => onUpdate({ value: Number(event.target.value) })} /></label><label>Maximum<input type="number" value={props.max ?? 100} onChange={event => onUpdate({ max: Number(event.target.value) })} /></label></div>;
  return null;
}
