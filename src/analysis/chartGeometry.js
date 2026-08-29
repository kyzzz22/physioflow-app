// Chart geometry: pure functions that turn sample arrays into SVG-ready
// coordinates, scales, ticks and paths.
//
// Keeping this separate from the React components means the maths that decides
// what a chart looks like can be unit tested in Node, without a DOM. The
// components only render what these functions return.

/**
 * Min/max bucket decimation: one retained pair per horizontal pixel.
 *
 * Drawing every sample of a long record is both slow and misleading — at 256 Hz
 * a five-minute EEG is 76,800 points squeezed into ~600 pixels. Keeping the min
 * and max of each bucket preserves the visual envelope (peaks are not averaged
 * away), which is what the eye actually reads.
 *
 * Returns the retained points in draw order, or the input unchanged when it is
 * already small enough to draw directly.
 */
export function decimateMinMax(values, maxPoints) {
  if (!Array.isArray(values)) return [];
  const limit = Math.max(2, Math.floor(maxPoints));
  if (values.length <= limit) return values.map((v, i) => ({ index: i, value: v }));
  const bucketSize = values.length / limit;
  const out = [];
  for (let bucket = 0; bucket < limit; bucket += 1) {
    const start = Math.floor(bucket * bucketSize);
    const end = Math.min(values.length, Math.floor((bucket + 1) * bucketSize));
    if (start >= end) continue;
    let min = Infinity;
    let max = -Infinity;
    let minIndex = start;
    let maxIndex = start;
    for (let i = start; i < end; i += 1) {
      const v = values[i];
      if (v === null || v === undefined || !Number.isFinite(v)) continue;
      if (v < min) { min = v; minIndex = i; }
      if (v > max) { max = v; maxIndex = i; }
    }
    if (min === Infinity) continue;
    // Emit in index order so the path never doubles back on itself.
    if (minIndex <= maxIndex) {
      out.push({ index: minIndex, value: min });
      if (maxIndex !== minIndex) out.push({ index: maxIndex, value: max });
    } else {
      out.push({ index: maxIndex, value: max });
      out.push({ index: minIndex, value: min });
    }
  }
  return out;
}

/** Finite extent of a value list; null when there is nothing to plot. */
export function extent(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values || []) {
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min === Infinity ? { min: null, max: null } : { min, max };
}

/**
 * Pad an extent so the line does not touch the frame, and give a zero-range
 * series a symmetric band around its single value instead of collapsing.
 */
export function padExtent({ min, max }, { paddingRatio = 0.05, symmetricZeroRange = 0.5 } = {}) {
  if (min === null || max === null) return { min: null, max: null };
  if (min === max) return { min: min - symmetricZeroRange, max: max + symmetricZeroRange };
  const pad = (max - min) * paddingRatio;
  return { min: min - pad, max: max + pad };
}

/** Combined extent across several series, so shared axes line up. */
export function combinedExtent(seriesList) {
  let min = Infinity;
  let max = -Infinity;
  for (const values of seriesList) {
    const e = extent(values);
    if (e.min === null) continue;
    if (e.min < min) min = e.min;
    if (e.max > max) max = e.max;
  }
  return min === Infinity ? { min: null, max: null } : { min, max };
}

/**
 * Build the linear maps from data space to pixel space.
 * `count` is the number of samples on the x axis; the last sample sits on the
 * right edge so the trace fills the width.
 */
export function createScales({ count, min, max, width, height, padding }) {
  const innerW = Math.max(1, width - padding.left - padding.right);
  const innerH = Math.max(1, height - padding.top - padding.bottom);
  const span = max - min || 1;
  const denom = Math.max(1, count - 1);
  return {
    innerW,
    innerH,
    x: index => padding.left + (index / denom) * innerW,
    y: value => padding.top + (1 - (value - min) / span) * innerH,
    // Inverse maps, used for hover readout and for turning a drag into a window.
    xInverse: px => ((px - padding.left) / innerW) * denom,
    yInverse: py => min + (1 - (py - padding.top) / innerH) * span,
  };
}

/**
 * "Nice" axis ticks: a round step that yields roughly `targetCount` intervals.
 * Falls back to the raw endpoints when the range is degenerate.
 */
export function niceTicks(min, max, targetCount = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return Number.isFinite(min) ? [min] : [];
  }
  const rawStep = (max - min) / Math.max(1, targetCount);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * magnitude;
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-9; t += step) {
    ticks.push(Math.abs(t) < step * 1e-9 ? 0 : t);
  }
  return ticks;
}

/**
 * SVG path for a series. Null samples break the path into separate subpaths
 * instead of being drawn as zeros — a gap must look like a gap.
 */
export function seriesPath(points, scales, { closeGaps = false } = {}) {
  if (!points.length) return '';
  let path = '';
  let penDown = false;
  for (const point of points) {
    const value = point.value;
    if (value === null || value === undefined || !Number.isFinite(value)) {
      if (!closeGaps) penDown = false;
      continue;
    }
    const x = scales.x(point.index).toFixed(2);
    const y = scales.y(value).toFixed(2);
    path += `${penDown ? 'L' : 'M'}${x} ${y}`;
    penDown = true;
  }
  return path;
}

