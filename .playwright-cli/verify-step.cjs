// Step-by-step acceptance driver. STEP env selects which verification to run.
// Supported now: align, tree-reorder, composer-step8
const { spawn, execSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

const STEP = process.env.STEP || 'align';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const URL = 'http://127.0.0.1:5174/';
const USER_DIR = path.join(os.tmpdir(), 'physioflow-verify-chrome');
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
    for (const pid of pids) {
      try { execSync(`taskkill /F /PID ${pid} >nul 2>&1`); } catch { /* ignore */ }
    }
  } catch { /* nothing listening */ }
}

async function startVite() {
  killPort(5174);
  viteProc = spawn(process.execPath, [VITE, '--port', '5174', '--host', '127.0.0.1', '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  viteProc.stderr.on('data', d => { const s = String(d); if (!s.includes('EBUSY')) process.stdout.write('[vite-err] ' + s); });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:5174/'); if (r.ok) return; } catch { /* retry */ }
    await sleep(400);
  }
  throw new Error('vite not ready');
}

function startChrome() {
  killPort(PORT);
  chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-proxy-server',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${USER_DIR}`,
    '--window-size=1600,1000',
    'about:blank',
  ], { stdio: 'ignore' });
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

async function clickAt(x, y, opts = {}) {
  const { clicks = 1 } = opts;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  for (let i = 0; i < clicks; i++) {
    const cc = clicks > 1 ? i + 1 : 1;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: cc });
    await sleep(60);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: cc });
    await sleep(140);
  }
}

async function keyPress(key, mods = {}) {
  const { ctrl = false, shift = false, meta = false } = mods;
  const single = key.length === 1;
  const code = single ? `Key${key.toUpperCase()}` : key;
  const vk = single ? key.toUpperCase().charCodeAt(0) : 0;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, ctrlKey: ctrl, shiftKey: shift, metaKey: meta, text: single ? key : '' });
  await sleep(60);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, ctrlKey: ctrl, shiftKey: shift, metaKey: meta });
  await sleep(150);
}

async function centerOf(selector) {
  return evalJS(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
}

async function clickEl(selector, opts = {}) {
  const { shiftKey = false } = opts;
  return evalJS(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'missing';
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const o = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, shiftKey: ${shiftKey} };
    el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.dispatchEvent(new MouseEvent('click', o));
    return { ok: true };
  })()`);
}

async function openBuilder() {
  await navigate(URL);
  await evalJS(`(async () => {
    const r = await fetch('/__verify-protocol.json');
    const list = await r.json();
    localStorage.setItem('physioflow.protocols.v1', JSON.stringify(list));
    return 'injected';
  })()`);
  await navigate(URL);
  await sleep(600);
  const editBtn = await evalJS(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Edit draft'));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!editBtn) return { ok: false, reason: 'no Edit draft' };
  await clickAt(editBtn.x, editBtn.y);
  await sleep(1500);
  const node = await evalJS(`(() => {
    const n = [...document.querySelectorAll('article.composer-node')].find(x => x.textContent.includes('display.screen'));
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!node) return { ok: false, reason: 'no screen node' };
  await clickAt(node.x, node.y, { clicks: 2 });
  await sleep(1200);
  const open = await evalJS(`(() => !!document.querySelector('.node-editor-fullscreen'))()`);
  return open ? { ok: true } : { ok: false, reason: 'builder not open' };
}

function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failures++;
}

async function verifyZOrder() {
  const b = await openBuilder();
  if (!b.ok) { check('builder-open', false, b.reason); return; }
  const zOrder = () => evalJS(`(() => [...document.querySelectorAll('.ui-canvas-pan [data-ui-id^="ui_z"]')].map(e => e.dataset.uiId))()`);
  const clickMenu = label => evalJS(`(() => {
    const b = [...document.querySelectorAll('.ui-context-menu button')].find(x => x.textContent.includes(${JSON.stringify(label)}));
    if (!b) return 'missing';
    b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return 'clicked';
  })()`);
  const openMenu = id => evalJS(`(() => {
    const el = document.querySelector('[data-ui-id="${id}"]');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
    return !!document.querySelector('.ui-context-menu');
  })()`);
  const key = (k, mods) => evalJS(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, ctrlKey: ${!!mods.ctrl}, bubbles: true })); return 'key'; })()`);
  const indexOf = id => evalJS(`(() => [...document.querySelectorAll('.ui-canvas-pan [data-ui-id]')].findIndex(e => e.dataset.uiId === '${id}'))()`);

  let order = await zOrder();
  check('zorder-initial', JSON.stringify(order) === JSON.stringify(['ui_z1', 'ui_z2', 'ui_z3']), `order=${order.join(',')}`);

  // Right-click ui_z3 -> Send to back
  await clickEl('[data-ui-id="ui_z3"]');
  await sleep(300);
  const menuShown = await openMenu('ui_z3');
  await sleep(300);
  const sent = await clickMenu('Send to back');
  await sleep(600);
  order = await zOrder();
  check('zorder-send-to-back', JSON.stringify(order) === JSON.stringify(['ui_z3', 'ui_z1', 'ui_z2']), `menu=${menuShown}/${sent} order=${order.join(',')}`);

  // ui_z1 -> Bring to front
  await clickEl('[data-ui-id="ui_z1"]');
  await sleep(300);
  await openMenu('ui_z1');
  await sleep(300);
  await clickMenu('Bring to front');
  await sleep(600);
  order = await zOrder();
  check('zorder-bring-to-front', JSON.stringify(order) === JSON.stringify(['ui_z3', 'ui_z2', 'ui_z1']), `order=${order.join(',')}`);

  // ui_z2 + Ctrl+[  => move backward one layer (index decreases)
  await clickEl('[data-ui-id="ui_z2"]');
  await sleep(300);
  const idxBeforeBackward = await indexOf('ui_z2');
  await key('[', { ctrl: true });
  await sleep(600);
  const idxAfterBackward = await indexOf('ui_z2');
  check('zorder-ctrl-bracket-backward', idxAfterBackward < idxBeforeBackward && idxAfterBackward >= 0, `z2 index ${idxBeforeBackward} -> ${idxAfterBackward}`);

  // Ctrl+] => move forward one layer (index increases)
  await key(']', { ctrl: true });
  await sleep(600);
  const idxAfterForward = await indexOf('ui_z2');
  check('zorder-ctrl-bracket-forward', idxAfterForward > idxAfterBackward, `z2 index ${idxAfterBackward} -> ${idxAfterForward}`);
}

async function verifyAltDrag() {
  const b = await openBuilder();
  if (!b.ok) { check('builder-open', false, b.reason); return; }
  const t1 = await evalJS(`(() => {
    const el = document.querySelector('[data-ui-id="ui_t1"]');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: parseFloat(el.style.left), top: parseFloat(el.style.top), count: document.querySelectorAll('[data-ui-id]').length };
  })()`);
  await evalJS(`(() => {
    const el = document.querySelector('[data-ui-id="ui_t1"]');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, altKey: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
    return 'down';
  })()`);
  await sleep(200);
  await evalJS(`(() => { window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: ${t1.x + 70}, clientY: ${t1.y + 50} })); return 'move'; })()`);
  await sleep(300);
  await evalJS(`(() => { window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: ${t1.x + 70}, clientY: ${t1.y + 50} })); return 'up'; })()`);
  await sleep(900);
  const result = await evalJS(`(() => {
    const selected = [...document.querySelectorAll('[data-ui-id].selected')].map(e => ({ id: e.dataset.uiId, cls: e.className, text: e.textContent.trim().slice(0, 30) }));
    const isAlphaEl = e => e.classList.contains('ui-slot') && !e.classList.contains('participant-ui-screen') && e.textContent.includes('Alpha');
    const alphas = [...document.querySelectorAll('[data-ui-id]')].filter(isAlphaEl);
    return {
      count: document.querySelectorAll('[data-ui-id]').length,
      alphaCount: alphas.length,
      positions: alphas.map(e => ({ id: e.dataset.uiId, left: parseFloat(e.style.left), top: parseFloat(e.style.top) })),
      selected,
    };
  })()`);
  check('alt-drag-duplicates', result.count === t1.count + 1, `count ${t1.count}->${result.count}`);
  check('alt-drag-moves-copy', result.alphaCount === 2 && result.positions.some(p => p.id !== 'ui_t1' && (p.left !== 40 || p.top !== 40)), `positions=${JSON.stringify(result.positions)} selected=${JSON.stringify(result.selected)}`);
}

async function verifyNudge() {
  const b = await openBuilder();
  if (!b.ok) { check('builder-open', false, b.reason); return; }
  await clickEl('[data-ui-id="ui_t1"]');
  await sleep(300);
  const pos = () => evalJS(`(() => {
    const el = document.querySelector('[data-ui-id="ui_t1"]');
    return { left: parseFloat(el.style.left), top: parseFloat(el.style.top) };
  })()`);
  const p0 = await pos();
  const key = (k, mods) => evalJS(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, ctrlKey: ${!!mods.ctrl}, shiftKey: ${!!mods.shift}, bubbles: true })); return 'key'; })()`);
  await key('ArrowRight', { ctrl: true, shift: true });
  await sleep(600);
  const p1 = await pos();
  check('ctrl-shift-arrow-1px', p1.left === p0.left + 1, `left ${p0.left}->${p1.left}`);
  await key('ArrowRight', { shift: true });
  await sleep(600);
  const p2 = await pos();
  check('shift-arrow-10px', p2.left === p1.left + 10, `left ${p1.left}->${p2.left}`);
  await key('ArrowRight', {});
  await sleep(600);
  const p3 = await pos();
  check('plain-arrow-1px', p3.left === p2.left + 1, `left ${p2.left}->${p3.left}`);
}

