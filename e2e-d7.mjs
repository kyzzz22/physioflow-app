// D7 end-to-end verification: analysis pipeline.
//  1. push a synthetic session (ECG-like rhythm + EDA + EEG) so BioDB has data
//  2. read it back and run the LOCAL pipeline over it (resample/filter/HRV/EDA/spectrum)
//  3. call the SERVER-side /sensor/data/features for the same window and compare
//     the channels and sample rate both sides agree on
//  4. train + predict on BioDB (kmeans) and train a regression
//  5. run the local models on synthetic data (ridge regression, kmeans)
//  6. build a joint export that carries the analysis
// Usage: $env:BIO_URL="http://localhost:5002"; $env:BIO_USER="<user_id>"; $env:BIO_TOKEN="<token>"; $env:BIO_PID="<participant_id>"; node e2e-d7.mjs
import { exportBioDBData, fetchBioDBFeatures, listBioDBAnalyses, predictBioDB, pushSessionToBioDB, trainBioDBModel } from './src/bioDBClient.js';
import { buildJointExportFiles } from './src/data/jointExport.js';
import { runAnalysisPipeline } from './src/analysis/signal/pipeline.js';
import { KMeans, RidgeRegression } from './src/analysis/signal/stats.js';
import { bundle } from './src/exporter.js';
import { block, protocol, step, trial } from './src/domain.js';

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

// ── arrange: synthetic signals with a known structure ──
const SAMPLE_RATE = 10; // Hz, BioDB sample interval for this push
const SECONDS = 30;
const N = SAMPLE_RATE * SECONDS;
const startedAt = new Date(Date.now() - 5000).toISOString();
const endTime = new Date(Date.now() + SECONDS * 1000 + 60000).toISOString();
const timeAt = i => new Date(Date.parse(startedAt) + i * (1000 / SAMPLE_RATE)).toISOString();

// ECG-like train at ~60 bpm plus an EDA channel with a slow drift and 3 responses,
// plus an EEG-like 10 Hz alpha rhythm.
const ecg = Array.from({ length: N }, (_, i) => {
  const phase = (i / SAMPLE_RATE) % 1;
  return phase < 0.06 ? 1 : 0;
});
const eda = Array.from({ length: N }, (_, i) => 2 + i * 0.001
  + [5, 14, 23].reduce((sum, at) => {
    const k = i - at * SAMPLE_RATE;
    return sum + (k >= 0 && k < SAMPLE_RATE * 2 ? Math.exp(-k / (SAMPLE_RATE * 0.6)) * 0.8 : 0);
  }, 0));
// 2 Hz, deliberately below the 5 Hz Nyquist limit of this 10 Hz stream — a 10 Hz
// alpha rhythm would alias into nonsense at this rate.
const EEG_HZ = 2;
const eeg = Array.from({ length: N }, (_, i) => Math.sin(2 * Math.PI * (EEG_HZ / SAMPLE_RATE) * i));

const deviceEvents = [];
for (let i = 0; i < N; i += 1) {
  const ts = timeAt(i);
  deviceEvents.push({ eventType: 'device_sample_received', timestamp: ts, payload: { channelId: 'ecg', value: ecg[i] } });
  deviceEvents.push({ eventType: 'device_sample_received', timestamp: ts, payload: { channelId: 'eda', value: eda[i] } });
  deviceEvents.push({ eventType: 'device_sample_received', timestamp: ts, payload: { channelId: 'eeg', value: eeg[i] } });
}
const channels = ['ecg', 'eda', 'eeg'];
console.log(`  → ${N} samples/channel at ${SAMPLE_RATE} Hz (${channels.join(', ')})`);

// ── 1. push the synthetic session ──
let experimentId = '';
const admin = await check('admin JWT', () => post('/auth/jwt/admin', { user_id: CFG.userId, token: CFG.token }));
if (admin) {
  const expsResp = await check('experiment list', () => get('/experiments', admin.jwt));
  const exps = expsResp?.experiments || expsResp?.list || [];
  const exp = exps.find(e => e.name === 'PF D4 e2e');
  if (exp) experimentId = exp.experiment_id || exp.id;
}
if (experimentId) console.log(`  → experiment: ${experimentId}`);

