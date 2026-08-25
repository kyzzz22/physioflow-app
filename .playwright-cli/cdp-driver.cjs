// Self-contained verification: spawns vite (IPv4) + headless Chrome, drives via CDP.
const { spawn, execSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

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
const consoleWarnings = [];

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
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'warning') {
      consoleWarnings.push(msg.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      consoleErrors.push(msg.params.entry.text);
    }
  };
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, {
      resolve,
      reject: e => reject(new Error(method + ' :: ' + e.message)),
    });
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
  const { clicks = 1, modifiers = 0 } = opts;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers });
  for (let i = 0; i < clicks; i++) {
    const cc = clicks > 1 ? i + 1 : 1;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: cc, modifiers });
    await sleep(60);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: cc, modifiers });
    await sleep(140);
  }
}

async function centerOf(selector) {
  return evalJS(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
}

// Simulate a real mouse click on an element via dispatched events (mousedown ->
// mouseup -> click). This is equivalent to how a real user's mouse events reach
// React; CDP's Input.dispatchMouseEvent sometimes fails to trigger React's
// delegated onMouseDown inside this app in headless mode.
async function clickEl(selector, opts = {}) {
  const { shiftKey = false, x = null, y = null } = opts;
  return evalJS(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'missing';
    const r = el.getBoundingClientRect();
    const cx = ${x ?? 'null'} ?? r.x + r.width / 2;
    const cy = ${y ?? 'null'} ?? r.y + r.height / 2;
    const o = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, shiftKey: ${shiftKey} };
    el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.dispatchEvent(new MouseEvent('click', o));
    return { ok: true, x: Math.round(cx), y: Math.round(cy) };
  })()`);
}

async function triggerDblClick(selector, stateExpression, fixedPoint = null) {
  const target = fixedPoint || await centerOf(selector);
  if (!target) return { method: 'none', state: null, reason: 'no-element' };

  // D1: real CDP mouse sequence
  await clickAt(target.x, target.y, { clicks: 2 });
  await sleep(600);
  let state = await evalJS(stateExpression);
  if (state) return { method: 'cdp', state, reason: null };

  // D2: dispatchEvent native dblclick (detail=2)
  await evalJS(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }));
    return 'dispatched';
  })()`);
  await sleep(600);
  state = await evalJS(stateExpression);
  if (state) return { method: 'dispatch', state, reason: null };

  // D3: call React's onDoubleClick handler directly
  await evalJS(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const key = Object.keys(el).find(k => k.startsWith('__reactProps'));
    if (!key) return 'no-props';
    const fn = el[key].onDoubleClick;
    if (typeof fn !== 'function') return 'no-handler';
    fn({ stopPropagation() {}, currentTarget: el, target: el });
    return 'called';
  })()`);
  await sleep(600);
  state = await evalJS(stateExpression);
  if (state) return { method: 'props', state, reason: null };

  return { method: 'none', state, reason: 'all-ladders-failed' };
}

async function main() {
  await startVite();
  startChrome();
  await waitForCdp();
  await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');

  await navigate(URL);
  await evalJS(`(async () => {
    const r = await fetch('/__verify-protocol.json');
    const list = await r.json();
    localStorage.setItem('physioflow.protocols.v1', JSON.stringify(list));
    return 'injected';
  })()`);
  await navigate(URL);
  console.log('RESULT home:', await evalJS(`(() => document.body.innerText.includes('UI Verify') ? 'project-listed' : 'no-project')()`));

  const editBtn = await evalJS(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Edit draft'));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!editBtn) { console.log('RESULT fail: no Edit draft'); cleanup(1); }
  await clickAt(editBtn.x, editBtn.y);
  await sleep(1500);
  console.log('RESULT composer:', await evalJS(`(() => document.body.innerText.includes('Graph valid') ? 'ok' : 'no')()`));

  const node = await evalJS(`(() => {
    const n = [...document.querySelectorAll('article.composer-node')].find(x => x.textContent.includes('display.screen'));
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!node) { console.log('RESULT fail: no screen node'); cleanup(1); }

  const builder = await triggerDblClick('article.composer-node', `(() => {
    const fs = document.querySelector('.node-editor-fullscreen');
    if (!fs) return { open: false, hasCanvas: false };
    const wraps = [...document.querySelectorAll('.ui-media-wrap, .ui-html-wrap')].map(w => w.getAttribute('data-ui-id'));
    return { open: true, hasCanvas: document.body.innerText.includes('Canvas width'), wraps: wraps.slice(0, 12) };
  })()`, node);
  console.log('D-DBL openBuilder:', JSON.stringify(builder));

  if (!builder.state?.open) { console.log('RESULT fail: builder not open'); cleanup(1); }

  // === V1: shield (iframe edit cover) ===
  console.log('V1-shield:', JSON.stringify(await evalJS(`(() => {
    const w = document.querySelector('.ui-media-wrap[data-ui-id="ui_media_youtube"]');
    const h = document.querySelector('.ui-html-wrap, .ui-media-wrap[data-ui-id="ui_html_custom"]');
    const shields = document.querySelectorAll('.ui-edit-shield');
    let top = null;
    if (w) {
      const r = w.getBoundingClientRect();
      top = document.elementFromPoint(r.x + Math.min(80, r.width / 2), r.y + Math.min(80, r.height / 2));
    }
    const style = shields.length ? getComputedStyle(shields[0]) : null;
    return { shieldCount: shields.length, mediaWrap: !!w, htmlWrap: !!h, topIsShield: top?.className === 'ui-edit-shield', pos: style ? style.position : null, z: style ? style.zIndex : null, inset: style ? style.inset : null };
  })()`)));

  // === V2: click selects Media (dispatch = real mouse sequence) ===
  const mc = await centerOf('.ui-media-wrap[data-ui-id="ui_media_youtube"]');
  let v2 = 'skipped';
  if (mc) {
    await clickEl('.ui-media-wrap[data-ui-id="ui_media_youtube"]');
    await sleep(500);
    v2 = await evalJS(`(() => document.querySelector('.ui-media-wrap[data-ui-id="ui_media_youtube"]')?.className.includes('selected') || false)()`);
  }
  console.log('V2-click-select:', v2);

  // === V3: dblclick opens in-place URL edit ===
  const v3 = await triggerDblClick('.ui-media-wrap[data-ui-id="ui_media_youtube"]', `(() => {
    const w = document.querySelector('.ui-media-wrap[data-ui-id="ui_media_youtube"]');
    return !!(w && (w.querySelector('.ui-media-url-edit') || w.querySelector('input')));
  })()`);
  console.log('V3-dblclick-edit:', JSON.stringify(v3));

  // === V4: type new URL + Enter ===
  if (v3.state) {
    await evalJS(`(() => {
      const w = document.querySelector('.ui-media-wrap[data-ui-id="ui_media_youtube"]');
      const input = w.querySelector('.ui-media-url-edit') || w.querySelector('input');
      input.focus(); input.select();
      return 'focused';
    })()`);
    await send('Input.insertText', { text: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' });
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(1200);
    console.log('V4-url-submit:', JSON.stringify(await evalJS(`(() => {
      const wrap = document.querySelector('.ui-media-wrap[data-ui-id="ui_media_youtube"]');
      const frame = wrap?.querySelector('iframe');
      const input = wrap?.querySelector('.ui-media-url-edit');
      return { src: frame?.src || null, stillEditing: !!input, inputVal: input?.value || null };
    })()`)));
  } else {
    console.log('V4-url-submit: skipped (edit not open)');
  }

  // === V5: Text dblclick edit (contenteditable) ===
  const tc = await centerOf('.ui-canvas-device h1, .ui-canvas-device p');
  if (tc) {
    const v5 = await triggerDblClick('.ui-canvas-device h1, .ui-canvas-device p', `(() => !!document.querySelector('[contenteditable="true"]'))()`);
    console.log('V5-text-edit:', JSON.stringify(v5));
    if (v5.state) {
      await evalJS(`(() => {
        const el = document.querySelector('[contenteditable="true"]');
        el.focus();
        return 'focused';
      })()`);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
      await send('Input.insertText', { text: 'Edited headline' });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await sleep(700);
      console.log('V5-text-typed:', await evalJS(`(() => {
        const el = document.querySelector('.ui-canvas-device h1, .ui-canvas-device p');
        return el?.textContent || null;
      })()`));
    }
  } else {
    console.log('V5-text-edit: skipped (no text element)');
  }

  // === V6: Button floatbar (select a button -> float bar appears) ===
  console.log('V6-pre:', JSON.stringify(await evalJS(`(() => {
    const wrap = document.querySelector('.ui-button-wrap');
    const btn = document.querySelector('.participant-ui-button');
    return {
      wrap: !!wrap, btn: !!btn,
      wrapClass: wrap?.className || null,
      btnRect: btn ? (() => { const r = btn.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })() : null,
    };
  })()`)));
  const bc = await centerOf('.participant-ui-button');
  if (bc) {
    // Experiment: dispatch click on the WRAP (span) vs the inner <button>
    await evalJS(`(() => {
      const wrap = document.querySelector('.ui-button-wrap');
      window.__b = [];
      wrap.addEventListener('mousedown', e => window.__b.push('md:' + (e.target.className || e.target.tagName)));
      wrap.addEventListener('click', e => window.__b.push('clk:' + (e.target.className || e.target.tagName)));
      return 'probe-on';
    })()`);
    await clickEl('.ui-button-wrap');
    await sleep(400);
    console.log('V6-wrap-click:', JSON.stringify(await evalJS(`(() => window.__b)()`)), 'class:', await evalJS(`(() => document.querySelector('.ui-button-wrap')?.className)()`));
    await clickEl('.participant-ui-button');
    await sleep(400);
    console.log('V6-btn-click:', JSON.stringify(await evalJS(`(() => window.__b)()`)), 'class:', await evalJS(`(() => document.querySelector('.ui-button-wrap')?.className)()`));
    console.log('V6-floatbar:', JSON.stringify(await evalJS(`(() => {
      const bar = document.querySelector('.ui-float-bar');
      if (!bar) return { visible: false };
      const r = bar.getBoundingClientRect();
      return { visible: r.width > 0 && r.height > 0, buttons: [...bar.querySelectorAll('button')].map(b => b.title || b.textContent) };
    })()`)));
  } else {
    console.log('V6-floatbar: skipped (no button)');
  }

  // === V7: multi-select (shift+click) -> multi-bar with duplicate/delete ===
  console.log('V7-pre:', JSON.stringify(await evalJS(`(() => {
    return {
      htmlWrap: !!document.querySelector('.ui-html-wrap[data-ui-id="ui_html_custom"]'),
      mediaAsHtml: !!document.querySelector('.ui-media-wrap[data-ui-id="ui_html_custom"]'),
      htmlWraps: [...document.querySelectorAll('.ui-html-wrap')].map(w => w.getAttribute('data-ui-id')),
      allShields: document.querySelectorAll('.ui-edit-shield').length,
    };
  })()`)));
  const a = await centerOf('.ui-media-wrap[data-ui-id="ui_media_youtube"]');
  const b = await centerOf('.ui-html-wrap[data-ui-id="ui_html_custom"], .ui-media-wrap[data-ui-id="ui_html_custom"]');
  if (a && b) {
    // Theory test: does shift+click toggle twice (mousedown + click)?
    await clickEl('.ui-media-wrap[data-ui-id="ui_media_youtube"]');
    await sleep(300);
    console.log('V7-t1-media-selected:', await evalJS(`(() => document.querySelector('.ui-media-wrap[data-ui-id="ui_media_youtube"]')?.className.includes('selected'))()`));
    await evalJS(`(() => {
      const el = document.querySelector('.ui-media-wrap[data-ui-id="ui_html_custom"]');
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, shiftKey: true }));
      return 'md-shift';
    })()`);
    await sleep(400);
    console.log('V7-t2-after-md:', JSON.stringify(await evalJS(`(() => ({
      htmlSel: document.querySelector('.ui-media-wrap[data-ui-id="ui_html_custom"]')?.className.includes('selected'),
      mediaSel: document.querySelector('.ui-media-wrap[data-ui-id="ui_media_youtube"]')?.className.includes('selected'),
      multi: !!document.querySelector('.ui-multi-bar'),
    }))()`)));
    await evalJS(`(() => {
      const el = document.querySelector('.ui-media-wrap[data-ui-id="ui_html_custom"]');
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, shiftKey: true }));
      return 'click-shift';
    })()`);
    await sleep(400);
    console.log('V7-t3-after-click:', JSON.stringify(await evalJS(`(() => ({
      htmlSel: document.querySelector('.ui-media-wrap[data-ui-id="ui_html_custom"]')?.className.includes('selected'),
      mediaSel: document.querySelector('.ui-media-wrap[data-ui-id="ui_media_youtube"]')?.className.includes('selected'),
      multi: !!document.querySelector('.ui-multi-bar'),
    }))()`)));
    await clickEl('.ui-media-wrap[data-ui-id="ui_media_youtube"]');
    await sleep(300);
    await clickEl('.ui-html-wrap[data-ui-id="ui_html_custom"], .ui-media-wrap[data-ui-id="ui_html_custom"]', { shiftKey: true });
    await sleep(500);
    const multi = await evalJS(`(() => {
      const bar = document.querySelector('.ui-multi-bar');
      if (!bar) return { visible: false };
      return { visible: true, text: bar.innerText.replace(/\\n+/g, ' | '), btns: [...bar.querySelectorAll('button')].map(x => x.textContent) };
    })()`);
    console.log('V7-multiselect:', JSON.stringify(multi));
    if (multi.visible) {
      const dupBtn = await evalJS(`(() => {
        const bar = document.querySelector('.ui-multi-bar');
        const btn = [...bar.querySelectorAll('button')].find(x => x.textContent.includes('Duplicate'));
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
      if (dupBtn) {
        const dupClick = await clickEl('.ui-multi-bar button');
        await sleep(900);
        console.log('V7-duplicate:', JSON.stringify({ click: dupClick, result: await evalJS(`(() => ({
          wraps: [...document.querySelectorAll('.ui-media-wrap')].map(w => w.getAttribute('data-ui-id')),
          multiBarGone: !document.querySelector('.ui-multi-bar'),
          allUiSlots: [...document.querySelectorAll('[data-ui-id]')].map(w => w.getAttribute('data-ui-id')).filter(id => id && id.startsWith('ui_')),
        }))()`) }));
      }
    }
  } else {
    console.log('V7-multiselect: skipped (missing elements)');
  }

  // === Console check ===
  console.log('CONSOLE-errors:', consoleErrors.length ? JSON.stringify(consoleErrors) : 'none');
  console.log('CONSOLE-warnings:', consoleWarnings.length ? JSON.stringify(consoleWarnings.slice(0, 8)) : 'none');

  cleanup(0);
}

function cleanup(code) {
  try { chrome?.kill(); } catch { }
  try { viteProc?.kill(); } catch { }
  process.exit(code);
}

main().catch(err => { console.error('FAIL', err.message); cleanup(1); });
