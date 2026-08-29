// D8 end-to-end verification: visualisation.
//  1. push a synthetic multi-channel session so BioDB has data
//  2. read it back through the real client
//  3. build every chart's geometry from that data and assert the SVG is valid
//  4. render the React components to static markup and check the SVG survives
//  5. verify the D8 views are actually reachable from the data panel
// Usage: $env:BIO_URL="http://localhost:5002"; $env:BIO_USER="<user_id>"; $env:BIO_TOKEN="<token>"; $env:BIO_PID="<participant_id>"; node e2e-d8.mjs
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import { exportBioDBData, pushSessionToBioDB } from './src/bioDBClient.js';
import {
  affectPoints,
  createScales,
  decimateMinMax,
  eventMarkers,
  padExtent,
  combinedExtent,
  seriesPath,
} from './src/analysis/chartGeometry.js';
import { runAnalysisPipeline } from './src/analysis/signal/pipeline.js';

// Node cannot load .jsx directly, so the components are pulled through Vite's
// SSR loader using the project's own config (same JSX settings as the build).
const viteServer = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const MultiChannelChart = (await viteServer.ssrLoadModule('/src/analysis/MultiChannelChart.jsx')).default;
const FeaturePanel = (await viteServer.ssrLoadModule('/src/analysis/FeaturePanel.jsx')).default;
const AffectMap = (await viteServer.ssrLoadModule('/src/analysis/AffectMap.jsx')).default;

const CFG = { baseUrl: process.env.BIO_URL || 'http://localhost:5002', userId: process.env.BIO_USER || '', token: process.env.BIO_TOKEN || '' };
const PID = process.env.BIO_PID || '';

if (!CFG.userId || !CFG.token || !PID) {
  console.error('Missing BIO_USER/BIO_TOKEN/BIO_PID env vars');
  process.exit(1);
}

let failures = 0;

async function check(name, fn) {
  try {
    const out = await fn();
    console.log(`✓ ${name}`);
    return out;
  } catch (e) {
    failures++;
    console.error(`✗ ${name}: ${e.message || e}`);
    return null;
  }
}

const post = async (path, body, token) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const resp = await fetch(CFG.baseUrl + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.detail || data.message || `HTTP ${resp.status}`);
  return data;
};
const get = async (path, token) => {
  const headers = token ? { Authorization: 'Bearer ' + token } : {};
  const resp = await fetch(CFG.baseUrl + path, { method: 'GET', headers });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.detail || data.message || `HTTP ${resp.status}`);
  return data;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ── arrange: three channels with different units and magnitudes ──
const SAMPLE_RATE = 10;
const SECONDS = 20;
const N = SAMPLE_RATE * SECONDS;
const startedAt = new Date(Date.now() - 4000).toISOString();
const endTime = new Date(Date.now() + SECONDS * 1000 + 60000).toISOString();
const timeAt = i => new Date(Date.parse(startedAt) + i * (1000 / SAMPLE_RATE)).toISOString();

const eeg = Array.from({ length: N }, (_, i) => 40 * Math.sin(2 * Math.PI * 2 * i / SAMPLE_RATE)); // uV
const eda = Array.from({ length: N }, (_, i) => 2 + i * 0.001);                                    // uS
const ecg = Array.from({ length: N }, (_, i) => ((i / SAMPLE_RATE) % 1 < 0.06 ? 1 : 0));           // mV
const channels = ['eeg', 'eda', 'ecg'];

const deviceEvents = [];
for (let i = 0; i < N; i += 1) {
  const ts = timeAt(i);
  deviceEvents.push({ eventType: 'device_sample_received', timestamp: ts, payload: { channelId: 'eeg', value: eeg[i] } });
  deviceEvents.push({ eventType: 'device_sample_received', timestamp: ts, payload: { channelId: 'eda', value: eda[i] } });
  deviceEvents.push({ eventType: 'device_sample_received', timestamp: ts, payload: { channelId: 'ecg', value: ecg[i] } });
}
console.log(`  → ${N} samples/channel at ${SAMPLE_RATE} Hz (${channels.join(', ')})`);

// ── 1. resolve experiment, push, read back ──
let experimentId = '';
const admin = await check('admin JWT', () => post('/auth/jwt/admin', { user_id: CFG.userId, token: CFG.token }));
if (admin) {
  const expsResp = await check('experiment list', () => get('/experiments', admin.jwt));
  const exp = (expsResp?.experiments || expsResp?.list || []).find(e => e.name === 'PF D4 e2e');
  if (exp) experimentId = exp.experiment_id || exp.id;
}
await check('push synthetic session', () =>
  pushSessionToBioDB(CFG, { participantId: PID, experimentId, startedAt, endedAt: endTime, deviceEvents }));

let envelope = null;
for (let attempt = 1; attempt <= 6 && !envelope?.sensor?.time?.length; attempt += 1) {
  if (attempt > 1) { console.log(`  … waiting for VictoriaMetrics visibility (attempt ${attempt})`); await sleep(3000); }
  envelope = await exportBioDBData(CFG, { participantId: PID, experimentId, rows: channels, startTime: startedAt, endTime }).catch(() => null);
}
await check('read session back', () => {
  if (!envelope?.sensor?.time?.length) throw new Error('no samples returned');
  return envelope;
});

