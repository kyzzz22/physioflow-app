import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeParticipantUi, resolveTheme, resolveUiBinding, resolveUiStyle, validateParticipantUi } from './core/index.js';
import ParticipantMedia from './ParticipantMedia.jsx';

// PPT-style WYSIWYG canvas for the participant-interface editor.
// Renders the real participant UI and lets the designer click to select an element
// (Shift-click to multi-select) and drag it freely in free-layout containers.
// Library elements are dragged in via HTML5 drag-and-drop; free-layout
// repositioning uses pointer events (more reliable than native drag).
//
// Selected elements get a floating action bar, a resize handle, double-click
// inline text editing and a right-click context menu. Dragging snaps to an 8px
// grid (when enabled) and shows alignment guides against sibling elements.

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

const SNAP = 8;
const GUIDE_THRESHOLD = 6;

// Alignment/distribution toolbar icon set (stroke-based, consistent with ui-multi-bar).
const ALIGN_ICONS = {
  left: 'M4 6h10M4 12h14M4 18h8',
  centerX: 'M7 6h8M2 12h16M6 18h9',
  right: 'M8 6h10M4 12h14M10 18h8',
  top: 'M6 4v10M12 4v14M18 4v8',
  centerY: 'M6 6v8M12 2v16M18 7v6',
  bottom: 'M6 8v10M12 4v14M18 9v8',
  distributeX: 'M5 7v10M12 7v10M19 7v10M5 12h14',
  distributeY: 'M7 5h10M7 12h10M7 19h10M12 5v14',
};
const ALIGN_TITLES = {
  left: 'Align left', centerX: 'Align centers (horizontal)', right: 'Align right',
  top: 'Align top', centerY: 'Align middles (vertical)', bottom: 'Align bottom',
  distributeX: 'Distribute horizontally', distributeY: 'Distribute vertically',
};
function AlignIcon({ name }) {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d={ALIGN_ICONS[name]} /></svg>;
}