async function verifyShapes() {
  const b = await openBuilder();
  if (!b.ok) { check('builder-open', false, b.reason); return; }
  const probe = () => evalJS(`(() => {
    const info = id => {
      const el = document.querySelector('[data-ui-id="' + id + '"]');
      if (!el) return null;
      const s = getComputedStyle(el);
      return { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height), left: parseFloat(el.style.left), top: parseFloat(el.style.top), radius: s.borderRadius, cls: el.className };
    };
    return { d: info('ui_d1'), r: info('ui_r1'), e: info('ui_e1') };
  })()`);
  const p0 = await probe();
  check('shapes-render', !!(p0.d && p0.r && p0.e), `d=${JSON.stringify(p0.d)} r=${JSON.stringify(p0.r)} e=${JSON.stringify(p0.e)}`);
  check('divider-horizontal-thin', p0.d && p0.d.h <= 2, `divider h=${p0.d && p0.d.h}`);
  check('rectangle-straight', p0.r && p0.r.radius !== '50%', `rect radius=${p0.r && p0.r.radius}`);
  check('ellipse-round', p0.e && p0.e.radius === '50%', `ellipse radius=${p0.e && p0.e.radius}`);

  // Select the rectangle, then drag it by (60, 40).
  await clickEl('[data-ui-id="ui_r1"]');
  await sleep(350);
  const r0 = await evalJS(`(() => {
    const el = document.querySelector('[data-ui-id="ui_r1"]');
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, left: parseFloat(el.style.left), top: parseFloat(el.style.top) };
  })()`);
  await evalJS(`(() => {
    const el = document.querySelector('[data-ui-id="ui_r1"]');
    const b = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 }));
    return 'down';
  })()`);
  await sleep(250);
  await evalJS(`(() => { window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: ${r0.x + 60}, clientY: ${r0.y + 40} })); return 'move'; })()`);
  await sleep(300);
  await evalJS(`(() => { window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: ${r0.x + 60}, clientY: ${r0.y + 40} })); return 'up'; })()`);
  await sleep(900);
  const r1 = await evalJS(`(() => {
    const el = document.querySelector('[data-ui-id="ui_r1"]');
    return { left: parseFloat(el.style.left), top: parseFloat(el.style.top) };
  })()`);
  check('shape-drag-move', r1.left !== r0.left || r1.top !== r0.top, `left ${r0.left}->${r1.left}, top ${r0.top}->${r1.top}`);

  // Resize the ellipse with its handle (drag bottom-right corner outward).
  await clickEl('[data-ui-id="ui_e1"]');
  await sleep(350);
  const e0 = await evalJS(`(() => {
    const el = document.querySelector('[data-ui-id="ui_e1"]');
    const h = el.querySelector('.ui-resize-handle');
    const hb = h.getBoundingClientRect();
    const eb = el.getBoundingClientRect();
    return { hx: hb.x + hb.width / 2, hy: hb.y + hb.height / 2, w: eb.width, h: eb.height };
  })()`);
  const resizeProbe = await evalJS(`(() => {
    const h = document.querySelector('[data-ui-id="ui_e1"] .ui-resize-handle');
    if (!h) return 'no-handle';
    const b = h.getBoundingClientRect();
    h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 }));
    return 'down';
  })()`);
  await sleep(250);
  await evalJS(`(() => { window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: ${e0.hx + 50}, clientY: ${e0.hy + 30} })); return 'move'; })()`);
  await sleep(300);
  await evalJS(`(() => { window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: ${e0.hx + 50}, clientY: ${e0.hy + 30} })); return 'up'; })()`);
  await sleep(900);
  const e1 = await evalJS(`(() => {
    const el = document.querySelector('[data-ui-id="ui_e1"]');
    const b = el.getBoundingClientRect();
    return { w: b.width, h: b.height };
  })()`);
  check('shape-resize', resizeProbe === 'down' && (e1.w > e0.w || e1.h > e0.h), `handle=${resizeProbe} size ${Math.round(e0.w)}x${Math.round(e0.h)} -> ${Math.round(e1.w)}x${Math.round(e1.h)}`);

  // Add a new Rectangle from the library: element count grows and a 2nd rect appears.
  const before = await evalJS(`(() => document.querySelectorAll('[data-ui-id]').length)()`);
  const added = await evalJS(`(() => {
    const blocks = [...document.querySelectorAll('.ui-library-block')];
    const target = blocks.find(x => x.textContent.includes('Rectangle'));
    if (!target) return 'missing';
    const b = target.getBoundingClientRect();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    for (const type of ['mousedown', 'mouseup', 'click']) target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    return 'clicked';
  })()`);
  await sleep(900);
  const after = await evalJS(`(() => ({
    count: document.querySelectorAll('[data-ui-id]').length,
    rects: document.querySelectorAll('.participant-ui-shape.rectangle').length,
  }))()`);
  check('library-add-rectangle', added === 'clicked' && after.count === before + 1 && after.rects >= 2, `add=${added} count ${before}->${after.count} rects=${after.rects}`);
}