/** Closed path filling the area under a series (for the first trace). */
export function areaPath(points, scales, baseline) {
  if (points.length < 2) return '';
  const line = seriesPath(points, scales, { closeGaps: true });
  if (!line) return '';
  const firstX = scales.x(points[0].index).toFixed(2);
  const lastX = scales.x(points[points.length - 1].index).toFixed(2);
  const baseY = scales.y(baseline).toFixed(2);
  return `${line}L${lastX} ${baseY}L${firstX} ${baseY}Z`;
}

/** Distinct, colour-blind-safe series colours (Okabe-Ito palette). */
export const SERIES_COLORS = Object.freeze([
  '#0072B2', '#E69F00', '#009E73', '#CC79A7',
  '#56B4E9', '#D55E00', '#F0E442', '#000000',
]);

export const seriesColor = index => SERIES_COLORS[index % SERIES_COLORS.length];

/**
 * Place events on the timeline. Events are matched to the nearest sample index
 * so a marker recorded between samples still lands in the right place, and
 * events outside the plotted window are dropped rather than pinned to an edge.
 */
export function eventMarkers(events, times, scales) {
  if (!Array.isArray(events) || !events.length || !Array.isArray(times) || !times.length) return [];
  const stamps = times.map(t => Date.parse(t));
  const first = stamps[0];
  const last = stamps[stamps.length - 1];
  if (!Number.isFinite(first) || !Number.isFinite(last)) return [];
  const out = [];
  for (const event of events) {
    const at = Date.parse(event.time || event.timestamp || event.start_time);
    if (!Number.isFinite(at) || at < first || at > last) continue;
    // Binary search for the nearest sample index.
    let lo = 0;
    let hi = stamps.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (stamps[mid] < at) lo = mid + 1;
      else hi = mid;
    }
    const prev = Math.max(0, lo - 1);
    const index = Math.abs(stamps[prev] - at) <= Math.abs(stamps[lo] - at) ? prev : lo;
    out.push({
      index,
      x: scales.x(index),
      label: event.event_name || event.name || event.event_id || '',
      id: event.event_id || `${at}-${out.length}`,
      time: event.time || event.timestamp || event.start_time,
    });
  }
  return out;
}

/**
 * Format an ISO timestamp for an axis label, in UTC.
 *
 * BioDB stores timestamps in UTC, and the axis must show the same instant to
 * every viewer: using local-time getters would render one record differently
 * depending on where it is opened, which makes screenshots and exports
 * irreproducible across a distributed team.
 */
export function formatAxisTime(iso, { withDate = false } = {}) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
  if (!withDate) return time;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${time}`;
}

/** Evenly spaced time ticks across the plotted window. */
export function timeTicks(times, count = 5) {
  if (!Array.isArray(times) || times.length < 2) return [];
  const lastIndex = times.length - 1;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const index = Math.round((lastIndex * i) / (count - 1));
    out.push({ index, time: times[index] });
  }
  return out;
}

/**
 * Normalise each series independently into 0..1 so channels with different
 * units (uV, uS, bpm) can share one plot.
 *
 * The scale is per channel, not global: a global extent would let the largest
 * channel dominate — an EDA trace in microsiemens would flatten an EEG trace in
 * microvolts to a straight line. Per-channel scaling preserves each trace's
 * shape, at the cost of making absolute magnitudes non-comparable across
 * channels, which the UI must state.
 */
export function normalizeSeries(seriesList) {
  return seriesList.map((values) => {
    const { min, max } = extent(values);
    if (min === null) return [];
    const span = max - min || 1;
    return values.map(v => (
      v === null || v === undefined || !Number.isFinite(v) ? null : (v - min) / span
    ));
  });
}

/**
 * Valence/arousal points for the affect map.
 * Accepts either numeric fields or the 1..9 SAM scale; SAM is rescaled to -1..1
 * so both sources can share one plot.
 */
export function affectPoints(responses, { scale = 'sam' } = {}) {
  const toUnit = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return scale === 'sam' ? (n - 5) / 4 : n;
  };
  const out = [];
  for (const response of responses || []) {
    const valence = toUnit(response?.valence ?? response?.v);
    const arousal = toUnit(response?.arousal ?? response?.a);
    if (valence === null || arousal === null) continue;
    out.push({ valence, arousal, label: response.label || response.stepId || '', index: out.length });
  }
  return out;
}

/** Quadrant labels for the valence/arousal circumplex. */
export function affectQuadrant({ valence, arousal }) {
  if (valence >= 0 && arousal >= 0) return 'excited';
  if (valence >= 0 && arousal < 0) return 'calm';
  if (valence < 0 && arousal >= 0) return 'stressed';
  return 'sad';
}
