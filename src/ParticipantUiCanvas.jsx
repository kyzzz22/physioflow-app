import { useMemo, useRef, useState } from 'react';
import { normalizeParticipantUi, resolveTheme, resolveUiBinding, resolveUiStyle, validateParticipantUi } from './core/index.js';
import ParticipantMedia from './ParticipantMedia.jsx';

// PPT-style WYSIWYG canvas for the participant-interface editor.
// Renders the real participant UI and lets the designer click to select an element
// and drag it freely in free-layout containers. Library elements are dragged in via
// HTML5 drag-and-drop; free-layout repositioning uses pointer events (more reliable
// than native drag in every browser). Preview mode remains the authoritative runtime
// rendering.

function boundProp(element, name, context) {
  const binding = element.bindings?.[name];
  return binding ? resolveUiBinding(binding, context) : element.props?.[name];
}

function parentElementOf(root, elementId) {
  for (const child of root.children || []) {
    if (child.id === elementId) return root;
    const found = parentElementOf(child, elementId);
    if (found) return found;
  }
  return null;
}

export default function ParticipantUiCanvas({ schema, selectedId, onSelect, onDropElement, onMoveElement, context = {} }) {
  const normalized = useMemo(() => normalizeParticipantUi(schema), [schema]);
  const theme = useMemo(() => resolveTheme(normalized), [normalized]);
  const validation = useMemo(() => validateParticipantUi(normalized), [normalized]);
  const onMoveRef = useRef(onMoveElement);
  onMoveRef.current = onMoveElement;
  const dragStartRef = useRef(null);
  const [livePos, setLivePos] = useState(null); // { elementId, x, y } during an active drag
  if (!validation.valid) return <div className="participant-ui-error">Participant UI is invalid: {validation.errors.map(error => error.message).join(' · ')}</div>;

  const selectedClass = element => (selectedId === element.id ? ' selected' : '');

  const pointerMove = event => {
    const start = dragStartRef.current;
    if (!start) return;
    const dx = event.clientX - start.startClientX;
    const dy = event.clientY - start.startClientY;
    if (!start.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    start.moved = true;
    start.x = Math.max(0, start.startX + dx);
    start.y = Math.max(0, start.startY + dy);
    setLivePos({ elementId: start.elementId, x: start.x, y: start.y });
  };

  const pointerUp = () => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    window.removeEventListener('mousemove', pointerMove);
    window.removeEventListener('mouseup', pointerUp);
    if (start?.moved) onMoveRef.current(start.elementId, start.containerId, Math.round(start.x), Math.round(start.y));
    setLivePos(null);
  };

  // Free-layout repositioning via pointer events.
  const beginPointerDrag = (event, element) => {
    if (element.type === 'Screen') return;
    const parent = parentElementOf(normalized.root, element.id);
    if (!parent?.props?.free) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(element.id);
    dragStartRef.current = {
      elementId: element.id,
      containerId: parent.id,
      startX: element.props?.x ?? 0,
      startY: element.props?.y ?? 0,
      startClientX: event.clientX,
      startClientY: event.clientY,
      x: element.props?.x ?? 0,
      y: element.props?.y ?? 0,
      moved: false,
    };
    setLivePos({ elementId: element.id, x: element.props?.x ?? 0, y: element.props?.y ?? 0 });
    window.addEventListener('mousemove', pointerMove);
    window.addEventListener('mouseup', pointerUp);
  };

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
      } catch { /* ignore malformed payload */ }
    },
  });

  const clickProps = element => ({
    onClick: event => { event.stopPropagation(); onSelect(element.id); },
  });

  const render = element => {
    const props = element.props || {};
    const style = resolveUiStyle(element, theme, context);
    // During an active drag, show the live position instead of the committed one.
    const live = livePos?.elementId === element.id;
    const x = live ? livePos.x : props.x;
    const y = live ? livePos.y : props.y;
    const positioned = (x != null && y != null) ? { position: 'absolute', left: x, top: y } : {};
    const freeClass = props.free ? ' ui-free' : '';
    if (element.type === 'Screen') return <div key={element.id} data-ui-id={element.id} className={`participant-ui-screen ui-slot${freeClass}${selectedClass(element)}`} style={{ ...style, ...(props.free ? { position: 'relative', minHeight: 'min(72vh, 560px)' } : {}) }} onClick={clickProps(element).onClick} {...dropProps(element)}>{props.free && <span className="ui-free-hint">FREE · drag elements anywhere</span>}{element.children.map(render)}</div>;
    if (element.type === 'Layout') return <div key={element.id} data-ui-id={element.id} className={`participant-ui-layout ${props.direction || 'column'} ui-slot${freeClass}${selectedClass(element)}`} style={{ ...style, gap: style.gap ?? 16, ...(props.free ? { position: 'relative', minHeight: 'min(72vh, 560px)' } : {}) }} onMouseDown={event => beginPointerDrag(event, element)} {...clickProps(element)} {...dropProps(element)}>{props.free && <span className="ui-free-hint">FREE · drag anywhere</span>}{element.children.map(render)}</div>;
    if (element.type === 'Text') {
      const text = boundProp(element, 'text', context) ?? '';
      return props.variant === 'heading'
        ? <h1 key={element.id} data-ui-id={element.id} className={`ui-slot${selectedClass(element)}`} style={{ ...style, ...positioned }} onMouseDown={event => beginPointerDrag(event, element)} {...clickProps(element)}>{text}</h1>
        : <p key={element.id} data-ui-id={element.id} className={`ui-slot${selectedClass(element)}`} style={{ ...style, ...positioned }} onMouseDown={event => beginPointerDrag(event, element)} {...clickProps(element)}>{text}</p>;
    }
    if (element.type === 'Media') {
      const source = boundProp(element, 'sourceUrl', context) || '';
      return <span key={element.id} data-ui-id={element.id} className={`ui-media-wrap ui-slot${selectedClass(element)}`} style={positioned} onMouseDown={event => beginPointerDrag(event, element)} {...clickProps(element)}><ParticipantMedia source={source} mediaType={props.mediaType || 'image'} controls={props.controls !== false} alt={props.alt || ''} fit={props.fit || 'contain'} /></span>;
    }
    if (element.type === 'Progress') {
      const value = Number(boundProp(element, 'value', context) ?? 0), max = Number(boundProp(element, 'max', context) ?? 100);
      return <div key={element.id} data-ui-id={element.id} className={`participant-ui-progress ui-slot${selectedClass(element)}`} style={{ ...style, ...positioned }} onMouseDown={event => beginPointerDrag(event, element)} {...clickProps(element)}>{props.label && <span>{props.label}</span>}<progress value={value} max={max} /></div>;
    }
    if (element.type === 'Html') {
      const html = boundProp(element, 'html', context) || '';
      return <iframe key={element.id} data-ui-id={element.id} className={`participant-ui-html ui-slot${selectedClass(element)}`} title="Custom HTML" srcDoc={html || '<div></div>'} style={positioned} onMouseDown={event => beginPointerDrag(event, element)} {...clickProps(element)} />;
    }
    if (element.type === 'Input') {
      const name = props.name;
      return <label key={element.id} data-ui-id={element.id} className={`participant-ui-input ui-slot${selectedClass(element)}`} style={{ ...style, ...positioned }} onMouseDown={event => beginPointerDrag(event, element)} {...clickProps(element)}><span>{props.label || name}{props.required && ' *'}</span>
        {props.inputType === 'rating'
          ? <div className="participant-rating">{Array.from({ length: Math.max(0, Number(props.max || 7) - Number(props.min || 1) + 1) }, (_, index) => Number(props.min || 1) + index).map(value => <span key={value} className="ui-rating-chip">{value}</span>)}</div>
          : props.inputType === 'textarea' ? <div className="ui-input-ghost" />
            : <div className="ui-input-ghost" />}
      </label>;
    }
    if (element.type === 'Button') return <button key={element.id} data-ui-id={element.id} type="button" className={`participant-ui-button ${props.variant || 'primary'} ui-slot${selectedClass(element)}`} style={{ ...style, ...positioned }} onMouseDown={event => beginPointerDrag(event, element)} {...clickProps(element)}>{props.label || 'Continue'}</button>;
    return null;
  };

  return <div className="ui-canvas-root">{render(normalized.root)}</div>;
}
