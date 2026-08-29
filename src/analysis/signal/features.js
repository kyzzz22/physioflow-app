// Feature extraction: generic time-domain statistics, HRV (from an ECG-like or
// peak-train signal) and EDA decomposition.
//
// Every feature function takes plain arrays plus an explicit sample rate, so the
// same code path serves local session data and BioDB read-back.

import { describe, movingAverage, movingMedian } from './preprocess.js';
import { HRV_BANDS, bandPower, bandPowers, dominantFrequency, powerSpectralDensity } from './spectrum.js';

/** Generic time-domain + spectral description of one channel. */
export function signalFeatures(samples, sampleRateHz) {
  const stats = describe(samples);
  const psd = powerSpectralDensity(samples, sampleRateHz);
  const { values } = samples.some(v => v === null || v === undefined)
    ? { values: samples.filter(v => v !== null && v !== undefined && !Number.isNaN(v)) }
    : { values: samples };
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = q => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null);
  const rms = stats.n ? Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / stats.n) : null;
  return {
    n: stats.n,
    mean: stats.mean,
    sd: stats.sd,
    min: stats.min,
    max: stats.max,
    rms,
    median: quantile(0.5),
    p05: quantile(0.05),
    p95: quantile(0.95),
    range: stats.min !== null && stats.max !== null ? stats.max - stats.min : null,
    dominantFrequencyHz: dominantFrequency(psd),
    bands: psd.frequencies.length ? bandPowers(psd, HRV_BANDS) : null,
  };
}

/**
 * Detect peaks with an adaptive threshold on a smoothed, mean-removed signal.
 * A refractory period prevents one broad peak from being counted several times.
 * Returns indices into the original array.
 */
export function detectPeaks(samples, { sampleRateHz, refractorySeconds = 0.25, sensitivity = 0.4 } = {}) {
  if (!samples.length) return [];
  const refractory = Math.max(1, Math.round(refractorySeconds * (sampleRateHz || 1)));
  const centred = samples.map(v => v - (describe(samples).mean || 0));
  const smooth = movingAverage(centred, Math.max(1, Math.round(refractory / 3)));
  const amplitude = Math.max(...smooth.map(Math.abs)) || 1;
  const threshold = sensitivity * amplitude;
  const peaks = [];
  let lastPeak = -Infinity;
  for (let i = 1; i < smooth.length - 1; i += 1) {
    if (smooth[i] > threshold && smooth[i] >= smooth[i - 1] && smooth[i] >= smooth[i + 1] && i - lastPeak >= refractory) {
      peaks.push(i);
      lastPeak = i;
    }
  }
  return peaks;
}

/** Successive differences of the peak intervals, in milliseconds. */
export function rrIntervals(peakIndices, sampleRateHz) {
  const intervals = [];
  for (let i = 1; i < peakIndices.length; i += 1) {
    intervals.push(((peakIndices[i] - peakIndices[i - 1]) / sampleRateHz) * 1000);
  }
  return intervals;
}

/** Time-domain HRV: SDNN, RMSSD, pNN50 and mean heart rate. */
export function hrvTimeDomain(intervals) {
  const n = intervals.length;
  if (n < 2) return { n, meanRR: null, meanHR: null, sdnn: null, rmssd: null, pnn50: null };
  const meanRR = intervals.reduce((sum, v) => sum + v, 0) / n;
  const variance = intervals.reduce((sum, v) => sum + (v - meanRR) ** 2, 0) / (n - 1);
  const diffs = intervals.slice(1).map((v, i) => v - intervals[i]);
  const rmssd = diffs.length ? Math.sqrt(diffs.reduce((sum, d) => sum + d * d, 0) / diffs.length) : null;
  const pnn50 = diffs.length ? (diffs.filter(d => Math.abs(d) > 50).length / diffs.length) * 100 : null;
  return {
    n,
    meanRR,
    meanHR: meanRR > 0 ? 60000 / meanRR : null,
    sdnn: Math.sqrt(variance),
    rmssd,
    pnn50,
  };
}

/**
 * Frequency-domain HRV on the interpolated RR tachogram.
 * Uses a 4 Hz interpolation grid, the conventional rate for HRV spectra.
 */