if (!envelope?.sensor) {
  console.log(failures === 0 ? '\nAll D8 steps PASS' : `\n${failures} step(s) FAILED`);
  await viteServer.close();
  process.exitCode = failures === 0 ? 0 : 1;
} else {
  const sensor = envelope.sensor;
  const times = sensor.time;
  const series = Object.fromEntries(channels.map(id => [id, sensor[id] || []]));
  const units = { eeg: 'uV', eda: 'uS', ecg: 'mV' };

  // ── 2. geometry from real read-back data ──
  await check('geometry: every channel produces a finite SVG path', () => {
    const extent = padExtent(combinedExtent(channels.map(id => series[id])));
    const scales = createScales({ count: times.length, min: extent.min, max: extent.max, width: 720, height: 260, padding: { top: 12, right: 16, bottom: 26, left: 52 } });
    for (const id of channels) {
      const path = seriesPath(decimateMinMax(series[id], 1400), scales);
      if (!path) throw new Error(`${id} produced an empty path`);
      if (/NaN|Infinity|undefined/.test(path)) throw new Error(`${id} path contains ${path.match(/NaN|Infinity|undefined/)[0]}`);
      if (!path.startsWith('M')) throw new Error(`${id} path does not start with a move command`);
    }
    return true;
  });

  await check('geometry: decimation bounds the point count', () => {
    const budget = 1400;
    for (const id of channels) {
      const points = decimateMinMax(series[id], budget);
      if (points.length > budget * 2) throw new Error(`${id} exceeded the decimation budget`);
    }
    return true;
  });

  await check('geometry: event markers land inside the plot', () => {
    const extent = padExtent(combinedExtent(channels.map(id => series[id])));
    const scales = createScales({ count: times.length, min: extent.min, max: extent.max, width: 720, height: 260, padding: { top: 12, right: 16, bottom: 26, left: 52 } });
    const mid = times[Math.floor(times.length / 2)];
    const markers = eventMarkers([{ event_id: 'e1', time: mid, event_name: 'mid' }], times, scales);
    if (markers.length !== 1) throw new Error('in-window marker was dropped');
    const x = markers[0].x;
    if (!(x >= 52 && x <= 704)) throw new Error(`marker x ${x} is outside the plot area`);
    return true;
  });

  // ── 3. D8 components render against real data ──
  await check('render: MultiChannelChart emits an SVG with one path per channel', () => {
    const html = renderToStaticMarkup(createElement(MultiChannelChart, {
      times, series, units, events: [{ event_id: 'e1', time: times[10], event_name: 'stimulus' }],
    }));
    if (!html.includes('<svg')) throw new Error('no svg element rendered');
    const paths = (html.match(/<path/g) || []).length;
    // One line per channel plus the area fill for the first trace.
    if (paths < channels.length) throw new Error(`only ${paths} paths for ${channels.length} channels`);
    if (/NaN|Infinity/.test(html)) throw new Error('rendered markup contains NaN/Infinity');
    if (!html.includes('stimulus')) throw new Error('event marker label missing');
    return paths;
  });

  const analysis = await check('D7 pipeline over the read-back window', () =>
    runAnalysisPipeline(sensor, { units }).analysis);

  await check('render: FeaturePanel shows the analysed channels', () => {
    if (!analysis) throw new Error('no analysis');
    const html = renderToStaticMarkup(createElement(FeaturePanel, { analysis, title: 'Channel analysis' }));
    for (const id of channels) {
      if (!html.includes(id)) throw new Error(`${id} missing from the feature panel`);
    }
    if (/NaN|Infinity/.test(html)) throw new Error('rendered markup contains NaN/Infinity');
    return true;
  });

  await check('render: AffectMap plots valence/arousal points', () => {
    const responses = [
      { valence: 2, arousal: 8, label: 'baseline' },
      { valence: 7, arousal: 6, label: 'stimulus' },
      { valence: 4, arousal: 3, label: 'recovery' },
    ];
    const points = affectPoints(responses, { scale: 'sam' });
    if (points.length !== 3) throw new Error('affect points were dropped');
    const html = renderToStaticMarkup(createElement(AffectMap, { responses, scale: 'sam' }));
    const circles = (html.match(/<circle/g) || []).length;
    if (circles !== 3) throw new Error(`expected 3 points, rendered ${circles}`);
    if (!html.includes('<polyline')) throw new Error('trajectory line missing');
    if (/NaN|Infinity/.test(html)) throw new Error('rendered markup contains NaN/Infinity');
    return circles;
  });

  await check('render: empty inputs degrade to a message, not a crash', () => {
    const html = renderToStaticMarkup(createElement(MultiChannelChart, { times: [], series: {} }));
    if (!html.includes('No samples')) throw new Error('missing empty state');
    const emptyAffect = renderToStaticMarkup(createElement(AffectMap, { responses: [] }));
    if (!emptyAffect.includes('No valence')) throw new Error('missing affect empty state');
    return true;
  });

  // ── 4. the D8 views are wired into the data panel ──
  await check('data panel exposes the D8 views', () => {
    const panel = readFileSync('src/DataPanel.jsx', 'utf8');
    for (const needed of ['MultiChannelChart', 'FeaturePanel', 'AffectMap', "'multi'", "'features'", "'affect'"]) {
      if (!panel.includes(needed)) throw new Error(`DataPanel is missing ${needed}`);
    }
    return true;
  });

  console.log(failures === 0 ? '\nAll D8 steps PASS' : `\n${failures} step(s) FAILED`);
  await viteServer.close();
  process.exitCode = failures === 0 ? 0 : 1;
}


