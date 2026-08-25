// Interaction acceptance driver for the ComposerV2 canvas:
// drag-to-connect, Ctrl+A select-all, zoom shortcuts, Esc-stays-in-editor.
const { spawn, execSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9334;
const URL = 'http://127.0.0.1:5175/';
const USER_DIR = path.join(os.tmpdir(), 'physioflow-interact-chrome');
const VITE = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');

let chrome = null;
let viteProc = null;
let ws = null;
let msgId = 0;
const pending = new Map();
const consoleErrors = [];
let failures = 0;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function killPort(port) {
  try {
    const out = execSync(`netstat -ano | findstr ":${port}" | findstr "LISTENING"`, { encoding: 'utf8' });
    const pids = [...new Set(out.split(/\r?\n/).map(l => l.trim().split(/\s+/).pop()).filter(p => p && /^\d+$/.test(p)))];
    for (const pid of pids) { try { execSync(`taskkill /F /PID ${pid} >nul 2>&1`); } catch { /* ignore */ } }
  } catch { /* no listener */ }
}

function cleanup(code) {
  try { chrome?.kill(); } catch { }
  try { viteProc?.kill(); } catch { }
  killPort(PORT);
  try { execSync(`rmdir /S /Q "${USER_DIR}" 2>nul`); } catch { }
  process.exit(code || 0);
}

async function launch() {
  killPort(5175);
  killPort(PORT);
  viteProc = spawn(process.execPath, [VITE, '--port', '5175', '--host', '127.0.0.1', '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' });
  let viteReady = false;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:5175/'); if (r.ok) { viteReady = true; break; } } catch { /* retry */ }
    await sleep(400);
  }
  if (!viteReady) throw new Error('vite not ready');
  chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${USER_DIR}`,
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--window-size=1280,900',
    'about:blank',
  ], { stdio: 'ignore' });
  await waitForCdp();
  await connect();
}

async function waitForCdp() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return; } catch { }
    await sleep(400);
  }
  throw new Error('CDP not available');
}

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    }
  };
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject: e => reject(new Error(method + ' :: ' + e.message)) });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalJS(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails.exception?.description || r.exceptionDetails.text;
    throw new Error('eval failed: ' + d);
  }
  return r.result.value;
}

async function navigate(url) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 60; i++) {
    try {
      const info = await evalJS(`({ href: location.href, root: document.querySelector('#root')?.children.length || 0, text: document.body.innerText.trim().length })`);
      if (info && info.href && info.href.startsWith('http') && info.root > 0 && info.text > 0) break;
    } catch { /* page still loading */ }
    await sleep(300);
  }
  await sleep(700);
}

async function clickAt(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(200);
}

async function dragMouse(from, to, steps = 14) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
  await sleep(40);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(80);
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
    await sleep(16);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(300);
}

async function keyPress(key, mods = {}) {
  const { ctrl = false, shift = false, meta = false } = mods;
  const single = key.length === 1;
  const code = single ? `Key${key.toUpperCase()}` : key;
  const vk = single ? key.toUpperCase().charCodeAt(0) : 0;
  let modifiers = 0;
  if (ctrl) modifiers |= 2;
  if (shift) modifiers |= 8;
  if (meta) modifiers |= 4;
  await send('Page.bringToFront');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers, text: single ? key : '' });
  await sleep(60);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
  await sleep(180);
}

function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' ' + extra : ''}`);
  if (!ok) failures++;
}

