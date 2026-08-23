import { HOSTED_SERVICE_CONTRACT_VERSION } from './hostedService.js';

export const HOSTED_HTTP_API_VERSION = 'v1';

export class HostedHttpError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'HostedHttpError';
    this.status = options.status || 0;
    this.code = options.code || 'hosted_http_error';
  }
}

function authorizationToken(request) {
  const value = request.headers.get('authorization') || '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new HostedHttpError('Bearer access token is required', { status: 401, code: 'unauthorized' });
  return match[1];
}

async function readJson(request, maximumBytes) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maximumBytes) throw new HostedHttpError('Hosted request body is too large', { status: 413, code: 'payload_too_large' });
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maximumBytes) throw new HostedHttpError('Hosted request body is too large', { status: 413, code: 'payload_too_large' });
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { throw new HostedHttpError('Hosted request body must be valid JSON', { status: 400, code: 'invalid_json' }); }
}

function json(value, status = 200) {
  return new globalThis.Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-physioflow-hosted-contract': HOSTED_SERVICE_CONTRACT_VERSION,
    },
  });
}

function errorResponse(error) {
  if (error instanceof HostedHttpError) return json({ error: { code: error.code, message: error.message } }, error.status);
  const message = error?.message || String(error);
  if (/permission .* required/i.test(message)) return json({ error: { code: 'forbidden', message } }, 403);
  if (/^Unknown hosted/i.test(message)) return json({ error: { code: 'not_found', message } }, 404);
  if (/conflict|already used with different|already registered|expired|deactivated|quota|exhausted|not ready/i.test(message)) return json({ error: { code: 'conflict', message } }, 409);
  if (/requires|required|invalid|does not match|unsupported|not ready|incomplete|backwards|must be/i.test(message)) return json({ error: { code: 'invalid_request', message } }, 400);
  return json({ error: { code: 'internal_error', message: 'Hosted service request failed' } }, 500);
}

function allowedCorsOrigin(request, allowedOrigins) {
  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins) return null;
  if (allowedOrigins === '*') return '*';
  if (typeof allowedOrigins === 'function') return allowedOrigins(origin) ? origin : null;
  const values = Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins];
  return values.includes(origin) ? origin : null;
}

