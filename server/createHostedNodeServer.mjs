import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { createHostedHttpHandler, createPersistentHostedExecutionService } from '../src/hosted/index.js';
import { FileHostedStateStore } from './fileHostedStateStore.mjs';
import { createFilesystemAssetDelivery } from './filesystemAssetDelivery.mjs';
import { HostedOperationalMetrics, HostedRequestRateLimiter, normalizeRateLimits, requestRateScope, requestSourceAddress } from './requestProtection.mjs';

const STATIC_TYPES = Object.freeze({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' });
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function normalizedPublicBaseUrl(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) throw new Error('Hosted public base URL must use HTTPS, except on a loopback host');
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('Hosted public base URL must contain only an origin');
  return url.origin;
}

function accessContext(request) {
  const match = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Bearer access token is required'), { status: 401, code: 'unauthorized' });
  return { accessToken: match[1] };
}

function corsOrigin(request, allowedOrigins) {
  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins) return null;
  if (allowedOrigins === '*') return '*';
  if (typeof allowedOrigins === 'function') return allowedOrigins(origin) ? origin : null;
  return (Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins]).includes(origin) ? origin : null;
}

function jsonResponse(value, status, request, allowedOrigins) {
  const headers = new globalThis.Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  const origin = corsOrigin(request, allowedOrigins);
  if (origin) { headers.set('access-control-allow-origin', origin); if (origin !== '*') headers.set('vary', 'Origin'); }
  return new Response(JSON.stringify(value), { status, headers });
}

