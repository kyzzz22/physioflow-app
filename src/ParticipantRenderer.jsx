import { useMemo, useState } from 'react';
import { normalizeParticipantUi, resolveTheme, resolveUiBinding, resolveUiStyle, validateParticipantUi } from './core/index.js';
import ParticipantMedia from './ParticipantMedia.jsx';

function boundProp(element, name, context) {
  const binding = element.bindings?.[name];
  return binding ? resolveUiBinding(binding, context) : element.props?.[name];
}

export default function ParticipantRenderer({ schema, context = {}, onSubmit, onValueChange, onAction, onMediaEvent, disabled = false, preview = false }) {
  const normalized = useMemo(() => normalizeParticipantUi(schema), [schema]);
  const validation = useMemo(() => validateParticipantUi(normalized), [normalized]);
  const theme = useMemo(() => resolveTheme(normalized), [normalized]);
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const inputs = [];
  const collect = element => { if (element.type === 'Input') inputs.push(element); (element.children || []).forEach(collect); };
  collect(normalized.root);

  const submit = (submittedValues = values) => {
    if (disabled || preview) return;
    const nextErrors = Object.fromEntries(inputs.filter(input => input.props?.required && (submittedValues[input.props.name] === undefined || submittedValues[input.props.name] === '')).map(input => [input.props.name, 'Required']));
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    onSubmit?.({ values: structuredClone(submittedValues), outputs: structuredClone(submittedValues), variables: structuredClone(submittedValues) });
  };

  const changeValue = (name, value, element) => {
    setValues(current => ({ ...current, [name]: value }));
    onValueChange?.({ name, value, elementId: element.id, inputType: element.props?.inputType || 'text' });
  };

  const executeActions = actions => {
    let nextValues = { ...values };
    let shouldSubmit = false;
    for (const action of actions || []) {
      if (action.action === 'setVariable') nextValues[action.name] = action.value;
      if (action.action === 'submit' || action.action === 'next') shouldSubmit = true;
      onAction?.(structuredClone(action));
    }
    setValues(nextValues);
    if (shouldSubmit) submit(nextValues);
  };

  if (!validation.valid) return <div className="participant-ui-error">Participant UI is invalid: {validation.errors.map(error => error.message).join(' · ')}</div>;

  const render = element => {
    const props = element.props || {};
    const style = resolveUiStyle(element, theme, context);
    // Free-layout positioning: elements carrying x/y coordinates are absolutely
    // positioned inside a container that opted into free layout.
    const positioned = (props.x != null && props.y != null) ? { position: 'absolute', left: props.x, top: props.y } : {};
    if (element.type === 'Screen') return <div key={element.id} className="participant-ui-screen" style={{ ...style, ...(props.free ? { position: 'relative' } : {}) }}>{element.children.map(render)}</div>;
    if (element.type === 'Layout') return <div key={element.id} className={`participant-ui-layout ${props.direction || 'column'}`} style={{ ...style, gap: style.gap ?? 16, ...(props.free ? { position: 'relative' } : {}) }}>{element.children.map(render)}</div>;
    if (element.type === 'Text') {
      const text = boundProp(element, 'text', context) ?? '';
      const className = props.pulse ? 'participant-pulse' : undefined;
      return props.variant === 'heading' ? <h1 key={element.id} className={className} style={{ ...style, ...positioned }}>{text}</h1> : <p key={element.id} className={className} style={{ ...style, ...positioned }}>{text}</p>;
    }
    if (element.type === 'Media') {
      const source = boundProp(element, 'sourceUrl', context) || '';
      return <ParticipantMedia key={element.id} source={source} mediaType={props.mediaType || 'image'} controls={props.controls !== false} autoPlay={props.autoPlay} alt={props.alt || ''} fit={props.fit || 'contain'} style={positioned} onMediaEvent={(eventType, payload) => onMediaEvent?.(eventType, { elementId: element.id, ...payload })} />;
    }
    if (element.type === 'Progress') {
      const value = Number(boundProp(element, 'value', context) ?? 0), max = Number(boundProp(element, 'max', context) ?? 100);
      return <div key={element.id} className="participant-ui-progress" style={positioned}>{props.label && <span>{props.label}</span>}<progress value={value} max={max} /></div>;
    }
    if (element.type === 'Html') {
      const html = boundProp(element, 'html', context) || '';
      if (!html) return <div key={element.id} className="participant-ui-html missing" style={positioned}>No HTML content</div>;
      return <iframe key={element.id} className="participant-ui-html" title="Custom HTML" srcDoc={html} style={positioned} sandbox="allow-same-origin" />;
    }
    if (element.type === 'Input') {
      const name = props.name;
      const common = { disabled, value: values[name] ?? '', onChange: event => changeValue(name, props.inputType === 'rating' || props.inputType === 'number' ? Number(event.target.value) : event.target.value, element) };
      return <label key={element.id} className="participant-ui-input" style={positioned}><span>{props.label || name}{props.required && ' *'}</span>
        {props.inputType === 'checkbox' ? <span className="participant-checkbox"><input type="checkbox" checked={Boolean(values[name])} disabled={disabled} onChange={event => changeValue(name, event.target.checked ? 'yes' : '', element)} /></span>
          : props.inputType === 'rating' ? <div className="participant-rating">{Array.from({ length: Number(props.max || 7) - Number(props.min || 1) + 1 }, (_, index) => Number(props.min || 1) + index).map(value => <button type="button" className={values[name] === value ? 'selected' : ''} disabled={disabled} key={value} onClick={() => changeValue(name, value, element)}>{value}</button>)}</div>
            : props.inputType === 'textarea' ? <textarea {...common} placeholder={props.placeholder || ''} />
              : <input {...common} type={props.inputType || 'text'} placeholder={props.placeholder || ''} min={props.min} max={props.max} />}
        {errors[name] && <small>{errors[name]}</small>}
      </label>;
    }
    if (element.type === 'Button') return <button key={element.id} type="button" disabled={disabled || preview} className={`participant-ui-button ${props.variant || 'primary'}`} style={positioned} onClick={() => executeActions(element.actions)}>{props.label || 'Continue'}</button>;
    return null;
  };

  return <div className="participant-ui-renderer">{render(normalized.root)}</div>;
}
