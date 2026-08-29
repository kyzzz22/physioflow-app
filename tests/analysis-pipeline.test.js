import test from 'node:test';
import assert from 'node:assert/strict';
import { compact, describe, detrend, fillGaps, movingMedian, rejectArtefacts, resample } from '../src/analysis/signal/preprocess.js';
import { bandPower, dominantFrequency, fft, powerSpectralDensity } from '../src/analysis/signal/spectrum.js';
import { detectPeaks, eda, featuresForChannel, hrv, hrvTimeDomain, rrIntervals } from '../src/analysis/signal/features.js';
import { KMeans, RidgeRegression, cohensD, mulberry32, pearson, welchTTest } from '../src/analysis/signal/stats.js';
import { analyseChannels, runAnalysisPipeline, sampleRateFromTimes, toChannelMap } from '../src/analysis/signal/pipeline.js';

// ── synthetic signal helpers ──
const sine = (hz, sampleRateHz, seconds, amplitude = 1, phase = 0) =>
  Array.from({ length: Math.round(sampleRateHz * seconds) }, (_, i) => amplitude * Math.sin(2 * Math.PI * hz * i / sampleRateHz + phase));

/** A train of gaussian-like spikes standing in for R peaks. */
function spikeTrain(sampleRateHz, seconds, bpm) {
  const length = Math.round(sampleRateHz * seconds);
  const out = new Array(length).fill(0);
  const intervalSamples = Math.round((60 / bpm) * sampleRateHz);
  for (let start = Math.round(sampleRateHz * 0.2); start < length; start += intervalSamples) {
    for (let k = -3; k <= 3; k += 1) {
      const i = start + k;
      if (i >= 0 && i < length) out[i] = Math.exp(-(k * k) / 2) * 1.0;
    }
  }
  return out;
}

test('gap filling interpolates between neighbours and holds the edges', () => {
  assert.deepEqual(fillGaps([1, null, 3]), [1, 2, 3]);
  assert.deepEqual(fillGaps([null, 5, 7]), [5, 5, 7]);
  assert.deepEqual(fillGaps([1, 3, null]), [1, 3, 3]);
  assert.deepEqual(fillGaps([]), []);
});

test('resampling changes the length by the rate ratio', () => {
  const source = sine(1, 100, 1);
  const up = resample(source, 100, 200);
  assert.equal(up.length, 199);
  const down = resample(source, 100, 50);
  assert.equal(down.length, 50);
  assert.throws(() => resample(source, 0, 10), /must be positive/);
});

test('moving median removes a single spike that a mean would only smear', () => {
  const clean = [1, 1, 1, 1, 1];
  const spiked = [1, 1, 50, 1, 1];
  assert.deepEqual(movingMedian(spiked, 3), clean);
  assert.ok(movingMedian(spiked, 3)[2] === 1);
});

test('detrend removes a slow drift and keeps the oscillation', () => {
  const sampleRateHz = 50;
  const drift = Array.from({ length: sampleRateHz * 4 }, (_, i) => i * 0.5);
  const wave = sine(5, sampleRateHz, 4);
  const combined = drift.map((v, i) => v + wave[i]);
  const detrended = detrend(combined, 1, sampleRateHz);
  const stats = describe(detrended);
  assert.ok(Math.abs(stats.mean) < 1, `trend should be removed, mean was ${stats.mean}`);
  assert.ok(stats.sd > 0.3, 'oscillation should survive');
});

test('artefact rejection replaces outliers but reports how many it touched', () => {
  const base = sine(2, 50, 2);
  const withArtefact = [...base];
  withArtefact[20] = 500;
  const { cleaned, rejected } = rejectArtefacts(withArtefact, { threshold: 4, window: 11 });
  assert.ok(rejected.includes(20));
  assert.ok(cleaned[20] < 10, 'the outlier should be replaced by the local median');
  assert.ok(Math.abs(cleaned[5] - base[5]) < 1e-9, 'untouched samples stay untouched');
});

test('FFT and PSD recover the frequency of a pure tone', () => {
  const sampleRateHz = 256;
  const signal = sine(10, sampleRateHz, 4);
  const psd = powerSpectralDensity(signal, sampleRateHz);
  assert.ok(psd.frequencies.length > 0);
  assert.equal(Math.round(dominantFrequency(psd)), 10);
  const alpha = bandPower(psd, 8, 13);
  const beta = bandPower(psd, 13, 30);
  assert.ok(alpha.relative > 0.9, `10 Hz should concentrate in alpha, got ${alpha.relative}`);
  assert.ok(beta.relative < 0.1);
});