export function hrvFrequencyDomain(intervals, { interpolationHz = 4 } = {}) {
  if (intervals.length < 4) return { vlf: null, lf: null, hf: null, lfHfRatio: null, totalPower: null };
  const totalMs = intervals.reduce((sum, v) => sum + v, 0);
  const grid = Array.from({ length: Math.max(2, Math.round(totalMs / 1000 * interpolationHz)) }, (_, i) => i / interpolationHz);
  const times = [0];
  for (const interval of intervals) times.push(times[times.length - 1] + interval / 1000);
  const values = [intervals[0], ...intervals];
  const resampled = grid.map((t) => {
    if (t <= times[0]) return values[0];
    if (t >= times[times.length - 1]) return values[values.length - 1];
    let k = 0;
    while (k + 1 < times.length && times[k + 1] < t) k += 1;
    const span = times[k + 1] - times[k] || 1;
    return values[k] + (values[k + 1] - values[k]) * ((t - times[k]) / span);
  });
  const mean = resampled.reduce((sum, v) => sum + v, 0) / resampled.length;
  const detrended = resampled.map(v => v - mean);
  const psd = powerSpectralDensity(detrended, interpolationHz);
  if (!psd.frequencies.length) return { vlf: null, lf: null, hf: null, lfHfRatio: null, totalPower: null };
  const vlf = bandPower(psd, ...HRV_BANDS.vlf);
  const lf = bandPower(psd, ...HRV_BANDS.lf);
  const hf = bandPower(psd, ...HRV_BANDS.hf);
  const total = vlf.absolute + lf.absolute + hf.absolute;
  return {
    vlf: vlf.absolute,
    lf: lf.absolute,
    hf: hf.absolute,
    lfHfRatio: hf.absolute > 0 ? lf.absolute / hf.absolute : null,
    totalPower: total,
  };
}

/** Full HRV report from the raw signal: peak detection -> intervals -> both domains. */
export function hrv(samples, { sampleRateHz, sensitivity, refractorySeconds } = {}) {
  const peaks = detectPeaks(samples, { sampleRateHz, sensitivity, refractorySeconds });
  const intervals = rrIntervals(peaks, sampleRateHz);
  const artifacts = intervals.filter(v => v < 300 || v > 2000).length;
  const plausible = intervals.filter(v => v >= 300 && v <= 2000);
  return {
    peakCount: peaks.length,
    rejectedIntervals: artifacts,
    time: hrvTimeDomain(plausible),
    frequency: hrvFrequencyDomain(plausible),
  };
}

/**
 * Split EDA into its tonic (slow baseline) and phasic (fast) components with a
 * moving-median trend, then count skin conductance responses.
 * `tonicWindowSeconds` should be a few seconds; the default follows the common
 * 4 s choice for electrodermal work.
 */
export function eda(samples, { sampleRateHz, tonicWindowSeconds = 4, threshold = 0.01 } = {}) {
  const window = Math.max(3, Math.round(tonicWindowSeconds * sampleRateHz));
  const tonic = movingMedian(samples, window);
  const phasic = samples.map((v, i) => v - tonic[i]);
  const positive = phasic.filter(v => v > 0);
  const scrPeaks = detectPeaks(phasic, { sampleRateHz, sensitivity: 0.3, refractorySeconds: 1 })
    .filter(i => phasic[i] >= threshold);
  const amplitude = describe(positive);
  return {
    tonic: describe(tonic),
    phasic: describe(phasic),
    scrCount: scrPeaks.length,
    scrRatePerMinute: scrPeaks.length / Math.max(1e-9, samples.length / sampleRateHz / 60),
    scrMeanAmplitude: amplitude.mean,
    scrMaxAmplitude: amplitude.max,
  };
}

/**
 * Feature set for one channel, dispatched on the channel id/unit when known.
 * Channels with no recognised physiology fall back to the generic description,
 * which is always safe to compute.
 */
export function featuresForChannel(channelId, samples, { sampleRateHz, unit } = {}) {
  const id = String(channelId || '').toLowerCase();
  const generic = signalFeatures(samples, sampleRateHz);
  if (/(ecg|ekg|hr|ppg|bvp|blood_volume)/.test(id) && /bpm|beats/.test(String(unit || '').toLowerCase())) {
    return { kind: 'heartRate', generic, hrv: hrv(samples, { sampleRateHz }) };
  }
  if (/(ecg|ekg|ppg|bvp|blood_volume)/.test(id)) {
    return { kind: 'cardiac', generic, hrv: hrv(samples, { sampleRateHz }) };
  }
  if (/(eda|gsr|electrodermal|skin_conductance)/.test(id) || /µs|us|microsiemens/.test(String(unit || '').toLowerCase())) {
    return { kind: 'eda', generic, eda: eda(samples, { sampleRateHz }) };
  }
  if (/(eeg|tp9|af7|af8|tp10|aux)/.test(id) || /uv|µv/.test(String(unit || '').toLowerCase())) {
    return { kind: 'eeg', generic };
  }
  return { kind: 'generic', generic };
}