async function verifyCopyPaste() {
  const b = await openBuilder();
  if (!b.ok) { check('builder-open', false, b.reason); return; }
  const count = () => evalJS(`(() => document.querySelectorAll('[data-ui-id]').length)()`);
  const before = await count();
  const introCount = () => evalJS(`(() => [...document.querySelectorAll('.participant-ui-screen p, .participant-ui-screen h1')].filter(el => (el.textContent || '').includes('Alpha')).length)()`);

  await clickEl('[data-ui-id="ui_t1"]');
  await sleep(350);

  const copied = await evalJS(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true })); return 'copied'; })()`);
  await sleep(250);
  const pasted1 = await evalJS(`(() => { try { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true })); return 'pasted'; } catch (e) { return 'THREW:' + String(e && e.stack || e); } })()`);
  await sleep(900);
  const after1 = await count();
  const texts1 = await introCount();
  check('copy-paste-adds-element', copied === 'copied' && pasted1 === 'pasted' && after1 === before + 1 && texts1 >= 2, `count ${before}->${after1}, intro-texts=${texts1}`);

  // Paste again — offset moves it away from the original.
  await evalJS(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true })); return 'pasted'; })()`);
  await sleep(900);
  const after2 = await count();
  const texts2 = await introCount();
  const offsets = await evalJS(`(() => {
    const els = [...document.querySelectorAll('.ui-canvas-device [data-ui-id]')].filter(el => !el.classList.contains('participant-ui-screen') && (el.textContent || '').includes('Alpha'));
    return els.map(el => { const r = el.getBoundingClientRect(); return { id: el.getAttribute('data-ui-id'), x: Math.round(r.x), y: Math.round(r.y), text: el.textContent.slice(0, 12) }; });
  })()`);
  const distinct = offsets.length >= 2 && offsets.some((a, i) => i > 0 && (a.x !== offsets[0].x || a.y !== offsets[0].y));
  check('paste-again-and-offset', after2 === before + 2 && texts2 >= 3 && distinct, `count ${after1}->${after2}, texts=${texts2}, offsets=${JSON.stringify(offsets)}`);

  // Undo should remove the last paste.
  await evalJS(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); return 'undo'; })()`);
  await sleep(900);
  const afterUndo = await count();
  check('undo-removes-paste', afterUndo === after2 - 1, `count ${after2}->${afterUndo}`);

  // Redo (Ctrl+Y) should restore the undone paste.
  await evalJS(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true })); return 'redo'; })()`);
  await sleep(900);
  const afterRedo = await count();
  check('redo-restores-paste', afterRedo === after2, `count ${afterUndo}->${afterRedo}`);

  // Ctrl+D duplicates the current selection and selects the copy.
  await evalJS(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true })); return 'dup'; })()`);
  await sleep(900);
  const afterDup = await count();
  const dupSelected = await evalJS(`(() => { const s = document.querySelector('[data-ui-id].selected'); return s ? s.getAttribute('data-ui-id') : null; })()`);
  check('ctrl-d-duplicates', afterDup === after2 + 1 && !!dupSelected && dupSelected !== 'ui_t1', `count ${after2}->${afterDup}, selected=${dupSelected}`);

  // Delete removes the selected duplicate.
  await evalJS(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); return 'del'; })()`);
  await sleep(900);
  const afterDel = await count();
  check('delete-removes-selected', afterDel === after2, `count ${afterDup}->${afterDel}`);
}

async function verifyUndoRedo() {
  const b = await openBuilder();
  if (!b.ok) { check('builder-open', false, b.reason); return; }
  const count = () => evalJS(`(() => document.querySelectorAll('[data-ui-id]').length)()`);
  const key = (k, mods = {}) => evalJS(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, ctrlKey: ${!!mods.ctrl}, shiftKey: ${!!mods.shift}, bubbles: true })); return 'key'; })()`);
  const posOf = id => evalJS(`(() => { const el = document.querySelector('[data-ui-id="${id}"]'); return el ? parseFloat(el.style.left) : null; })()`);
  const textOf = id => evalJS(`(() => { const el = document.querySelector('[data-ui-id="${id}"]'); return el ? (el.textContent || '').trim().slice(0, 24) : null; })()`);
  const addFromLibrary = name => evalJS(`(() => {
    const blocks = [...document.querySelectorAll('.ui-library-block')];
    const target = blocks.find(x => x.querySelector('.ui-library-name') && x.querySelector('.ui-library-name').textContent.trim() === '${name}');
    if (!target) return 'missing';
    const r = target.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    for (const t of ['mousedown', 'mouseup', 'click']) target.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    return 'clicked';
  })()`);
  const btnState = () => evalJS(`(() => {
    const btns = [...document.querySelectorAll('.ui-history-btn')];
    const f = t => { const x = btns.find(x => (x.title || '').toLowerCase().includes(t)); return x ? x.disabled : null; };
    return { undo: f('undo'), redo: f('redo') };
  })()`);

  const before = await count();

  // 1) Fresh history: both undo and redo buttons are disabled.
  const s0 = await btnState();
  check('history-btns-initial-disabled', s0.undo === true && s0.redo === true, JSON.stringify(s0));

  // 2) Add element -> Ctrl+Z removes it -> Ctrl+Shift+Z restores it.
  const a0 = await addFromLibrary('Text');
  await sleep(900);
  const cAdd = await count();
  const s1 = await btnState();
  check('undo-add-element', a0 === 'clicked' && cAdd === before + 1 && s1.undo === false, `add=${a0} count ${before}->${cAdd} btns=${JSON.stringify(s1)}`);
  await key('z', { ctrl: true });
  await sleep(700);
  const cUAdd = await count();
  check('ctrl-z-undo-add', cUAdd === before, `count ${cAdd}->${cUAdd}`);
  await key('Z', { ctrl: true, shift: true });
  await sleep(700);
  const cRAdd = await count();
  check('ctrl-shift-z-redo-add', cRAdd === before + 1, `count ${cUAdd}->${cRAdd}`);

  // 3) Delete element -> Ctrl+Z restores it (original text intact) -> Ctrl+Shift+Z re-deletes it.
  await clickEl('[data-ui-id="ui_t1"]');
  await sleep(350);
  await key('Delete', {});
  await sleep(700);
  const cDel = await count();
  check('delete-element', cDel === before && (await posOf('ui_t1')) === null, `count ${cRAdd}->${cDel}`);
  await key('z', { ctrl: true });
  await sleep(700);
  const cUDel = await count();
  const t1 = await textOf('ui_t1');
  check('ctrl-z-restores-deleted', cUDel === before + 1 && t1 === 'Alpha', `count ${cDel}->${cUDel} text=${t1}`);
  await key('Z', { ctrl: true, shift: true });
  await sleep(700);
  const cRDel = await count();
  check('ctrl-shift-z-re-deletes', cRDel === before, `count ${cUDel}->${cRDel}`);

  // 4) Move (nudge) -> Ctrl+Z restores position -> Ctrl+Shift+Z re-applies the move.
  await clickEl('[data-ui-id="ui_t2"]');
  await sleep(350);
  const l0 = await posOf('ui_t2');
  await key('ArrowRight', {});
  await sleep(600);
  const l1 = await posOf('ui_t2');
  check('nudge-element', l1 === l0 + 1, `left ${l0}->${l1}`);
  await key('z', { ctrl: true });
  await sleep(700);
  const l2 = await posOf('ui_t2');
  check('ctrl-z-restores-position', l2 === l0, `left ${l1}->${l2}`);
  await key('Z', { ctrl: true, shift: true });
  await sleep(700);
  const l3 = await posOf('ui_t2');
  check('ctrl-shift-z-re-applies-move', l3 === l0 + 1, `left ${l2}->${l3}`);

  // 5) Multi-step undo walks back one at a time; a new operation clears the redo branch.
  await addFromLibrary('Text');
  await sleep(800);
  await addFromLibrary('Text');
  await sleep(800);
  const cBase = await count();
  await key('z', { ctrl: true });
  await sleep(700);
  const c1 = await count();
  check('multi-undo-step1', c1 === cBase - 1, `count ${cBase}->${c1}`);
  await key('z', { ctrl: true });
  await sleep(700);
  const c2 = await count();
  check('multi-undo-step2', c2 === cBase - 2, `count ${c1}->${c2}`);
  await key('Z', { ctrl: true, shift: true });
  await sleep(700);
  const c3 = await count();
  check('multi-redo-step1', c3 === cBase - 1, `count ${c2}->${c3}`);
  await addFromLibrary('Text');
  await sleep(800);
  const cNew = await count();
  await key('Z', { ctrl: true, shift: true });
  await sleep(700);
  const cNoRedo = await count();
  check('new-op-clears-redo-branch', cNew === cBase && cNoRedo === cBase, `after-new=${cNew}, redo-attempt=${cNoRedo}`);
}

async function verifyTreeReorder() {
  const b = await openBuilder();
  if (!b.ok) { check('builder-open', false, b.reason); return; }

  // Open the Structure (component tree) panel.
  await evalJS(`(() => {
    const btn = [...document.querySelectorAll('.ui-builder-toolbar button')].find(x => (x.textContent || '').trim() === 'Structure');
    if (!btn) return 'missing';
    btn.click();
    return 'clicked';
  })()`);
  await sleep(600);
  const hasTree = await evalJS(`(() => !!document.querySelector('.ui-tree'))()`);
  check('structure-panel-opens', hasTree === true, 'tree visible');

  const order = () => evalJS(`(() => [...document.querySelectorAll('.ui-tree .ui-row')].map(r => r.getAttribute('data-ui-id')))()`);
  const depthOf = id => evalJS(`(() => {
    const r = document.querySelector('.ui-tree [data-ui-id="${id}"]');
    const btn = r && r.querySelector('.ui-tree-node');
    return btn ? Math.round((parseFloat(btn.style.paddingLeft) - 8) / 20) : null;
  })()`);
  const dndOver = (fromId, toId, frac) => evalJS(`(() => {
    window.__dt = new DataTransfer();
    const from = document.querySelector('.ui-tree [data-ui-id="${fromId}"]');
    const to = document.querySelector('.ui-tree [data-ui-id="${toId}"]');
    if (!from || !to) return 'missing';
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__dt }));
    const r = to.getBoundingClientRect();
    const y = r.top + r.height * ${frac};
    to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__dt, clientX: r.left + r.width / 2, clientY: y }));
    return 'over';
  })()`);
  const dndDrop = (toId, frac) => evalJS(`(() => {
    const to = document.querySelector('.ui-tree [data-ui-id="${toId}"]');
    if (!to) return 'missing';
    const r = to.getBoundingClientRect();
    const y = r.top + r.height * ${frac};
    to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dt, clientX: r.left + r.width / 2, clientY: y }));
    window.__dt = null;
    return 'drop';
  })()`);
  const dnd = async (fromId, toId, frac) => { await dndOver(fromId, toId, frac); await sleep(500); await dndDrop(toId, frac); };

  const initial = await order();
  if (!initial.includes('ui_t1') || !initial.includes('ui_t2') || !initial.includes('ui_layout_row')) {
    check('tree-has-targets', false, `rows=${initial.join(',')}`);
    return;
  }

  // 1) Reorder a leaf between two siblings (after / before depending on current order).
  const idx1 = initial.indexOf('ui_t1');
  const idx2 = initial.indexOf('ui_t2');
  if (idx1 < idx2) {
    await dnd('ui_t1', 'ui_t2', 0.8);
    await sleep(700);
    const after = await order();
    check('tree-reorder-sibling', after.indexOf('ui_t1') > after.indexOf('ui_t2') && after.join(',') !== initial.join(','), `${initial.join(',')} -> ${after.join(',')}`);
  } else {
    await dnd('ui_t2', 'ui_t1', 0.2);
    await sleep(700);
    const after = await order();
    check('tree-reorder-sibling', after.indexOf('ui_t2') < after.indexOf('ui_t1') && after.join(',') !== initial.join(','), `${initial.join(',')} -> ${after.join(',')}`);
  }

  // 2) Nest a leaf inside a container row (middle band of the row).
  const d0 = await depthOf('ui_t3');
  await dnd('ui_t3', 'ui_layout_row', 0.5);
  await sleep(700);
  const d1 = await depthOf('ui_t3');
  const dLayout = await depthOf('ui_layout_row');
  check('tree-nest-inside-container', d1 === dLayout + 1 && d1 === d0 + 1, `ui_t3 depth ${d0}->${d1} (layout=${dLayout})`);

  // 3) Undo restores the original parent and depth.
  await evalJS(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); return 'undo'; })()`);
  await sleep(700);
  const d2 = await depthOf('ui_t3');
  check('tree-undo-nest', d2 === d0, `ui_t3 depth ${d1}->${d2}`);

  // 4) Drop on the root row appends the element at the end of the top level.
  const rows = await order();
  const rootId = rows[0];
  const before = rows.indexOf('ui_z1');
  await dnd('ui_z1', rootId, 0.5);
  await sleep(700);
  const afterOrder = await order();
  const dz = await depthOf('ui_z1');
  check('tree-drop-root-appends', afterOrder[afterOrder.length - 1] === 'ui_z1' && dz === 1 && before !== afterOrder.length - 1, `ui_z1 index ${before}->${afterOrder.length - 1} depth=${dz}`);
}

