// Lightweight web distribution build.
// Produces release-web/PhysioFlow-Web-v{version}/ and a small ZIP with only static files.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const pkg = require('./package.json');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const OUT_ROOT = path.join(ROOT, 'release-web');
const VERSION = pkg.version || '0.2.0';
const APP_DIR_NAME = `PhysioFlow-Web-v${VERSION}`;
const APP_DIR = path.join(OUT_ROOT, APP_DIR_NAME);
const ZIP_PATH = path.join(OUT_ROOT, `${APP_DIR_NAME}.zip`);
const crcTable = Array.from({ length: 256 }, (_, number) => {
  let value = number;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

console.log('=== PhysioFlow Lightweight Web Build ===');

const build = spawnSync('npx', ['vite', 'build'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
});
if (build.status !== 0) process.exit(build.status || 1);

fs.rmSync(OUT_ROOT, { recursive: true, force: true });
fs.mkdirSync(APP_DIR, { recursive: true });
fs.cpSync(DIST, APP_DIR, { recursive: true });
fs.writeFileSync(path.join(APP_DIR, 'favicon.ico'), Buffer.from(
  'AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAQAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///8A////AP///wD///8A////AP///wD///8A////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP///wD///8Ae9hX/3vYV/97uFf/e7hX/3vYV/97uFf/////AP///wAAAAAAAAAAAAAAAAAAAAAA////AP///wB72Ff/e9hX/3vYV/97uFf/e9hX/3vYV/////wD///8AAAAAAAAAAAAAAAAAAAAAAP///wD///8Ae9hX/3vYV/97uFf/e9hX/3vYV/97uFf/////AP///wAAAAAAAAAAAAAAAAAAAAAA////AP///wB72Ff/e9hX/3vYV/97uFf/e9hX/3vYV/////wD///8AAAAAAAAAAAAAAAAAAAAAAP///wD///8Ae9hX/3vYV/97uFf/e9hX/3vYV/97uFf/////AP///wAAAAAAAAAAAAAAAAAAAAAA////AP///wB72Ff/e9hX/3vYV/97uFf/e9hX/3vYV/////wD///8AAAAAAAAAAAAAAAAAAAAAAP///wD///8Ae9hX/3vYV/97uFf/e9hX/3vYV/97uFf/////AP///wAAAAAAAAAAAAAAAAAAAAAA////AP///wD///8A////AP///wD///8A////AP///wD///8A////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/////w==',
  'base64'
));
fs.writeFileSync(path.join(APP_DIR, 'START_HERE.html'), [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="utf-8" />',
  '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
  '  <title>Start PhysioFlow Web</title>',
  '  <style>',
  '    :root { color-scheme: light; --ink: #1d2939; --muted: #667085; --line: #d0d5dd; --soft: #f2f4f7; --brand: #237a57; --warn: #b54708; }',
  '    * { box-sizing: border-box; }',
  '    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; color: var(--ink); background: #f8fafc; }',
  '    main { width: min(920px, calc(100% - 32px)); margin: 40px auto; background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 32px; box-shadow: 0 14px 40px rgba(16, 24, 40, 0.08); }',
  '    h1 { margin: 0 0 8px; font-size: 30px; line-height: 1.15; letter-spacing: 0; }',
  '    h2 { margin: 28px 0 12px; font-size: 18px; letter-spacing: 0; }',
  '    p { line-height: 1.6; margin: 10px 0; }',
  '    .notice { border-left: 4px solid var(--warn); background: #fffaeb; padding: 12px 14px; color: #7a2e0e; }',
  '    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; margin-top: 14px; }',
  '    .item { border: 1px solid var(--line); border-radius: 8px; padding: 14px; background: #fff; }',
  '    .item strong { display: block; margin-bottom: 8px; }',
  '    code { display: inline-block; max-width: 100%; overflow-wrap: anywhere; padding: 2px 6px; border-radius: 6px; background: var(--soft); color: #101828; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }',
  '    .primary { color: var(--brand); font-weight: 700; }',
  '    ul { padding-left: 20px; }',
  '    li { margin: 8px 0; line-height: 1.5; }',
  '    @media (max-width: 640px) { main { margin: 16px auto; padding: 22px; } h1 { font-size: 24px; } }',
  '  </style>',
  '</head>',
  '<body>',
  '  <main>',
  '    <h1>Start PhysioFlow Web</h1>',
  '    <p class="primary">Use a launcher script to open the app. This page is only the package guide.</p>',
  '    <p class="notice"><strong>Do not open <code>index.html</code> directly.</strong> Browsers often block modern web apps opened from <code>file://</code>, which can show a blank page.</p>',
  '    <h2>Run on this computer</h2>',
  '    <div class="grid">',
  '      <div class="item"><strong>Windows</strong><p>Double-click <code>start-windows.bat</code>.</p></div>',
  '      <div class="item"><strong>macOS</strong><p>Double-click <code>start-mac.command</code>. If blocked, open Terminal here and run <code>chmod +x start-mac.command</code>.</p></div>',
  '      <div class="item"><strong>Linux</strong><p>Open Terminal here and run <code>sh start-linux.sh</code>.</p></div>',
  '      <div class="item"><strong>Fallback</strong><p>Run <code>python3 start.py</code>, then use the local URL printed in the terminal.</p></div>',
  '    </div>',
  '    <h2>What the launcher does</h2>',
  '    <ul>',
  '      <li>Starts a local static server from this folder.</li>',
  '      <li>Chooses an available local port from <code>8080</code> to <code>8099</code>.</li>',
  '      <li>Opens PhysioFlow in the browser and keeps data folder permissions attached to that local origin.</li>',
  '      <li>Requires a selected local data folder before frozen formal sessions can start.</li>',
  '    </ul>',
  '    <h2>For easiest distribution</h2>',
  '    <p>The desktop DMG/app is the most direct click-to-use option for non-technical operators. It opens by double-click and stores data in the local PhysioFlow data folder. Use this Web package when a lightweight browser-based copy is preferred.</p>',
  '  </main>',
  '</body>',
  '</html>',
  '',
].join('\n'));
fs.writeFileSync(path.join(APP_DIR, 'README.txt'), [
  'PhysioFlow lightweight web build',
  '',
  'How to run:',
  '1. You may double-click START_HERE.html for human-readable package instructions.',
  '2. Do not double-click index.html. Modern browsers may block module scripts from file:// pages, which causes a blank screen.',
  '3. Use the launcher for your system. It starts a local server, chooses an available port, then opens the browser.',
  '4. Windows: double-click start-windows.bat.',
  '5. macOS: double-click start-mac.command. If macOS blocks it, run: chmod +x start-mac.command',
  '6. Linux: run: sh start-linux.sh',
  '7. The browser may remember the folder permission, but experiment data should be stored in the local folder you choose.',
  '8. On the dashboard, click Data folder and choose a local folder for protocols, sessions, uploaded media, and recovery snapshots.',
  '9. Frozen/formal sessions require a selected local data folder before the run can start.',
  '10. Export every formal session ZIP before clearing browser data or moving computers.',
  '',
  'Notes:',
  '- This build does not include a bundled browser runtime.',
  '- The launch scripts require Python 3. If Python is unavailable, use any static web server.',
  '- Chrome or Edge is recommended so PhysioFlow can write directly to your selected local data folder.',
  '- If no data folder is selected, the app falls back to browser-managed storage for drafts and preview runs.',
  '- Formal collection is blocked until a local data folder is selected.',
  '- For lab computers, keep the same launcher and URL origin when possible so browser fallback storage remains attached to the same origin.',
  '',
].join('\n'));
fs.writeFileSync(path.join(APP_DIR, 'start.py'), [
  '#!/usr/bin/env python3',
  'import http.server',
  'import os',
  'import socketserver',
  'import sys',
  'import webbrowser',
  '',
  'HOST = "127.0.0.1"',
  'START_PORT = 8080',
  'MAX_PORT = 8099',
  '',
  'class Handler(http.server.SimpleHTTPRequestHandler):',
  '    def end_headers(self):',
  '        self.send_header("Cache-Control", "no-store")',
  '        super().end_headers()',
  '',
  'def make_server():',
  '    for port in range(START_PORT, MAX_PORT + 1):',
  '        try:',
  '            return port, socketserver.TCPServer((HOST, port), Handler)',
  '        except OSError:',
  '            continue',
  '    raise RuntimeError(f"No free local port found from {START_PORT} to {MAX_PORT}.")',
  '',
  'def main():',
  '    os.chdir(os.path.dirname(os.path.abspath(__file__)))',
  '    try:',
  '        port, server = make_server()',
  '    except Exception as exc:',
  '        print(f"Could not start PhysioFlow Web: {exc}")',
  '        input("Press Enter to close...")',
  '        return 1',
  '    url = f"http://{HOST}:{port}/"',
  '    print("")',
  '    print("PhysioFlow Web is running.")',
  '    print(f"Open: {url}")',
  '    print("Keep this window open while using PhysioFlow. Press Ctrl+C to stop.")',
  '    print("")',
  '    try:',
  '        webbrowser.open(url)',
  '        server.serve_forever()',
  '    except KeyboardInterrupt:',
  '        print("\\nPhysioFlow Web stopped.")',
  '    finally:',
  '        server.server_close()',
  '    return 0',
  '',
  'if __name__ == "__main__":',
  '    sys.exit(main())',
  '',
].join('\n'), { mode: 0o755 });
fs.writeFileSync(path.join(APP_DIR, 'start-windows.bat'), [
  '@echo off',
  'setlocal',
  'cd /d "%~dp0"',
  'where py >nul 2>nul',
  'if %ERRORLEVEL%==0 (',
  '  py -3 start.py',
  '  goto :eof',
  ')',
  'where python >nul 2>nul',
  'if %ERRORLEVEL%==0 (',
  '  python start.py',
  '  goto :eof',
  ')',
  'echo Python 3 was not found. Install Python 3 or serve this folder with another static web server.',
  'pause',
  '',
].join('\r\n'));
fs.writeFileSync(path.join(APP_DIR, 'start-mac.command'), [
  '#!/bin/sh',
  'cd "$(dirname "$0")"',
  'if command -v python3 >/dev/null 2>&1; then',
  '  python3 start.py',
  'elif command -v python >/dev/null 2>&1; then',
  '  python start.py',
  'else',
  '  echo "Python 3 was not found. Install Python 3 or serve this folder with another static web server."',
  '  read -r _',
  'fi',
  '',
].join('\n'), { mode: 0o755 });
fs.writeFileSync(path.join(APP_DIR, 'start-linux.sh'), [
  '#!/bin/sh',
  'cd "$(dirname "$0")"',
  'if command -v python3 >/dev/null 2>&1; then',
  '  python3 start.py',
  'elif command -v python >/dev/null 2>&1; then',
  '  python start.py',
  'else',
  '  echo "Python 3 was not found. Install Python 3 or serve this folder with another static web server."',
  'fi',
  '',
].join('\n'), { mode: 0o755 });

const files = collectFiles(APP_DIR).map(file => ({
  absolute: file,
  archive: path.posix.join(APP_DIR_NAME, path.relative(APP_DIR, file).split(path.sep).join('/')),
}));
fs.writeFileSync(ZIP_PATH, createZip(files));

const folderSize = getDirSize(APP_DIR);
const zipSize = fs.statSync(ZIP_PATH).size;
console.log(`Web folder: ${APP_DIR} (${formatBytes(folderSize)})`);
console.log(`Web ZIP:    ${ZIP_PATH} (${formatBytes(zipSize)})`);
console.log('=== Done ===');

function collectFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? collectFiles(full) : [full];
  });
}