function withCors(response, origin) {
  if (!origin) return response;
  const headers = new globalThis.Headers(response.headers);
  headers.set('access-control-allow-origin', origin);
  headers.set('access-control-allow-methods', 'GET, POST, PUT, OPTIONS');
  headers.set('access-control-allow-headers', 'authorization, content-type, idempotency-key');
  headers.set('access-control-max-age', '600');
  if (origin !== '*') headers.append('vary', 'Origin');
  return new globalThis.Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function createHostedHttpHandler(service, options = {}) {
  if (!service) throw new Error('Hosted HTTP handler requires a service');
  const maximumBytes = options.maximumBodyBytes || 10 * 1024 * 1024;
  const handle = async request => {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/$/, '') || '/';
      if (!path.startsWith(`/${HOSTED_HTTP_API_VERSION}/`)) throw new HostedHttpError('Hosted API route not found', { status: 404, code: 'not_found' });
      const method = request.method.toUpperCase();
      if (method === 'POST' && path === '/v1/launch-links/redeem') {
        const body = await readJson(request, maximumBytes);
        const idempotencyKey = request.headers.get('idempotency-key') || body.idempotencyKey;
        return json(await service.redeemLaunchLink(body.launchToken, { ...body, idempotencyKey }), 201);
      }
      const context = { accessToken: authorizationToken(request) };
      if (method === 'POST' && path === '/v1/deployments') {
        const body = await readJson(request, maximumBytes);
        const idempotencyKey = request.headers.get('idempotency-key') || body.options?.idempotencyKey;
        return json(await service.publishDeployment(body.bundle, { ...(body.options || {}), idempotencyKey }, context), 201);
      }
      if (method === 'POST' && path === '/v1/deployments/process-next') return json(await service.processNextDeployment(context));
      if (method === 'GET' && path === '/v1/audit') return json(await service.readAudit(context));
      let match = path.match(/^\/v1\/deployments\/([^/]+)$/);
      if (method === 'GET' && match) return json(await service.getDeployment(decodeURIComponent(match[1]), context));
      match = path.match(/^\/v1\/deployments\/([^/]+)\/data$/);
      if (method === 'GET' && match) return json(await service.readDeploymentData(decodeURIComponent(match[1]), context));
      match = path.match(/^\/v1\/deployments\/([^/]+)\/deactivate$/);
      if (method === 'POST' && match) {
        const body = await readJson(request, maximumBytes);
        const idempotencyKey = request.headers.get('idempotency-key') || body.idempotencyKey;
        return json(await service.deactivateDeployment(decodeURIComponent(match[1]), { ...body, idempotencyKey }, context));
      }
      match = path.match(/^\/v1\/deployments\/([^/]+)\/launch-links$/);
      if (method === 'POST' && match) {
        const body = await readJson(request, maximumBytes);
        const idempotencyKey = request.headers.get('idempotency-key') || body.idempotencyKey;
        return json(await service.createLaunchLink(decodeURIComponent(match[1]), { ...body, idempotencyKey }, context), 201);
      }
      match = path.match(/^\/v1\/deployments\/([^/]+)\/sessions$/);
      if (method === 'POST' && match) {
        const body = await readJson(request, maximumBytes);
        const idempotencyKey = request.headers.get('idempotency-key') || body.idempotencyKey;
        return json(await service.createSession(decodeURIComponent(match[1]), { ...body, idempotencyKey }, context), 201);
      }
      match = path.match(/^\/v1\/sessions\/([^/]+)$/);
      if (method === 'GET' && match) return json(await service.getSession(decodeURIComponent(match[1]), context));
      match = path.match(/^\/v1\/sessions\/([^/]+)\/bootstrap$/);
      if (method === 'GET' && match) return json(await service.getParticipantBootstrap(decodeURIComponent(match[1]), context));
      match = path.match(/^\/v1\/sessions\/([^/]+)\/events$/);
      if (method === 'POST' && match) {
        const body = await readJson(request, maximumBytes);
        return json(await service.appendEvents(decodeURIComponent(match[1]), body.events, body.options, context));
      }
      match = path.match(/^\/v1\/sessions\/([^/]+)\/state$/);
      if (method === 'PUT' && match) {
        const body = await readJson(request, maximumBytes);
        return json(await service.syncSessionState(decodeURIComponent(match[1]), body.state, body.options, context));
      }
      match = path.match(/^\/v1\/sessions\/([^/]+)\/complete$/);
      if (method === 'POST' && match) {
        const body = await readJson(request, maximumBytes);
        return json(await service.completeSession(decodeURIComponent(match[1]), body.options, context));
      }
      match = path.match(/^\/v1\/sessions\/([^/]+)\/data$/);
      if (method === 'GET' && match) return json(await service.readSessionData(decodeURIComponent(match[1]), context));
      match = path.match(/^\/v1\/launch-links\/([^/]+)\/revoke$/);
      if (method === 'POST' && match) {
        const body = await readJson(request, maximumBytes);
        const idempotencyKey = request.headers.get('idempotency-key') || body.idempotencyKey;
        return json(await service.revokeLaunchLink(decodeURIComponent(match[1]), { ...body, idempotencyKey }, context));
      }
      throw new HostedHttpError('Hosted API route not found', { status: 404, code: 'not_found' });
    } catch (error) {
      return errorResponse(error);
    }
  };
  return async request => {
    const corsOrigin = allowedCorsOrigin(request, options.allowedOrigins);
    if (request.method.toUpperCase() === 'OPTIONS') {
      if (request.headers.get('origin') && !corsOrigin) return errorResponse(new HostedHttpError('Hosted API origin is not allowed', { status: 403, code: 'forbidden_origin' }));
      return withCors(new globalThis.Response(null, { status: 204, headers: { 'cache-control': 'no-store' } }), corsOrigin);
    }
    return withCors(await handle(request), corsOrigin);
  };
}