async function buildProtocol() {
  const { pathToFileURL } = require('url');
  const { createProtocolGraph } = await import(pathToFileURL(path.join(process.cwd(), 'src/core/protocolGraph.js')).href);
  const { addNode, connect } = await import(pathToFileURL(path.join(process.cwd(), 'src/core/graphCommands.js')).href);
  const { createCoreComponentRegistry } = await import(pathToFileURL(path.join(process.cwd(), 'src/core/componentRegistry.js')).href);
  const registry = createCoreComponentRegistry();
  const responseDefaults = registry.get('input.response').defaultConfig;
  const now = '2026-08-26T00:00:00.000Z';
  let p = createProtocolGraph({ name: 'Interaction Verify', now });
  const start = p.graph.nodes.find(n => n.component.type === 'core.start');
  const end = p.graph.nodes.find(n => n.component.type === 'core.end');
  p.graph.edges = [];
  let r = addNode(p, 'input.response', { id: 'resp', label: 'Respond', config: { ...responseDefaults, prompt: 'Press a key', correctValue: 'yes' }, layout: { x: 260, y: 160 }, now });
  p = r.protocol;
  let c = addNode(p, 'logic.condition', { id: 'cond', label: 'Branch', config: { operator: 'equals', expected: 'yes' }, layout: { x: 300, y: 340 }, now });
  p = c.protocol;
  let l = connect(p, 'control', { nodeId: start.id, portId: 'next' }, { nodeId: r.node.id, portId: 'in' });
  p = l.protocol;
  l = connect(p, 'control', { nodeId: r.node.id, portId: 'next' }, { nodeId: end.id, portId: 'in' });
  p = l.protocol;
  return p;
}

