// D6 end-to-end verification: joint export (PF session package + BioDB envelope).
//  1. push device samples for a participant so BioDB has data in the window
//  2. attach the channel dictionary (D4) so the experiment leg carries it
//  3. call POST /sensor/data/export and check all three legs come back
//  4. merge with a PF session package and verify the archive contents
//  5. verify a failed BioDB leg still produces a usable PF-only archive
// Usage: $env:BIO_URL="http://localhost:5002"; $env:BIO_USER="<user_id>"; $env:BIO_TOKEN="<token>"; $env:BIO_PID="<participant_id>"; node e2e-d6.mjs
import { exportBioDBData, pushExperimentDictionary, pushSessionToBioDB } from './src/bioDBClient.js';
import { buildJointExportFiles, channelsForExport } from './src/data/jointExport.js';
import { bundle } from './src/exporter.js';
import { exampleSimulatedConnector } from './src/devices/index.js';
import { block, protocol, step, trial } from './src/domain.js';

const CFG = { baseUrl: process.env.BIO_URL || 'http://localhost:5002', userId: process.env.BIO_USER || '', token: process.env.BIO_TOKEN || '' };
const PID = process.env.BIO_PID || '';
const EXPERIMENT = process.env.BIO_EXPERIMENT || '';

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

// ── arrange: a protocol with a simulated connector, plus a session window ──
const connector = exampleSimulatedConnector();
const pfProtocol = protocol({
  config_hash: 'e2e-d6-hash',
  deviceConnectors: [connector],
  blocks: [block({ trials: [trial({ steps: [step('questionnaire', { name: 'Survey', questionnaire: { questionnaire_id: 'q', questions: [{ question_id: 'a', type: 'short_text', required: true, prompt_i18n: { en: 'Answer' } }] } })] })] })],
});
const startedAt = new Date(Date.now() - 20000).toISOString();
const endedAt = new Date(Date.now() + 60000).toISOString();
const session = {
  session_id: 'e2e-d6-session',
  participant_id: PID,
  status: 'completed',
  protocol_hash: 'e2e-d6-hash',
  started_at: startedAt,
  ended_at: endedAt,
};
// Shape matches DeviceConnectorSession: one event per sample per channel.
const deviceEvents = Array.from({ length: 20 }, (_, i) => ({
  eventType: 'device_sample_received',
  timestamp: new Date(Date.parse(startedAt) + i * 500).toISOString(),
  payload: { channelId: 'signal', value: Math.sin(i / 3) },
}));
const channels = channelsForExport(pfProtocol, deviceEvents);
console.log(`  → channels: ${channels.join(', ') || '(none)'}`);

// ── 1. resolve the experiment FIRST: the export filters on the experiment tag, so
//       a session pushed without one can never be read back with a filter.
let experimentId = EXPERIMENT;
if (!experimentId) {
  const admin = await check('admin JWT', () => post('/auth/jwt/admin', { user_id: CFG.userId, token: CFG.token }));
  if (admin) {
    const expsResp = await check('experiment list', () => get('/experiments', admin.jwt));
    const exps = expsResp?.experiments || expsResp?.list || [];
    const exp = exps.find(e => e.name === 'PF D4 e2e');
    if (exp) experimentId = exp.experiment_id || exp.id;
  }
}
if (experimentId) console.log(`  → experiment: ${experimentId}`);

// ── 2. push samples under that experiment so the export has something to read ──
const pushed = await check('push device samples to BioDB', () =>
  pushSessionToBioDB(CFG, { participantId: PID, experimentId, startedAt, endedAt, deviceEvents }));
if (pushed) console.log(`  → ${pushed.rows} rows pushed (channels: ${pushed.channels.join(', ')})`);

// ── 3. attach the dictionary so the experiment leg carries it ──
if (experimentId) {
  await check('attach channel dictionary', () =>
    pushExperimentDictionary(CFG, experimentId, { signal: { label: 'signal', unit: 'a.u.', type: 'number', sampleRateHz: 100, direction: 'input' } }));
}

// ── 4. the joint envelope: sensor + events + experiment ──
// VictoriaMetrics needs a moment before freshly written samples become queryable,
// so retry the export instead of asserting on an eventually-consistent read.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let biodb = null;
for (let attempt = 1; attempt <= 6 && !biodb?.sensor?.time?.length; attempt += 1) {
  if (attempt > 1) { console.log(`  … waiting for VictoriaMetrics visibility (attempt ${attempt})`); await sleep(3000); }
  biodb = await exportBioDBData(CFG, { participantId: PID, experimentId, rows: channels, startTime: startedAt, endTime: endedAt }).catch(() => null);
}
await check('export BioDB envelope (sensor/events/experiment)', () => {
  if (!biodb) throw new Error('export never succeeded');
  return biodb;
});
if (biodb) {
  const points = biodb.sensor?.time?.length ?? 0;
  console.log(`  → sensor: ${points} points, columns ${Object.keys(biodb.sensor || {}).filter(k => k !== 'time').join(', ') || '(none)'}`);
  console.log(`  → events: ${biodb.events?.length ?? 'null'}, experiment: ${biodb.experiment ? (biodb.experiment.experiment_id || biodb.experiment.id) : 'null'}`);
  if (!points) { failures++; console.error('  ⚠ no sensor points returned'); }
}

// ── 5. merge with the PF session package ──
const sessionFiles = bundle(session, pfProtocol, []);
const merged = await check('build joint export package', () => Promise.resolve(buildJointExportFiles({
  sessionFiles,
  biodb,
  meta: { sessionId: session.session_id, participantId: PID, experimentId, startTime: startedAt, endTime: endedAt, baseUrl: CFG.baseUrl, channels },
})));
if (merged) {
  const { files, manifest } = merged;
  const names = Object.keys(files);
  console.log(`  → ${names.length} files; sensor points ${manifest.sources.biodb.sensorPoints}, PF files ${manifest.sources.pf.files.length}`);
  for (const required of ['joint_manifest.json', 'joint_data_dictionary.json', 'export_manifest.json', 'channel_dictionary.json', 'biodb/sensor_data.csv']) {
    if (!files[required]) { failures++; console.error(`  ⚠ missing ${required}`); }
  }
  const csvText = files['biodb/sensor_data.csv'] || '';
  const csvLines = csvText.trim().split('\n');
  if (csvLines.length < 2) { failures++; console.error('  ⚠ sensor CSV has no data rows'); }
  else console.log(`  → sensor CSV: ${csvLines.length - 1} rows, header "${csvLines[0]}"`);
}

// ── 6. a failed BioDB leg must still archive the PF session ──
await check('PF-only archive when the BioDB leg fails', () => {
  const degraded = buildJointExportFiles({
    sessionFiles,
    biodb: null,
    meta: { sessionId: session.session_id, participantId: PID, channels, biodbError: 'HTTP 500 (simulated)' },
  });
  if (!degraded.files['export_manifest.json']) throw new Error('PF files were dropped');
  if (degraded.files['biodb/sensor_data.csv']) throw new Error('BioDB files should not be present');
  if (!degraded.manifest.warnings.some(w => w.includes('HTTP 500'))) throw new Error('degraded reason was not recorded');
  return degraded;
});

console.log(failures === 0 ? '\nAll D6 steps PASS' : `\n${failures} step(s) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