export class HostedHttpClient {
  constructor(options = {}) {
    if (!options.baseUrl) throw new Error('Hosted HTTP client requires a base URL');
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.accessToken = options.accessToken;
    const transport = options.fetch || globalThis.fetch?.bind(globalThis);
    this.fetch = transport ? (...args) => transport(...args) : null;
    this.timeoutMs = options.timeoutMs || 15000;
    if (!this.fetch) throw new Error('Hosted HTTP client requires fetch');
  }

  async request(method, path, body, options = {}) {
    const controller = new globalThis.AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(`${this.baseUrl}/${HOSTED_HTTP_API_VERSION}${path}`, {
        method,
        headers: {
          ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new HostedHttpError(payload.error?.message || `Hosted request failed with status ${response.status}`, { status: response.status, code: payload.error?.code });
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') throw new HostedHttpError('Hosted request timed out', { status: 0, code: 'timeout' });
      throw error;
    } finally { clearTimeout(timeout); }
  }

  publish(bundle, options = {}) { return this.request('POST', '/deployments', { bundle, options }, options); }
  deployment(id) { return this.request('GET', `/deployments/${encodeURIComponent(id)}`); }
  deploymentData(id) { return this.request('GET', `/deployments/${encodeURIComponent(id)}/data`); }
  processNextDeployment() { return this.request('POST', '/deployments/process-next'); }
  createSession(id, request = {}) { return this.request('POST', `/deployments/${encodeURIComponent(id)}/sessions`, request, request); }
  deploymentAssets(id) { return this.request('GET', `/deployments/${encodeURIComponent(id)}/assets`); }
  async uploadDeploymentAsset(id, assetId, content, options = {}) {
    if (content === undefined || content === null) throw new Error('Hosted asset upload requires content');
    const controller = new globalThis.AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || this.timeoutMs);
    try {
      const response = await this.fetch(`${this.baseUrl}/${HOSTED_HTTP_API_VERSION}/deployments/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetId)}`, {
        method: 'PUT',
        headers: { ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}), accept: 'application/json', 'content-type': options.mediaType || 'application/octet-stream' },
        body: content,
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new HostedHttpError(payload.error?.message || `Hosted asset upload failed with status ${response.status}`, { status: response.status, code: payload.error?.code });
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') throw new HostedHttpError('Hosted asset upload timed out', { status: 0, code: 'timeout' });
      throw error;
    } finally { clearTimeout(timeout); }
  }
  deactivateDeployment(id, request = {}) { return this.request('POST', `/deployments/${encodeURIComponent(id)}/deactivate`, request, request); }
  createLaunchLink(id, request = {}) { return this.request('POST', `/deployments/${encodeURIComponent(id)}/launch-links`, request, request); }
  revokeLaunchLink(id, request = {}) { return this.request('POST', `/launch-links/${encodeURIComponent(id)}/revoke`, request, request); }
  redeemLaunchLink(launchToken, request = {}) { return this.request('POST', '/launch-links/redeem', { ...request, launchToken }, request); }
  session(id) { return this.request('GET', `/sessions/${encodeURIComponent(id)}`); }
  bootstrap(id) { return this.request('GET', `/sessions/${encodeURIComponent(id)}/bootstrap`); }
  appendEvents(id, events, options) { return this.request('POST', `/sessions/${encodeURIComponent(id)}/events`, { events, options }); }
  syncState(id, state, options) { return this.request('PUT', `/sessions/${encodeURIComponent(id)}/state`, { state, options }); }
  completeSession(id, options) { return this.request('POST', `/sessions/${encodeURIComponent(id)}/complete`, { options }); }
  sessionData(id) { return this.request('GET', `/sessions/${encodeURIComponent(id)}/data`); }
  audit() { return this.request('GET', '/audit'); }
}