test('FFT rejects a non power-of-two length instead of silently truncating', () => {
  assert.throws(() => fft(new Array(100).fill(0), new Array(100).fill(0)), /power of two/);
});

test('peak detection and RR intervals recover the simulated heart rate', () => {
  const sampleRateHz = 200;
  const bpm = 60;
  const peaks = detectPeaks(spikeTrain(sampleRateHz, 10, bpm), { sampleRateHz, refractorySeconds: 0.3 });
  const intervals = rrIntervals(peaks, sampleRateHz);
  const result = hrvTimeDomain(intervals);
  assert.ok(peaks.length >= 8, `expected ~10 peaks, got ${peaks.length}`);
  assert.ok(Math.abs(result.meanHR - bpm) < 5, `mean HR ${result.meanHR} should be near ${bpm}`);
  // A perfectly regular train has almost no variability.
  assert.ok(result.rmssd < 20, `rmssd should be small for a regular train, got ${result.rmssd}`);
});

test('HRV separates a regular from an irregular rhythm', () => {
  const sampleRateHz = 200;
  const regular = hrv(spikeTrain(sampleRateHz, 12, 60), { sampleRateHz });
  // Jittered rhythm: alternate the interval to raise RMSSD.
  const length = sampleRateHz * 12;
  const irregularSignal = new Array(length).fill(0);
  let cursor = Math.round(sampleRateHz * 0.2);
  let beats = 0;
  while (cursor < length - 10) {
    for (let k = -3; k <= 3; k += 1) {
      const i = cursor + k;
      if (i >= 0 && i < length) irregularSignal[i] = Math.exp(-(k * k) / 2);
    }
    const interval = beats % 2 === 0 ? sampleRateHz * 0.75 : sampleRateHz * 1.25;
    cursor += Math.round(interval);
    beats += 1;
  }
  const irregular = hrv(irregularSignal, { sampleRateHz });
  assert.ok(irregular.time.rmssd > regular.time.rmssd,
    `irregular rmssd ${irregular.time.rmssd} should exceed regular ${regular.time.rmssd}`);
  assert.ok(irregular.time.sdnn > regular.time.sdnn);
});

test('EDA separates the slow tonic level from phasic responses', () => {
  const sampleRateHz = 20;
  const samples = Array.from({ length: sampleRateHz * 30 }, (_, i) => 2 + (i / sampleRateHz) * 0.05);
  // Add three phasic responses.
  for (const at of [5, 12, 22]) {
    const start = Math.round(at * sampleRateHz);
    for (let k = 0; k < sampleRateHz * 2 && start + k < samples.length; k += 1) {
      samples[start + k] += Math.exp(-k / (sampleRateHz * 0.6)) * 0.8;
    }
  }
  const result = eda(samples, { sampleRateHz, tonicWindowSeconds: 4 });
  assert.ok(result.tonic.mean > 1.5, 'tonic should track the baseline');
  assert.equal(result.scrCount, 3, `expected 3 skin conductance responses, got ${result.scrCount}`);
  assert.ok(result.phasic.sd > 0);
});

test('channel dispatch picks the right feature family', () => {
  const sampleRateHz = 200;
  assert.equal(featuresForChannel('ECG', spikeTrain(sampleRateHz, 8, 60), { sampleRateHz }).kind, 'cardiac');
  assert.equal(featuresForChannel('eda', [1, 2, 3, 4, 5, 6], { sampleRateHz: 4, unit: 'uS' }).kind, 'eda');
  assert.equal(featuresForChannel('TP9', sine(10, 256, 2), { sampleRateHz: 256, unit: 'uV' }).kind, 'eeg');
  assert.equal(featuresForChannel('temperature', [1, 2, 3], { sampleRateHz: 1 }).kind, 'generic');
});