export default function ParticipantUiCanvas({
  schema, selectedId, selectedIds, onSelect, onDropElement, onMoveElement, onMoveElements,
  onRemoveElement, onDuplicateElement, onMoveStep, onResizeElement, onUpdateText, onUpdateProp,
  onContextMenu, onRemoveSelected, onDuplicateSelected, onAlignSelected, zoom = 1, snapEnabled = true, context = {},
}) {
  const normalized = useMemo(() => normalizeParticipantUi(schema), [schema]);
  const theme = useMemo(() => resolveTheme(normalized), [normalized]);
  const validation = useMemo(() => validateParticipantUi(normalized), [normalized]);
  const onMoveRef = useRef(onMoveElement);
  onMoveRef.current = onMoveElement;
  const onResizeRef = useRef(onResizeElement);
  onResizeRef.current = onResizeElement;
  const onRemoveRef = useRef(onRemoveElement);
  onRemoveRef.current = onRemoveElement;
  const onDuplicateRef = useRef(onDuplicateElement);
  onDuplicateRef.current = onDuplicateElement;
  const onMoveStepRef = useRef(onMoveStep);
  onMoveStepRef.current = onMoveStep;
  const onMoveElementsRef = useRef(onMoveElements);
  onMoveElementsRef.current = onMoveElements;
  const onUpdateTextRef = useRef(onUpdateText);
  onUpdateTextRef.current = onUpdateText;
  const onUpdatePropRef = useRef(onUpdateProp);
  onUpdatePropRef.current = onUpdateProp;
  const onRemoveSelectedRef = useRef(onRemoveSelected);
  onRemoveSelectedRef.current = onRemoveSelected;
  const onDuplicateSelectedRef = useRef(onDuplicateSelected);
  onDuplicateSelectedRef.current = onDuplicateSelected;
  const onAlignSelectedRef = useRef(onAlignSelected);
  onAlignSelectedRef.current = onAlignSelected;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const snapRef = useRef(snapEnabled);
  snapRef.current = snapEnabled;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const nodeRefs = useRef(new Map());
  const dragStartRef = useRef(null);
  const resizeStartRef = useRef(null);
  const [livePos, setLivePos] = useState(null); // { elementId, x, y } or { multi, ids, offsetX, offsetY }
  const [liveSize, setLiveSize] = useState(null); // { elementId, w, h } during an active resize
  const [editingId, setEditingId] = useState(null); // element id currently edited inline (double-click)
  const [guides, setGuides] = useState(null); // { containerId, v: [x], h: [y] } alignment lines in container coords
  const suppressFocusSelectRef = useRef(false);
  useEffect(() => {
    const closeOnPointer = event => {
      if (event.target?.closest?.('.ui-slot.editing')) return;
      setEditingId(null);
    };
    window.addEventListener('pointerdown', closeOnPointer);
    return () => window.removeEventListener('pointerdown', closeOnPointer);
  }, []);
  if (!validation.valid) return <div className="participant-ui-error">Participant UI is invalid: {validation.errors.map(error => error.message).join(' · ')}</div>;

  const registerRef = id => node => {
    if (node) nodeRefs.current.set(id, node);
    else nodeRefs.current.delete(id);
  };

  const selectedClass = element => (selectedIds?.has(element.id) ? ' selected' : '');

  const collectSiblingRects = (containerId, draggedId) => {
    const containerNode = nodeRefs.current.get(containerId);
    const parent = parentElementOf(normalized.root, draggedId);
    if (!containerNode || !parent?.props?.free) return [];
    const cRect = containerNode.getBoundingClientRect();
    const rects = [];
    for (const [id, node] of nodeRefs.current) {
      if (id === draggedId || node === containerNode || node.parentElement !== containerNode) continue;
      const r = node.getBoundingClientRect();
      rects.push({
        l: r.left - cRect.left,
        r: r.right - cRect.left,
        t: r.top - cRect.top,
        b: r.bottom - cRect.top,
        cx: (r.left + r.right) / 2 - cRect.left,
        cy: (r.top + r.bottom) / 2 - cRect.top,
      });
    }
    return rects;
  };

  const pointerMove = event => {
    const start = dragStartRef.current;
    if (!start) return;
    const dx = (event.clientX - start.startClientX) / zoomRef.current;
    const dy = (event.clientY - start.startClientY) / zoomRef.current;
    if (!start.moved && Math.abs(dx) + Math.abs(dy) < 3 / zoomRef.current) return;
    start.moved = true;
    if (start.multi) {
      let ox = dx;
      let oy = dy;
      if (start.snap) {
        ox = Math.round(ox / SNAP) * SNAP;
        oy = Math.round(oy / SNAP) * SNAP;
      }
      start.offsetX = ox;
      start.offsetY = oy;
      setLivePos({ multi: true, ids: start.ids, offsetX: ox, offsetY: oy });
      return;
    }
    let x = start.startX + dx;
    let y = start.startY + dy;
    if (start.snap) {
      x = Math.round(x / SNAP) * SNAP;
      y = Math.round(y / SNAP) * SNAP;
      const v = [];
      const h = [];
      const t = { l: x, r: x + start.w, t: y, b: y + start.h, cx: x + start.w / 2, cy: y + start.h / 2 };
      let sx = null;
      let sy = null;
      for (const s of start.siblingRects) {
        const xPairs = [[t.l, s.l, s.l], [t.cx, s.cx, s.cx], [t.r, s.r, s.r], [t.l, s.r, s.r], [t.r, s.l, s.l]];
        const yPairs = [[t.t, s.t, s.t], [t.cy, s.cy, s.cy], [t.b, s.b, s.b], [t.t, s.b, s.b], [t.b, s.t, s.t]];
        for (const [a, b, line] of xPairs) {
          if (sx == null && Math.abs(a - b) <= GUIDE_THRESHOLD) { sx = b; if (!v.includes(line)) v.push(line); }
        }
        for (const [a, b, line] of yPairs) {
          if (sy == null && Math.abs(a - b) <= GUIDE_THRESHOLD) { sy = b; if (!h.includes(line)) h.push(line); }
        }
      }
      if (sx != null) x = sx;
      if (sy != null) y = sy;
      setGuides(v.length || h.length ? { containerId: start.containerId, v, h } : null);
    }
    x = Math.max(0, x);
    y = Math.max(0, y);
    start.x = x;
    start.y = y;
    setLivePos({ elementId: start.elementId, x, y });
  };

  const pointerUp = () => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    window.removeEventListener('mousemove', pointerMove);
    window.removeEventListener('mouseup', pointerUp);
    if (start?.moved) {
      if (start.multi) onMoveElementsRef.current(start.ids, Math.round(start.offsetX), Math.round(start.offsetY));
      else onMoveRef.current(start.elementId, start.containerId, Math.round(start.x), Math.round(start.y));
    }
    setLivePos(null);
    setGuides(null);
  };

  // Free repositioning via pointer events. Dragging one of several selected
  // elements moves the whole selection together; otherwise it is a single drag.
  const beginPointerDrag = (event, element) => {
    if (element.type === 'Screen') return;
    if (editingId === element.id || event.target?.isContentEditable) return;
    const parent = parentElementOf(normalized.root, element.id);
    if (!parent) return;
    event.preventDefault();
    event.stopPropagation();
    markSuppressFocusSelect();
    // Alt+drag duplicates the element and drags the copy instead (Figma-style).
    // Only free-layout (positioned) elements can be duplicated this way; the copy
    // is inserted exactly where the source sits, so the drag continues from the
    // source's coordinates and targets the new id.
    const positioned = element.props?.x != null || element.props?.y != null;
    let dragId = element.id;
    if (event.altKey && positioned) {
      const newId = onDuplicateRef.current?.(element.id);
      if (!newId) return;
      dragId = newId;
    }
    const isDragCopy = dragId !== element.id;
    // Dragging one of several selected elements keeps the selection intact.
    const alreadyInMulti = !isDragCopy && selectedIdsRef.current?.has(element.id) && selectedIdsRef.current.size > 1 && !event.shiftKey;
    // Plain (non-shift) mousedown selects immediately so dragging works; additive
    // (shift) selection is left to the single click handler to avoid the toggle
    // being applied twice (mousedown + click) and cancelling the multi-select.
    if (!alreadyInMulti && !event.shiftKey) onSelect(dragId, false);
    const multi = alreadyInMulti;
    const ids = multi ? [...selectedIdsRef.current].filter(id => id !== normalized.root.id) : [dragId];
    const node = nodeRefs.current.get(element.id);
    const rect = node?.getBoundingClientRect();
    const w = element.props?.width ?? (rect ? rect.width : 0);
    const h = element.props?.height ?? (rect ? rect.height : 0);
    dragStartRef.current = {
      elementId: dragId,
      containerId: parent.id,
      startX: element.props?.x ?? 0,
      startY: element.props?.y ?? 0,
      startClientX: event.clientX,
      startClientY: event.clientY,
      x: element.props?.x ?? 0,
      y: element.props?.y ?? 0,
      w,
      h,
      moved: false,
      multi,
      ids,
      offsetX: 0,
      offsetY: 0,
      snap: snapRef.current,
      siblingRects: multi ? [] : collectSiblingRects(parent.id, element.id),
    };
    if (multi) setLivePos({ multi: true, ids, offsetX: 0, offsetY: 0 });
    else setLivePos({ elementId: dragId, x: element.props?.x ?? 0, y: element.props?.y ?? 0 });
    window.addEventListener('mousemove', pointerMove);
    window.addEventListener('mouseup', pointerUp);
  };

  const resizeMove = event => {
    const start = resizeStartRef.current;
    if (!start) return;
    const z = zoomRef.current || 1;
    start.w = Math.max(24, Math.round(start.startW + (event.clientX - start.startClientX) / z));
    start.h = Math.max(20, Math.round(start.startH + (event.clientY - start.startClientY) / z));
    setLiveSize({ elementId: start.elementId, w: start.w, h: start.h });
  };

  const resizeUp = () => {
    const start = resizeStartRef.current;
    resizeStartRef.current = null;
    window.removeEventListener('mousemove', resizeMove);
    window.removeEventListener('mouseup', resizeUp);
    if (start) onResizeRef.current(start.elementId, start.w, start.h);
    setLiveSize(null);
  };

  const beginResize = (event, element) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(element.id, event.shiftKey);
    const rect = event.currentTarget.getBoundingClientRect();
    const w = element.props?.width ?? Math.round(rect.width);
    const h = element.props?.height ?? Math.round(rect.height);
    resizeStartRef.current = { elementId: element.id, startClientX: event.clientX, startClientY: event.clientY, startW: w, startH: h, w, h };
    setLiveSize({ elementId: element.id, w, h });
    window.addEventListener('mousemove', resizeMove);
    window.addEventListener('mouseup', resizeUp);
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
        const x = rect ? Math.max(0, Math.round((event.clientX - rect.left) / zoomRef.current)) : undefined;
        const y = rect ? Math.max(0, Math.round((event.clientY - rect.top) / zoomRef.current)) : undefined;
        if (payload.action === 'add' && payload.type) onDropElement(payload.type, element.id, x, y);
      } catch { /* ignore malformed payload */ }
    },
  });

  const clickProps = element => ({
    onClick: event => { event.stopPropagation(); markSuppressFocusSelect(); onSelect(element.id, event.shiftKey); },
    onContextMenu: event => {
      event.preventDefault();
      event.stopPropagation();
      if (onContextMenu) onContextMenu(element.id, event.clientX, event.clientY);
    },
  });

  // Keyboard accessibility: every canvas element is focusable; focusing via the
  // keyboard (Tab) selects it, while mouse-initiated focus is suppressed so it
  // does not fight shift+click additive selection.
  const markSuppressFocusSelect = () => {
    suppressFocusSelectRef.current = true;
    requestAnimationFrame(() => { suppressFocusSelectRef.current = false; });
  };
  const a11yProps = element => ({
    tabIndex: 0,
    onFocus: event => {
      event.stopPropagation();
      if (suppressFocusSelectRef.current) return;
      onSelect(element.id, false);
    },
  });

  // Floating action bar for a single selected element (anchored to the element).
  const floatBar = element => selectedId === element.id && selectedIds?.size <= 1 && element.type !== 'Screen'
    ? <span className="ui-float-bar" onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
      <button type="button" title="Move up" onClick={() => onMoveStepRef.current(element.id, -1)}>↑</button>
      <button type="button" title="Move down" onClick={() => onMoveStepRef.current(element.id, 1)}>↓</button>
      <button type="button" title="Duplicate (Ctrl+D)" onClick={() => onDuplicateRef.current(element.id)}>⧉</button>
      <button type="button" className="danger" title="Remove (Del)" onClick={() => onRemoveRef.current(element.id)}>×</button>
    </span>
    : null;

  const guideLayer = element => (guides?.containerId === element.id && (guides.v.length || guides.h.length))
    ? <span className="ui-guides">{guides.v.map(line => <span key={`v${line}`} className="ui-guide-v" style={{ left: line }} />)}{guides.h.map(line => <span key={`h${line}`} className="ui-guide-h" style={{ top: line }} />)}</span>
    : null;

  const render = element => {
    const props = element.props || {};
    const style = resolveUiStyle(element, theme, context);
    // During an active drag, show the live position instead of the committed one.
    let x = props.x;
    let y = props.y;
    if (livePos) {
      if (livePos.multi && livePos.ids.includes(element.id) && (props.x != null || props.y != null)) {
        x = (props.x ?? 0) + livePos.offsetX;
        y = (props.y ?? 0) + livePos.offsetY;
      } else if (livePos.elementId === element.id) {
        x = livePos.x;
        y = livePos.y;
      }
    }
    const liveSizeEl = liveSize?.elementId === element.id;
    const w = liveSizeEl ? liveSize.w : props.width;
    const h = liveSizeEl ? liveSize.h : props.height;
    const sized = (w != null || h != null) ? { width: w != null ? w : undefined, height: h != null ? h : undefined } : {};
    const positioned = (x != null && y != null) ? { position: 'absolute', left: x, top: y, ...sized } : {};
    // Anchor the floating bar to static elements by making the selected one relative.
    const anchorStyle = (!positioned.position && selectedId === element.id) ? { position: 'relative' } : {};
    // Resize handle only for free-positioned leaf elements.
    const showResize = Boolean(positioned.position) && selectedId === element.id && selectedIds?.size <= 1 && element.type !== 'Layout' && element.type !== 'Screen';
    const resizeHandle = showResize ? <span className="ui-resize-handle" title="Drag to resize" onMouseDown={event => beginResize(event, element)} /> : null;
    const freeClass = props.free ? ' ui-free' : '';
    if (element.type === 'Screen') return <div key={element.id} data-ui-id={element.id} className={`participant-ui-screen ui-slot${freeClass}${selectedClass(element)}`} style={{ ...style, ...(props.free ? { position: 'relative', minHeight: 'min(72vh, 560px)' } : {}) }} ref={registerRef(element.id)} {...a11yProps(element)} {...clickProps(element)} {...dropProps(element)}>{props.free && <span className="ui-free-hint">FREE · drag elements anywhere</span>}{guideLayer(element)}{element.children.map(render)}</div>;
    if (element.type === 'Layout') return <div key={element.id} data-ui-id={element.id} className={`participant-ui-layout ${props.direction || 'column'} ui-slot${freeClass}${selectedClass(element)}`} style={{ ...style, gap: style.gap ?? 16, ...(props.free ? { position: 'relative', minHeight: 'min(72vh, 560px)' } : {}) }} ref={registerRef(element.id)} onMouseDown={event => beginPointerDrag(event, element)} {...a11yProps(element)} {...clickProps(element)} {...dropProps(element)}>{floatBar(element)}{props.free && <span className="ui-free-hint">FREE · drag anywhere</span>}{guideLayer(element)}{element.children.map(render)}</div>;
    if (element.type === 'Text') {
      const text = boundProp(element, 'text', context) ?? '';
      const editing = editingId === element.id;
      const common = {
        'data-ui-id': element.id,
        className: `ui-slot${selectedClass(element)}${editing ? ' editing' : ''}`,
        style: { ...style, ...positioned, ...anchorStyle },
        ref: registerRef(element.id),
        onMouseDown: event => beginPointerDrag(event, element),
        ...a11yProps(element),
        ...clickProps(element),
        onDoubleClick: event => { event.stopPropagation(); if (element.bindings?.text) return; setEditingId(element.id); },
        contentEditable: editing,
        suppressContentEditableWarning: true,
        spellCheck: false,
        onBlur: event => {
          setEditingId(null);
          const next = event.currentTarget.textContent ?? '';
          if (next !== text) onUpdateTextRef.current(element.id, next);
        },
        onKeyDown: event => {
          if (event.key === 'Escape') event.currentTarget.blur();
          if (event.key === 'Enter' && !event.shiftKey && props.variant !== 'heading') { event.preventDefault(); event.currentTarget.blur(); }
        },
      };
      return props.variant === 'heading'
        ? <h1 key={element.id} {...common}>{floatBar(element)}{resizeHandle}{text}</h1>
        : <p key={element.id} {...common}>{floatBar(element)}{resizeHandle}{text}</p>;
    }
    if (element.type === 'Media') {
      const source = boundProp(element, 'sourceUrl', context) || '';
      const editing = editingId === element.id;
      if (editing) {
        return <span key={element.id} data-ui-id={element.id} className={`ui-media-wrap ui-slot editing${selectedClass(element)}`} style={{ ...positioned, ...anchorStyle, display: 'inline-block', minWidth: 180 }} ref={registerRef(element.id)} onMouseDown={event => event.stopPropagation()} {...a11yProps(element)}>{floatBar(element)}
          <input className="ui-media-url-edit" defaultValue={source} placeholder="Paste video or image URL…" autoFocus spellCheck={false}
            onKeyDown={event => {
              if (event.key === 'Escape') event.currentTarget.blur();
              if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
            }}
            onBlur={event => {
              setEditingId(null);
              const next = event.currentTarget.value.trim();
              if (next !== source) onUpdatePropRef.current?.(element.id, 'sourceUrl', next);
            }} />
        </span>;
      }
      return <span key={element.id} data-ui-id={element.id} className={`ui-media-wrap ui-slot${selectedClass(element)}`} style={{ ...positioned, ...anchorStyle }} ref={registerRef(element.id)} onMouseDown={event => beginPointerDrag(event, element)} {...a11yProps(element)} {...clickProps(element)} onDoubleClick={event => { event.stopPropagation(); if (element.bindings?.sourceUrl) return; setEditingId(element.id); }}>{floatBar(element)}{resizeHandle}<ParticipantMedia source={source} mediaType={props.mediaType || 'image'} controls={props.controls !== false} autoPlay={Boolean(props.autoPlay)} alt={props.alt || ''} fit={props.fit || 'contain'} /><div className="ui-edit-shield" /></span>;
    }
    if (element.type === 'Progress') {
      const value = Number(boundProp(element, 'value', context) ?? 0), max = Number(boundProp(element, 'max', context) ?? 100);
      return <div key={element.id} data-ui-id={element.id} className={`participant-ui-progress ui-slot${selectedClass(element)}`} style={{ ...style, ...positioned, ...anchorStyle }} ref={registerRef(element.id)} onMouseDown={event => beginPointerDrag(event, element)} {...a11yProps(element)} {...clickProps(element)}>{floatBar(element)}{resizeHandle}{props.label && <span>{props.label}</span>}<progress value={value} max={max} /></div>;
    }
    if (element.type === 'Html') {
      const html = boundProp(element, 'html', context) || '';
      return <span key={element.id} data-ui-id={element.id} className={`ui-media-wrap ui-slot${selectedClass(element)}`} style={{ ...positioned, ...anchorStyle, display: 'inline-block' }} ref={registerRef(element.id)} onMouseDown={event => beginPointerDrag(event, element)} {...a11yProps(element)} {...clickProps(element)}>{floatBar(element)}{resizeHandle}<iframe className="participant-ui-html" title="Custom HTML" srcDoc={html || '<div></div>'} /><div className="ui-edit-shield" /></span>;
    }
    if (element.type === 'Divider') {
      const orientation = props.orientation || 'horizontal';
      const thickness = Math.max(0.5, Number(props.thickness) || 1);
      const dividerStyle = { ...style, background: style.background || theme.line, ...positioned, ...anchorStyle };
      if (orientation === 'vertical') {
        dividerStyle.width = thickness;
        if (dividerStyle.height == null) dividerStyle.height = 160;
      } else {
        dividerStyle.height = thickness;
      }
      return <div key={element.id} data-ui-id={element.id} className={`participant-ui-divider ${orientation} ui-slot${selectedClass(element)}`} style={dividerStyle} ref={registerRef(element.id)} onMouseDown={event => beginPointerDrag(event, element)} {...a11yProps(element)} {...clickProps(element)}>{floatBar(element)}{resizeHandle}</div>;
    }
    if (element.type === 'Rectangle' || element.type === 'Ellipse') {
      const isEllipse = element.type === 'Ellipse';
      const shapeStyle = { ...style, background: style.background || theme.green, ...(isEllipse ? { borderRadius: '50%' } : {}), ...positioned, ...anchorStyle };
      return <div key={element.id} data-ui-id={element.id} className={`participant-ui-shape ${isEllipse ? 'ellipse' : 'rectangle'} ui-slot${selectedClass(element)}`} style={shapeStyle} ref={registerRef(element.id)} onMouseDown={event => beginPointerDrag(event, element)} {...a11yProps(element)} {...clickProps(element)}>{floatBar(element)}{resizeHandle}</div>;
    }
    if (element.type === 'Input') {
      const name = props.name;
      return <label key={element.id} data-ui-id={element.id} className={`participant-ui-input ui-slot${selectedClass(element)}`} style={{ ...style, ...positioned, ...anchorStyle }} ref={registerRef(element.id)} onMouseDown={event => beginPointerDrag(event, element)} {...a11yProps(element)} {...clickProps(element)}>{floatBar(element)}{resizeHandle}<span>{props.label || name}{props.required && ' *'}</span>
        {props.inputType === 'rating'
          ? <div className="participant-rating">{Array.from({ length: Math.max(0, Number(props.max || 7) - Number(props.min || 1) + 1) }, (_, index) => Number(props.min || 1) + index).map(value => <span key={value} className="ui-rating-chip">{value}</span>)}</div>
          : props.inputType === 'checkbox' ? <span className="participant-checkbox"><span className="ui-checkbox-ghost" /></span>
            : <div className="ui-input-ghost" />}
      </label>;
    }
    if (element.type === 'Button') return <span key={element.id} data-ui-id={element.id} className={`ui-button-wrap ui-slot${selectedClass(element)}`} style={{ ...positioned, ...anchorStyle }} ref={registerRef(element.id)} onMouseDown={event => beginPointerDrag(event, element)} {...a11yProps(element)} {...clickProps(element)}>{floatBar(element)}{resizeHandle}<button type="button" className={`participant-ui-button ${props.variant || 'primary'}`} style={style}>{props.label || 'Continue'}</button></span>;
    return null;
  };

  return <div className="ui-canvas-root">
    {render(normalized.root)}
    {selectedIds?.size > 1 && <div className="ui-multi-bar" onMouseDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
      <b>{selectedIds.size} selected</b>
      <span className="ui-align-group">
        {['left', 'centerX', 'right', 'top', 'centerY', 'bottom', 'distributeX', 'distributeY'].map(name => (
          <button key={name} type="button" className="ui-align-btn" title={ALIGN_TITLES[name]} aria-label={ALIGN_TITLES[name]} onClick={() => onAlignSelectedRef.current(name)}>
            <AlignIcon name={name} />
          </button>
        ))}
      </span>
      <span className="ui-multi-bar-sep" />
      <button type="button" onClick={() => onDuplicateSelectedRef.current()}>Duplicate</button>
      <button type="button" className="danger" onClick={() => onRemoveSelectedRef.current()}>Delete</button>
      <button type="button" onClick={() => onSelect(normalized.root.id)}>Deselect</button>
    </div>}
  </div>;
}
