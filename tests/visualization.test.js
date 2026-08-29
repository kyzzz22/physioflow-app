import test from 'node:test';
import assert from 'node:assert/strict';
import {
  affectPoints,
  affectQuadrant,
  areaPath,
  combinedExtent,
  createScales,
  decimateMinMax,
  eventMarkers,
  extent,
  formatAxisTime,
  niceTicks,
  normalizeSeries,
  padExtent,
  seriesPath,
  timeTicks,
} from '../src/analysis/chartGeometry.js';
import { runAnalysisPipeline } from '../src/analysis/signal/pipeline.js';

const PADDING = { top: 10, right: 10, bottom: 20, left: 40 };

test('min/max decimation keeps the envelope instead of averaging peaks away', () => {
  // A spike in the middle of a flat run must survive decimation.
  const values = Array.from({ length: 1000 }, () => 0);
  values[500] = 10;
  values[501] = -10;
  const decimated = decimateMinMax(values, 100);
  assert.ok(decimated.length <= 200, 'output is bounded');
  assert.ok(decimated.some(p => p.value === 10), 'the positive spike is retained');
  assert.ok(decimated.some(p => p.value === -10), 'the negative spike is retained');
});

test('decimation emits points in index order so the path never doubles back', () => {
  const values = Array.from({ length: 500 }, (_, i) => Math.sin(i / 7));
  const decimated = decimateMinMax(values, 60);
  for (let i = 1; i < decimated.length; i += 1) {
    assert.ok(decimated[i].index >= decimated[i - 1].index, 'indices are monotonic');
  }
});

test('small series pass through decimation untouched', () => {
  const values = [1, 2, 3];
  assert.deepEqual(decimateMinMax(values, 100), [
    { index: 0, value: 1 }, { index: 1, value: 2 }, { index: 2, value: 3 },
  ]);
});

test('extent ignores nulls and reports nothing for an empty series', () => {
  assert.deepEqual(extent([1, null, 3, NaN, -2]), { min: -2, max: 3 });
  assert.deepEqual(extent([null, undefined]), { min: null, max: null });
  assert.deepEqual(extent([]), { min: null, max: null });
});

test('a flat series gets a symmetric band rather than a zero-height plot', () => {
  const padded = padExtent({ min: 5, max: 5 });
  assert.ok(padded.max > padded.min, 'zero range must not collapse');
  assert.equal((padded.max + padded.min) / 2, 5, 'the band stays centred on the value');
});

test('combined extent spans every series so shared axes line up', () => {
  assert.deepEqual(combinedExtent([[0, 10], [-5, 3]]), { min: -5, max: 10 });
});

test('scales map the last sample onto the right edge and invert back', () => {
  const scales = createScales({ count: 11, min: 0, max: 10, width: 300, height: 200, padding: PADDING });
  assert.equal(scales.x(0), PADDING.left);
  assert.equal(scales.x(10), 300 - PADDING.right);
  assert.equal(scales.y(0), 200 - PADDING.bottom);
  assert.equal(scales.y(10), PADDING.top);
  // Round trip through the inverse maps.
  for (const index of [0, 3, 7, 10]) assert.ok(Math.abs(scales.xInverse(scales.x(index)) - index) < 1e-9);
  for (const value of [0, 2.5, 10]) assert.ok(Math.abs(scales.yInverse(scales.y(value)) - value) < 1e-9);
});

test('nice ticks use a round step and stay inside the range', () => {
  const ticks = niceTicks(0, 10, 5);
  assert.deepEqual(ticks, [0, 2, 4, 6, 8, 10]);
  const small = niceTicks(0, 0.5, 5);
  assert.ok(small.length >= 3 && small.every(t => t >= 0 && t <= 0.5));
  assert.deepEqual(niceTicks(3, 3, 5), [3], 'a degenerate range yields its single value');
});

test('a gap in the data breaks the path instead of being drawn as zero', () => {
  const scales = createScales({ count: 5, min: 0, max: 4, width: 200, height: 100, padding: PADDING });
  const points = [
    { index: 0, value: 1 }, { index: 1, value: 2 }, { index: 2, value: null },
    { index: 3, value: 3 }, { index: 4, value: 4 },
  ];
  const path = seriesPath(points, scales);
  // Two "M" commands: the trace restarts after the missing sample.
  assert.equal((path.match(/M/g) || []).length, 2);
  assert.ok(!path.includes('NaN'));
});

test('area path closes back to the baseline', () => {
  const scales = createScales({ count: 3, min: 0, max: 2, width: 200, height: 100, padding: PADDING });
  const path = areaPath([{ index: 0, value: 1 }, { index: 1, value: 2 }, { index: 2, value: 1 }], scales, 0);
  assert.ok(path.endsWith('Z'), 'a closed subpath');
  assert.ok(path.includes('L'));
});

