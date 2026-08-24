import { useMemo } from 'react';
import { normalizeParticipantUi, resolveTheme, resolveUiBinding, resolveUiStyle, validateParticipantUi } from './core/index.js';
import ParticipantMedia from './ParticipantMedia.jsx';

// PPT-style WYSIWYG canvas for the participant-interface editor.
// Renders the real participant UI and lets the designer click to select an element,
// drag new elements in from the library, and drop to reorder. Mirrors
// ParticipantRenderer's layout closely for direct manipulation. The builder's
// Preview mode remains the authoritative runtime rendering.

function boundProp(element, name, context) {
  const binding = element.bindings?.[name];
  return binding ? resolveUiBinding(binding, context) : element.props?.[name];
}


export default function ParticipantUiCanvas({ schema, selectedId, onSelect, onDropElement, onMoveElement, context = {} }) {
  const normalized = useMemo(() => normalizeParticipantUi(schema), [schema]);
  const theme = useMemo(() => resolveTheme(normalized), [normalized]);
  const validation = useMemo(() => validateParticipantUi(normalized), [normalized]);
  if (!validation.valid) return <div className="participant-ui-error">Participant UI is invalid: {validation.errors.map(error => error.message).join(' · ')}</div>;

  const selectedClass = element => (selectedId === element.id ? ' selected' : '');

  const dropProps = element => ({
    onDragOver: event => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; },
    onDrop: event => {
      event.preventDefault();
      event.stopPropagation();
      const raw = event.dataTransfer.getData('application/x-physioflow-ui');
      if (!raw) return;
      try {
        const payload = JSON.parse(raw);
        // Free-layout containers position the dropped element at the drop point.
        const free = Boolean(element.props?.free);
        const rect = free ? event.currentTarget.getBoundingClientRect() : null;
        const x = rect ? Math.max(0, Math.round(event.clientX - rect.left)) : undefined;
        const y = rect ? Math.max(0, Math.round(event.clientY - rect.top)) : undefined;
        if (payload.action === 'add' && payload.type) onDropElement(payload.type, element.id, x, y);
        if (payload.action === 'move' && payload.elementId) onMoveElement(payload.elementId, element.id, x, y);
      } catch { /* ignore malformed payload */ }
    },
  });

  const clickProps = element => ({
    onClick: event => { event.stopPropagation(); onSelect(element.id); },
  });

  const dragProps = element => element.type === 'Screen' ? {} : ({
    draggable: true,
    onDragStart: event => {
      event.stopPropagation();
      event.dataTransfer.setData('application/x-physioflow-ui', JSON.stringify({ action: 'move', elementId: element.id }));
      event.dataTransfer.effectAllowed = 'move';
      onSelect(element.id);
    },
  });

  const render = element => {
    const props = element.props || {};
    const style = resolveUiStyle(element, theme, context);
    const positioned = (props.x != null && props.y != null) ? { position: 'absolute', left: props.x, top: props.y } : {};
    const freeClass = props.free ? ' ui-free' : '';
    if (element.type === 'Screen') return <div key={element.id} data-ui-id={element.id} className={`participant-ui-screen ui-slot${freeClass}${selectedClass(element)}`} style={{ ...style, ...(props.free ? { position: 'relative' } : {}) }} onClick={clickProps(element).onClick} {...dropProps(element)}>{element.children.map(render)}</div>;
    if (element.type === 'Layout') return <div key={element.id} data-ui-id={element.id} className={`participant-ui-layout ${props.direction || 'column'} ui-slot${freeClass}${selectedClass(element)}`} style={{ ...style, gap: style.gap ?? 16, ...(props.free ? { position: 'relative' } : {}) }} {...clickProps(element)} {...dragProps(element)} {...dropProps(element)}>{element.children.map(render)}</div>;
    if (element.type === 'Text') {
      const text = boundProp(element, 'text', context) ?? '';
      return props.variant === 'heading'
        ? <h1 key={element.id} data-ui-id={element.id} className={`ui-slot${selectedClass(element)}`} style={{ ...style, ...positioned }} {...clickProps(element)} {...dragProps(element)}>{text}</h1>
        : <p key={element.id} data-ui-id={element.id} className={`ui-slot${selectedClass(element)}`} style={{ ...style, ...positioned }} {...clickProps(element)} {...dragProps(element)}>{text}</p>;
    }
    if (element.type === 'Media') {
      const source = boundProp(element, 'sourceUrl', context) || '';
      return <span key={element.id} data-ui-id={element.id} className={`ui-media-wrap ui-slot${selectedClass(element)}`} style={positioned} {...clickProps(element)} {...dragProps(element)}><ParticipantMedia source={source} mediaType={props.mediaType || 'image'} controls={props.controls !== false} alt={props.alt || ''} fit={props.fit || 'contain'} /></span>;
    }
    if (element.type === 'Progress') {
      const value = Number(boundProp(element, 'value', context) ?? 0), max = Number(boundProp(element, 'max', context) ?? 100);
      return <div key={element.id} data-ui-id={element.id} className={`participant-ui-progress ui-slot${selectedClass(element)}`} style={{ ...style, ...positioned }} {...clickProps(element)} {...dragProps(element)}>{props.label && <span>{props.label}</span>}<progress value={value} max={max} /></div>;
    }
    if (element.type === 'Html') {
      const html = boundProp(element, 'html', context) || '';
      return <iframe key={element.id} data-ui-id={element.id} className={`participant-ui-html ui-slot${selectedClass(element)}`} title="Custom HTML" srcDoc={html || '<div></div>'} style={positioned} sandbox="allow-same-origin" {...clickProps(element)} {...dragProps(element)} />;
    }
    if (element.type === 'Input') {
      const name = props.name;
      return <label key={element.id} data-ui-id={element.id} className={`participant-ui-input ui-slot${selectedClass(element)}`} style={{ ...style, ...positioned }} {...clickProps(element)} {...dragProps(element)}><span>{props.label || name}{props.required && ' *'}</span>
        {props.inputType === 'rating'
          ? <div className="participant-rating">{Array.from({ length: Math.max(0, Number(props.max || 7) - Number(props.min || 1) + 1) }, (_, index) => Number(props.min || 1) + index).map(value => <span key={value} className="ui-rating-chip">{value}</span>)}</div>
          : props.inputType === 'textarea' ? <div className="ui-input-ghost" />
            : <div className="ui-input-ghost" />}
      </label>;
    }
    if (element.type === 'Button') return <button key={element.id} data-ui-id={element.id} type="button" className={`participant-ui-button ${props.variant || 'primary'} ui-slot${selectedClass(element)}`} style={{ ...style, ...positioned }} {...clickProps(element)} {...dragProps(element)}>{props.label || 'Continue'}</button>;
    return null;
  };

  return <div className="ui-canvas-root">{render(normalized.root)}</div>;
}