async function openComposer() {
  await navigate(URL);
  await evalJS(`(async () => {
    const r = await fetch('/__verify-protocol.json');
    const list = await r.json();
    localStorage.setItem('physioflow.protocols.v1', JSON.stringify(list));
    return 'injected';
  })()`);
  await navigate(URL);
  await sleep(600);
  const editBtn = await evalJS(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Edit draft'));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!editBtn) return { ok: false, reason: 'no Edit draft' };
  await clickAt(editBtn.x, editBtn.y);
  await sleep(1500);
  const count = await evalJS(`(() => document.querySelectorAll('article.composer-node').length)()`);
  return count ? { ok: true } : { ok: false, reason: 'composer not open' };
}

async function verifyComposerStep8() {
  const b = await openComposer();
  if (!b.ok) { check('composer-open', false, b.reason); return; }
  const key = (k, mods = {}) => evalJS(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, ctrlKey: ${!!mods.ctrl}, shiftKey: ${!!mods.shift}, bubbles: true })); return 'key'; })()`);
  const nodeCount = () => evalJS(`(() => document.querySelectorAll('article.composer-node').length)()`);
  const edgeCount = () => evalJS(`(() => document.querySelectorAll('.composer-wires path').length)()`);
  const nodeByType = type => evalJS(`(() => {
    const el = [...document.querySelectorAll('article.composer-node')].find(x => (x.textContent || '').includes(${JSON.stringify(type)}));
    return el ? { left: parseFloat(el.style.left), top: parseFloat(el.style.top) } : null;
  })()`);
  const clickNode = (type, opts = {}) => evalJS(`(() => {
    const el = [...document.querySelectorAll('article.composer-node')].find(x => (x.textContent || '').includes(${JSON.stringify(type)}));
    if (!el) return 'missing';
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const o = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, shiftKey: ${!!opts.shift} };
    el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.dispatchEvent(new MouseEvent('click', o));
    return 'clicked';
  })()`);

  const n0 = await nodeCount();
  const e0 = await edgeCount();
  check('step8-initial', n0 === 3 && e0 === 2, `nodes=${n0} edges=${e0}`);

  // 1) Smart guides appear while dragging a node toward a neighbour's edge,
  //    the node snaps to the exact aligned position, and the guide clears on release.
  const drag = await evalJS(`(() => {
    const start = [...document.querySelectorAll('article.composer-node')].find(x => (x.textContent || '').includes('core.start'));
    const end = [...document.querySelectorAll('article.composer-node')].find(x => (x.textContent || '').includes('core.end'));
    if (!start || !end) return { ok: false };
    const sr = start.getBoundingClientRect(), er = end.getBoundingClientRect();
    const sx = sr.x + sr.width / 2, sy = sr.y + sr.height / 2;
    const targetX = sx + (er.x - sr.x - 188);
    start.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: sx, clientY: sy }));
    return { ok: true, sx, sy, targetX };
  })()`);
  await sleep(300);
  await evalJS(`(() => {
    const start = [...document.querySelectorAll('article.composer-node')].find(x => (x.textContent || '').includes('core.start'));
    const { sx, sy, targetX } = ${JSON.stringify(drag)};
    start.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: sx + (targetX - sx) * 0.5, clientY: sy }));
    start.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: targetX, clientY: sy }));
    return 'moved';
  })()`);
  await sleep(500);
  const g1 = await evalJS(`(() => {
    const start = [...document.querySelectorAll('article.composer-node')].find(x => (x.textContent || '').includes('core.start'));
    const r = start.getBoundingClientRect();
    return {
      guides: document.querySelectorAll('.composer-guide').length,
      v: !!document.querySelector('.composer-guide.guide-v'),
      start: start.style.left,
      rectX: Math.round(r.x),
    };
  })()`);
  check('guide-visible-on-drag', drag.ok && g1.v && g1.guides > 0, `guides=${g1.guides} start.left=${g1.start} rectX=${g1.rectX}`);
  check('guide-snaps-to-edge', g1.start === '372px', `start.left=${g1.start} (expect 372px)`);
  await evalJS(`(() => {
    const start = [...document.querySelectorAll('article.composer-node')].find(x => (x.textContent || '').includes('core.start'));
    start.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
    return 'up';
  })()`);
  await sleep(400);
  const gAfter = await evalJS(`(() => document.querySelectorAll('.composer-guide').length)()`);
  check('guide-cleared-on-release', gAfter === 0, `guides=${gAfter}`);

  // 2) Arrow keys nudge by 24px; Shift+Arrow by 8px.
  await clickNode('core.start');
  await sleep(350);
  const p0 = await nodeByType('core.start');
  await key('ArrowRight', {});
  await sleep(500);
  const p1 = await nodeByType('core.start');
  check('arrow-nudge-24', p1.left === p0.left + 24, `left ${p0.left}->${p1.left}`);
  await key('ArrowRight', { shift: true });
  await sleep(500);
  const p2 = await nodeByType('core.start');
  check('shift-arrow-nudge-8', p2.left === p1.left + 8, `left ${p1.left}->${p2.left}`);

  // 3) Escape clears the selection.
  const selBefore = await evalJS(`(() => document.querySelectorAll('article.composer-node.selected').length)()`);
  await key('Escape', {});
  await sleep(350);
  const selAfter = await evalJS(`(() => document.querySelectorAll('article.composer-node.selected').length)()`);
  check('escape-clears-selection', selBefore > 0 && selAfter === 0, `selected ${selBefore}->${selAfter}`);

  // 4) Enter opens the node editor for a node with a UI.
  await clickNode('display.screen');
  await sleep(350);
  await key('Enter', {});
  await sleep(1500);
  const editorOpen = await evalJS(`(() => !!document.querySelector('.node-editor-fullscreen'))()`);
  check('enter-opens-node-editor', editorOpen === true, 'fullscreen editor visible');
  await evalJS(`(() => { const b = document.querySelector('.node-editor-close'); if (b) b.click(); return 'done'; })()`);
  await sleep(700);

  // 5) Copy/paste carries internal edges; undo removes the whole paste.
  await key('Escape', {});
  await sleep(300);
  await clickNode('core.start', { shift: true });
  await sleep(300);
  await clickNode('display.screen', { shift: true });
  await sleep(300);
  const multi = await evalJS(`(() => document.querySelectorAll('article.composer-node.selected').length)()`);
  const c0 = await nodeCount();
  await key('c', { ctrl: true });
  await sleep(300);
  await key('v', { ctrl: true });
  await sleep(1000);
  const c1 = await nodeCount();
  const e1 = await edgeCount();
  check('paste-keeps-internal-edges', multi === 2 && c1 === c0 + 2 && e1 === e0 + 1, `multi=${multi} nodes ${c0}->${c1} edges=${e0}->${e1}`);
  await key('z', { ctrl: true });
  await sleep(800);
  const c2 = await nodeCount();
  check('undo-removes-paste', c2 === c0, `nodes ${c1}->${c2}`);
}

async function buildP2Protocol() {
  const { pathToFileURL } = require('url');
  const { createProtocolGraph } = await import(pathToFileURL(path.join(process.cwd(), 'src/core/protocolGraph.js')).href);
  const { addNode, connect } = await import(pathToFileURL(path.join(process.cwd(), 'src/core/graphCommands.js')).href);
  const { createCoreComponentRegistry } = await import(pathToFileURL(path.join(process.cwd(), 'src/core/componentRegistry.js')).href);
  const registry = createCoreComponentRegistry();
  const mediaDefaults = registry.get('display.media').defaultConfig;
  const ratingDefaults = registry.get('input.rating').defaultConfig;
  const condDefaults = registry.get('logic.condition').defaultConfig;
  const now = '2026-08-25T00:00:00.000Z';
  let p = createProtocolGraph({ name: 'P2 Verify', now });
  const id = { start: p.graph.entryNodeId };
  let   r = addNode(p, 'display.media', { id: 'm1', label: 'Media', config: { ...mediaDefaults, mediaType: 'image', sourceUrl: 'not-a-url', completion: { mode: 'fixed', durationMs: 2000 } }, layout: { x: 200, y: 140 }, now });
  p = r.protocol; id.media = r.node.id;
  r = addNode(p, 'input.rating', { id: 'r1', label: 'Rating', config: { ...ratingDefaults, min: 1, max: 7, required: true }, layout: { x: 440, y: 140 }, now });
  p = r.protocol; id.rating = r.node.id;
  r = addNode(p, 'logic.condition', { id: 'c1', label: 'Cond', config: { ...condDefaults, operator: 'gte', expected: 3 }, layout: { x: 680, y: 140 }, now });
  p = r.protocol; id.cond = r.node.id;
  r = addNode(p, 'core.end', { label: 'End', layout: { x: 920, y: 140 }, now });
  p = r.protocol; id.end = r.node.id;
  p.variables = [{ name: 'score', type: 'number', scope: 'participant', createdAt: now, updatedAt: now }];
  const link = (from, portId, to) => { const out = connect(p, 'control', { nodeId: from, portId }, { nodeId: to, portId: 'in' }); p = out.protocol; };
  link(id.start, 'next', id.media);
  link(id.media, 'next', id.rating);
  link(id.rating, 'next', id.cond);
  const de = connect(p, 'data', { nodeId: id.rating, portId: 'value' }, { nodeId: id.cond, portId: 'value' });
  p = de.protocol;
  return p;
}

async function openComposerWithP2() {
  const p2 = await buildP2Protocol();
  await navigate(URL);
  await evalJS(`(async () => {
    const p2 = ${JSON.stringify(p2)};
    localStorage.setItem('physioflow.protocols.v1', JSON.stringify([p2]));
    return 'injected';
  })()`);
  await navigate(URL);
  await sleep(600);
  const editBtn = await evalJS(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Edit draft'));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!editBtn) return { ok: false, reason: 'no Edit draft' };
  await clickAt(editBtn.x, editBtn.y);
  await sleep(1500);
  const count = await evalJS(`(() => document.querySelectorAll('article.composer-node').length)()`);
  return count ? { ok: true } : { ok: false, reason: 'composer not open' };
}

async function verifyComposerP2() {
  const b = await openComposerWithP2();
  if (!b.ok) { check('p2-composer-open', false, b.reason); return; }
  const clickNode = async type => {
    const rect = await evalJS(`(() => {
      const el = [...document.querySelectorAll('article.composer-node')].find(x => (x.textContent || '').includes(${JSON.stringify(type)}));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (!rect) return 'missing';
    await clickAt(rect.x, rect.y);
    return 'clicked';
  };

  // 1) Rating node shows its data output badge (data-flow visibility).
  const badge = await evalJS(`(() => {
    const el = [...document.querySelectorAll('article.composer-node')].find(x => (x.textContent || '').includes('input.rating'));
    if (!el) return 'missing';
    const badge = el.querySelector('.node-data-fields');
    return badge ? badge.textContent : null;
  })()`);
  check('p2-data-badge', badge === '2 outputs', `badge=${badge}`);

  // 2) Condition inspector offers a Node outputs (upstream) group.
  await clickNode('logic.condition');
  await sleep(600);
  const cond = await evalJS(`(() => {
    const inspector = document.querySelector('.composer-inspector');
    const summary = inspector ? inspector.textContent.slice(0, 220).replace(/\\s+/g, ' ') : 'no-inspector';
    const sel = [...(inspector ? inspector.querySelectorAll('select') : [])].find(s => s.getAttribute('aria-label') === 'Condition input variable');
    if (!sel) return { summary, state: 'no-select' };
    const groups = [...sel.querySelectorAll('optgroup')].map(g => g.label);
    const opts = [...sel.querySelectorAll('option')].map(o => o.value);
    return { summary, groups, opts, state: 'ok' };
  })()`);
  const hasOutput = cond.state === 'ok' && (cond.opts || []).some(o => /^output:.+:value$/.test(o));
  const hasVar = cond.state === 'ok' && (cond.opts || []).some(o => o.startsWith('variable:'));
  check('p2-node-outputs-group', cond.state === 'ok' && cond.groups.includes('Node outputs (upstream)') && hasOutput && hasVar, `summary=${cond.summary} groups=${cond.state === 'ok' ? cond.groups.join('|') : '-'} opts=${cond.state === 'ok' ? cond.opts.join('|') : '-'}`);

  // 3) Binding a node output turns Expected into a number input.
  const bound = await evalJS(`(() => {
    const sel = [...document.querySelectorAll('.composer-inspector select')].find(s => s.getAttribute('aria-label') === 'Condition input variable');
    if (!sel) return 'no-select';
    const outputOption = [...sel.querySelectorAll('option')].find(o => o.value.startsWith('output:'));
    if (!outputOption) return 'no-output-option';
    sel.value = outputOption.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return outputOption.value;
  })()`);
  await sleep(600);
  const expected = await evalJS(`(() => {
    const label = [...document.querySelectorAll('.composer-inspector label')].find(x => (x.textContent || '').includes('Expected'));
    if (!label) return null;
    const input = label.querySelector('input');
    return input ? { type: input.type, value: input.value } : null;
  })()`);
  check('p2-expected-follows-output-type', bound !== 'no-output-option' && expected && expected.type === 'number', `bound=${bound} expected=${JSON.stringify(expected)}`);

  // 4) The invalid media URL surfaces as a validation issue (localized in zh).
  const validation = await evalJS(`(() => {
    const btn = [...document.querySelectorAll('.composer-validation button')].find(x => (x.textContent || '').includes('config.media_url_invalid'));
    return btn ? btn.textContent : null;
  })()`);
  check('p2-media-url-invalid-listed', validation && (validation.includes('媒体') || validation.includes('invalid')), `validation=${validation}`);

  // 5) The media inspector flags the bad URL inline.
  await clickNode('display.media');
  await sleep(600);
  const media = await evalJS(`(() => {
    const inspector = document.querySelector('.composer-inspector');
    const summary = inspector ? inspector.textContent.slice(0, 160).replace(/\\s+/g, ' ') : 'no-inspector';
    const label = [...document.querySelectorAll('.composer-inspector label')].find(x => (x.textContent || '').includes('Source URL'));
    if (!label) return { summary, state: 'no-label' };
    return { summary, invalid: label.classList.contains('field-invalid'), hint: !!(label.querySelector('.field-hint')), state: 'ok' };
  })()`);
  check('p2-media-url-inline-error', media.state === 'ok' && media.invalid && media.hint, `summary=${media.summary} invalid=${media.invalid} hint=${media.hint}`);
}