test('event markers snap to the nearest sample and drop out-of-window events', () => {
  const times = ['2026-08-29T10:00:00Z', '2026-08-29T10:00:01Z', '2026-08-29T10:00:02Z'];
  const scales = createScales({ count: 3, min: 0, max: 1, width: 200, height: 100, padding: PADDING });
  const events = [
    { event_id: 'in-window', time: '2026-08-29T10:00:00.900Z', event_name: 'stimulus' },
    { event_id: 'too-early', time: '2026-08-28T10:00:00Z' },
    { event_id: 'too-late', time: '2026-08-30T10:00:00Z' },
  ];
  const markers = eventMarkers(events, times, scales);
  assert.equal(markers.length, 1, 'only the in-window event is kept');
  assert.equal(markers[0].id, 'in-window');
  // 0.9 s is closer to the second sample (index 1) than to the first.
  assert.equal(markers[0].index, 1);
  assert.equal(markers[0].label, 'stimulus');
});

test('time ticks span the window endpoints', () => {
  const times = Array.from({ length: 101 }, (_, i) => new Date(Date.parse('2026-08-29T10:00:00Z') + i * 1000).toISOString());
  const ticks = timeTicks(times, 5);
  assert.equal(ticks.length, 5);
  assert.equal(ticks[0].index, 0);
  assert.equal(ticks[4].index, 100);
});

test('axis time formatting is stable and locale-independent', () => {
  assert.equal(formatAxisTime('2026-08-29T10:20:30Z'), '10:20:30');
  assert.equal(formatAxisTime('not-a-date'), '');
});

test('normalisation puts mixed-unit channels on one comparable band', () => {
  const normalized = normalizeSeries([[0, 50, 100], [-1, 0, 1]]);
  for (const series of normalized) {
    for (const v of series) assert.ok(v >= 0 && v <= 1, 'values land in 0..1');
  }
  // Each channel is scaled to its own range, so both span the full band.
  assert.equal(normalized[0][0], 0);
  assert.equal(normalized[0][2], 1);
  assert.equal(normalized[1][0], 0);
  assert.equal(normalized[1][2], 1);
});

test('normalisation keeps a small-unit channel visible beside a large one', () => {
  // Regression: scaling to a shared global extent let microsiemens flatten
  // microvolts into a straight line. Each channel must keep its own dynamic range.
  const eda = [2.0, 2.05, 2.1, 2.05, 2.0];        // ~0.1 uS swing
  const eeg = [-40, 45, -30, 50, -20];            // ~90 uV swing
  const [nEda, nEeg] = normalizeSeries([eda, eeg]);
  const swing = values => Math.max(...values) - Math.min(...values);
  assert.equal(swing(nEda), 1, 'eda still uses the full height');
  assert.equal(swing(nEeg), 1, 'eeg still uses the full height, not flattened');
});

test('affect points rescale the 1..9 SAM scale onto -1..1', () => {
  const points = affectPoints([
    { valence: 1, arousal: 9 },  // most negative valence, most aroused
    { valence: 5, arousal: 5 },  // neutral
    { valence: 9, arousal: 1 },
  ], { scale: 'sam' });
  assert.deepEqual(points[0], { valence: -1, arousal: 1, label: '', index: 0 });
  assert.deepEqual(points[1], { valence: 0, arousal: 0, label: '', index: 1 });
  assert.deepEqual(points[2], { valence: 1, arousal: -1, label: '', index: 2 });
});

test('affect points accept an already-normalised source', () => {
  const points = affectPoints([{ valence: 0.5, arousal: -0.25 }], { scale: 'unit' });
  assert.equal(points[0].valence, 0.5);
  assert.equal(points[0].arousal, -0.25);
});

test('quadrants follow the circumplex convention', () => {
  assert.equal(affectQuadrant({ valence: 1, arousal: 1 }), 'excited');
  assert.equal(affectQuadrant({ valence: 1, arousal: -1 }), 'calm');
  assert.equal(affectQuadrant({ valence: -1, arousal: 1 }), 'stressed');
  assert.equal(affectQuadrant({ valence: -1, arousal: -1 }), 'sad');
});

test('the D7 analysis result carries everything FeaturePanel renders', () => {
  const sampleRateHz = 200;
  const n = sampleRateHz * 8;
  const ecg = Array.from({ length: n }, (_, i) => ((i / sampleRateHz) % 1 < 0.06 ? 1 : 0));
  const eda = Array.from({ length: n }, (_, i) => 2 + i * 0.0005);
  const times = Array.from({ length: n }, (_, i) => new Date(Date.parse('2026-08-29T10:00:00Z') + i * 5).toISOString());
  const { analysis } = runAnalysisPipeline(
    { time: times, ecg, eda },
    { sampleRateHz, units: { ecg: 'mV', eda: 'uS' } },
  );
  assert.equal(analysis.channels.ecg.features.kind, 'cardiac');
  assert.ok(analysis.channels.ecg.features.hrv, 'cardiac channel exposes hrv');
  assert.equal(analysis.channels.eda.features.kind, 'eda');
  assert.ok(analysis.channels.eda.features.eda, 'eda channel exposes eda features');
  // The panel reads these specific fields; guard them against renames.
  assert.ok('meanHR' in analysis.channels.ecg.features.hrv.time);
  assert.ok('scrCount' in analysis.channels.eda.features.eda);
  assert.ok(analysis.channels.ecg.features.generic.bands, 'bands are present for the bar chart');
});
