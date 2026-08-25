import { useEffect, useMemo, useRef, useState } from 'react';
import ParticipantRenderer from './ParticipantRenderer.jsx';
import ParticipantUiCanvas from './ParticipantUiCanvas.jsx';
import {
  appendUiElement,
  createId,
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
  Divider: { orientation: 'horizontal', thickness: 1 },
  Rectangle: { width: 120, height: 80 },
  Ellipse: { width: 120, height: 80 },
};

const TEMPLATE_KINDS = ['instruction', 'media', 'form', 'text', 'rating', 'fixation', 'attention', 'device', 'manual', 'html', 'calibration'];
const CONTAINERS = new Set(['Screen', 'Layout']);
const COLOR_TOKENS = ['ink', 'green', 'greenStrong', 'lime', 'mint', 'blue', 'amber', 'paper', 'paperSoft', 'surface', 'line', 'lineStrong', 'danger', 'warning', 'muted', 'mutedStrong'];
const FONT_TOKENS = ['fontFamily', 'headingFamily', 'fontSizeBase'];
const SPACING_TOKENS = ['spacingUnit', 'radius', 'maxWidth'];

const LIBRARY_GROUPS = [
  { label: 'Content', types: ['Text', 'Media', 'Html'] },
  { label: 'Form', types: ['Input', 'Button', 'Progress'] },
  { label: 'Layout', types: ['Layout', 'Divider'] },
  { label: 'Shapes', types: ['Rectangle', 'Ellipse'] },
];

const TYPE_HINTS = {
  Layout: 'Group children in a row or column',
  Text: 'Heading or body copy',
  Media: 'Image, audio or video',
  Input: 'Response field',
  Button: 'Continue / action button',
  Progress: 'Progress indicator',
  Html: 'Custom HTML fragment',
  Divider: 'Horizontal or vertical separator line',
  Rectangle: 'Filled rectangle shape',
  Ellipse: 'Filled ellipse / circle shape',
};

const DEVICES = [
  { id: 'phone', label: 'Phone', width: 375 },
  { id: 'tablet', label: 'Tablet', width: 768 },
  { id: 'desktop', label: 'Desktop', width: null },
];

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

