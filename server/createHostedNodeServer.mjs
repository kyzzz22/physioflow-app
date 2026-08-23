import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { createHostedHttpHandler, createPersistentHostedExecutionService } from '../src/hosted/index.js';
import { FileHostedStateStore } from './fileHostedStateStore.mjs';
import { createFilesystemAssetDelivery } from './filesystemAssetDelivery.mjs';

const STATIC_TYPES = Object.freeze({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' });
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function normalizedPublicBaseUrl(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) throw new Error('Hosted public base URL must use HTTPS, except on a loopback host');
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('Hosted public base URL must contain only an origin');
  return url.origin;
}

async function bodyOf(request, maximumBytes) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return undefined;
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) throw Object.assign(new Error('Request body is too large'), { status: 413 });
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function sendNodeResponse(response, webResponse, head = false) {
  response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers.entries()));
  response.end(head ? undefined : Buffer.from(await webResponse.arrayBuffer()));
}

async function staticResponse(request, staticDirectory) {
  if (!staticDirectory || !['GET', 'HEAD'].includes(request.method)) return null;
  const url = new URL(request.url);
  if (url.pathname === '/participant/') return new Response(null, { status: 308, headers: { location: '/participant' } });
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return new Response('Invalid path', { status: 400 }); }
  const requested = pathname === '/' || pathname === '/participant' || pathname === '/participant/' ? 'index.html' : pathname.replace(/^\//, '');
  const root = resolve(staticDirectory);
  const file = resolve(root, requested);
  if (file !== root && !file.startsWith(`${root}${sep}`)) return new Response('Invalid path', { status: 400 });
  try {
    if (!(await stat(file)).isFile()) return null;
    const content = await readFile(file);
    return new Response(content, { headers: { 'content-type': STATIC_TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': String(content.length), 'cache-control': requested === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } });
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function createHostedNodeServer(options = {}) {
  if (!Array.isArray(options.actors) || !options.actors.length) throw new Error('Hosted Node server requires at least one configured actor');
  const maximumBodyBytes = options.maximumBodyBytes || 10 * 1024 * 1024;
  let baseUrl = normalizedPublicBaseUrl(options.publicBaseUrl);
  const listenHost = options.host || '127.0.0.1';
  if (options.assetDirectory && !baseUrl && !LOOPBACK_HOSTS.has(listenHost)) throw new Error('Non-loopback asset hosting requires an explicit HTTPS public base URL');
  const assetDelivery = options.assetDirectory ? createFilesystemAssetDelivery({ rootDirectory: options.assetDirectory, secret: options.assetSecret, publicBaseUrl: () => baseUrl, ttlMs: options.assetTtlMs, clock: options.epochClock }) : null;
  const store = options.store || new FileHostedStateStore(options.stateFile);
  const service = await createPersistentHostedExecutionService({ ...options.serviceOptions, actors: options.actors, store, assetResolver: assetDelivery?.resolve });
  const hosted = createHostedHttpHandler(service, { maximumBodyBytes, allowedOrigins: options.allowedOrigins });
  const server = createServer(async (incoming, outgoing) => {
    try {
      const requestUrl = `${baseUrl || `http://${incoming.headers.host}`}${incoming.url}`;
      const request = new Request(requestUrl, { method: incoming.method, headers: incoming.headers, body: await bodyOf(incoming, maximumBodyBytes) });
      if (new URL(request.url).pathname === '/healthz') return sendNodeResponse(outgoing, new Response(JSON.stringify({ status: 'ok' }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }), incoming.method === 'HEAD');
      const asset = await assetDelivery?.response(request);
      if (asset) return sendNodeResponse(outgoing, asset, incoming.method === 'HEAD');
      if (new URL(request.url).pathname.startsWith('/v1/')) return sendNodeResponse(outgoing, await hosted(request), incoming.method === 'HEAD');
      const staticFile = await staticResponse(request, options.staticDirectory);
      return sendNodeResponse(outgoing, staticFile || new Response('Not found', { status: 404 }), incoming.method === 'HEAD');
    } catch (error) {
      const status = error?.status || 500;
      return sendNodeResponse(outgoing, new Response(status === 500 ? 'Hosted server request failed' : error.message, { status, headers: { 'cache-control': 'no-store' } }));
    }
  });

  return {
    server,
    service,
    async listen(port = options.port ?? 8787, host = listenHost) {
      await new Promise((resolveListen, rejectListen) => { server.once('error', rejectListen); server.listen(port, host, resolveListen); });
      const address = server.address();
      baseUrl ||= `http://${address.address.includes(':') ? `[${address.address}]` : address.address}:${address.port}`;
      return { baseUrl, address };
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()));
    },
  };
}