await check('push synthetic session', () =>
  pushSessionToBioDB(CFG, { participantId: PID, experimentId, startedAt, endedAt: endTime, deviceEvents }));

// ── 2. read back with retries (VictoriaMetrics visibility lag) ──
let envelope = null;
for (let attempt = 1; attempt <= 6 && !envelope?.sensor?.time?.length; attempt += 1) {
  if (attempt > 1) { console.log(`  … waiting for VictoriaMetrics visibility (attempt ${attempt})`); await sleep(3000); }
  envelope = await exportBioDBData(CFG, { participantId: PID, experimentId, rows: channels, startTime: startedAt, endTime }).catch(() => null);
}
await check('read session back', () => {
  if (!envelope?.sensor?.time?.length) throw new Error('no samples returned');
  return envelope;
});

// ── 3. local pipeline over the read-back data ──
const analysis = await check('run local analysis pipeline', () => {
  const result = runAnalysisPipeline(envelope.sensor, { units: { ecg: 'mV', eda: 'uS', eeg: 'uV' } });
  return result;
});
if (analysis) {
  const a = analysis.analysis;
  console.log(`  → sample rate ${a.sampleRateHz} Hz, channels: ${Object.keys(a.channels).join(', ')}`);
  for (const [id, entry] of Object.entries(a.channels)) {
    const kind = entry.features.kind;
    const extra = kind === 'cardiac' ? `HR=${entry.features.hrv?.time?.meanHR?.toFixed(1)} bpm, RMSSD=${entry.features.hrv?.time?.rmssd?.toFixed(1)}`
      : kind === 'eda' ? `tonic=${entry.features.eda?.tonic?.mean?.toFixed(2)}, SCR=${entry.features.eda?.scrCount}`
        : `peak=${entry.features.generic.dominantFrequencyHz?.toFixed(2)} Hz`;
    console.log(`     ${id} (${kind}): ${extra}`);
  }
  if (!a.channels.ecg || a.channels.ecg.features.kind !== 'cardiac') { failures++; console.error('  ⚠ ecg was not recognised as cardiac'); }
  if (a.channels.eda && a.channels.eda.features.eda?.scrCount < 1) { failures++; console.error('  ⚠ eda found no skin conductance responses'); }
  // Tolerance is one FFT bin: resolution is sampleRate/2^floor(log2(N)).
  if (a.channels.eeg) {
    const resolution = (a.sampleRateHz || SAMPLE_RATE) / 256;
    const peak = a.channels.eeg.features.generic.dominantFrequencyHz ?? 0;
    if (Math.abs(peak - EEG_HZ) > resolution * 2) {
      failures++;
      console.error(`  ⚠ eeg peak ${peak} Hz, expected ~${EEG_HZ} Hz (bin ${resolution.toFixed(3)} Hz)`);
    }
  }
}

// ── 4. server-side features for the same window ──
const features = await check('server-side /data/features', () =>
  fetchBioDBFeatures(CFG, { participantId: PID, rows: channels, startTime: startedAt, endTime }));
if (features) {
  console.log(`  → server: ${features.total_points} points @ ${features.sample_rate_hz} Hz, columns ${Object.keys(features.columns || {}).join(', ')}`);
  if (analysis && features.sample_rate_hz) {
    const local = analysis.analysis.sampleRateHz;
    const diff = Math.abs(local - features.sample_rate_hz) / features.sample_rate_hz;
    if (diff > 0.05) {
      failures++;
      console.error(`  ⚠ sample rate disagreement: local ${local} vs server ${features.sample_rate_hz}`);
    } else {
      console.log(`  → sample rates agree (local ${local} vs server ${features.sample_rate_hz})`);
    }
  }
}