function withRateLimitHeaders(response, decision) {
  if (!decision?.limit) return response;
  const headers = new globalThis.Headers(response.headers);
  headers.set('x-ratelimit-limit', String(decision.limit));
  headers.set('x-ratelimit-remaining', String(decision.remaining));
  headers.set('x-ratelimit-reset', String(Math.ceil(decision.resetAt / 1000)));
  if (!decision.allowed) headers.set('retry-after', String(decision.retryAfterSeconds));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function assetRequirementsWithoutStore(deployment) {
  const assets = (deployment.bundle?.dependencies?.assets || []).filter(asset => asset.source === 'workspace').map(asset => ({ ...asset, status: 'missing', size: null }));
  return { deploymentId: deployment.deploymentId, bundleId: deployment.bundleId, ready: assets.length === 0, assets };
}

function hostedNodeError(error) {
  if (error?.status) return { status: error.status, code: error.code || 'invalid_request', message: error.message };
  const message = error?.message || String(error);
  if (/permission .* required/i.test(message)) return { status: 403, code: 'forbidden', message };
  if (/^Unknown hosted/i.test(message)) return { status: 404, code: 'not_found', message };
  if (/conflict|checksum|already|expired|deactivated|quota|exhausted| is (?:ready|completed|failed)/i.test(message)) return { status: 409, code: 'conflict', message };
  if (/requires|required|invalid|not declared|must be/i.test(message)) return { status: 400, code: 'invalid_request', message };
  return { status: 500, code: 'internal_error', message: 'Hosted server request failed' };
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
  const maximumAssetBytes = options.maximumAssetBytes || 250 * 1024 * 1024;
  const trustedProxyHops = options.trustedProxyHops ?? 0;
  if (!Number.isInteger(trustedProxyHops) || trustedProxyHops < 0) throw new Error('Hosted trusted proxy hops must be a non-negative integer');
  const rateLimits = normalizeRateLimits(options.rateLimits);
  const limiter = new HostedRequestRateLimiter({ limits: rateLimits || false, clock: options.rateLimitClock });
  const metrics = new HostedOperationalMetrics({ clock: options.metricsClock });
  let baseUrl = normalizedPublicBaseUrl(options.publicBaseUrl);
  const listenHost = options.host || '127.0.0.1';
  if (options.assetDirectory && !baseUrl && !LOOPBACK_HOSTS.has(listenHost)) throw new Error('Non-loopback asset hosting requires an explicit HTTPS public base URL');
  const assetDelivery = options.assetDirectory ? createFilesystemAssetDelivery({ rootDirectory: options.assetDirectory, secret: options.assetSecret, publicBaseUrl: () => baseUrl, ttlMs: options.assetTtlMs, maximumBytes: maximumAssetBytes, clock: options.epochClock }) : null;
  const store = options.store || new FileHostedStateStore(options.stateFile);
  const service = await createPersistentHostedExecutionService({ ...options.serviceOptions, actors: options.actors, store, assetResolver: assetDelivery?.resolve });
  const hosted = createHostedHttpHandler(service, { maximumBodyBytes, allowedOrigins: options.allowedOrigins });
  const readiness = async () => {
    const checks = { state: { ready: false }, assets: { ready: false } };
    try {
      const detail = store.checkReadiness ? await store.checkReadiness() : { initialized: Boolean(await store.load()) };
      checks.state = { ready: true, ...detail };
    } catch { checks.state = { ready: false }; }
    try {
      const invalid = [];
      if (assetDelivery) {
        for (const deployment of service.deployments.values()) {
          if (deployment.status === 'queued') continue;
          const status = await assetDelivery.status(deployment);
          if (!status.ready) invalid.push(deployment.deploymentId);
        }
      } else {
        for (const deployment of service.deployments.values()) {
          if (deployment.status === 'queued') continue;
          if ((deployment.bundle?.dependencies?.assets || []).some(asset => asset.source === 'workspace')) invalid.push(deployment.deploymentId);
        }
      }
      checks.assets = { ready: invalid.length === 0, invalidDeployments: invalid.length };
    } catch { checks.assets = { ready: false }; }
    return { status: Object.values(checks).every(check => check.ready) ? 'ready' : 'not_ready', checks };
  };
  const server = createServer(async (incoming, outgoing) => {
    let rateDecision = null;
    let requestTenantId = 'public';
    const send = async (response, head = incoming.method === 'HEAD', error = false) => {
      metrics.record(response.status, error, requestTenantId);
      return sendNodeResponse(outgoing, withRateLimitHeaders(response, rateDecision), head);
    };
    try {
      const requestUrl = `${baseUrl || `http://${incoming.headers.host}`}${incoming.url}`;
      const pathname = new URL(requestUrl).pathname;
      const metadataRequest = new Request(requestUrl, { method: incoming.method, headers: incoming.headers });
      const bearer = String(incoming.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1];
      requestTenantId = bearer ? await service.tenantForContext({ accessToken: bearer }) || 'public' : 'public';
      const rateScope = requestRateScope(pathname, incoming.method);
      rateDecision = limiter.consume(rateScope, requestSourceAddress(incoming, trustedProxyHops), requestTenantId);
      if (!rateDecision.allowed) {
        incoming.resume();
        return send(jsonResponse({ error: { code: 'rate_limited', message: 'Hosted request rate limit exceeded' } }, 429, metadataRequest, options.allowedOrigins));
      }
      const uploadMatch = pathname.match(/^\/v1\/deployments\/([^/]+)\/assets\/([^/]+)$/);
      const request = new Request(requestUrl, { method: incoming.method, headers: incoming.headers, body: await bodyOf(incoming, incoming.method === 'PUT' && uploadMatch ? maximumAssetBytes : maximumBodyBytes) });
      if (pathname === '/healthz') {
        if (!['GET', 'HEAD'].includes(incoming.method)) return send(new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' } }));
        return send(new Response(JSON.stringify({ status: 'ok' }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } }));
      }
      if (pathname === '/readyz') {
        if (!['GET', 'HEAD'].includes(incoming.method)) return send(new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' } }));
        const result = await readiness();
        return send(new Response(JSON.stringify(result), { status: result.status === 'ready' ? 200 : 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } }));
      }
      if (pathname === '/metrics') {
        if (!['GET', 'HEAD'].includes(incoming.method)) return send(new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' } }));
        const context = accessContext(request);
        const actor = await service.authorize(context, 'audit.read');
        return send(jsonResponse(metrics.snapshot(service, limiter, actor.tenantId), 200, request, options.allowedOrigins));
      }
      const asset = await assetDelivery?.response(request);
      if (asset) return send(asset);
      const assetListMatch = pathname.match(/^\/v1\/deployments\/([^/]+)\/assets$/);
      if (incoming.method === 'GET' && assetListMatch) {
        const deploymentId = decodeURIComponent(assetListMatch[1]);
        const { deployment } = await service.authorizeDeployment(accessContext(request), 'deployment.read', deploymentId);
        return send(jsonResponse(assetDelivery ? await assetDelivery.status(deployment) : assetRequirementsWithoutStore(deployment), 200, request, options.allowedOrigins));
      }
      if (incoming.method === 'PUT' && uploadMatch) {
        const deploymentId = decodeURIComponent(uploadMatch[1]);
        const assetId = decodeURIComponent(uploadMatch[2]);
        const context = accessContext(request);
        const { deployment } = await service.authorizeDeployment(context, 'deployment.asset.write', deploymentId);
        if (deployment.status !== 'queued') return send(jsonResponse({ error: { code: 'conflict', message: `Hosted deployment ${deploymentId} is ${deployment.status}` } }, 409, request, options.allowedOrigins));
        if (!assetDelivery) return send(jsonResponse({ error: { code: 'asset_storage_unavailable', message: 'Hosted asset storage is not configured' } }, 503, request, options.allowedOrigins));
        const uploaded = await assetDelivery.upload(deployment, assetId, await request.arrayBuffer(), request.headers.get('content-type'));
        if (uploaded.outcome === 'uploaded') await service.recordDeploymentAsset(deploymentId, uploaded, context);
        return send(jsonResponse(uploaded, uploaded.outcome === 'uploaded' ? 201 : 200, request, options.allowedOrigins));
      }
      if (incoming.method === 'POST' && pathname === '/v1/deployments/process-next') {
        const queued = await service.nextQueuedDeployment(accessContext(request));
        if (queued) {
          const requirements = assetDelivery ? await assetDelivery.status(queued) : assetRequirementsWithoutStore(queued);
          if (!requirements.ready) return send(jsonResponse({ error: { code: 'assets_incomplete', message: 'Hosted deployment workspace assets are incomplete', detail: requirements } }, 409, request, options.allowedOrigins));
        }
      }
      if (pathname.startsWith('/v1/')) return send(await hosted(request));
      const staticFile = await staticResponse(request, options.staticDirectory);
      return send(staticFile || new Response('Not found', { status: 404 }));
    } catch (error) {
      const normalized = hostedNodeError(error);
      const request = new Request(`${baseUrl || `http://${incoming.headers.host}`}${incoming.url}`, { headers: incoming.headers });
      return send(jsonResponse({ error: { code: normalized.code, message: normalized.message } }, normalized.status, request, options.allowedOrigins), incoming.method === 'HEAD', true);
    }
  });

  return {
    server,
    service,
    readiness,
    limiter,
    metrics,
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