async function main() {
  const proto = await buildProtocol();
  await launch();
  await navigate(URL);
  await evalJS(`(() => { localStorage.setItem('physioflow.protocols.v1', JSON.stringify([${JSON.stringify(proto)}])); return 'injected'; })()`);
  await navigate(URL);
  await sleep(600);
  const injected = await evalJS(`localStorage.getItem('physioflow.protocols.v1') ? localStorage.getItem('physioflow.protocols.v1').slice(0, 80) : 'none'`);
  const pageInfo = await evalJS(`(() => ({
    text: document.body.innerText.trim().slice(0, 120).replace(/\\n/g, ' | '),
    buttons: [...document.querySelectorAll('button')].slice(0, 8).map(b => (b.textContent || '').trim()),
  }))()`);
  const clickedEdit = await evalJS(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('Edit draft'));
    if (!b) return false;
    b.click();
    return true;
  })()`);
  check('open-composer', clickedEdit, `storage=${JSON.stringify(injected)} page=${JSON.stringify(pageInfo)}`);
  if (!clickedEdit) { cleanup(1); return; }
  let canvas = false;
  for (let i = 0; i < 50; i++) {
    canvas = await evalJS(`!!document.querySelector('.composer-canvas-wrap')`);
    if (canvas) break;
    await sleep(250);
  }
  if (!canvas) {
    const diag = await evalJS(`(() => ({
      href: location.href,
      text: document.body.innerText.trim().slice(0, 300).replace(/\\n/g, ' | '),
      err: [...document.querySelectorAll('.error, [class*="error"]')].map(e => e.textContent.trim().slice(0, 120)),
    }))()`);
    check('canvas-visible', false, JSON.stringify(diag));
    cleanup(1);
    return;
  }
  check('canvas-visible', canvas);

  // --- Drag-to-connect: resp.value (data out) -> cond.value (data in) ---
  const ports = await evalJS(`(() => {
    const resp = document.querySelector('.composer-node[data-node-id="resp"]');
    const cond = document.querySelector('.composer-node[data-node-id="cond"]');
    if (!resp || !cond) return null;
    const out = resp.querySelector('.composer-port.output[data-port-id="value"]');
    const inp = cond.querySelector('.composer-port.input[data-port-id="value"]');
    if (!out || !inp) return null;
    const a = out.getBoundingClientRect();
    const b = inp.getBoundingClientRect();
    return { from: { x: a.x + a.width / 2, y: a.y + a.height / 2 }, to: { x: b.x + b.width / 2, y: b.y + b.height / 2 } };
  })()`);
  const edgeCount = async () => evalJS(`(() => {
    const t = document.querySelector('.composer-canvas-toolbar span')?.textContent || '';
    const m = t.match(/(\\d+) connections/);
    return m ? Number(m[1]) : -1;
  })()`);
  const before = await edgeCount();
  if (!ports) { check('drag-connect', false, 'ports not found'); }
  else {
    await evalJS(`(() => {
      window.__pd = 0; window.__pm = 0; window.__pu = 0;
      window.addEventListener('pointerdown', () => { window.__pd++; }, true);
      window.addEventListener('pointermove', () => { window.__pm++; }, true);
      window.addEventListener('pointerup', () => { window.__pu++; }, true);
      return 'listening';
    })()`);
    await dragMouse(ports.from, ports.to);
    await sleep(200);
    const after = await edgeCount();
    const evStats = await evalJS(`({ pd: window.__pd, pm: window.__pm, pu: window.__pu })`);
    const wireCount = await evalJS(`document.querySelectorAll('.composer-wires path.temp').length`);
    check('drag-connect', after === before + 1, `connections ${before} -> ${after} events=${JSON.stringify(evStats)}`);
    check('drag-wire-cleaned', wireCount === 0, `temp wires left: ${wireCount}`);
  }

  // --- Ctrl+A selects all non-entry nodes ---
  await keyPress('a', { ctrl: true });
  const sel = await evalJS(`(() => {
    const nodes = document.querySelectorAll('.composer-node').length;
    const selected = document.querySelectorAll('.composer-node.selected').length;
    const entrySel = document.querySelector('.composer-node.selected[data-node-id]') ? 1 : 0;
    return { nodes, selected, entrySel };
  })()`);
  check('ctrl-a-select-all', sel.selected === sel.nodes - 1, JSON.stringify(sel));

  // --- Zoom shortcuts: Ctrl+= zooms in, Ctrl+0 resets ---
  const zoomText = async () => (await evalJS(`document.querySelector('.composer-zoom span')?.textContent || ''`)).trim();
  const z0 = await zoomText();
  await keyPress('=', { ctrl: true });
  const z1 = await zoomText();
  await keyPress('0', { ctrl: true });
  const z2 = await zoomText();
  check('zoom-shortcuts', z0 === '100%' && z1 === '125%' && z2 === '100%', `zoom ${z0} -> ${z1} -> ${z2}`);

  // --- Escape cancels an in-flight point-to-point connection ---
  const respOut = await evalJS(`(() => {
    const p = document.querySelector('.composer-node[data-node-id="resp"] .composer-port.output[data-port-id="value"]');
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (respOut) {
    await clickAt(respOut.x, respOut.y);
    const pendingBefore = await evalJS(`!!document.querySelector('.composer-port.pending')`);
    await keyPress('Escape');
    const pendingAfter = await evalJS(`(() => ({
      pending: !!document.querySelector('.composer-port.pending'),
      inBuilder: !!document.querySelector('.composer-v2'),
    }))()`);
    check('esc-cancels-pending-port', pendingBefore && !pendingAfter.pending && pendingAfter.inBuilder, JSON.stringify({ before: pendingBefore, ...pendingAfter }));
  } else { check('esc-cancels-pending-port', false, 'resp value port not found'); }

  // --- Escape clears selection and does NOT leave the editor ---
  await keyPress('a', { ctrl: true });
  const selectedAfterA = await evalJS(`document.querySelectorAll('.composer-node.selected').length`);
  await keyPress('Escape');
  const esc = await evalJS(`(() => ({
    inBuilder: !!document.querySelector('.composer-v2'),
    selected: document.querySelectorAll('.composer-node.selected').length,
    confirmDialog: document.body.innerText.includes('Discard') || document.body.innerText.includes('unsaved'),
  }))()`);
  check('esc-stays-in-editor', selectedAfterA > 0 && esc.inBuilder && esc.selected === 0 && !esc.confirmDialog, JSON.stringify({ selectedAfterA, ...esc }));

  console.log('CONSOLE-errors:', consoleErrors.length ? JSON.stringify(consoleErrors) : 'none');
  cleanup(failures ? 1 : 0);
}

main().catch(error => { console.error(error); cleanup(1); });
