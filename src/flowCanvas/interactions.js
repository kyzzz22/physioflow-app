// Pure geometry / interaction helpers for FlowCanvas.
// No React imports: kept free of component state so the exact maths can be
// unit-tested and reused across layers without triggering re-renders.

import { GRID_SIZE, SNAP_THRESHOLD, nodeHeight, nodeWidth } from './layout.js';

// Snap a viewport coordinate to the layout grid when grid snap is enabled.
export const snapToGrid = (v, enabled) => (enabled ? Math.round(v / GRID_SIZE) * GRID_SIZE : v);

// --- Node port geometry ------------------------------------------------------
// Mirrors the CSS card box (see .flow-node) so edges attach to the same spots
// the pointer interaction targets.
export const nodePortGeometry = (node, isSource) => {
  const noteH = node.height || 100;
  const nodeW = 180;
  const inputPortY = 13; // matches CSS .node-input { top: 13px }
  // Estimate node height: title(~28px) + rule/meta(~14px) + outputs(~24px) = ~66px
  const hasRule = (node.type === 'condition' || node.type === 'loop') ? 14 : 0;
  const hasMeta = node.type === 'event' ? 14 : 0;
  const estimatedH = 28 + hasRule + hasMeta + 24;
  const outputPortY = estimatedH - 10; // near bottom of card
  return isSource
    ? { x: node.x + (node.type === 'junction' ? 10 : nodeW), y: node.y + (node.type === 'junction' ? 10 : node.type === 'note' ? noteH / 2 : outputPortY) }
    : { x: node.x + (node.type === 'junction' ? 0 : -1), y: node.y + (node.type === 'junction' ? 10 : node.type === 'note' ? noteH / 2 : inputPortY) };
};

// --- Drag alignment guides ---------------------------------------------------
// Compare the dragged box (anchored at nx/ny with the fixed card box) against
// every other node; return axis-aligned guide lines within SNAP_THRESHOLD.
export const buildAlignmentGuides = (nx, ny, nodes, excludeId) => {
  const guides = [];
  const dcx = nx + 92, dcy = ny + 52, dl = nx, dr = nx + 184, dt = ny, db = ny + 104;
  (nodes || []).forEach(node => {
    if (node.id === excludeId) return;
    const ocx = node.x + 92, ocy = node.y + 52, ol = node.x, or = node.x + 184, ot = node.y, ob = node.y + 104;
    if (Math.abs(dcx - ocx) < SNAP_THRESHOLD) guides.push({ orientation: 'v', pos: ocx });
    if (Math.abs(dcy - ocy) < SNAP_THRESHOLD) guides.push({ orientation: 'h', pos: ocy });
    if (Math.abs(dl - ol) < SNAP_THRESHOLD) guides.push({ orientation: 'v', pos: ol });
    if (Math.abs(dr - or) < SNAP_THRESHOLD) guides.push({ orientation: 'v', pos: or });
    if (Math.abs(dt - ot) < SNAP_THRESHOLD) guides.push({ orientation: 'h', pos: ot });
    if (Math.abs(db - ob) < SNAP_THRESHOLD) guides.push({ orientation: 'h', pos: ob });
  });
  return guides;
};

// --- Marquee selection -------------------------------------------------------
// Return the ids of nodes whose fixed card box intersects the marquee rect.
export const computeMarqueeSelection = (nodes, marquee) => {
  const selection = [];
  (nodes || []).forEach(node => {
    const left = node.x, right = node.x + 180, top = node.y, bottom = node.y + 55;
    if (right > marquee.x1 && left < marquee.x2 && bottom > marquee.y1 && top < marquee.y2) selection.push(node.id);
  });
  return selection;
};

// --- Derived flow geometry ----------------------------------------------------
export const boundsOf = nodes => {
  if (!nodes || !nodes.length) return { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    const w = nodeWidth(n), h = nodeHeight(n);
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + h);
  });
  return { minX: minX - 40, minY: minY - 40, maxX: maxX + 40, maxY: maxY + 40 };
};

// Fit a rect (e.g. the visible viewport) to the flow bounds.
export const fitViewTransform = (bounds, rect) => {
  const worldW = bounds.maxX - bounds.minX;
  const worldH = bounds.maxY - bounds.minY;
  const scale = Math.min(rect.width / worldW, rect.height / worldH, 1.25);
  const zoom = Math.min(2, Math.max(0.3, scale));
  const cx = (bounds.minX + bounds.maxX) / 2, cy = (bounds.minY + bounds.maxY) / 2;
  return { zoom, pan: { x: rect.width / 2 - cx * zoom, y: rect.height / 2 - cy * zoom } };
};

// Breadth-first layout starting from the `start` node: assign each node a column
// level, then stagger rows. Group nodes and grouped members keep their position.
export const autoLayoutPositions = (nodes, edges) => {
  const start = nodes.find(n => n.type === 'start');
  const levels = new Map(start ? [[start.id, 0]] : []);
  if (!start) return nodes;
  const queue = [start.id]; let qhead = 0;
  while (qhead < queue.length) {
    const id = queue[qhead++], lvl = levels.get(id);
    (edges || []).filter(e => e.source === id).forEach(e => {
      if (!levels.has(e.target)) { levels.set(e.target, lvl + 1); queue.push(e.target); }
    });
  }
  const counts = {};
  return nodes.map((n, i) => {
    if (n.type === 'group' || n.group_id) return n;
    const lvl = levels.get(n.id) ?? i;
    counts[lvl] = (counts[lvl] || 0) + 1;
    return { ...n, x: 80 + lvl * 250, y: 90 + (counts[lvl] - 1) * 150 };
  });
};

// Convert a drop client coordinate into snapped canvas coordinates.
export const dropPosition = (clientX, clientY, rect, pan, zoom, snapEnabled) => {
  const gx = (clientX - rect.left - pan.x) / zoom;
  const gy = (clientY - rect.top - pan.y) / zoom;
  return {
    x: snapToGrid(Math.round(gx / GRID_SIZE) * GRID_SIZE, snapEnabled),
    y: snapToGrid(Math.round(gy / GRID_SIZE) * GRID_SIZE, snapEnabled),
  };
};
