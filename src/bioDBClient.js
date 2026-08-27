// bioDBClient.js — BioDB REST client (D2)
// Exchanges the long-term token for short-lived JWTs and pushes session
// sensor samples into BioDB. All endpoints go through the NGINX gateway:
//   POST /auth/jwt/admin                 long-term token -> admin JWT
//   POST /auth/jwt/sensors/readjwt       -> sensor read JWT (claims: participant/experiment)
//   POST /auth/jwt/sensors/writejwt      -> sensor write JWT (claims: participant/experiment/experimenter)
//   GET  /experiments                    experiment registry (with read JWT)
//   GET  /auth/participant               participant list (with read JWT)
//   POST /sensor/data/write              {format, compression, data(base64 records)} (with write JWT)

export const bioDBDefaultSettings = () => ({
  baseUrl: 'http://localhost:5002',
  userId: '',
  token: '',
});

function baseOf(cfg) {
  return (cfg && cfg.baseUrl ? cfg.baseUrl : 'http://localhost:5002').replace(/\/+$/, '');
}

async function postJSON(url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  let data = {};
  try { data = await resp.json(); } catch (e) { /* keep {} */ }
  if (!resp.ok) throw new Error(data.message || data.detail || `HTTP ${resp.status}`);
  return data;
}

async function getJSON(url, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(url, { method: 'GET', headers });
  let data = {};
  try { data = await resp.json(); } catch (e) { /* keep {} */ }
  if (!resp.ok) throw new Error(data.message || data.detail || `HTTP ${resp.status}`);
  return data;
}

/** Connection test: exchange the long-term token for an admin JWT. */
export async function testBioDBConnection(cfg) {
  if (!cfg.userId || !cfg.token) throw new Error('user_id and long-term token are required');
  const data = await postJSON(`${baseOf(cfg)}/auth/jwt/admin`, { user_id: cfg.userId, token: cfg.token });
  if (!data.jwt) throw new Error(data.message || 'admin JWT exchange failed');
  return { ok: true, jwt: data.jwt };
}

/** Exchange the long-term token for a sensor read JWT (wide time window). */
export async function getBioDBReadJwt(cfg, participantId) {
  const now = Date.now();
  const body = {
    user_id: cfg.userId,
    token: cfg.token,
    participant_id: participantId || 'pf_conn_test',
    start_time: new Date(now - 60000).toISOString(),
    end_time: new Date(now).toISOString(),
  };
  const data = await postJSON(`${baseOf(cfg)}/auth/jwt/sensors/readjwt`, body);
  if (!data.jwt) throw new Error(data.message || 'read JWT exchange failed');
  return data.jwt;
}

/** Experiment registry list (requires cfg.userId/token). */
export async function listBioDBExperiments(cfg, participantId) {
  const jwt = await getBioDBReadJwt(cfg, participantId);
  const data = await getJSON(`${baseOf(cfg)}/experiments`, jwt);
  return data.experiments || data.list || data.data || [];
}

/** Participant list (requires cfg.userId/token). */
export async function listBioDBParticipants(cfg, participantId) {
  const jwt = await getBioDBReadJwt(cfg, participantId);
  const data = await getJSON(`${baseOf(cfg)}/auth/participant`, jwt);
  return data.participants || data.list || data.data || [];
}

/**
 * Push a session into BioDB:
 *   1. exchange long-term token -> sensor write JWT (participant + experiment claims)
 *   2. serialize device samples to [{time, channel: value, ...}]
 *   3. POST /sensor/data/write
 * Returns {rows, channels, start, end, experimentId}.
 */
export async function pushSessionToBioDB(cfg, opts) {
  const {
    participantId = 'pf_participant',
    experimentId = '',
    startedAt,
    endedAt,
    deviceEvents = [],
  } = opts || {};
  const start = startedAt || new Date(Date.now() - 60000).toISOString();
  const end = endedAt || new Date().toISOString();

  const body = {
    user_id: cfg.userId,
    token: cfg.token,
    participant_id: participantId,
    start_time: start,
    end_time: end,
  };
  if (experimentId) body.experiment_id = experimentId;

  const wj = await postJSON(`${baseOf(cfg)}/auth/jwt/sensors/writejwt`, body);
  if (!wj.jwt) throw new Error(wj.message || 'write JWT exchange failed');

  const rows = rowsFromDeviceEvents(deviceEvents);
  if (!rows.length) throw new Error('no_device_samples');
  const payload = JSON.stringify(rows);
  const encoded = typeof btoa === 'function'
    ? btoa(unescape(encodeURIComponent(payload)))
    : Buffer.from(payload, 'utf8').toString('base64');

  const res = await postJSON(
    `${baseOf(cfg)}/sensor/data/write`,
    { format: 'json', compression: 'none', data: encoded },
    wj.jwt,
  );
  if (res.code !== 200 && res.code !== undefined && res.code !== 0) {
    throw new Error(res.message || JSON.stringify(res));
  }
  return { rows: rows.length, channels: channelsOf(rows), start, end, experimentId };
}

/**
 * device_sample_received events -> BioDB record rows.
 * Samples sharing the same timestamp are merged into a single row
 * {time: ISO, [channelId]: value}.
 * Accepts both DeviceConnectorSession events (camelCase: eventType/timestampIso/payload)
 * and engine logger events (snake_case: event_type/timestamp_iso/metadata).
 */
export function rowsFromDeviceEvents(deviceEvents = []) {
  const byTime = new Map();
  for (const ev of deviceEvents) {
    if (!ev) continue;
    const type = ev.eventType || ev.event_type;
    if (type !== 'device_sample_received') continue;
    const payload = ev.payload || ev.metadata || ev;
    const t = ev.timestampIso || ev.timestamp_iso || ev.timestamp || payload.timestamp;
    if (!t) continue;
    const ch = String(payload.channelId || payload.channel || payload.dataType || 'ch');
    const raw = payload.value !== undefined ? payload.value : ev.value;
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    const iso = new Date(t).toISOString();
    let row = byTime.get(iso);
    if (!row) { row = { time: iso }; byTime.set(iso, row); }
    row[ch] = v;
  }
  return [...byTime.values()].sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

function channelsOf(rows) {
  const set = new Set();
  for (const row of rows) for (const key of Object.keys(row)) if (key !== 'time') set.add(key);
  return [...set];
}