async function verifyComposerP3() {
  const b = await openComposerWithP2();
  if (!b.ok) { check('p3-composer-open', false, b.reason); return; }
  const key = (k, mods = {}) => evalJS(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, ctrlKey: ${!!mods.ctrl}, shiftKey: ${!!mods.shift}, bubbles: true })); return 'key'; })()`);
  const keyOnInput = async (selector, k) => evalJS(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'missing';
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }));
    return 'key';
  })()`);
  const clickPanelButton = async text => evalJS(`(() => {
    const el = [...document.querySelectorAll('.composer-snapshots-panel button')].find(x => (x.textContent || '').trim() === ${JSON.stringify(text)});
    if (!el) return 'missing';
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.dispatchEvent(new MouseEvent('click', o));
    return 'clicked';
  })()`);
  const clickButtonByText = async (scope, text) => evalJS(`(() => {
    const root = ${scope === 'body' ? 'document' : `document.querySelector(${JSON.stringify(scope)})`};
    if (!root) return 'missing-scope';
    const el = [...root.querySelectorAll('button')].find(x => (x.textContent || '').trim() === ${JSON.stringify(text)});
    if (!el) return 'missing';
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.dispatchEvent(new MouseEvent('click', o));
    return 'clicked';
  })()`);
  const setInput = async (selector, value) => evalJS(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'missing';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'set';
  })()`);
  const nodeLeft = async type => evalJS(`(() => {
    const el = [...document.querySelectorAll('article.composer-node')].find(x => (x.textContent || '').includes(${JSON.stringify(type)}));
    if (!el) return null;
    return parseFloat(el.style.left);
  })()`);
  const clickNode = async type => {
    const rect = await evalJS(`(() => {
      const el = [...document.querySelectorAll('article.composer-node')].find(x => (x.textContent || '').includes(${JSON.stringify(type)}));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (!rect) return 'missing';
    await clickAt(rect.x, rect.y);
    return 'clicked';
  };
  const clickReal = async selector => {
    const rect = await evalJS(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (!rect) return 'missing';
    await clickAt(rect.x, rect.y);
    return 'clicked';
  };

  // 1) Ctrl+F focuses the search box.
  await key('f', { ctrl: true });
  await sleep(400);
  const focused = await evalJS(`(() => document.activeElement === document.querySelector('input[aria-label="Search nodes"]'))()`);
  check('p3-search-ctrl-f', focused === true, `focused=${focused}`);

  // 2) Typing shows a match count and result row.
  await setInput('input[aria-label="Search nodes"]', 'rating');
  await sleep(400);
  const match = await evalJS(`(() => ({
    count: document.querySelector('.composer-search-count')?.textContent || null,
    results: document.querySelectorAll('.composer-search-results button').length,
  }))()`);
  check('p3-search-match', match.count === '1 match' && match.results === 1, `count=${match.count} results=${match.results}`);

  // 3) Enter selects the first match.
  await keyOnInput('input[aria-label="Search nodes"]', 'Enter');
  await sleep(400);
  const sel = await evalJS(`(() => {
    const el = document.querySelector('article.composer-node.selected');
    return el ? (el.textContent || '').replace(/\\s+/g, ' ') : null;
  })()`);
  check('p3-search-enter-selects', !!sel && sel.includes('input.rating'), `selected=${sel}`);

  // 4) Escape clears the query.
  await setInput('input[aria-label="Search nodes"]', 'media');
  await evalJS(`(() => { document.querySelector('input[aria-label="Search nodes"]').focus(); return 'ok'; })()`);
  await sleep(300);
  await keyOnInput('input[aria-label="Search nodes"]', 'Escape');
  await sleep(300);
  const afterEsc = await evalJS(`(() => ({ layout: !!document.querySelector('.composer-layout'), val: document.querySelector('input[aria-label="Search nodes"]')?.value || '' }))()`);
  const cleared = afterEsc.val;
  check('p3-search-esc-clears', cleared === '' && afterEsc.layout === true, `value=${JSON.stringify(cleared)} layout=${afterEsc.layout}`);

  // 5) Save a snapshot of the original layout, then auto layout.
  await setInput('input[aria-label="Search nodes"]', '');
  await sleep(200);
  await clickReal('button[title="Flow snapshots"]');
  await sleep(400);
  await setInput('input[aria-label="Snapshot name"]', 'Base');
  await clickPanelButton('Save');
  await sleep(500);
  const saved = await evalJS(`(() => [...document.querySelectorAll('.composer-snapshots-row')].some(x => (x.textContent || '').includes('Base')))()`);
  check('p3-snapshot-saved', saved === true, `saved=${saved}`);

  const beforeX = await nodeLeft('display.media');
  await clickReal('button[title="Auto layout"]');
  await sleep(800);
  const afterX = await nodeLeft('display.media');
  const startX = await nodeLeft('core.start');
  check('p3-autolayout', beforeX === 200 && afterX === 300 && startX === 80, `media ${beforeX}->${afterX} start=${startX}`);

  // 6) Restore brings positions back to the snapshot.
  const movedX = await nodeLeft('display.media');
  await clickPanelButton('Restore');
  await sleep(800);
  const restoredX = await nodeLeft('display.media');
  check('p3-snapshot-restore', movedX === 300 && restoredX === 200, `moved=${movedX} restored=${restoredX}`);

  // 7) Rename the snapshot.
  await clickPanelButton('Rename');
  await sleep(300);
  await setInput('input[aria-label="Rename snapshot"]', 'Renamed');
  await keyOnInput('input[aria-label="Rename snapshot"]', 'Enter');
  await sleep(400);
  const renamed = await evalJS(`(() => {
    const row = [...document.querySelectorAll('.composer-snapshots-row')].find(x => (x.textContent || '').includes('Renamed') && x.querySelector('button'));
    return row ? row.textContent : null;
  })()`);
  check('p3-snapshot-rename', !!renamed && renamed.includes('Renamed') && !renamed.includes('Base'), `row=${renamed}`);

  // 8) Full-graph snapshot restores a deleted node with its original position.
  const count0 = await evalJS(`(() => document.querySelectorAll('article.composer-node').length)()`);
  await clickNode('input.rating');
  await sleep(300);
  await evalJS(`(() => { if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur(); return 'ok'; })()`);
  await sleep(200);
  await key('Delete');
  await sleep(300);
  await clickReal('.composer-delete-confirm .danger');
  await sleep(700);
  const count1 = await evalJS(`(() => document.querySelectorAll('article.composer-node').length)()`);
  await clickPanelButton('Restore');
  await sleep(800);
  const count2 = await evalJS(`(() => document.querySelectorAll('article.composer-node').length)()`);
  const ratingX = await nodeLeft('input.rating');
  check('p3-snapshot-full-graph', count1 === count0 - 1 && count2 === count0 && ratingX === 440, `nodes ${count0}->${count1}->${count2} ratingX=${ratingX}`);
}

async function verifyAlign() {
  const b = await openBuilder();
  if (!b.ok) { check('builder-open', false, b.reason); return; }
  // Multi-select the three free texts with shift-click.
  for (const id of ['ui_t1', 'ui_t2', 'ui_t3']) {
    await clickEl(`[data-ui-id="${id}"]`, { shiftKey: true });
    await sleep(300);
  }
  const count = await evalJS(`(() => document.querySelectorAll('[data-ui-id].selected').length)()`);
  const selIds = await evalJS(`(() => [...document.querySelectorAll('[data-ui-id].selected')].map(e => e.dataset.uiId).join(','))()`);
  const btnInfo = await evalJS(`(() => {
    const b = document.querySelector('.ui-align-btn[title="Align left"]');
    return b ? { found: true } : { found: false, bars: document.querySelectorAll('.ui-multi-bar').length, btns: [...document.querySelectorAll('.ui-multi-bar button')].map(x => x.getAttribute('title') || x.textContent).join('|') };
  })()`);
  check('multi-select', count === 4 && selIds.includes('ui_t1') && btnInfo.found, `selected=${count} (${selIds}) btn=${JSON.stringify(btnInfo)}`);

  const snapshot = () => evalJS(`(() => {
    const pos = {};
    for (const id of ['ui_t1', 'ui_t2', 'ui_t3']) {
      const el = document.querySelector('[data-ui-id="' + id + '"]');
      const r = el.getBoundingClientRect();
      pos[id] = { left: parseFloat(el.style.left), top: parseFloat(el.style.top), w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    }
    return pos;
  })()`);

  // 1) Align left
  const probe = await evalJS(`(() => {
    const b = document.querySelector('.ui-align-btn[title="Align left"]');
    window.__probe = [];
    b.addEventListener('click', () => window.__probe.push('native-click'));
    b.addEventListener('pointerdown', () => window.__probe.push('native-pd'));
    const r = b.getBoundingClientRect();
    b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
    b.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
    b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
    return 'dispatched';
  })()`);
  await sleep(600);
  // 1) Align left
  await clickEl('.ui-align-btn[title="Align left"]');
  await sleep(600);
  let p = await snapshot();
  const lx = Object.values(p).map(v => v.left);
  check('align-left', new Set(lx).size === 1, `lefts=${lx.join(',')}`);

  // 2) Align centers (horizontal)
  await clickEl('.ui-align-btn[title="Align centers (horizontal)"]');
  await sleep(600);
  p = await snapshot();
  const cxs = Object.values(p).map(v => v.cx);
  check('align-centerX', Math.max(...cxs) - Math.min(...cxs) < 2, `centers=${cxs.map(v => Math.round(v)).join(',')}`);

  // 3) Distribute vertically (equal gaps between element boxes)
  await clickEl('.ui-align-btn[title="Distribute vertically"]');
  await sleep(600);
  p = await snapshot();
  const ys = Object.values(p).sort((a, b) => a.top - b.top);
  const gaps = [ys[1].top - (ys[0].top + ys[0].h), ys[2].top - (ys[1].top + ys[1].h)];
  check('distribute-y', Math.abs(gaps[0] - gaps[1]) < 2, `gaps=${gaps.map(g => Math.round(g)).join(',')}`);
}

async function buildResponseProtocol() {
  const { pathToFileURL } = require('url');
  const { createProtocolGraph } = await import(pathToFileURL(path.join(process.cwd(), 'src/core/protocolGraph.js')).href);
  const { addNode, connect } = await import(pathToFileURL(path.join(process.cwd(), 'src/core/graphCommands.js')).href);
  const { createCoreComponentRegistry } = await import(pathToFileURL(path.join(process.cwd(), 'src/core/componentRegistry.js')).href);
  const registry = createCoreComponentRegistry();
  const responseDefaults = registry.get('input.response').defaultConfig;
  const now = '2026-08-26T00:00:00.000Z';
  let p = createProtocolGraph({ name: 'Response Verify', now });
  const start = p.graph.nodes.find(n => n.component.type === 'core.start');
  const end = p.graph.nodes.find(n => n.component.type === 'core.end');
  p.graph.edges = [];
  const r = addNode(p, 'input.response', { id: 'resp', label: 'Respond', config: { ...responseDefaults, prompt: 'Press the matching key', correctValue: 'yes' }, layout: { x: 240, y: 160 }, now });
  p = r.protocol;
  const l1 = connect(p, 'control', { nodeId: start.id, portId: 'next' }, { nodeId: r.node.id, portId: 'in' });
  p = l1.protocol;
  const l2 = connect(p, 'control', { nodeId: r.node.id, portId: 'next' }, { nodeId: end.id, portId: 'in' });
  p = l2.protocol;
  return p;
}

async function verifyComposerResponse() {
  const proto = await buildResponseProtocol();
  await navigate(URL);
  await evalJS(`(() => { localStorage.setItem('physioflow.protocols.v1', JSON.stringify([${JSON.stringify(proto)}])); return 'injected'; })()`);
  await navigate(URL);
  await sleep(600);
  const editBtn = await evalJS(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Edit draft'));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!editBtn) { check('resp-open-composer', false, 'no Edit draft'); return; }
  await clickAt(editBtn.x, editBtn.y);
  await sleep(1500);
  const composerOpen = await evalJS(`(() => document.querySelectorAll('article.composer-node').length)()`);
  if (!composerOpen) { check('resp-open-composer', false, 'composer not open'); return; }

  // 1) Response node renders with its 5-output data badge.
  const nodeInfo = await evalJS(`(() => {
    const el = [...document.querySelectorAll('article.composer-node')].find(x => (x.textContent || '').includes('input.response'));
    if (!el) return { found: false };
    const badge = el.querySelector('.node-data-fields');
    return { found: true, badge: badge ? badge.textContent : null };
  })()`);
  check('resp-node-renders', nodeInfo.found && nodeInfo.badge === '5 outputs', JSON.stringify(nodeInfo));

  // 2) Selecting the node shows the default inline UI preview and the options textarea with the default line format.
  const nodeCenter = await evalJS(`(() => {
    const el = [...document.querySelectorAll('article.composer-node')].find(x => (x.textContent || '').includes('input.response'));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  await clickAt(nodeCenter.x, nodeCenter.y);
  await sleep(700);
  const previewInfo = await evalJS(`(() => {
    const preview = document.querySelector('.node-inline-preview');
    return preview ? { preview: true, text: preview.textContent || '' } : { preview: false };
  })()`);
  check('resp-inline-preview', previewInfo.preview && previewInfo.text.includes('Respond when you see the target') && previewInfo.text.includes('Submit'), JSON.stringify(previewInfo));
  const optionsValue = await evalJS(`(() => {
    const ta = [...document.querySelectorAll('textarea')].find(t => (t.closest('label')?.textContent || '').includes('Response options'));
    return ta ? ta.value : null;
  })()`);
  check('resp-options-default', optionsValue === 'yes=Yes,key=y\nno=No,key=n', `options=${JSON.stringify(optionsValue)}`);

  // 3) Editing the options textarea round-trips into the stored array and back.
  const editResult = await evalJS(`(() => {
    const ta = [...document.querySelectorAll('textarea')].find(t => (t.closest('label')?.textContent || '').includes('Response options'));
    if (!ta) return 'missing';
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'yes=Yes,key=y\\nno=No,key=n\\nmaybe=Maybe,key=m');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'set';
  })()`);
  check('resp-options-edit', editResult === 'set', `edit=${editResult}`);
  await sleep(500);
  const optionsAfter = await evalJS(`(() => {
    const ta = [...document.querySelectorAll('textarea')].find(t => (t.closest('label')?.textContent || '').includes('Response options'));
    return ta ? ta.value : null;
  })()`);
  check('resp-options-roundtrip', optionsAfter === 'yes=Yes,key=y\nno=No,key=n\nmaybe=Maybe,key=m', `after=${JSON.stringify(optionsAfter)}`);

  // 4) Preview run → begin experiment → response runner appears with prompt and 3 option buttons.
  const previewBtn = await evalJS(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('Preview run') && !x.disabled);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!previewBtn) { check('resp-preview-open', false, 'no Preview run button'); return; }
  await clickAt(previewBtn.x, previewBtn.y);
  await sleep(1200);
  const setupOpen = await evalJS(`(() => document.body.innerText.includes('Start session'))()`);
  check('resp-preview-open', setupOpen === true, 'setup page visible');

  const participantInput = await evalJS(`(() => {
    const input = document.querySelector('#participant-id');
    if (!input) return null;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'P1');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'filled';
  })()`);
  check('resp-setup-participant', participantInput === 'filled', `participant=${participantInput}`);
  await sleep(400);
  const startState = await evalJS(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('Start session'));
    if (!b) return { found: false };
    return { found: true, disabled: b.disabled, title: b.textContent.trim() };
  })()`);
  if (!startState.found) { check('resp-start-session', false, 'no Start session button'); return; }
  const startClicked = await evalJS(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('Start session'));
    if (!b || b.disabled) return 'disabled';
    b.click();
    return 'clicked';
  })()`);
  check('resp-start-session', startClicked === 'clicked' && !startState.disabled, `state=${JSON.stringify(startState)} result=${startClicked}`);
  await sleep(2500);
  const ready = await evalJS(`(() => ({ begin: document.body.innerText.includes('Begin experiment'), head: document.body.innerText.slice(0, 300).replace(/\\n/g, ' | ') }))()`);
  check('resp-runner-ready', ready.begin === true, `runtime ready page · ${ready.head}`);

  const beginBtn = await evalJS(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('Begin experiment'));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!beginBtn) { check('resp-begin', false, 'no Begin experiment'); return; }
  await clickAt(beginBtn.x, beginBtn.y);
  await sleep(1000);
  const runner = await evalJS(`(() => {
    const el = document.querySelector('.response-runner');
    if (!el) return { found: false };
    const prompt = (el.querySelector('.response-stimulus')?.textContent || '');
    const buttons = el.querySelectorAll('.response-options button').length;
    const labels = [...el.querySelectorAll('.response-options button')].map(b => b.textContent.trim().replace(/\\s+/g, ' '));
    const firstRaw = buttons ? el.querySelector('.response-options button').textContent : null;
    const firstCodes = firstRaw ? [...firstRaw].map(c => c.charCodeAt(0)).join(',') : null;
    return { found: true, prompt, buttons, labels, firstRaw, firstCodes };
  })()`);
  check('resp-runner-shows', runner.found && runner.prompt === 'Press the matching key' && runner.buttons === 3 && runner.labels.some(l => l.includes('Yes')) && runner.labels.some(l => l.includes('No')) && runner.labels.some(l => l.includes('Maybe')), JSON.stringify(runner));

  // 5) A real key press ('y') auto-advances to the completed session and records 1 response.
  await keyPress('y');
  await sleep(1800);
  const completed = await evalJS(`(() => {
    const body = document.body.innerText;
    const ev = body.match(/(\\d+)\\s+events/);
    const rs = body.match(/(\\d+)\\s+responses/);
    return { complete: body.includes('SESSION COMPLETE'), events: ev ? Number(ev[1]) : null, responses: rs ? Number(rs[1]) : null, tail: body.slice(0, 220).replace(/\\n/g, ' | ') };
  })()`);
  // One key press should produce exactly the 5 declared data-field rows (value/response_key/reaction_time_ms/correct/timed_out).
  check('resp-key-advances', completed.complete === true && completed.responses === 5 && completed.events >= 5, JSON.stringify(completed));
}

async function main() {
  await startVite();
  startChrome();
  await waitForCdp();
  await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  if (STEP === 'align') await verifyAlign();
  if (STEP === 'zorder') await verifyZOrder();
  if (STEP === 'altdrag') await verifyAltDrag();
  if (STEP === 'nudge') await verifyNudge();
  if (STEP === 'shapes') await verifyShapes();
  if (STEP === 'copypaste') await verifyCopyPaste();
  if (STEP === 'undo-redo') await verifyUndoRedo();
  if (STEP === 'tree-reorder') await verifyTreeReorder();
  if (STEP === 'composer-step8') await verifyComposerStep8();
  if (STEP === 'composer-p2') await verifyComposerP2();
  if (STEP === 'composer-p3') await verifyComposerP3();
  if (STEP === 'composer-response') await verifyComposerResponse();
  console.log('CONSOLE-errors:', consoleErrors.length ? JSON.stringify(consoleErrors) : 'none');
  cleanup(failures ? 1 : 0);
}

function cleanup(code) {
  try { chrome?.kill(); } catch { }
  try { viteProc?.kill(); } catch { }
  process.exit(code);
}

main().catch(err => { console.error('FAIL', err.message); cleanup(1); });