function getDirSize(dir) {
  return collectFiles(dir).reduce((total, file) => total + fs.statSync(file).size, 0);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function header(size, writer) {
  const bytes = Buffer.alloc(size);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  writer(view);
  return bytes;
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime();

  files.forEach(file => {
    const nameBytes = Buffer.from(file.archive, 'utf8');
    const data = fs.readFileSync(file.absolute);
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);
    const unixMode = executableInZip(file.archive) ? 0o100755 : 0o100644;
    const local = header(30, view => {
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0x0800, true);
      view.setUint16(8, 8, true);
      view.setUint16(10, dosTime, true);
      view.setUint16(12, dosDate, true);
      view.setUint32(14, checksum, true);
      view.setUint32(18, compressed.length, true);
      view.setUint32(22, data.length, true);
      view.setUint16(26, nameBytes.length, true);
    });
    localParts.push(local, nameBytes, compressed);

    const central = header(46, view => {
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, (3 << 8) | 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0x0800, true);
      view.setUint16(10, 8, true);
      view.setUint16(12, dosTime, true);
      view.setUint16(14, dosDate, true);
      view.setUint32(16, checksum, true);
      view.setUint32(20, compressed.length, true);
      view.setUint32(24, data.length, true);
      view.setUint16(28, nameBytes.length, true);
      view.setUint32(38, unixMode << 16, true);
      view.setUint32(42, offset, true);
    });
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  });

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = header(22, view => {
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, files.length, true);
    view.setUint16(10, files.length, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, offset, true);
  });
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function executableInZip(archivePath) {
  return archivePath.endsWith('/start.py')
    || archivePath.endsWith('/start-mac.command')
    || archivePath.endsWith('/start-linux.sh');
}
