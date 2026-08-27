// bioDBClient.js — BioDB REST client (D2/D3)
// Exchanges the long-term token for short-lived JWTs and pushes session
// sensor samples into BioDB. All endpoints go through the NGINX gateway:
//   POST /auth/jwt/admin                 long-term token -> admin JWT
//   POST /auth/jwt/sensors/readjwt       -> sensor read JWT (claims: participant/experiment)
//   POST /auth/jwt/sensors/writejwt      -> sensor write JWT (claims: participant/experiment/experimenter)
//   GET  /experiments                    experiment registry (with read JWT)
//   GET  /auth/participant               participant list (with read JWT)
//   POST /sensor/data/write              {format, compression, data(base64 records)} (with write JWT)
//   POST /sensor/data/read               {format, compression, rows, start_time, end_time} -> columnar JSON (with read JWT)
//   POST /jwt/events                     -> event JWT (claims: participant/time window)
//   GET  /events?role=experimenter&start_time&end_time   event list (with event JWT)

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

/** Admin JWT (WebUI claim) — used for participant/experiment listings. */
export async function getBioDBAdminJwt(cfg) {
  const data = await postJSON(`${baseOf(cfg)}/auth/jwt/admin`, { user_id: cfg.userId, token: cfg.token });
  if (!data.jwt) throw new Error(data.message || 'admin JWT exchange failed');
  return data.jwt;
}

/** Exchange the long-term token for a sensor read JWT (window = request window). */
export async function getBioDBReadJwt(cfg, participantId, { startTime, endTime } = {}) {
  const now = Date.now();
  const body = {
    user_id: cfg.userId,
    token: cfg.token,
    participant_id: participantId || 'pf_conn_test',
    start_time: startTime || new Date(now - 60000).toISOString(),
    end_time: endTime || new Date(now).toISOString(),
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

/** Participant list (admin JWT + WebUI claim; entries expose id/email/name). */
export async function listBioDBParticipants(cfg) {
  const jwt = await getBioDBAdminJwt(cfg);
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

/* ── D3: data management panel helpers ─────────────────────────────── */

function b64DecodeUtf8(b64) {
  if (typeof atob === 'function') return decodeURIComponent(escape(atob(b64)));
  return Buffer.from(b64, 'base64').toString('utf8');
}

/** Exchange the long-term token for an event JWT (claims: participant + time window). */
export async function getBioDBEventJwt(cfg, { participantId, startTime, endTime } = {}) {
  const body = {
    user_id: cfg.userId,
    token: cfg.token,
    participant_id: participantId || 'pf_conn_test',
    start_time: startTime || new Date(Date.now() - 60000).toISOString(),
    end_time: endTime || new Date().toISOString(),
  };
  const data = await postJSON(`${baseOf(cfg)}/auth/jwt/events`, body);
  if (!data.jwt) throw new Error(data.message || 'event JWT exchange failed');
  return data.jwt;
}

/**
 * Read sensor data back from BioDB (D3).
 * Returns the decoded columnar JSON: { time: [ISO...], [channel]: [values...], ... }.
 */
export async function readBioDBData(cfg, { participantId, startTime, endTime, rows = ['pf_conn_test'], chunkSeconds } = {}) {
  const start = startTime || new Date(Date.now() - 60000).toISOString();
  const end = endTime || new Date().toISOString();
  const jwt = await getBioDBReadJwt(cfg, participantId, { startTime: start, endTime: end });
  const body = {
    format: 'json',
    compression: 'none',
    rows,
    start_time: start,
    end_time: end,
  };
  if (chunkSeconds) body.chunk_seconds = chunkSeconds;
  const res = await postJSON(`${baseOf(cfg)}/sensor/data/read`, body, jwt);
  if (!res.data) throw new Error(res.message || 'read returned no data');
  let parsed;
  try {
    parsed = JSON.parse(b64DecodeUtf8(res.data));
  } catch (e) {
    throw new Error('failed to decode read payload');
  }
  return parsed && typeof parsed === 'object' ? parsed : { time: [] };
}

/** Event list for a participant + time window (requires cfg.userId/token). */
export async function listBioDBEvents(cfg, { participantId, startTime, endTime } = {}) {
  const jwt = await getBioDBEventJwt(cfg, { participantId, startTime, endTime });
  const params = new URLSearchParams({
    role: 'experimenter',
    start_time: startTime || new Date(Date.now() - 60000).toISOString(),
    end_time: endTime || new Date().toISOString(),
  });
  const data = await getJSON(`${baseOf(cfg)}/event/events?${params.toString()}`, jwt);
  return data.event_list || data.events || [];
}

/** Create an event for a participant (D3). Note: body.user_id = participantId. */
export async function createBioDBEvent(cfg, { participantId, startTime, endTime, event, description, experimentId } = {}) {
  const jwt = await getBioDBEventJwt(cfg, { participantId, startTime, endTime });
  const body = {
    user_id: participantId,
    start_time: startTime,
    end_time: endTime,
    event,
    description,
  };
  if (experimentId) body.experiment_id = experimentId;
  const data = await postJSON(`${baseOf(cfg)}/event/events`, body, jwt);
  return data; // { code, message, event_id }
}

/** Delete an event (D3). The event JWT window must cover the event's own window. */
export async function deleteBioDBEvent(cfg, { participantId, eventId, startTime, endTime }) {
  const jwt = await getBioDBEventJwt(cfg, { participantId, startTime, endTime });
  const resp = await fetch(`${baseOf(cfg)}/event/events/${eventId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${jwt}` },
  });
  let data = {};
  try { data = await resp.json(); } catch (e) { /* keep {} */ }
  if (!resp.ok) throw new Error(data.message || data.detail || `HTTP ${resp.status}`);
  return data;
}
