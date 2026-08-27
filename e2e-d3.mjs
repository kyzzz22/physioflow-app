// D3 end-to-end verification: read columnar data + event list via the DataPanel client functions.
// Usage: $env:BIO_URL="http://localhost:5002"; $env:BIO_USER="<user_id>"; $env:BIO_TOKEN="<token>"; $env:BIO_PID="<participant_id>"; node e2e-d3.mjs
import { readBioDBData, listBioDBEvents, listBioDBParticipants, getBioDBEventJwt, deleteBioDBEvent } from './src/bioDBClient.js';

const CFG = { baseUrl: process.env.BIO_URL || 'http://localhost:5002', userId: process.env.BIO_USER || '', token: process.env.BIO_TOKEN || '' };
const PID = process.env.BIO_PID || '';

if (!CFG.userId || !CFG.token || !PID) {
  console.error('Missing BIO_USER/BIO_TOKEN/BIO_PID env vars');
  process.exit(1);
}

const endTime = new Date();
const startTime = new Date(endTime.getTime() - 3600000);
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

// 1. participant list (panel dropdown source)
const participants = await step('participant list', () => listBioDBParticipants(CFG));
if (participants) {
  const names = participants.map(p => p.participant_id || p.participantId || p.id || p.name || p.user_id).filter(Boolean);
  console.log(`  → ${names.length} participant(s): ${names.slice(0, 5).join(', ')}`);
}

// 2. columnar read-back (the DataPanel "Read data" path)
const data = await step('columnar read (rows=eda,hr)', () =>
  readBioDBData(CFG, { participantId: PID, startTime: startTime.toISOString(), endTime: endTime.toISOString(), rows: ['eda', 'hr'] }));
if (data) {
  const keys = Object.keys(data).filter(k => k !== 'time');
  const n = data.time ? data.time.length : 0;
  console.log(`  → ${n} rows, channels: ${keys.join(', ') || '(none)'}`);
  if (n > 0 && keys.length > 0) {
    const last = keys[0];
    console.log(`  → sample[${last}] = ${Number(data[last][n - 1]).toFixed(3)}`);
  } else {
    failures++;
    console.error('  ⚠ read returned no rows/channels');
  }
}

// 3. event list (the DataPanel "Read events" path)
const events = await step('event list', () =>
  listBioDBEvents(CFG, { participantId: PID, startTime: startTime.toISOString(), endTime: endTime.toISOString() }));
if (events) {
  console.log(`  → ${events.length} event(s)`);
  if (events.length > 0) {
    const ev = events[0];
    console.log(`  → first: ${ev.event} @ ${ev.start_time || ev.startTime}`);
  }
}

// 4. event CRUD path: create one with the event JWT, then read it back
const eventJwt = await step('event JWT', () =>
  getBioDBEventJwt(CFG, { participantId: PID, startTime: startTime.toISOString(), endTime: endTime.toISOString() }));
if (eventJwt) {
  const evStart = new Date(Date.now() - 30 * 60000).toISOString();
  const created = await step('create event', async () => {
    const resp = await fetch(`${CFG.baseUrl}/event/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${eventJwt}` },
      body: JSON.stringify({
        user_id: PID,
        start_time: evStart,
        end_time: new Date(Date.now() - 29 * 60000).toISOString(),
        event: 'e2e-d3-verify',
        description: 'D3 e2e verification event',
      }),
    });
    const d = await resp.json();
    if (!resp.ok) throw new Error(d.message || d.error || `HTTP ${resp.status}`);
    return d;
  });
  if (created) console.log(`  → event_id: ${created.event_id}`);
  const after = await step('event list after create', () =>
    listBioDBEvents(CFG, { participantId: PID, startTime: startTime.toISOString(), endTime: endTime.toISOString() }));
  const createdEv = after && after.find(ev => (ev.event || '') === 'e2e-d3-verify');
  if (after && !createdEv) {
    failures++;
    console.error('  ⚠ created event not found in list');
  } else if (after) {
    console.log(`  → e2e-d3-verify present (${after.length} event(s) total)`);
  }

  if (createdEv) {
    const marked = after.filter(ev => (ev.event || '') === 'e2e-d3-verify');
    await step(`delete ${marked.length} e2e event(s)`, async () => {
      for (const ev of marked) {
        const st = ev.start_time || ev.startTime;
        const en = ev.end_time || ev.endTime || st;
        await deleteBioDBEvent(CFG, { participantId: PID, eventId: ev.event_id || ev.eventId, startTime: st, endTime: en });
      }
    });
    const finalList = await step('event list after delete', () =>
      listBioDBEvents(CFG, { participantId: PID, startTime: startTime.toISOString(), endTime: endTime.toISOString() }));
    if (finalList && finalList.some(ev => (ev.event || '') === 'e2e-d3-verify')) {
      failures++;
      console.error('  ⚠ deleted event still present');
    } else if (finalList) {
      console.log(`  → e2e-d3-verify removed (${finalList.length} event(s) left)`);
    }
  }
}

console.log(failures === 0 ? '\nAll D3 steps PASS' : `\n${failures} step(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
