import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCoreComponentRegistry, createProtocolGraph, createSequentialIdFactory, freezeProtocolGraph, insertNodeOnControlEdge, participantUiTemplate } from '../src/core/index.js';
import { createDeploymentBundle } from '../src/deployment/index.js';
import { createHostedHttpHandler, HostedExecutionClient, LocalHostedExecutionService } from '../src/hosted/index.js';

const APP_PORT = Number(process.env.PHYSIOFLOW_PARTICIPANT_E2E_PORT || 14000 + process.pid % 10000);
const API_PORT = APP_PORT + 1;
const DEBUG_PORT = APP_PORT + 2;
const appUrl = `http://127.0.0.1:${APP_PORT}`;
const apiUrl = `http://127.0.0.1:${API_PORT}`;
const debugUrl = `http://127.0.0.1:${DEBUG_PORT}`;
const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);
if (!chrome) throw new Error('Chrome/Chromium is required; set CHROME_BIN to its executable path');

const ids = createSequentialIdFactory();
let protocol = createProtocolGraph({ idFactory: ids, name: 'Public participant E2E', now: '2026-08-23T00:00:00.000Z' });
protocol = insertNodeOnControlEdge(protocol, protocol.graph.edges[0].id, 'display.screen', { idFactory: ids, label: 'Public welcome', config: { ui: participantUiTemplate('instruction'), completion: { mode: 'manual' } } }).protocol;
protocol = await freezeProtocolGraph(protocol, createCoreComponentRegistry(), { now: '2026-08-23T01:00:00.000Z' });
const bundle = await createDeploymentBundle(protocol, { bundleId: 'public_e2e_bundle', createdAt: '2026-08-23T02:00:00.000Z' });
let hostedId = 0;
const service = new LocalHostedExecutionService({ actors: [{ actorId: 'public-e2e-owner', role: 'owner', accessToken: 'public-e2e-owner-token' }], idFactory: prefix => `${prefix}_public_e2e_${++hostedId}` });
const owner = new HostedExecutionClient(service, 'public-e2e-owner-token');
const deployment = await owner.publish(bundle, { idempotencyKey: 'public-e2e-publish' });
owner.processNextDeployment();
const link = await owner.createLaunchLink(deployment.deploymentId, { idempotencyKey: 'public-e2e-link', maximumUses: 1 });
const hostedHandler = createHostedHttpHandler(service, { allowedOrigins: [appUrl] });
const apiServer = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const result = await hostedHandler(new Request(`${apiUrl}${request.url}`, { method: request.method, headers: request.headers, body }));
  response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
  response.end(Buffer.from(await result.arrayBuffer()));
});
await new Promise((resolve, reject) => apiServer.listen(API_PORT, '127.0.0.1', error => error ? reject(error) : resolve()));

const profileDirectory = mkdtempSync(join(tmpdir(), 'physioflow-participant-e2e-'));
const children = [];
const cleanup = async () => {
  children.forEach(child => { if (!child.killed) child.kill('SIGKILL'); });
  await Promise.all(children.map(child => child.exitCode != null ? undefined : new Promise(resolve => { const timer = setTimeout(resolve, 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); })));
  await new Promise(resolve => apiServer.close(resolve));
  rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
};
process.on('exit', () => children.forEach(child => { if (!child.killed) child.kill('SIGKILL'); }));

async function waitForUrl(url, label, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const vite = spawn(process.execPath, ['./node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(APP_PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
children.push(vite);
await waitForUrl(appUrl, 'Vite');
const launchUrl = `${appUrl}/participant#launch=${encodeURIComponent(link.launchToken)}&api=${encodeURIComponent(apiUrl)}&participantId=PUBLIC-E2E`;
const chromeProcess = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profileDirectory}`, launchUrl], { stdio: ['ignore', 'pipe', 'pipe'] });
children.push(chromeProcess);
await waitForUrl(`${debugUrl}/json/list`, 'Chrome DevTools');

const targets = await fetch(`${debugUrl}/json/list`).then(response => response.json());
const target = targets.find(item => item.type === 'page' && item.url.startsWith(`${appUrl}/participant`));
if (!target) throw new Error('Participant page target was not created');
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const waitFor = async (expression, label, timeout = 10000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  const diagnostic = await evaluate(`({ text: document.body.innerText, url: location.href })`);
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(diagnostic)}`);
};
const clickText = async text => {
  const clicked = await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent.includes(${JSON.stringify(text)}) && !item.disabled); if (!button) return false; button.click(); return true; })()`);
  assert.equal(clicked, true, `Missing enabled button containing ${text}`);
};

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await waitFor(`document.body.textContent.includes('RUNTIME V2 READY') && document.body.textContent.includes('PUBLIC-E2E')`, 'verified participant runtime');
  await clickText('Begin experiment');
  await waitFor(`document.body.textContent.includes('Welcome') && document.body.textContent.includes('Continue')`, 'participant instruction');
  const syncStarted = Date.now();
  while (![...service.sessions.values()][0]?.runtimeSnapshot && Date.now() - syncStarted < 5000) await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok([...service.sessions.values()][0]?.runtimeSnapshot, 'Hosted recovery snapshot was not synchronized');
  await evaluate(`new Promise((resolve, reject) => { const request = indexedDB.open('physioflow-data-v1', 1); request.onsuccess = () => { const transaction = request.result.transaction('current', 'readwrite'); transaction.objectStore('current').delete('active'); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); }; request.onerror = () => reject(request.error); }).then(() => localStorage.removeItem('physioflow.current-run-pointer.v2'))`);
  await send('Page.reload', { ignoreCache: true });
  await waitFor(`document.body.textContent.includes('Welcome') && document.body.textContent.includes('Continue') && !document.body.textContent.includes('RUNTIME V2 READY')`, 'participant refresh recovery');
  await clickText('Continue');
  await waitFor(`document.body.textContent.includes('SESSION COMPLETE') && document.body.textContent.includes('Hosted sync complete')`, 'public participant completion');
  assert.equal(service.launchLinks.get(link.launchLinkId).useCount, 1);
  const session = [...service.sessions.values()][0];
  assert.equal(session.status, 'completed');
  assert.ok(session.eventCount >= 4);
  console.log(JSON.stringify({ status: 'passed', publicParticipantEntry: true, bootstrapVerified: true, refreshRecovery: true, hostedRuntimeSync: true }, null, 2));
} finally {
  socket.close();
  await cleanup();
}
