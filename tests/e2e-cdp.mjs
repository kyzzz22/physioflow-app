import assert from 'node:assert/strict';

const targets = await fetch('http://localhost:9222/json/list').then(response => response.json());
const target = targets.find(item => item.type === 'page' && item.url.includes('localhost:5174')) || targets.find(item => item.type === 'page');
if (!target) throw new Error('No Chrome page target found. Start Chrome with --remote-debugging-port=9222 and open http://localhost:5174');

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const waitFor = async (expression, label, timeout = 8000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out waiting for ${label}`);
};
const clickText = async (text, selector = 'button') => {
  const clicked = await evaluate(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find(item => item.textContent.trim().includes(${JSON.stringify(text)}));
    if (!element) return false;
    element.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Missing clickable text: ${text}`);
};
const setLabel = async (label, value, selector = 'input,textarea,select') => {
  const changed = await evaluate(`(() => {
    const labels = [...document.querySelectorAll('label')];
    const label = labels.find(item => item.childNodes[0]?.textContent?.trim() === ${JSON.stringify(label)} || item.textContent.trim().startsWith(${JSON.stringify(label)}));
    if (!label) return false;
    const element = label.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(String(value))});
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  assert.equal(changed, true, `Missing field: ${label}`);
};
const resetWorkspace = async () => {
  await evaluate(`Promise.all([
    new Promise(resolve => { const request = indexedDB.deleteDatabase('physioflow-data-v1'); request.onsuccess = request.onerror = request.onblocked = () => resolve(); }),
    new Promise(resolve => { const request = indexedDB.deleteDatabase('physioflow-assets-v1'); request.onsuccess = request.onerror = request.onblocked = () => resolve(); }),
    new Promise(resolve => { const request = indexedDB.deleteDatabase('physioflow-workspace-v1'); request.onsuccess = request.onerror = request.onblocked = () => resolve(); }),
  ]).then(() => { localStorage.clear(); localStorage.setItem('physioflow.guide-seen.v1', '1'); location.reload(); })`);
  await waitFor(`document.body.textContent.includes('PhysioFlow workspace')`, 'dashboard');
};
const seedProtocol = async (name, frozen) => {
  await evaluate(`(async () => {
    const domain = await import('/src/domain.js');
    const protocol = domain.protocol({
      name: ${JSON.stringify(name)},
      blocks: [domain.block({
        name: 'E2E block',
        trials: [domain.trial({
          name: 'E2E trial',
          steps: [domain.step('timer', { name: 'Fast timer', planned_duration_ms: 80, is_analysis_window: true, role: 'task' })],
        })],
      })],
    });
    const finalProtocol = ${frozen ? 'await domain.freezeProtocol(protocol)' : 'protocol'};
    localStorage.setItem('physioflow.protocols.v1', JSON.stringify([finalProtocol]));
    localStorage.setItem('physioflow.guide-seen.v1', '1');
    location.reload();
  })()`);
  await waitFor(`document.body.textContent.includes(${JSON.stringify(name)})`, `${name} seeded`);
};

await send('Page.enable');
await send('Runtime.enable');

await resetWorkspace();
await seedProtocol('E2E formal storage gate', true);
assert.equal(await evaluate(`document.body.textContent.includes('blocked')`), true);
await clickText('Run latest');
await waitFor(`document.body.textContent.includes('LOCAL DATA STORAGE')`, 'formal storage gate');
assert.equal(await evaluate(`document.body.textContent.includes('Formal sessions must write to a selected local data folder')`), true);
assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(button => button.textContent.includes('Continue to session setup'))`), false);

await resetWorkspace();
await seedProtocol('E2E preview fallback', false);
await clickText('Edit draft');
await waitFor(`document.body.textContent.includes('Save flow')`, 'visual editor');
await clickText('Run');
await waitFor(`document.body.textContent.includes('SESSION SETUP')`, 'session setup');
assert.equal(await evaluate(`document.body.textContent.includes('Preview storage')`), true);
await setLabel('Participant ID', 'E2E-PREVIEW');
await clickText('Start session');
await waitFor(`document.body.textContent.includes('Begin experiment')`, 'runtime ready');
await clickText('Begin experiment');
await waitFor(`document.body.textContent.includes('SESSION COMPLETE')`, 'session complete', 10000);
await clickText('Return to projects');
await waitFor(`document.body.textContent.includes('E2E-PREVIEW')`, 'saved preview session summary', 10000);

const sessionIndex = await evaluate(`JSON.parse(localStorage.getItem('physioflow.sessions.v2') || '[]')`);
assert.equal(sessionIndex.length, 1);
assert.equal(sessionIndex[0].status, 'completed');
assert.equal(sessionIndex[0].run_mode, 'preview');

const details = await evaluate(`new Promise((resolve, reject) => {
  const request = indexedDB.open('physioflow-data-v1', 1);
  request.onsuccess = () => {
    const read = request.result.transaction('sessions').objectStore('sessions').getAll();
    read.onsuccess = () => resolve(read.result);
    read.onerror = () => reject(read.error);
  };
  request.onerror = () => reject(request.error);
})`);
assert.equal(details.length, 1);
assert.equal(details[0].participant_id, 'E2E-PREVIEW');
assert.equal(details[0].run_mode, 'preview');
assert.ok(details[0].events.some(event => event.event_type === 'session_completed'));

socket.close();
console.log(JSON.stringify({
  status: 'passed',
  formal_gate: 'blocked_without_local_folder',
  preview_participant: details[0].participant_id,
  preview_events: details[0].events.length,
  preview_integrity: details[0].integrity?.validity_status,
}, null, 2));
