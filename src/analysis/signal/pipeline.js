// Analysis pipeline orchestration: run preprocessing + feature extraction over a
// session's channels and render the result in a form that can be exported.
//
// Input is the columnar shape BioDB returns ({ time: [...], channel: [...] }) or a
// plain { channelId: [values] } map, so local session data and read-back data share
// one code path.

import { fillGaps, preprocess, rejectArtefacts } from './preprocess.js';
import { featuresForChannel } from './features.js';

export const ANALYSIS_CONTRACT_VERSION = '1.0.0';

/**
 * Turn either a BioDB columnar payload or a channel->values map into
 * { channelId: values[] }. The `time` key is treated as the timeline, not a channel.
 */
export function toChannelMap(data) {
  if (!data || typeof data !== 'object') return {};
  if (Array.isArray(data.time)) {
    const out = {};
    for (const [key, values] of Object.entries(data)) {
      if (key === 'time' || !Array.isArray(values)) continue;
      out[key] = values;
    }
    return out;
  }
  const out = {};
  for (const [key, values] of Object.entries(data)) {
    if (!Array.isArray(values)) continue;
    out[key] = values;
  }
  return out;
}

/**
 * Estimate the sample rate from a timeline of ISO strings.
 * Uses the median interval so a few delayed samples do not distort it, and
 * returns null when it cannot be established rather than guessing.
 */
export function sampleRateFromTimes(times) {
  if (!Array.isArray(times) || times.length < 3) return null;
  const stamps = times.map(t => Date.parse(t)).filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (stamps.length < 3) return null;
  const diffs = stamps.slice(1).map((t, i) => t - stamps[i]).filter(d => d > 0).sort((a, b) => a - b);
  if (!diffs.length) return null;
  const median = diffs[Math.floor(diffs.length / 2)];
  return median > 0 ? 1000 / median : null;
}

/**
 * Analyse every channel.
 *
 * data:     columnar payload or channel->values map
 * options:  { sampleRateHz (required when no timeline), channels (whitelist),
 *             units ({ channelId: unit }), preprocess: {...} }
 *
 * Returns { contractVersion, sampleRateHz, channels: { id: {...} }, warnings }.
 */
export function analyseChannels(data, options = {}) {
  const channels = toChannelMap(data);
  const requested = options.channels?.length ? options.channels : Object.keys(channels);
  const sampleRateHz = options.sampleRateHz
    ?? (Array.isArray(data?.time) ? sampleRateFromTimes(data.time) : null);
  const warnings = [];
  if (!sampleRateHz) warnings.push('Sample rate could not be determined; spectral and HRV features are unavailable.');

  const result = {};
  for (const id of requested) {
    const raw = channels[id];
    if (!Array.isArray(raw) || !raw.length) {
      warnings.push(`Channel ${id} has no samples and was skipped.`);
      continue;
    }
    const missing = raw.filter(v => v === null || v === undefined || Number.isNaN(v)).length;
    if (missing) warnings.push(`Channel ${id} had ${missing} missing sample(s); they were interpolated before analysis.`);
    if (!sampleRateHz) {
      result[id] = { missing, preprocessing: null, features: featuresForChannel(id, raw, { sampleRateHz: 0, unit: options.units?.[id] }) };
      continue;
    }
    const prepared = preprocess(raw, { sampleRateHz, ...options.preprocess });
    const unit = options.units?.[id];
    result[id] = {
      missing,
      interpolatedFraction: raw.length ? missing / raw.length : 0,
      rejectedSamples: prepared.rejected.length,
      features: featuresForChannel(id, prepared.samples, { sampleRateHz, unit }),
    };
  }
  return {
    contractVersion: ANALYSIS_CONTRACT_VERSION,
    sampleRateHz,
    channels: result,
    warnings,
  };
}

/** Flatten an analysis result into CSV-ready rows (one row per channel). */
export function analysisRows(analysis) {
  const rows = [];
  for (const [id, entry] of Object.entries(analysis.channels || {})) {
    const generic = entry.features?.generic || {};
    const bands = generic.bands || {};
    const row = {
      channel: id,
      kind: entry.features?.kind ?? '',
      n: generic.n ?? '',
      mean: round(generic.mean),
      sd: round(generic.sd),
      min: round(generic.min),
      max: round(generic.max),
      rms: round(generic.rms),
      median: round(generic.median),
      dominant_frequency_hz: round(generic.dominantFrequencyHz),
      missing_samples: entry.missing ?? '',
      rejected_samples: entry.rejectedSamples ?? '',
    };
    for (const [band, value] of Object.entries(bands)) row[`band_${band}_relative`] = round(value?.relative);
    const hrv = entry.features?.hrv;
    if (hrv) {
      row.hrv_peak_count = hrv.peakCount;
      row.hrv_mean_hr = round(hrv.time?.meanHR);
      row.hrv_sdnn = round(hrv.time?.sdnn);
      row.hrv_rmssd = round(hrv.time?.rmssd);
      row.hrv_pnn50 = round(hrv.time?.pnn50);
      row.hrv_lf_hf = round(hrv.frequency?.lfHfRatio);
      row.hrv_rejected_intervals = hrv.rejectedIntervals;
    }
    const eda = entry.features?.eda;
    if (eda) {
      row.eda_tonic_mean = round(eda.tonic?.mean);
      row.eda_phasic_sd = round(eda.phasic?.sd);
      row.eda_scr_count = eda.scrCount;
      row.eda_scr_rate_per_min = round(eda.scrRatePerMinute);
    }
    rows.push(row);
  }
  return rows;
}

/** Column order for analysisRows, with the channel identifier first. */
export function analysisColumns(rows) {
  const seen = new Set(['channel', 'kind']);
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
  return [...seen];
}

const round = value => (value === null || value === undefined || Number.isNaN(value) ? '' : Math.round(value * 1e6) / 1e6);

/**
 * Full pipeline: analyse, then render both JSON and CSV for the export bundle.
 * Returns { analysis, files }.
 */
export function runAnalysisPipeline(data, options = {}) {
  const analysis = analyseChannels(data, options);
  const rows = analysisRows(analysis);
  return {
    analysis,
    files: {
      'analysis.json': JSON.stringify(analysis, null, 2),
      'analysis.csv': [analysisColumns(rows).join(','), ...rows.map(row => analysisColumns(rows).map(key => csvCell(row[key])).join(','))].join('\n') + '\n',
    },
  };
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export { fillGaps, rejectArtefacts };
