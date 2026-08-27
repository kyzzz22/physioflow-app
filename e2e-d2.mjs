// D2 end-to-end verification: register experiment -> push via PF client -> read back with experiment filter
// Usage: $env:BIO_URL="http://localhost:5002"; $env:BIO_USER="<user_id>"; $env:BIO_TOKEN="<token>"; $env:BIO_PID="<participant_id>"; node e2e-d2.mjs
import { pushSessionToBioDB } from './src/bioDBClient.js';

const CFG = { baseUrl: process.env.BIO_URL || 'http://localhost:5002', userId: process.env.BIO_USER || '', token: process.env.BIO_TOKEN || '' };
const PID = process.env.BIO_PID || '';
const EXP_NAME = 'PF D2 e2e';

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

if (!CFG.userId || !CFG.token || !PID) {
  console.error('Missing BIO_USER/BIO_TOKEN/BIO_PID env vars');
  process.exit(1);
}

const admin = await post('/auth/jwt/admin', { user_id: CFG.userId, token: CFG.token });
const adminJwt = admin.jwt;
console.log('1. admin JWT: OK');

const expsResp = await get('/experiments', adminJwt);
const exps = expsResp.experiments || expsResp.list || [];
let exp = exps.find(e => e.name === EXP_NAME);
if (!exp) {
  const created = await post('/experiment', { name: EXP_NAME, label: 'PF D2 端到端验证', description: 'D2 push e2e' }, adminJwt);
  exp = created.experiment || created;
  console.log('2. registered experiment:', JSON.stringify(exp));
} else {
  console.log('2. found experiment:', JSON.stringify(exp));
}
const expId = exp.experiment_id || exp.id;

const startedAt = new Date(Date.now() - 30000).toISOString();
const endedAt = new Date().toISOString();
const events = [];
for (let i = 0; i < 20; i++) {
  const t = new Date(Date.now() - 30000 + i * 1000).toISOString();
  events.push({ eventType: 'device_sample_received', timestampIso: t, payload: { channelId: 'eda', value: 5 + Math.random() * 3 } });
  events.push({ eventType: 'device_sample_received', timestampIso: t, payload: { channelId: 'hr', value: 60 + Math.random() * 10 } });
}

const result = await pushSessionToBioDB(CFG, { participantId: PID, experimentId: expId, startedAt, endedAt, deviceEvents: events });
console.log('3. push OK:', JSON.stringify(result));

const readJwt = await post('/auth/jwt/sensors/readjwt', {
  user_id: CFG.userId, token: CFG.token, participant_id: PID,
  start_time: startedAt, end_time: endedAt, experiment_id: expId,
});
const read = await post('/sensor/data/read', { format: 'json', rows: ['eda', 'hr'], start_time: startedAt, end_time: endedAt }, readJwt.jwt);
const rows = JSON.parse(Buffer.from(read.data, 'base64').toString());
console.log('4. read-back rows:', rows.length, 'first:', JSON.stringify(rows[0]));
console.log('E2E D2 PASS');
