import { useEffect, useMemo, useRef, useState } from 'react';
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
  validateParticipantUi,
} from '../core/index.js';
import { useParticipantUiHistory } from './useParticipantUiHistory.js';
import { CONTAINERS, defaults, DEVICES } from './constants.js';
import { duplicateElementTree, findInTree, findParentAndIndex, flatten, mapTree, pathTo } from './tree.js';

export function useParticipantUiState({ schema, onChange, defaultTemplate = 'instruction' }) {
  const normalized = useMemo(() => normalizeParticipantUi(schema), [schema]);
  const theme = useMemo(() => resolveTheme(normalized), [normalized]);
  const [selectedId, setSelectedId] = useState(normalized.root.id);
  const [preview, setPreview] = useState(false);
  const [structureOpen, setStructureOpen] = useState(false);
  const [dragOver, setDragOver] = useState(null);
  const [deviceId, setDeviceId] = useState('desktop');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [selectedIds, setSelectedIds] = useState(() => new Set([normalized.root.id]));
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [marquee, setMarquee] = useState(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [contextMenu, setContextMenu] = useState(null);
  const [styleForceOpen, setStyleForceOpen] = useState(false);
  const [templateKind, setTemplateKind] = useState(defaultTemplate);
  const viewportRef = useRef(null);
  const panRef = useRef(null);
  const marqueeRef = useRef(null);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const { commit, canUndo, canRedo, undo, redo } = useParticipantUiHistory(normalized, onChange);
  const elements = flatten(normalized.root);
  const selected = elements.find(item => item.element.id === selectedId)?.element || normalized.root;
  const validation = validateParticipantUi(normalized);
  const selectedParent = selectedId !== normalized.root.id ? findParentAndIndex(normalized.root, selectedId) : null;
  const selectedParentElement = selectedParent ? elements.find(item => item.element.id === selectedParent.parentId)?.element : null;
  const showPosition = Boolean(selectedParentElement?.props?.free) || (selected.props?.x != null && selected.props?.y != null);
  const deviceWidth = DEVICES.find(device => device.id === deviceId)?.width ?? null;
  const crumbs = pathTo(normalized.root, selected.id) || [];

  const updateProps = patch => commit(mapUiElement(normalized, selected.id, element => ({ ...element, props: { ...element.props, ...patch } })));

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
    commit(mapUiElement(normalized, containerElement.id, element => ({ ...element, props: { ...element.props, free }, children })));
  };
  const setStyle = next => commit(mapUiElement(normalized, selected.id, element => {
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
    commit(appendUiElement(normalized, normalized.root.id, element));
    selectElement(element.id);
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
      commit(insertUiElement(normalized, parentId, index, element));
      selectElement(element.id);
    } catch { /* invalid drop ignored */ }
  };

  const containerInTree = (root, id) => {
    if (root?.id === id) return root;
    for (const child of root?.children || []) {
      const found = containerInTree(child, id);
      if (found) return found;
    }
    return null;
  };

  const moveElement = (elementId, targetElementId, x, y) => {
    // Free-layout drag: reposition in place instead of reordering the flex tree.
    if (x != null && y != null) {
      try {
        // Position the dragged element, then make sure its container is a free-layout
        // container (auto-enables free editing when the designer drags without
        // toggling first) and staggers the remaining children so nothing overlaps.
        let tree = mapUiElement(normalized, elementId, element => ({ ...element, props: { ...element.props, x, y } }));
        const container = containerInTree(tree.root, targetElementId);
        if (container && !container.props?.free) {
          const children = (container.children || []).map((child, index) => {
            if (child.props?.x != null && child.props?.y != null) return child; // the dragged element keeps its position
            return { ...child, props: { ...child.props, x: 32 + (index % 2) * 140, y: 36 + index * 72 } };
          });
          tree = mapUiElement(tree, targetElementId, element => ({ ...element, props: { ...element.props, free: true }, children }));
        }
        commit(tree);
        selectElement(elementId);
      } catch { /* invalid position ignored */ }
      return;
    }
    const target = elements.find(item => item.element.id === targetElementId)?.element;
    if (!target) return;
    try {
      const parentId = CONTAINERS.has(target.type) ? target.id : findParentAndIndex(normalized.root, target.id)?.parentId;
      if (!parentId) return;
      const index = CONTAINERS.has(target.type) ? (target.children || []).length : (findParentAndIndex(normalized.root, target.id)?.index || 0) + 1;
      commit(moveUiElement(normalized, elementId, parentId, index));
      selectElement(elementId);
    } catch { /* invalid move ignored */ }
  };

  const moveStep = (elementId, delta) => {
    const parent = findParentAndIndex(normalized.root, elementId);
    if (!parent) return;
    try { commit(moveUiElement(normalized, elementId, parent.parentId, parent.index + delta)); } catch { /* ignored */ }
  };

  const removeElement = elementId => {
    if (elementId === normalized.root.id) return;
    commit(removeUiElement(normalized, elementId));
    selectElement(normalized.root.id);
  };

  const duplicateElementById = elementId => {
    const source = elements.find(item => item.element.id === elementId)?.element;
    if (!source || source.id === normalized.root.id) return;
    const parent = findParentAndIndex(normalized.root, elementId);
    if (!parent) return;
    const copy = duplicateElementTree(source);
    commit(insertUiElement(normalized, parent.parentId, parent.index + 1, copy));
    selectElement(copy.id);
    return copy.id;
  };

  // Clipboard copy/paste (Ctrl+C / Ctrl+V). The copied element subtree lives in
  // memory; pasting deep-copies it with fresh ids and drops it next to the
  // current selection (or at the end of the root when nothing meaningful is
  // selected), offsetting free-layout copies by 20px so they do not stack.
  const clipboardRef = useRef(null);
  const copySelected = () => {
    const ids = [...selectedIds].filter(id => id !== normalized.root.id);
    const targetId = selectedId !== normalized.root.id ? selectedId : ids[0];
    const source = findInTree(normalized.root, targetId);
    if (!source) return null;
    clipboardRef.current = structuredClone(source);
    return source.id;
  };
  const pasteClipboard = () => {
    if (!clipboardRef.current) return null;
    const copy = duplicateElementTree(clipboardRef.current);
    if (copy.props?.x != null || copy.props?.y != null) {
      copy.props = { ...copy.props, x: (copy.props.x ?? 0) + 20, y: (copy.props.y ?? 0) + 20 };
    }
    const parent = selectedId !== normalized.root.id ? findParentAndIndex(normalized.root, selectedId) : null;
    const parentId = parent?.parentId ?? normalized.root.id;
    const index = parent ? parent.index + 1 : (normalized.root.children || []).length;
    const next = insertUiElement(normalized, parentId, index, copy);
    commit(next);
    selectElement(copy.id);
    return copy.id;
  };

  const resizeElement = (elementId, width, height) => {
    commit(mapUiElement(normalized, elementId, element => {
      const props = { ...element.props };
      if (width == null) delete props.width; else props.width = width;
      if (height == null) delete props.height; else props.height = height;
      return { ...element, props };
    }));
  };

  const selectElement = (id, additive) => {
    if (additive) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      setSelectedId(id);
    } else {
      setSelectedIds(new Set([id]));
      setSelectedId(id);
    }
  };

  const selectMany = ids => {
    setSelectedIds(new Set(ids));
    setSelectedId(ids[ids.length - 1]);
  };

  const removeSelected = () => {
    const ids = [...selectedIds].filter(id => id !== normalized.root.id);
    if (!ids.length) return;
    let tree = normalized;
    for (const id of ids) tree = removeUiElement(tree, id);
    commit(tree);
    setSelectedId(normalized.root.id);
    setSelectedIds(new Set([normalized.root.id]));
  };

  const duplicateSelected = () => {
    const ids = [...selectedIds].filter(id => id !== normalized.root.id);
    if (!ids.length) return;
    // Only duplicate top-level selected nodes; their subtrees already contain
    // any nested selections, avoiding double-copies of child elements.
    const idSet = new Set(ids);
    const topLevelIds = ids.filter(id => {
      const parent = findParentAndIndex(normalized.root, id);
      return !parent || !idSet.has(parent.parentId);
    });
    let tree = normalized;
    let lastId = null;
    for (const id of topLevelIds) {
      const source = findInTree(tree.root, id);
      if (!source) continue;
      const parent = findParentAndIndex(tree.root, id);
      if (!parent) continue;
      const copy = duplicateElementTree(source);
      tree = insertUiElement(tree, parent.parentId, parent.index + 1, copy);
      lastId = copy.id;
    }
    if (lastId) {
      commit(tree);
      setSelectedId(lastId);
      setSelectedIds(new Set([lastId]));
    }
  };

  // Alignment / distribution for multi-selected free-layout elements. Operates on
  // the bounding box of the selection (Figma-style): align snaps edges or centers
  // to the selection bounds; distribute spreads elements evenly along an axis.
  const alignSelected = alignment => {
    const ids = [...selectedIds].filter(id => id !== normalized.root.id);
    const panNode = panRef.current;
    const items = ids
      .map(id => findInTree(normalized.root, id))
      .filter(el => el && el.props?.x != null && el.props?.y != null)
      .map(el => {
        const props = el.props;
        const node = panNode?.querySelector(`[data-ui-id="${el.id}"]`);
        const rect = node?.getBoundingClientRect();
        return {
          id: el.id,
          x: props.x,
          y: props.y,
          w: props.width ?? (rect ? Math.round(rect.width / zoom) : 0),
          h: props.height ?? (rect ? Math.round(rect.height / zoom) : 0),
        };
      });
    if (items.length < 2) return;
    const left = Math.min(...items.map(i => i.x));
    const right = Math.max(...items.map(i => i.x + i.w));
    const top = Math.min(...items.map(i => i.y));
    const bottom = Math.max(...items.map(i => i.y + i.h));
    const cx = left + (right - left) / 2;
    const cy = top + (bottom - top) / 2;
    const nextPos = {};
    if (alignment === 'left') items.forEach(i => { nextPos[i.id] = { x: left }; });
    else if (alignment === 'centerX') items.forEach(i => { nextPos[i.id] = { x: cx - i.w / 2 }; });
    else if (alignment === 'right') items.forEach(i => { nextPos[i.id] = { x: right - i.w }; });
    else if (alignment === 'top') items.forEach(i => { nextPos[i.id] = { y: top }; });
    else if (alignment === 'centerY') items.forEach(i => { nextPos[i.id] = { y: cy - i.h / 2 }; });
    else if (alignment === 'bottom') items.forEach(i => { nextPos[i.id] = { y: bottom - i.h }; });
    else if (alignment === 'distributeX' || alignment === 'distributeY') {
      const vertical = alignment === 'distributeY';
      const sorted = [...items].sort((a, b) => (vertical ? a.y - b.y : a.x - b.x));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const middle = sorted.slice(1, -1);
      const span = vertical ? last.y - (first.y + first.h) : last.x - (first.x + first.w);
      const used = middle.reduce((sum, i) => sum + (vertical ? i.h : i.w), 0);
      const gap = Math.max(0, (span - used) / (sorted.length - 1));
      let cursor = (vertical ? first.y + first.h : first.x + first.w) + gap;
      for (const item of middle) {
        nextPos[item.id] = vertical ? { y: cursor } : { x: cursor };
        cursor += (vertical ? item.h : item.w) + gap;
      }
    }
    if (!Object.keys(nextPos).length) return;
    commit({
      ...normalized,
      root: mapTree(normalized.root, element => {
        const pos = nextPos[element.id];
        if (!pos) return element;
        return { ...element, props: { ...element.props, x: pos.x != null ? Math.round(pos.x) : element.props.x, y: pos.y != null ? Math.round(pos.y) : element.props.y } };
      }),
    });
  };

  const moveElements = (ids, dx, dy) => {
    const idSet = new Set(ids);
    commit({
      ...normalized,
      root: mapTree(normalized.root, element => {
        if (!idSet.has(element.id)) return element;
        const props = element.props || {};
        if (props.x == null && props.y == null) return element;
        return { ...element, props: { ...props, x: Math.max(0, (props.x ?? 0) + dx), y: Math.max(0, (props.y ?? 0) + dy) } };
      }),
    });
  };

  const updateText = (id, text) => commit(mapUiElement(normalized, id, element => ({ ...element, props: { ...element.props, text } })));
  const updateProp = (id, name, value) => commit(mapUiElement(normalized, id, element => ({ ...element, props: { ...element.props, [name]: value } })));

  // Reorder the selected elements inside their parent containers to control paint
  // order / stacking: 'front' & 'back' move the selection to the top/bottom of the
  // parent's child list, 'forward' & 'backward' step one layer (skipping other
  // selected elements). DOM order is what the canvas renderer uses for stacking.
  const zOrderSelected = (mode, idsOverride) => {
    const ids = (idsOverride || [...selectedIds]).filter(id => id !== normalized.root.id);
    if (!ids.length) return;
    const groups = new Map();
    for (const id of ids) {
      const found = findParentAndIndex(normalized.root, id);
      if (!found?.parentId) continue;
      if (!groups.has(found.parentId)) groups.set(found.parentId, []);
      groups.get(found.parentId).push(id);
    }
    if (!groups.size) return;
    let next = normalized;
    for (const [parentId, members] of groups) {
      const memberSet = new Set(members);
      next = mapUiElement(next, parentId, parent => {
        const children = parent.children || [];
        let result = children;
        if (mode === 'front') {
          result = [...children.filter(c => !memberSet.has(c.id)), ...children.filter(c => memberSet.has(c.id))];
        } else if (mode === 'back') {
          result = [...children.filter(c => memberSet.has(c.id)), ...children.filter(c => !memberSet.has(c.id))];
        } else if (mode === 'forward' || mode === 'backward') {
          const arr = children.slice();
          if (mode === 'forward') {
            for (let i = arr.length - 1; i >= 0; i--) {
              if (!memberSet.has(arr[i].id)) continue;
              let j = i + 1;
              while (j < arr.length && memberSet.has(arr[j].id)) j++;
              if (j < arr.length) { const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
              break;
            }
          } else {
            for (let i = 0; i < arr.length; i++) {
              if (!memberSet.has(arr[i].id)) continue;
              let j = i - 1;
              while (j >= 0 && memberSet.has(arr[j].id)) j--;
              if (j >= 0) { const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
              break;
            }
          }
          result = arr;
        }
        return { ...parent, children: result };
      });
    }
    if (next !== normalized) commit(next);
  };

  const nudgeSelected = (key, big) => {
    const step = big ? 10 : 1;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[key];
    if (!delta) return;
    const ids = [...selectedIds].filter(id => {
      if (id === normalized.root.id) return false;
      const el = findInTree(normalized.root, id);
      return el?.props?.x != null || el?.props?.y != null;
    });
    if (!ids.length) return;
    moveElements(ids, delta[0], delta[1]);
  };

  // Editor shortcuts: Ctrl/Cmd+Z undo, Ctrl+Shift+Z / Ctrl+Y redo, Ctrl+D duplicate,
  // Delete remove, arrow keys nudge a free-layout element (Shift = 10px).
  const onKeyDown = event => {
    const target = event.target;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
    if (mod && key === 'y') { event.preventDefault(); redo(); return; }
    if (mod && key === 'd') { event.preventDefault(); duplicateSelected(); return; }
    if (mod && key === 'c') { event.preventDefault(); copySelected(); return; }
    if (mod && key === 'v') { event.preventDefault(); pasteClipboard(); return; }
    if (mod && key === ']') { event.preventDefault(); zOrderSelected('forward'); return; }
    if (mod && key === '[') { event.preventDefault(); zOrderSelected('backward'); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected(); return; }
    if (event.key === 'Escape') { marqueeRef.current && handleMarqueeUp(); return; }
    if (event.key.startsWith('Arrow')) { event.preventDefault(); nudgeSelected(event.key, event.shiftKey && !mod); }
  };
  const keyHandlerRef = useRef(onKeyDown);
  keyHandlerRef.current = onKeyDown;
  useEffect(() => {
    const listener = event => keyHandlerRef.current?.(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  // Canvas zoom / pan. Ctrl/Cmd + wheel zooms around the cursor; plain wheel pans.
  const zoomAt = (clientX, clientY, factor) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const next = Math.min(2, Math.max(0.25, zoomRef.current * factor));
    const k = next / zoomRef.current;
    setPan(p => ({ x: mx - (mx - p.x) * k, y: my - (my - p.y) * k }));
    setZoom(next);
  };
  const viewportCenter = () => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 };
  };
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const fitView = () => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const base = deviceWidth || 800;
    if (!rect) return;
    const next = Math.min(1.5, Math.max(0.2, (rect.width - 24) / base));
    setZoom(next);
    setPan({ x: (rect.width - base * next) / 2, y: 20 });
  };
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const handler = event => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.1 : 0.9);
      else setPan(p => ({ x: p.x - event.deltaX, y: p.y - event.deltaY }));
    };
    node.addEventListener('wheel', handler, { passive: false });
    return () => node.removeEventListener('wheel', handler);
  }, []);

  // Marquee selection: press on canvas blank space and drag a rectangle.
  const viewportPoint = event => {
    const rect = viewportRef.current.getBoundingClientRect();
    return { x: (event.clientX - rect.left - pan.x) / zoom, y: (event.clientY - rect.top - pan.y) / zoom };
  };
  const handleViewportPointerDown = event => {
    if (event.button !== 0) return;
    setContextMenu(null);
    const target = event.target;
    // Clicks on elements (other than container blank space) are handled by the canvas.
    const el = target?.closest?.('[data-ui-id]');
    if (el && !el.classList.contains('participant-ui-screen') && !el.classList.contains('participant-ui-layout')) return;
    const point = viewportPoint(event);
    marqueeRef.current = { x0: point.x, y0: point.y, x1: point.x, y1: point.y };
    setMarquee({ x0: point.x, y0: point.y, x1: point.x, y1: point.y });
    window.addEventListener('pointermove', handleMarqueeMove);
    window.addEventListener('pointerup', handleMarqueeUp);
  };
  const handleMarqueeMove = event => {
    const m = marqueeRef.current;
    if (!m) return;
    const point = viewportPoint(event);
    m.x1 = point.x;
    m.y1 = point.y;
    setMarquee({ x0: m.x0, y0: m.y0, x1: m.x1, y1: m.y1 });
  };
  const handleMarqueeUp = () => {
    const m = marqueeRef.current;
    marqueeRef.current = null;
    window.removeEventListener('pointermove', handleMarqueeMove);
    window.removeEventListener('pointerup', handleMarqueeUp);
    if (!m) return;
    const rect = { left: Math.min(m.x0, m.x1), top: Math.min(m.y0, m.y1), right: Math.max(m.x0, m.x1), bottom: Math.max(m.y0, m.y1) };
    setMarquee(null);
    // Plain click on blank space clears the selection.
    if (rect.right - rect.left < 4 && rect.bottom - rect.top < 4) { selectElement(normalized.root.id); return; }
    const panNode = panRef.current;
    if (!panNode) return;
    const panRect = panNode.getBoundingClientRect();
    const hits = [];
    panNode.querySelectorAll('[data-ui-id]').forEach(node => {
      if (node.dataset.uiId === normalized.root.id) return;
      const r = node.getBoundingClientRect();
      const el = {
        left: (r.left - panRect.left) / zoom,
        top: (r.top - panRect.top) / zoom,
        right: (r.right - panRect.left) / zoom,
        bottom: (r.bottom - panRect.top) / zoom,
      };
      if (el.right >= rect.left && el.left <= rect.right && el.bottom >= rect.top && el.top <= rect.bottom) hits.push(node.dataset.uiId);
    });
    if (hits.length) selectMany(hits);
  };

  // Right-click context menu for canvas elements (rendered over the viewport).
  const openContextMenu = (elementId, clientX, clientY) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    setContextMenu({ elementId, x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) });
  };
  const closeContextMenu = () => setContextMenu(null);
  const focusStyle = id => { selectElement(id); setStyleForceOpen(true); };

  const toggleCollapse = id => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const isHidden = entry => {
    if (entry.parentId == null) return false;
    let parentId = entry.parentId;
    while (parentId != null) {
      if (collapsed.has(parentId)) return true;
      const parentEntry = elements.find(item => item.element.id === parentId);
      parentId = parentEntry?.parentId ?? null;
    }
    return false;
  };

  return {
    normalized, theme, commit, canUndo, canRedo, undo, redo,
    selectedId, setSelectedId, preview, setPreview, structureOpen, setStructureOpen,
    dragOver, setDragOver, deviceId, setDeviceId, collapsed, setCollapsed,
    selectedIds, setSelectedIds, zoom, setZoom, pan, setPan, marquee, setMarquee,
    snapEnabled, setSnapEnabled, contextMenu, setContextMenu, styleForceOpen, setStyleForceOpen,
    templateKind, setTemplateKind, viewportRef, panRef, marqueeRef,
    elements, selected, validation, showPosition, deviceWidth, crumbs,
    mapUiElement, updateProps, toggleFree, setStyle, bindingTarget,
    addToRoot, dropElement, moveElement, moveStep, removeElement, duplicateElementById,
    clipboardRef, copySelected, pasteClipboard, resizeElement,
    selectElement, selectMany, removeSelected, duplicateSelected, alignSelected,
    moveElements, updateText, updateProp, zOrderSelected, nudgeSelected, onKeyDown,
    zoomAt, viewportCenter, resetView, fitView, viewportPoint,
    handleViewportPointerDown, handleMarqueeMove, handleMarqueeUp,
    openContextMenu, closeContextMenu, focusStyle, toggleCollapse, isHidden,
  };
}
