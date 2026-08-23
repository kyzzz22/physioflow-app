import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP_PORT = Number(process.env.PHYSIOFLOW_E2E_PORT || 10000 + process.pid % 20000);
const DEBUG_PORT = APP_PORT + 1;
const appUrl = `http://127.0.0.1:${APP_PORT}`;
const debugUrl = `http://127.0.0.1:${DEBUG_PORT}`;
const chromeCandidates = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const chrome = chromeCandidates.find(executable => existsSync(executable));
if (!chrome) throw new Error('Chrome/Chromium is required; set CHROME_BIN to its executable path');

const profileDirectory = mkdtempSync(join(tmpdir(), 'physioflow-e2e-'));
const children = [];
const terminateChildren = () => {
  children.forEach(child => { if (!child.killed) child.kill('SIGKILL'); });
};
const waitForChildExit = child => {
  if (child.exitCode != null || child.signalCode != null) return Promise.resolve();
  return new Promise(resolve => {
    const timeout = setTimeout(resolve, 5000);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
    if (!child.killed) child.kill('SIGKILL');
  });
};
const cleanup = async () => {
  await Promise.all(children.map(waitForChildExit));
  rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
};
process.on('exit', terminateChildren);
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

async function waitForUrl(url, label, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { const response = await fetch(url); if (response.ok) return response; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const vite = spawn(process.execPath, ['./node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(APP_PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
children.push(vite);
await waitForUrl(appUrl, 'Vite');
const chromeProcess = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profileDirectory}`, appUrl], { stdio: ['ignore', 'pipe', 'pipe'] });
children.push(chromeProcess);
await waitForUrl(`${debugUrl}/json/list`, 'Chrome DevTools');

const targets = await fetch(`${debugUrl}/json/list`).then(response => response.json());
const target = targets.find(item => item.type === 'page' && item.url.startsWith(appUrl));
if (!target) throw new Error('Composer E2E page target was not created');
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let commandSequence = 0;
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++commandSequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
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
  throw new Error(`Timed out waiting for ${label}`);
};
const clickText = async text => {
  const clicked = await evaluate(`(() => { const element = [...document.querySelectorAll('button')].find(item => item.textContent.trim().includes(${JSON.stringify(text)}) && !item.disabled); if (!element) return false; element.click(); return true; })()`);
  assert.equal(clicked, true, `Missing enabled button containing ${text}`);
};
const field = async (ariaLabel, value, eventName = 'input') => {
  const changed = await evaluate(`(() => { const element = document.querySelector('[aria-label=${JSON.stringify(ariaLabel)}]'); if (!element) return false; const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(String(value))}); element.dispatchEvent(new Event(${JSON.stringify(eventName)}, { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  assert.equal(changed, true, `Missing field ${ariaLabel}`);
};

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await waitFor(`document.body.textContent.includes('PhysioFlow workspace')`, 'workspace');
  await evaluate(`Promise.all(['physioflow-data-v1','physioflow-assets-v1','physioflow-workspace-v1'].map(name => new Promise(resolve => { const request = indexedDB.deleteDatabase(name); request.onsuccess = request.onerror = request.onblocked = () => resolve(); }))).then(() => { localStorage.clear(); localStorage.setItem('physioflow.guide-seen.v1','1'); location.reload(); })`);
  await waitFor(`document.body.textContent.includes('No projects yet')`, 'clean dashboard');
  await clickText('＋ New protocol');
  await waitFor(`document.body.textContent.includes('Composer V2')`, 'Composer V2');
  await clickText('Design');
  await field('New variable name', 'score');
  await field('New variable type', 'number', 'change');
  await clickText('Add variable');
  await clickText('input.rating');
  await waitFor(`document.body.textContent.includes('Participant interface')`, 'Rating inspector');
  await clickText('Create group from node');
  await field('Rating group group kind', 'subflow', 'change');
  await clickText('Add parameter');
  await field('Rating group parameter 1 name', 'result');
  await clickText('Publish reusable template');
  await waitFor(`document.body.textContent.includes('Reusable subflows')`, 'subflow template library');
  await clickText('Create instance');
  await waitFor(`document.body.textContent.includes('Created Rating group instance')`, 'subflow instance');
  assert.equal(await evaluate(`document.querySelectorAll('.composer-node').length`), 4);
  await clickText('logic.value-switch');
  await waitFor(`document.body.textContent.includes('Match value')`, 'Value switch inspector');
  assert.equal(await evaluate(`[...document.querySelectorAll('.composer-node')].some(node => node.textContent.includes('Value switch'))`), true);
  assert.equal(await evaluate(`document.body.textContent.includes('Match') && document.body.textContent.includes('Default')`), true);

  await clickText('Advanced');
  await waitFor(`document.body.textContent.includes('Collaboration change sets')`, 'collaboration change-set panel');
  await waitFor(`document.body.textContent.includes('Portable deployment')`, 'portable deployment panel');
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(button => button.textContent.includes('Export deployment bundle') && button.disabled)`), true);
  await clickText('Use current as baseline');
  await waitFor(`document.body.textContent.includes('Collaboration baseline updated')`, 'collaboration baseline');
  await clickText('Install Reaction Button example');
  await waitFor(`document.body.textContent.includes('org.physioflow.examples.reaction-button@1.0.0')`, 'SDK package installation');
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(button => button.textContent.includes('example.reaction-button'))`), true);
  await clickText('Install simulated sensor');
  await waitFor(`document.body.textContent.includes('org.physioflow.simulated-sensor@1.0.0')`, 'device connector installation');
  assert.equal(await evaluate(`document.body.textContent.includes('input signal:number') && document.body.textContent.includes('device.connect, device.read, device.write')`), true);
  await clickText('Export changes');
  await waitFor(`document.body.textContent.includes('Exported') && document.body.textContent.includes('collaboration operation')`, 'collaboration change-set export');

  console.log(JSON.stringify({ status: 'passed', composer: 'v2', nodes: 5, reusableSubflow: true, controlHandler: 'core.value-switch@1.0.0', collaborationChangeSet: true, portableDeployment: true, sdkComponent: 'example.reaction-button@1.0.0', deviceConnector: 'org.physioflow.simulated-sensor@1.0.0' }, null, 2));
} finally {
  socket.close();
  await cleanup();
}
