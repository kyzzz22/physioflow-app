// Signal preprocessing for the analysis pipeline: gap filling, resampling,
// smoothing/filtering and artefact rejection.
//
// Everything here is pure and operates on plain arrays so it can run in the
// browser, in Node tests, or over data read back from BioDB.

/** Drop null/undefined/NaN entries, keeping the index of the values that remain. */
export function compact(samples) {
  const values = [];
  const indices = [];
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i];
    if (value === null || value === undefined || Number.isNaN(value)) continue;
    values.push(value);
    indices.push(i);
  }
  return { values, indices };
}

/** Mean, stddev, min, max — null-safe over the finite values only. */
export function describe(samples) {
  const { values } = compact(samples);
  const n = values.length;
  if (!n) return { n: 0, mean: null, sd: null, min: null, max: null };
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = n > 1 ? values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1) : 0;
  return { n, mean, sd: Math.sqrt(variance), min: Math.min(...values), max: Math.max(...values) };
}

/**
 * Fill missing samples by linear interpolation between the neighbours that exist.
 * Leading and trailing gaps are filled with the nearest observed value, because
 * extrapolating a physiological signal is not defensible.
 */
export function fillGaps(samples) {
  if (!samples.length) return [];
  const out = [...samples];
  const { indices } = compact(samples);
  if (!indices.length) return out;
  for (let i = 0; i < indices[0]; i += 1) out[i] = out[indices[0]];
  for (let i = indices[indices.length - 1] + 1; i < out.length; i += 1) out[i] = out[indices[indices.length - 1]];
  for (let k = 0; k + 1 < indices.length; k += 1) {
    const from = indices[k];
    const to = indices[k + 1];
    if (to - from < 2) continue;
    const span = to - from;
    const start = out[from];
    const step = (out[to] - start) / span;
    for (let i = from + 1; i < to; i += 1) out[i] = start + step * (i - from);
  }
  return out;
}

/**
 * Resample to a new rate by linear interpolation on the sample timeline.
 * `sourceHz` and `targetHz` are both required: inferring the source rate from
 * timestamps would silently hide gaps.
 */
export function resample(samples, sourceHz, targetHz) {
  if (!(sourceHz > 0) || !(targetHz > 0)) throw new Error('sourceHz and targetHz must be positive');
  if (!samples.length || sourceHz === targetHz) return [...samples];
  const ratio = targetHz / sourceHz;
  const outLength = Math.max(1, Math.floor((samples.length - 1) * ratio) + 1);
  const out = new Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const position = i / ratio;
    const low = Math.floor(position);
    const high = Math.min(low + 1, samples.length - 1);
    const frac = position - low;
    out[i] = samples[low] + (samples[high] - samples[low]) * frac;
  }
  return out;
}

/** Moving average. `window` is in samples and is clamped to an odd length. */
export function movingAverage(samples, window) {
  const size = Math.max(1, Math.floor(window));
  if (size <= 1 || !samples.length) return [...samples];
  const half = Math.floor(size / 2);
  const out = samples.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(samples.length - 1, i + half); k += 1) { sum += samples[k]; count += 1; }
    return sum / count;
  });
  return out;
}

/** Moving median — far more effective than a mean for spike artefacts. */
export function movingMedian(samples, window) {
  const size = Math.max(1, Math.floor(window));
  if (size <= 1 || !samples.length) return [...samples];
  const half = Math.floor(size / 2);
  return samples.map((_, i) => {
    const slice = samples.slice(Math.max(0, i - half), Math.min(samples.length, i + half + 1))
      .filter(v => v !== null && v !== undefined && !Number.isNaN(v));
    if (!slice.length) return NaN;
    slice.sort((a, b) => a - b);
    const mid = Math.floor(slice.length / 2);
    return slice.length % 2 ? slice[mid] : (slice[mid - 1] + slice[mid]) / 2;
  });
}

/**
 * Remove a slowly varying baseline with a moving-median trend.
 * The window should span at least one full cycle of the slowest component you
 * want to remove (for EDA tonic, a few seconds at the sample rate).
 */
export function detrend(samples, windowSeconds, sampleRateHz) {
  const window = Math.max(3, Math.round((windowSeconds || 1) * sampleRateHz));
  const trend = movingMedian(samples, window);
  return samples.map((v, i) => v - trend[i]);
}

/**
 * Artefact rejection for transient spikes (electrode pops, motion bursts).
 *
 * Works on the first difference rather than on the deviation from a moving
 * median: a spike shows up as a sudden jump between neighbours, while the
 * normal physiological variation between adjacent samples stays small. Using a
 * moving-median residual instead would flag ordinary signal excursions, because
 * a median filter lags any curving signal and leaves a systematic residual.
 *
 * The scale is the median absolute deviation of the differences (times 1.4826,
 * the consistency constant for a normal distribution), so a few large artefacts
 * do not inflate the threshold and mask themselves.
 *
 * Returns the cleaned signal plus the indices that were replaced, so callers can
 * report how much of the record was affected instead of silently discarding it.
 */
export function rejectArtefacts(samples, { threshold = 4, window = 31 } = {}) {
  if (samples.length < 3) return { cleaned: [...samples], rejected: [] };
  const diffs = samples.slice(1).map((v, i) => v - samples[i]);
  const finite = diffs.filter(v => Number.isFinite(v)).map(Math.abs).sort((a, b) => a - b);
  const medianAbsDiff = finite.length ? finite[Math.floor(finite.length / 2)] : 0;
  const scale = 1.4826 * medianAbsDiff;
  if (!(scale > 0)) return { cleaned: [...samples], rejected: [] };

  const rejectedSet = new Set();
  for (let i = 0; i < diffs.length; i += 1) {
    if (Math.abs(diffs[i]) > threshold * scale) {
      // A single spike produces one large step up and one back down; mark both ends.
      rejectedSet.add(i);
      rejectedSet.add(i + 1);
    }
  }
  const rejected = [...rejectedSet].sort((a, b) => a - b);
  const local = movingMedian(samples, window);
  const cleaned = [...samples];
  for (const index of rejected) cleaned[index] = local[index];
  return { cleaned, rejected };
}

/**
 * Convenience chain: fill gaps -> reject artefacts -> detrend -> smooth.
 * Each step is opt-in so callers can see which stage changed the signal.
 */
export function preprocess(samples, options = {}) {
  const {
    sampleRateHz,
    fillGaps: doFill = true,
    artefactThreshold,
    detrendSeconds,
    smoothWindow,
  } = options;
  let out = doFill ? fillGaps(samples) : [...samples];
  let rejected = [];
  if (artefactThreshold !== undefined && artefactThreshold !== null) {
    const result = rejectArtefacts(out, { threshold: artefactThreshold, window: options.artefactWindow });
    out = result.cleaned;
    rejected = result.rejected;
  }
  if (detrendSeconds && sampleRateHz) out = detrend(out, detrendSeconds, sampleRateHz);
  if (smoothWindow) out = movingAverage(out, smoothWindow);
  return { samples: out, rejected };
}