test('statistics: correlation, Welch t-test and effect size', () => {
  const xs = [1, 2, 3, 4, 5, 6];
  const ys = [2, 4, 6, 8, 10, 12];
  assert.ok(Math.abs(pearson(xs, ys).r - 1) < 1e-9);
  assert.ok(Math.abs(pearson(xs, [6, 5, 4, 3, 2, 1]).r + 1) < 1e-9);

  const a = [10, 11, 12, 11, 10, 12, 11];
  const b = [20, 21, 22, 21, 20, 22, 21];
  const test2 = welchTTest(a, b);
  assert.ok(test2.p !== null && test2.p < 0.001, `groups should differ, p=${test2.p}`);
  assert.ok(Math.abs(cohensD(a, b)) > 2, 'effect size should be large');

  const same = welchTTest([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
  assert.equal(same.t, 0);
});

test('ridge regression recovers a known linear relationship', () => {
  const random = mulberry32(7);
  const X = Array.from({ length: 60 }, () => [random() * 10, random() * 5]);
  const y = X.map(([a, b]) => 3 + 2 * a - 1.5 * b);
  const model = new RidgeRegression({ alpha: 0 }).fit(X, y, ['a', 'b']);
  assert.ok(Math.abs(model.intercept - 3) < 1e-6, `intercept ${model.intercept}`);
  assert.ok(Math.abs(model.coefficients[0] - 2) < 1e-6);
  assert.ok(Math.abs(model.coefficients[1] + 1.5) < 1e-6);
  assert.ok(model.score(X, y) > 0.9999);
});

test('kmeans finds the planted clusters and is deterministic', () => {
  const points = [
    ...Array.from({ length: 20 }, () => [0 + Math.random() * 0.1, 0 + Math.random() * 0.1]),
    ...Array.from({ length: 20 }, () => [10 + Math.random() * 0.1, 10 + Math.random() * 0.1]),
  ];
  const first = new KMeans({ clusters: 2, randomState: 42 }).fit(points);
  const second = new KMeans({ clusters: 2, randomState: 42 }).fit(points);
  assert.deepEqual(first.labels, second.labels);
  const groups = new Set(first.labels);
  assert.equal(groups.size, 2);
});

test('pipeline reads the BioDB columnar shape and estimates the sample rate', () => {
  const times = Array.from({ length: 101 }, (_, i) => new Date(Date.parse('2026-08-29T10:00:00Z') + i * 100).toISOString());
  const data = { time: times, signal: sine(5, 10, 10) };
  assert.deepEqual(Object.keys(toChannelMap(data)), ['signal']);
  assert.equal(Math.round(sampleRateFromTimes(times)), 10);

  const { analysis } = runAnalysisPipeline(data);
  assert.equal(analysis.sampleRateHz, 10);
  assert.equal(analysis.contractVersion, '1.0.0');
  assert.ok(analysis.channels.signal);
  assert.equal(Math.round(analysis.channels.signal.features.generic.dominantFrequencyHz), 5);
});

test('pipeline reports missing samples instead of hiding them', () => {
  const times = Array.from({ length: 101 }, (_, i) => new Date(Date.parse('2026-08-29T10:00:00Z') + i * 100).toISOString());
  const values = sine(5, 10, 10);
  values[10] = null;
  values[11] = null;
  const { analysis, files } = runAnalysisPipeline({ time: times, signal: values }, { sampleRateHz: 10 });
  assert.equal(analysis.channels.signal.missing, 2);
  assert.match(analysis.warnings.join(' '), /2 missing sample/);
  assert.ok(files['analysis.csv'].includes('channel,'));
  assert.ok(files['analysis.json'].includes('contractVersion'));
});

test('pipeline still works when the sample rate is unknown', () => {
  const { analysis } = runAnalysisPipeline({ signal: [1, 2, 3, 4, 5] });
  assert.equal(analysis.sampleRateHz, null);
  assert.match(analysis.warnings.join(' '), /Sample rate could not be determined/);
  assert.equal(analysis.channels.signal.features.kind, 'generic');
});

test('analyseChannels honours an explicit channel whitelist', () => {
  const data = { time: [], ecg: sine(1, 100, 2), eda: sine(2, 100, 2) };
  const analysis = analyseChannels(data, { sampleRateHz: 100, channels: ['ecg'] });
  assert.deepEqual(Object.keys(analysis.channels), ['ecg']);
});

test('compact returns the surviving values with their original indices', () => {
  const { values, indices } = compact([1, null, 3, NaN, 5]);
  assert.deepEqual(values, [1, 3, 5]);
  assert.deepEqual(indices, [0, 2, 4]);
});
