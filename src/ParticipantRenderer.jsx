import { useMemo, useState } from 'react';
import { normalizeParticipantUi, resolveUiBinding, validateParticipantUi } from './core/index.js';

function boundProp(element, name, context) {
  const binding = element.bindings?.[name];
  return binding ? resolveUiBinding(binding, context) : element.props?.[name];
}

export default function ParticipantRenderer({ schema, context = {}, onSubmit, disabled = false, preview = false }) {
  const normalized = useMemo(() => normalizeParticipantUi(schema), [schema]);
  const validation = useMemo(() => validateParticipantUi(normalized), [normalized]);
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const inputs = [];
  const collect = element => { if (element.type === 'Input') inputs.push(element); (element.children || []).forEach(collect); };
  collect(normalized.root);

  const submit = () => {
    if (disabled || preview) return;
    const nextErrors = Object.fromEntries(inputs.filter(input => input.props?.required && (values[input.props.name] === undefined || values[input.props.name] === '')).map(input => [input.props.name, 'Required']));
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    onSubmit?.({ values: structuredClone(values), outputs: structuredClone(values), variables: structuredClone(values) });
  };

  if (!validation.valid) return <div className="participant-ui-error">Participant UI is invalid: {validation.errors.map(error => error.message).join(' · ')}</div>;

  const render = element => {
    const props = element.props || {};
    const style = {
      color: boundProp(element, 'color', context),
      background: boundProp(element, 'background', context),
      fontSize: props.fontSize,
      textAlign: props.align,
    };
    if (element.type === 'Screen') return <div key={element.id} className="participant-ui-screen" style={{ ...style, maxWidth: props.maxWidth, padding: props.padding }}>{element.children.map(render)}</div>;
    if (element.type === 'Layout') return <div key={element.id} className={`participant-ui-layout ${props.direction || 'column'}`} style={{ ...style, gap: props.gap ?? 16, justifyContent: props.justify, alignItems: props.alignItems }}>{element.children.map(render)}</div>;
    if (element.type === 'Text') {
      const text = boundProp(element, 'text', context) ?? '';
      return props.variant === 'heading' ? <h1 key={element.id} style={style}>{text}</h1> : <p key={element.id} style={style}>{text}</p>;
    }
    if (element.type === 'Media') {
      const source = boundProp(element, 'sourceUrl', context) || '';
      if (!source) return <div key={element.id} className="participant-ui-media missing">Media source not configured</div>;
      if (props.mediaType === 'video') return <video key={element.id} className="participant-ui-media" src={source} controls={props.controls !== false} autoPlay={props.autoPlay} />;
      if (props.mediaType === 'audio') return <audio key={element.id} className="participant-ui-media" src={source} controls autoPlay={props.autoPlay} />;
      return <img key={element.id} className="participant-ui-media" src={source} alt={props.alt || ''} style={{ objectFit: props.fit || 'contain' }} />;
    }
    if (element.type === 'Progress') {
      const value = Number(boundProp(element, 'value', context) ?? 0), max = Number(boundProp(element, 'max', context) ?? 100);
      return <div key={element.id} className="participant-ui-progress">{props.label && <span>{props.label}</span>}<progress value={value} max={max} /></div>;
    }
    if (element.type === 'Input') {
      const name = props.name;
      const common = { disabled, value: values[name] ?? '', onChange: event => setValues(current => ({ ...current, [name]: props.inputType === 'rating' || props.inputType === 'number' ? Number(event.target.value) : event.target.value })) };
      return <label key={element.id} className="participant-ui-input"><span>{props.label || name}{props.required && ' *'}</span>
        {props.inputType === 'rating' ? <div className="participant-rating">{Array.from({ length: Number(props.max || 7) - Number(props.min || 1) + 1 }, (_, index) => Number(props.min || 1) + index).map(value => <button type="button" className={values[name] === value ? 'selected' : ''} disabled={disabled} key={value} onClick={() => setValues(current => ({ ...current, [name]: value }))}>{value}</button>)}</div>
          : props.inputType === 'textarea' ? <textarea {...common} placeholder={props.placeholder || ''} />
            : <input {...common} type={props.inputType || 'text'} placeholder={props.placeholder || ''} min={props.min} max={props.max} />}
        {errors[name] && <small>{errors[name]}</small>}
      </label>;
    }
    if (element.type === 'Button') return <button key={element.id} type="button" disabled={disabled || preview} className={`participant-ui-button ${props.variant || 'primary'}`} onClick={() => (element.actions || []).forEach(action => action.action === 'submit' && submit())}>{props.label || 'Continue'}</button>;
    return null;
  };

  return <div className="participant-ui-renderer">{render(normalized.root)}</div>;
}