// ── 5. server-side train + predict ──
const kmeans = await check('train kmeans on BioDB', () =>
  trainBioDBModel(CFG, 'kmeans', { participantId: PID, rows: channels, startTime: startedAt, endTime, n_clusters: 2 }));
if (kmeans) {
  console.log(`  → model ${kmeans.model_id}, inertia ${kmeans.metrics?.inertia?.toFixed?.(2)}`);
  const prediction = await check('predict with the trained model', () =>
    predictBioDB(CFG, { participantId: PID, modelId: kmeans.model_id, rows: channels, startTime: startedAt, endTime }));
  if (prediction) console.log(`  → prediction received (${prediction.code})`);
}
const regression = await check('train regression on BioDB', () =>
  trainBioDBModel(CFG, 'regression', { participantId: PID, rows: ['ecg', 'eeg', 'eda'], startTime: startedAt, endTime }));
if (regression) console.log(`  → r2=${regression.metrics?.r2}, mse=${regression.metrics?.mse?.toExponential?.(2)}`);

const analyses = await check('list stored analyses', () => listBioDBAnalyses(CFG, { participantId: PID, startTime: startedAt, endTime }));
if (analyses) console.log(`  → ${analyses.length} analysis record(s) stored`);

// ── 6. local models on synthetic data ──
await check('local ridge regression recovers a known slope', () => {
  const random = (seed => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)(11);
  const X = Array.from({ length: 80 }, () => [random() * 10, random() * 4]);
  const y = X.map(([a, b]) => 1.5 + 3 * a - 2 * b);
  const model = new RidgeRegression({ alpha: 0 }).fit(X, y);
  const r2 = model.score(X, y);
  console.log(`  → intercept ${model.intercept.toFixed(3)}, r2 ${r2.toFixed(6)}`);
  if (r2 < 0.999) throw new Error(`r2 too low: ${r2}`);
  return model;
});
await check('local kmeans separates two planted clusters', () => {
  const points = [
    ...Array.from({ length: 25 }, () => [Math.random() * 0.2, Math.random() * 0.2]),
    ...Array.from({ length: 25 }, () => [8 + Math.random() * 0.2, 8 + Math.random() * 0.2]),
  ];
  const model = new KMeans({ clusters: 2, randomState: 42 }).fit(points);
  const groups = new Set(model.labels);
  console.log(`  → ${groups.size} clusters, inertia ${model.inertia?.toFixed(2)}`);
  if (groups.size !== 2) throw new Error('expected 2 clusters');
  return model;
});

// ── 7. joint export carrying the analysis ──
const pfProtocol = protocol({
  config_hash: 'e2e-d7-hash',
  deviceConnectors: [],
  blocks: [block({ trials: [trial({ steps: [step('questionnaire', { name: 'Survey', questionnaire: { questionnaire_id: 'q', questions: [{ question_id: 'a', type: 'short_text', required: true, prompt_i18n: { en: 'Answer' } }] } })] })] })],
});
const session = { session_id: 'e2e-d7-session', participant_id: PID, status: 'completed', protocol_hash: 'e2e-d7-hash' };
await check('joint export carries the analysis', () => {
  const { files, manifest } = buildJointExportFiles({
    sessionFiles: bundle(session, pfProtocol, []),
    biodb: envelope,
    analysis: analysis?.analysis || null,
    meta: { sessionId: session.session_id, participantId: PID, experimentId, startTime: startedAt, endTime, baseUrl: CFG.baseUrl, channels },
  });
  if (!files['analysis/analysis.json']) throw new Error('analysis.json missing');
  if (!manifest.sources.analysis.included) throw new Error('manifest did not record the analysis');
  console.log(`  → ${Object.keys(files).length} files, analysis channels ${manifest.sources.analysis.channels}`);
  return files;
});

console.log(failures === 0 ? '\nAll D7 steps PASS' : `\n${failures} step(s) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
