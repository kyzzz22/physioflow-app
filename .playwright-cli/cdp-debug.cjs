const { spawn } = require('node:child_process');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9334;
const path = require('node:path');

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-proxy-server',
  '--host-resolver-rules=MAP localhost 127.0.0.1',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(process.cwd(), '.playwright-cli', 'dbg-chrome2')}`,
  '--window-size=1600,1000',
  'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let ok = false;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) { ok = true; break; } } catch { }
    await sleep(400);
  }
  if (!ok) { console.log('CDP timeout'); process.exit(1); }
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise(res => {
    const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  });

  await send('Page.navigate', { url: 'http://127.0.0.1:5174/' });
  await sleep(3000);
  console.log('nav-127:', JSON.stringify((await send('Runtime.evaluate', { expression: '({ href: location.href, text: document.body.innerText.slice(0,50) })', returnByValue: true })).result.result.value));

  await send('Page.navigate', { url: 'https://example.com/' });
  await sleep(3000);
  console.log('nav-ext:', JSON.stringify((await send('Runtime.evaluate', { expression: '({ href: location.href, text: document.body.innerText.slice(0,50) })', returnByValue: true })).result.result.value));

  chrome.kill();
  process.exit(0);
})();
