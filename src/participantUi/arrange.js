// Pure layout helpers for the participant-interface builder.
//
// The canvas uses free (absolute) positioning only inside containers whose
// `props.free` is true; children there carry `props.x`/`props.y` in local
// (un-zoomed) units. These helpers compute tidy, non-overlapping placements for
// those children on the 8px grid so that converting a container to free layout
// (or re-arranging one that is already free) never scatters elements the way the
// old hard-coded stagger did.

export const GRID = 8;

export function snap(value, step = GRID) {
  if (!Number.isFinite(Number(value))) return 0;
  return Math.round(Number(value) / step) * step;
}

// Nominal rendered height of an element in local units. Explicit props.height wins
// (shapes, resized elements); otherwise we use a per-type estimate that keeps a
// tidy stack from overlapping. These are starting points the designer then refines
// by dragging/resizing — they never change props.
export function elementHeight(element) {
  const props = element?.props || {};
  if (props.height != null && Number.isFinite(Number(props.height))) return Math.max(0, Number(props.height));
  switch (element?.type) {
    case 'Text': return props.variant === 'heading' ? 48 : 26;
    case 'Media': return 220;
    case 'Input': return 68;
    case 'Button': return 42;
    case 'Progress': return 28;
    case 'Html': return 160;
    case 'Divider': return props.orientation === 'vertical' ? 160 : 13;
    case 'Layout': return 120;
    case 'Rectangle':
    case 'Ellipse': return 80;
    default: return 48;
  }
}

// Nominal width of an element in local units (used to reserve space when an item is
// pinned during auto-conversion, and to decide row width in future multi-column
// layouts). Explicit props.width wins.
export function elementWidth(element) {
  const props = element?.props || {};
  if (props.width != null && Number.isFinite(Number(props.width))) return Math.max(0, Number(props.width));
  switch (element?.type) {
    case 'Text': return 320;
    case 'Media': return 320;
    case 'Input': return 280;
    case 'Button': return 160;
    case 'Progress': return 240;
    case 'Html': return 320;
    case 'Divider': return 120;
    case 'Layout': return 560;
    case 'Rectangle':
    case 'Ellipse': return 120;
    default: return 200;
  }
}

// Horizontal inset where a container's free children should start. A Screen has a
// padding (default 32); a free Layout has none (its children start at its edge).
export function contentXOf(container) {
  if (!container) return 0;
  if (container.type === 'Screen') return snap(Number(container.props?.padding ?? 32));
  return 0;
}

/**
 * Lay direct children out as a tidy single column.
 *
 * @param {Array<{id:string, type:string, props?:object}>} children
 * @param {{x?:number, startY?:number, gap?:number}} options
 * @returns {Array<{id:string, x:number, y:number}>} grid-aligned, non-overlapping positions
 *
 * Every element gets the same snapped left edge and rows advance by the element's
 * nominal height plus a uniform gap, so the result is aligned on the 8px grid and
 * nothing overlaps — the baseline a designer drags from (or the result of Auto-arrange).
 */
export function tidyStack(children, { x = 0, startY = 0, gap = 16 } = {}) {
  const left = snap(x);
  let cursor = snap(startY);
  const positions = [];
  for (const child of children) {
    positions.push({ id: child.id, x: left, y: cursor });
    // Snap every row start so the whole stack stays aligned on the 8px grid.
    cursor = snap(cursor + elementHeight(child) + gap);
  }
  return positions;
}

// Find the next free slot (top-left, local units) to insert a new element below the
// existing free children so it never overlaps them. `placements` is the current
// [{ id, x, y, height }] of that container's children (height may be nominal).
export function nextFreeSlot(children, { x = 0, gap = 16, first = 0 } = {}) {
  let bottom = Number.isFinite(first) ? first : 0;
  for (const child of children) {
    const y = child.props?.y;
    if (y == null) continue;
    bottom = Math.max(bottom, Number(y) + elementHeight(child));
  }
  return { x: snap(x), y: snap(bottom + gap) };
}