function pathTo(root, id, path = []) {
  if (root.id === id) return path.concat(root);
  for (const child of root.children || []) {
    const found = pathTo(child, id, path.concat(root));
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

function duplicateElementTree(element) {
  return createUiElement(element.type, {
    id: createId('ui'),
    props: element.props,
    style: element.style,
    bindings: element.bindings,
    actions: element.actions,
    children: (element.children || []).map(duplicateElementTree),
  });
}

function UiIcon({ name }) {
  const paths = {
    Screen: <path d="M4 5h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z M9 21h6" />,
    Layout: <path d="M4 5h16v14H4z M4 9h16 M4 13h16" />,
    Text: <path d="M5 6h14 M5 11h10 M5 16h14 M12 11v5" />,
    Media: <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z M9 10.5l3-3 3 3 M8.5 14l2.5-2.5 2 2 2-2 1.5 1.5" />,
    Input: <path d="M4 8.5h16v7H4z M7 8.5v7" />,
    Button: <path d="M7 9.5h10a3 3 0 0 1 3 3v-1a0 0 0 0 1 0 0v1a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-1a0 0 0 0 1 0 0v1a3 3 0 0 1 3-3z" />,
    Progress: <path d="M4 10h16v4H4z M4 12h12" />,
    Html: <path d="M9 8.5L5.5 12 9 15.5 M15 8.5l3.5 3.5L15 15.5" />,
    Divider: <path d="M4 12h16" />,
    Rectangle: <path d="M5 7h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />,
    Ellipse: <path d="M12 5.5c4.4 0 8 2.9 8 6.5s-3.6 6.5-8 6.5-8-2.9-8-6.5 3.6-6.5 8-6.5z" />,
  };
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || null}</svg>;
}

export default function ParticipantUiBuilder({ schema, onChange, defaultTemplate = 'instruction' }) {
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
  const [, setHistoryTick] = useState(0);
  const viewportRef = useRef(null);
  const panRef = useRef(null);
  const marqueeRef = useRef(null);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const elements = flatten(normalized.root);
  const selected = elements.find(item => item.element.id === selectedId)?.element || normalized.root;
  const validation = validateParticipantUi(normalized);
  const selectedParent = selectedId !== normalized.root.id ? findParentAndIndex(normalized.root, selectedId) : null;
  const selectedParentElement = selectedParent ? elements.find(item => item.element.id === selectedParent.parentId)?.element : null;
  const showPosition = Boolean(selectedParentElement?.props?.free) || (selected.props?.x != null && selected.props?.y != null);
  const deviceWidth = DEVICES.find(device => device.id === deviceId)?.width ?? null;
  const crumbs = pathTo(normalized.root, selected.id) || [];

  // Undo / redo history. Every mutation goes through commit() so the editor behaves
  // like a real builder (Ctrl+Z / Ctrl+Shift+Z), mirroring craft.js and friends.
  const historyRef = useRef({ stack: [normalized], cursor: 0 });
  useEffect(() => {
    const h = historyRef.current;
    if (JSON.stringify(h.stack[h.cursor]) !== JSON.stringify(normalized)) {
      historyRef.current = { stack: [normalized], cursor: 0 };
      setHistoryTick(tick => tick + 1);
    }
  }, [normalized]);

  const commit = next => {
    const h = historyRef.current;
    const current = h.stack[h.cursor];
    if (current && JSON.stringify(current) === JSON.stringify(next)) {
      onChange(next);
      return;
    }
    let stack = h.stack.slice(0, h.cursor + 1);
    stack.push(next);
    if (stack.length > 80) stack = stack.slice(stack.length - 80);
    historyRef.current = { stack, cursor: stack.length - 1 };
    setHistoryTick(tick => tick + 1);
    onChange(next);
  };

  const canUndo = historyRef.current.cursor > 0;
  const canRedo = historyRef.current.cursor < historyRef.current.stack.length - 1;
  const undo = () => {
    const h = historyRef.current;
    if (h.cursor <= 0) return;
    h.cursor -= 1;
    setHistoryTick(tick => tick + 1);
    onChange(h.stack[h.cursor]);
  };
  const redo = () => {
    const h = historyRef.current;
    if (h.cursor >= h.stack.length - 1) return;
    h.cursor += 1;
    setHistoryTick(tick => tick + 1);
    onChange(h.stack[h.cursor]);
  };

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

  const findInTree = (node, id) => {
    if (!node) return null;
    if (node.id === id) return node;
    for (const child of node.children || []) {
      const found = findInTree(child, id);
      if (found) return found;
    }
    return null;
  };

  const mapTree = (node, fn) => {
    const mapped = fn(node);
    return { ...mapped, children: (mapped.children || []).map(child => mapTree(child, fn)) };
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

  return <section className="participant-ui-builder">
    <div className="ui-builder-toolbar">
      <b className="ui-builder-title">Participant interface</b>
      <select aria-label="Template" value={templateKind} onChange={event => { const next = participantUiTemplate(event.target.value); setTemplateKind(event.target.value); commit(next); selectElement(next.root.id); }}>
        {TEMPLATE_KINDS.map(kind => <option key={kind} value={kind}>{kind}</option>)}
      </select>
      <button onClick={() => { const next = participantUiTemplate(templateKind); commit(next); selectElement(next.root.id); }}>Reset template</button>
      <span className="ui-toolbar-sep" />
      <button className="ui-history-btn" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">↶</button>
      <button className="ui-history-btn" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)">↷</button>
      <span className="ui-toolbar-sep" />
      <div className="ui-device-switch" role="group" aria-label="Canvas width">
        {DEVICES.map(device => <button key={device.id} type="button" className={deviceId === device.id ? 'active' : ''} onClick={() => setDeviceId(device.id)}>{device.label}</button>)}
      </div>
      <span className="ui-toolbar-sep" />
      <div className="ui-zoom-controls" role="group" aria-label="Canvas zoom">
        <button type="button" onClick={() => { const c = viewportCenter(); zoomAt(c.x, c.y, 0.9); }} title="Zoom out (Ctrl+wheel)">−</button>
        <span className="ui-zoom-value">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => { const c = viewportCenter(); zoomAt(c.x, c.y, 1.1); }} title="Zoom in (Ctrl+wheel)">+</button>
        <button type="button" onClick={fitView} title="Fit to view">Fit</button>
        <button type="button" onClick={resetView} title="Reset to 100%">1:1</button>
      </div>
      <label className="ui-snap-toggle" title="Snap to 8px grid while dragging"><input type="checkbox" checked={snapEnabled} onChange={event => setSnapEnabled(event.target.checked)} /> Snap</label>
      <button onClick={() => setPreview(value => !value)}>{preview ? 'Edit' : 'Preview'}</button>
      <button onClick={() => setStructureOpen(value => !value)}>Structure</button>
      <ThemeEditor schema={normalized} theme={theme} onChange={commit} />
    </div>

    {preview ? <div className="ui-builder-preview"><ParticipantRenderer schema={normalized} context={{ progress: { percent: 40 } }} preview /></div>
      : <div className="ui-canvas-layout">
        <div className="ui-element-library">
          <b className="ui-library-title">Elements</b>
          {LIBRARY_GROUPS.map(group => <div key={group.label} className="ui-library-group">
            <span className="ui-library-label">{group.label}</span>
            {group.types.map(type => (
              <div key={type} className="ui-library-block" draggable
                onClick={() => addToRoot(type)}
                onDragStart={event => {
                  event.dataTransfer.setData('application/x-physioflow-ui', JSON.stringify({ action: 'add', type }));
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                title={TYPE_HINTS[type]}>
                <UiIcon name={type} />
                <span className="ui-library-name">{type}</span>
                <small>{TYPE_HINTS[type]}</small>
              </div>
            ))}
          </div>)}
          <small className="ui-library-tip">Click to append · drag onto canvas · Del to remove</small>
        </div>
        <div className="ui-canvas-wrap" ref={viewportRef} onPointerDown={handleViewportPointerDown} onContextMenu={event => { if (event.target === event.currentTarget || !event.target.closest('[data-ui-id]')) closeContextMenu(); }}>
          <div className="ui-canvas-pan" ref={panRef} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            <div className="ui-canvas-device" style={deviceWidth ? { maxWidth: deviceWidth } : undefined}>
              <ParticipantUiCanvas schema={normalized} selectedId={selectedId} selectedIds={selectedIds} zoom={zoom} snapEnabled={snapEnabled}
                onSelect={selectElement} onDropElement={dropElement} onMoveElement={moveElement} onMoveElements={moveElements}
                onRemoveElement={removeElement} onDuplicateElement={duplicateElementById} onMoveStep={moveStep} onResizeElement={resizeElement}
                onUpdateText={updateText} onUpdateProp={updateProp} onContextMenu={openContextMenu} onRemoveSelected={removeSelected} onDuplicateSelected={duplicateSelected} onAlignSelected={alignSelected} />
            </div>
          </div>
          {marquee && <div className="ui-marquee" style={{ left: Math.min(marquee.x0, marquee.x1) * zoom + pan.x, top: Math.min(marquee.y0, marquee.y1) * zoom + pan.y, width: Math.abs(marquee.x1 - marquee.x0) * zoom, height: Math.abs(marquee.y1 - marquee.y0) * zoom }} />}
          {contextMenu && (() => {
            const menuElement = elements.find(item => item.element.id === contextMenu.elementId)?.element;
            return <div className="ui-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onMouseDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
              <b>{menuElement?.type || 'Element'}</b>
              <button type="button" onClick={() => { duplicateElementById(contextMenu.elementId); closeContextMenu(); }}>Duplicate</button>
              <button type="button" onClick={() => { copySelected(); closeContextMenu(); }}>Copy</button>
              <button type="button" disabled={!clipboardRef.current} onClick={() => { pasteClipboard(); closeContextMenu(); }}>Paste</button>
              <button type="button" onClick={() => { moveStep(contextMenu.elementId, -1); closeContextMenu(); }}>Move up</button>
              <button type="button" onClick={() => { moveStep(contextMenu.elementId, 1); closeContextMenu(); }}>Move down</button>
              <button type="button" onClick={() => { zOrderSelected('front', [contextMenu.elementId]); closeContextMenu(); }}>Bring to front</button>
              <button type="button" onClick={() => { zOrderSelected('back', [contextMenu.elementId]); closeContextMenu(); }}>Send to back</button>
              <button type="button" onClick={() => { focusStyle(contextMenu.elementId); closeContextMenu(); }}>Edit style</button>
              <button type="button" className="danger" onClick={() => { removeElement(contextMenu.elementId); closeContextMenu(); }}>Delete</button>
            </div>;
          })()}
        </div>
        <aside className="ui-inspector">
          <div className="ui-inspector-head">
            <UiIcon name={selected.type} />
            <span className="ui-inspector-name">
              <b>{selected.type}</b>
              {crumbs.length > 1 && <small>{crumbs.slice(0, -1).map(item => item.type).join(' / ')}</small>}
            </span>
            {selected.id !== normalized.root.id && <div className="ui-inspector-actions">
              <button title="Duplicate (Ctrl+D)" onClick={duplicateSelected}>⧉</button>
              <button className="danger" title="Delete (Del)" onClick={removeSelected}>×</button>
            </div>}
          </div>
          <UiPropertyEditor element={selected} onUpdate={updateProps} onToggleFree={toggleFree} />
          {showPosition && <div className="ui-property-grid"><b>Position</b>
            <label>X<input type="number" value={selected.props?.x ?? 0} onChange={event => updateProps({ x: Number(event.target.value) })} /></label>
            <label>Y<input type="number" value={selected.props?.y ?? 0} onChange={event => updateProps({ y: Number(event.target.value) })} /></label>
            <label>Width<input type="number" value={selected.props?.width ?? ''} placeholder="auto" onChange={event => updateProps({ width: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
            <label>Height<input type="number" value={selected.props?.height ?? ''} placeholder="auto" onChange={event => updateProps({ height: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
          </div>}
          <StyleEditor element={selected} theme={theme} onSetStyle={setStyle} forceOpen={styleForceOpen} onToggle={open => { if (!open) setStyleForceOpen(false); }} />
          {bindingTarget && <label className="ui-binding-field">Runtime binding for {bindingTarget}<input value={selected.bindings?.[bindingTarget] || ''} placeholder="e.g. variables.score" onChange={event => commit(mapUiElement(normalized, selected.id, element => ({ ...element, bindings: { ...element.bindings, [bindingTarget]: event.target.value } })))} /></label>}
          {selected.type === 'Button' && <div className="ui-property-grid">
            <label>Click action<select value={selected.actions?.[0]?.action || 'submit'} onChange={event => commit(mapUiElement(normalized, selected.id, element => ({ ...element, actions: [{ ...(element.actions?.[0] || { event: 'click' }), action: event.target.value }] })))}><option value="submit">submit</option><option value="next">next</option><option value="setVariable">setVariable</option></select></label>
            {selected.actions?.[0]?.action === 'setVariable' && <><label>Variable name<input value={selected.actions[0].name || ''} onChange={event => commit(mapUiElement(normalized, selected.id, element => ({ ...element, actions: [{ ...element.actions[0], name: event.target.value }] })))} /></label><label>Value<input value={selected.actions[0].value ?? ''} onChange={event => commit(mapUiElement(normalized, selected.id, element => ({ ...element, actions: [{ ...element.actions[0], value: event.target.value }] })))} /></label></>}
          </div>}
        </aside>
      </div>}

    {structureOpen && <div className="ui-tree">
      {elements.filter(entry => !isHidden(entry)).map(entry => {
        const { element, depth } = entry;
        const hasChildren = (element.children || []).length > 0;
        const isDropBefore = dragOver?.where === 'before' && dragOver.parentId === entry.parentId && dragOver.index === entry.childIndex;
        const isDropAfter = dragOver?.where === 'after' && dragOver.parentId === entry.parentId && dragOver.index === entry.childIndex + 1;
        const isDropInside = dragOver?.where === 'inside' && dragOver.parentId === element.id;
        return <div key={element.id} data-ui-id={element.id} className={`ui-row${isDropBefore ? ' drop-before' : ''}${isDropAfter ? ' drop-after' : ''}${isDropInside ? ' drop-inside' : ''}`}
          draggable={element.id !== normalized.root.id}
          onDragStart={event => {
            if (element.id === normalized.root.id) return;
            event.dataTransfer.setData('application/x-physioflow-ui', JSON.stringify({ action: 'move', elementId: element.id }));
            event.dataTransfer.effectAllowed = 'move';
            selectElement(element.id);
          }}
          onDragOver={event => {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            const y = event.clientY - rect.top;
            const h = rect.height || 1;
            if (element.id === normalized.root.id) {
              // Root row: drop means appending to the end of the top-level list.
              setDragOver({ parentId: normalized.root.id, index: -1, where: 'inside' });
              return;
            }
            if (CONTAINERS.has(element.type) && y > h / 3 && y < (h * 2) / 3) {
              // Middle of a container row: nest the dragged element inside it.
              setDragOver({ parentId: element.id, index: -1, where: 'inside' });
            } else {
              const before = y < h / 2;
              setDragOver({ parentId: entry.parentId, index: before ? entry.childIndex : entry.childIndex + 1, where: before ? 'before' : 'after' });
            }
          }}
          onDrop={event => {
            event.preventDefault();
            const raw = event.dataTransfer.getData('application/x-physioflow-ui');
            setDragOver(null);
            if (!raw || !dragOver) return;
            try {
              const payload = JSON.parse(raw);
              const dropIndex = dragOver.where === 'inside' && dragOver.index === -1
                ? (findInTree(normalized.root, dragOver.parentId)?.children?.length ?? 0)
                : dragOver.index;
              if (payload.action === 'add' && payload.type) {
                const elementToAdd = createUiElement(payload.type, { props: defaults[payload.type], actions: payload.type === 'Button' ? [{ event: 'click', action: 'submit' }] : [] });
                commit(insertUiElement(normalized, dragOver.parentId, dropIndex, elementToAdd));
                setSelectedId(elementToAdd.id);
              } else if (payload.action === 'move' && payload.elementId) {
                commit(moveUiElement(normalized, payload.elementId, dragOver.parentId, dropIndex));
                if (dragOver.where === 'inside' && dragOver.parentId !== normalized.root.id) {
                  setCollapsed(prev => { const next = new Set(prev); next.delete(dragOver.parentId); return next; });
                }
              }
            } catch (err) { console.error('[tree-drop-error]', err && err.message); }
          }}
          onDragLeave={() => setDragOver(null)}>
          <button className={`ui-tree-node${selectedId === element.id ? ' selected' : ''}`} style={{ paddingLeft: 8 + depth * 20 }} onClick={() => selectElement(element.id)}>
            {hasChildren
              ? <span className="ui-tree-toggle" onClick={event => { event.stopPropagation(); toggleCollapse(element.id); }}>{collapsed.has(element.id) ? '▸' : '▾'}</span>
              : <span className="ui-tree-toggle is-empty" />}
            <UiIcon name={element.type} />
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

function StyleEditor({ element, theme, onSetStyle, forceOpen = false, onToggle }) {
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
  if (element.type === 'Media') return <div className="ui-property-grid"><label>Media type<select value={props.mediaType || 'image'} onChange={event => onUpdate({ mediaType: event.target.value })}><option>image</option><option>audio</option><option>video</option></select></label><label>Source URL<input value={props.sourceUrl || ''} onChange={event => onUpdate({ sourceUrl: event.target.value })} /></label><label>Alt text<input value={props.alt || ''} onChange={event => onUpdate({ alt: event.target.value })} /></label><label>Fit<select value={props.fit || 'contain'} onChange={event => onUpdate({ fit: event.target.value })}><option>contain</option><option>cover</option><option>fill</option></select></label><label><input type="checkbox" checked={props.controls !== false} onChange={event => onUpdate({ controls: event.target.checked })} /> Show controls</label><label><input type="checkbox" checked={Boolean(props.autoPlay)} onChange={event => onUpdate({ autoPlay: event.target.checked })} /> Auto-play</label></div>;
  if (element.type === 'Input') return <div className="ui-property-grid"><label>Response name<input value={props.name || ''} onChange={event => onUpdate({ name: event.target.value })} /></label><label>Label<input value={props.label || ''} onChange={event => onUpdate({ label: event.target.value })} /></label><label>Input type<select value={props.inputType || 'text'} onChange={event => onUpdate({ inputType: event.target.value })}><option>text</option><option>textarea</option><option>number</option><option>rating</option><option>checkbox</option></select></label>{props.inputType !== 'checkbox' && <label>Placeholder<input value={props.placeholder || ''} onChange={event => onUpdate({ placeholder: event.target.value })} /></label>}<label><input type="checkbox" checked={Boolean(props.required)} onChange={event => onUpdate({ required: event.target.checked })} /> Required</label>{props.inputType === 'rating' && <><label>Min<input type="number" value={props.min ?? 1} onChange={event => onUpdate({ min: Number(event.target.value) })} /></label><label>Max<input type="number" value={props.max ?? 7} onChange={event => onUpdate({ max: Number(event.target.value) })} /></label></>}</div>;
  if (element.type === 'Button') return <div className="ui-property-grid"><label>Label<input value={props.label || ''} onChange={event => onUpdate({ label: event.target.value })} /></label><label>Variant<select value={props.variant || 'primary'} onChange={event => onUpdate({ variant: event.target.value })}><option>primary</option><option>secondary</option></select></label></div>;
  if (element.type === 'Progress') return <div className="ui-property-grid"><label>Label<input value={props.label || ''} onChange={event => onUpdate({ label: event.target.value })} /></label><label>Value<input type="number" value={props.value ?? 0} onChange={event => onUpdate({ value: Number(event.target.value) })} /></label><label>Maximum<input type="number" value={props.max ?? 100} onChange={event => onUpdate({ max: Number(event.target.value) })} /></label></div>;
  if (element.type === 'Html') return <div className="ui-property-grid"><label>HTML fragment<textarea value={props.html || ''} rows={5} onChange={event => onUpdate({ html: event.target.value })} /></label></div>;
  if (element.type === 'Divider') return <div className="ui-property-grid"><label>Orientation<select value={props.orientation || 'horizontal'} onChange={event => onUpdate({ orientation: event.target.value })}><option>horizontal</option><option>vertical</option></select></label><label>Thickness<input type="number" min="0.5" step="0.5" value={props.thickness ?? 1} onChange={event => onUpdate({ thickness: Number(event.target.value) })} /></label></div>;
  return null;
}
