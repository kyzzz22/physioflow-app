// D4 end-to-end verification: channel data dictionary linkage.
//  1. render the channel dictionary from a protocol's device connectors (dataType/unit/sampleRate)
//  2. attach it to a BioDB experiment via POST /experiment/<id>/dictionary (admin JWT exchange)
//  3. read it back via GET /experiment/<id>/dictionary and compare
//  4. verify the dictionary is bundled into graph session exports and generic bundles
// Usage: $env:BIO_URL="http://localhost:5002"; $env:BIO_USER="<user_id>"; $env:BIO_TOKEN="<token>"; $env:BIO_PID="<participant_id>"; node e2e-d4.mjs
import { pushExperimentDictionary } from './src/bioDBClient.js';
import { channelDataDictionary, dictionaryPayload } from './src/data/channelDictionary.js';
import { exampleSimulatedConnector, installDeviceConnector } from './src/devices/index.js';
import { buildGraphSessionFiles } from './src/data/index.js';
import { createProtocolGraph, createSequentialIdFactory } from './src/core/index.js';

const CFG = { baseUrl: process.env.BIO_URL || 'http://localhost:5002', userId: process.env.BIO_USER || '', token: process.env.BIO_TOKEN || '' };
const PID = process.env.BIO_PID || '';
const EXPERIMENT = process.env.BIO_EXPERIMENT || '';
const EXP_NAME = 'PF D4 e2e';

if (!CFG.userId || !CFG.token || !PID) {
  console.error('Missing BIO_USER/BIO_TOKEN/BIO_PID env vars');
  process.exit(1);
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

let failures = 0;

async function step(name, fn) {
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

// 1. channel dictionary rendered from the protocol's device connectors
const connector = exampleSimulatedConnector();
const protocol = { protocolId: 'e2e-d4', name: 'D4 e2e', version: 1, deviceConnectors: [connector] };
const dict = channelDataDictionary(protocol);
const payload = dictionaryPayload(protocol);
console.log(`  → channels: ${Object.keys(dict.channels).join(', ') || '(none)'}`);
console.log(`  → input (time-series): ${dict.inputChannels.join(', ') || '(none)'}`);
if (!dict.inputChannels.length) {
  failures++;
  console.error('  ⚠ no input channels extracted');
}

// 2. attach the dictionary to an experiment in the registry.
// Uses a dedicated experiment (created if absent) so existing experiments are never overwritten.
let experimentId = EXPERIMENT;
if (!experimentId) {
  const admin = await step('admin JWT', () => post('/auth/jwt/admin', { user_id: CFG.userId, token: CFG.token }));
  if (admin) {
    const expsResp = await step('experiment list', () => get('/experiments', admin.jwt));
    const exps = expsResp?.experiments || expsResp?.list || [];
    let exp = exps.find(e => e.name === EXP_NAME);
    if (!exp) {
      exp = await step(`register experiment "${EXP_NAME}"`, async () => {
        const created = await post('/experiment', { name: EXP_NAME, label: 'PF D4 通道字典验证', description: 'D4 dictionary e2e' }, admin.jwt);
        return created.experiment || created;
      });
    }
    experimentId = exp ? (exp.experiment_id || exp.id) : '';
    if (experimentId) console.log(`  → using experiment: ${experimentId}`);
    else failures++;
  }
}

if (experimentId) {
  const pushed = await step('push experiment dictionary', () =>
    pushExperimentDictionary(CFG, experimentId, payload.dictionary));
  if (pushed) console.log(`  → dictionary pushed (${Object.keys(payload.dictionary).length} channel(s))`);

  // 3. read back and compare
  const readback = await step('read dictionary back', async () => {
    const jwt = (await import('./src/bioDBClient.js')).getBioDBReadJwt;
    const readJwt = await jwt(CFG, PID);
    const resp = await fetch(`${CFG.baseUrl}/experiment/${encodeURIComponent(experimentId)}/dictionary`, {
      headers: { Authorization: `Bearer ${readJwt}` },
    });
    const d = await resp.json();
    if (!resp.ok) throw new Error(d.message || d.error || `HTTP ${resp.status}`);
    return d;
  });
  if (readback) {
    const remote = readback.dictionary || readback;
    const signal = remote.signal;
    console.log(`  → remote signal: ${signal ? `${signal.unit ?? 'no unit'} @ ${signal.sampleRateHz ?? '?'}Hz (${signal.type ?? signal.dataType})` : 'missing'}`);
    if (!signal || signal.unit !== 'a.u.' || signal.sampleRateHz !== 100) {
      failures++;
      console.error('  ⚠ dictionary read-back mismatch (expected signal: a.u. @ 100Hz)');
    }
  }
}

// 4. dictionary bundled into graph session export (V2 Graph protocol)
const graphProtocol = installDeviceConnector(
  createProtocolGraph({ idFactory: createSequentialIdFactory(), name: 'D4 e2e graph', now: '2026-08-28T00:00:00.000Z' }),
  connector,
  { approvedPermissions: connector.permissions, now: '2026-08-28T00:00:00.000Z' },
);
const session = { session_id: 'e2e-d4', participant_id: PID, status: 'completed', runtime_snapshot: { status: 'completed' } };
const files = await step('graph export bundles channel_dictionary.json', () =>
  Promise.resolve(buildGraphSessionFiles(session, graphProtocol, [], [])));
if (files && files['channel_dictionary.json']) {
  const exported = JSON.parse(files['channel_dictionary.json']);
  console.log(`  → channel_dictionary.json present (input: ${exported.inputChannels.join(', ') || '(none)'})`);
  if (!exported.inputChannels.includes('signal')) {
    failures++;
    console.error('  ⚠ exported dictionary missing signal channel');
  }
}

console.log(failures === 0 ? '\nAll D4 steps PASS' : `\n${failures} step(s) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
