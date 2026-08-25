// Pure layout / geometry helpers for the legacy flow canvas.
// No React, no component state — safe to reuse anywhere.

export const branchesFor = node => ['note', 'group'].includes(node.type) ? [] : node.type === 'condition' ? ['true', 'false'] : node.type === 'loop' ? ['body', 'exit'] : ['next'];
export const nodeWidth = n => n.type === 'note' ? (n.width || 180) : n.type === 'junction' ? 20 : n.type === 'group' ? (n.width || 240) : 180;
export const nodeHeight = n => n.type === 'note' ? (n.height || 100) : n.type === 'junction' ? 20 : n.type === 'group' ? (n.height || 160) : 55;
// Orthogonal (Z-shaped) routing for forward edges; smooth curve fallback for back-edges
export const edgePath = (x1, y1, x2, y2) => {
  const m = x1 + (x2 - x1) / 2;
  if (x2 >= x1) return `M${x1},${y1} L${m},${y1} L${m},${y2} L${x2},${y2}`;
  return `M${x1},${y1} C${x1 + 60},${y1} ${x2 - 60},${y2} ${x2},${y2}`;
};
// Branch semantics: color + dash convey flow meaning
export const branchStyle = branch => {
  switch (branch) {
    case 'true': return { stroke: '#16a34a', dash: undefined };
    case 'false': return { stroke: '#dc2626', dash: '6 4' };
    case 'body': return { stroke: '#2563eb', dash: undefined };
    case 'exit': return { stroke: '#94a3b8', dash: '6 4' };
    default: return { stroke: '#8f9d95', dash: undefined };
  }
};

export const GRID_SIZE = 24;
export const SNAP_THRESHOLD = 4;
export const SCROLL_EDGE = 40;
export const SCROLL_SPEED = 8;
