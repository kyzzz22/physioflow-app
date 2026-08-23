import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';

export const HOSTED_METRICS_SCHEMA_VERSION = '1.0.0';

export const DEFAULT_HOSTED_RATE_LIMITS = Object.freeze({
  windowMs: 60_000,
  maxEntries: 10_000,
  publicRedemption: 60,
  api: 600,
  assetUpload: 30,
  assetDownload: 600,
});

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`Hosted rate limit ${name} must be a positive integer`);
  return value;
}

export function normalizeRateLimits(value = {}) {
  if (value === false) return null;
  const merged = { ...DEFAULT_HOSTED_RATE_LIMITS, ...(value || {}) };
  for (const key of Object.keys(DEFAULT_HOSTED_RATE_LIMITS)) positiveInteger(merged[key], key);
  return Object.freeze(merged);
}

export function requestRateScope(pathname, method = 'GET') {
  if (method === 'OPTIONS' || ['/healthz', '/readyz'].includes(pathname)) return null;
  if (pathname === '/v1/launch-links/redeem') return 'publicRedemption';
  if (/^\/v1\/deployments\/[^/]+\/assets\/[^/]+$/.test(pathname) && method === 'PUT') return 'assetUpload';
  if (pathname.startsWith('/assets/')) return 'assetDownload';
  if (pathname.startsWith('/v1/') || pathname === '/metrics') return 'api';
  return null;
}

function normalizedAddress(value) {
  const address = String(value || '').trim().replace(/^\[|\]$/g, '');
  return isIP(address) ? address : null;
}

export function requestSourceAddress(incoming, trustedProxyHops = 0) {
  if (!Number.isInteger(trustedProxyHops) || trustedProxyHops < 0) throw new Error('Hosted trusted proxy hops must be a non-negative integer');
  const direct = normalizedAddress(incoming?.socket?.remoteAddress) || 'unknown';
  if (!trustedProxyHops) return direct;
  const forwarded = String(incoming?.headers?.['x-forwarded-for'] || '').split(',').map(normalizedAddress);
  if (forwarded.some(address => !address)) return direct;
  const chain = [...forwarded, direct];
  return chain.length > trustedProxyHops ? chain[chain.length - trustedProxyHops - 1] : direct;
}

export class HostedRequestRateLimiter {
  constructor(options = {}) {
    this.config = normalizeRateLimits(options.limits === undefined ? options : options.limits);
    this.clock = options.clock || (() => Date.now());
    this.salt = options.salt || randomBytes(32);
    this.entries = new Map();
    this.rateLimitedTotal = 0;
  }

  key(scope, source) { return `${scope}:${createHash('sha256').update(this.salt).update(String(source)).digest('hex')}`; }

  prune(now) {
    for (const [key, entry] of this.entries) if (entry.resetAt <= now) this.entries.delete(key);
    while (this.entries.size >= this.config.maxEntries) this.entries.delete(this.entries.keys().next().value);
  }

  consume(scope, source) {
    if (!this.config || !scope) return { allowed: true, limit: null, remaining: null, resetAt: null, retryAfterSeconds: null };
    const now = this.clock();
    const limit = this.config[scope];
    if (!limit) throw new Error(`Unsupported hosted rate-limit scope ${scope}`);
    const key = this.key(scope, source);
    let entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      if (!entry) this.prune(now);
      entry = { count: 0, resetAt: now + this.config.windowMs };
      this.entries.set(key, entry);
    }
    if (entry.count >= limit) {
      this.rateLimitedTotal += 1;
      return { allowed: false, limit, remaining: 0, resetAt: entry.resetAt, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
    }
    entry.count += 1;
    return { allowed: true, limit, remaining: limit - entry.count, resetAt: entry.resetAt, retryAfterSeconds: null };
  }

  snapshot() { return { enabled: Boolean(this.config), trackedKeys: this.entries.size, rateLimitedTotal: this.rateLimitedTotal, maxEntries: this.config?.maxEntries || 0 }; }
}

export class HostedOperationalMetrics {
  constructor(options = {}) {
    this.clock = options.clock || (() => Date.now());
    this.startedAt = this.clock();
    this.requestsTotal = 0;
    this.responsesByStatus = {};
    this.errorsTotal = 0;
  }

  record(status, error = false) {
    this.requestsTotal += 1;
    this.responsesByStatus[status] = (this.responsesByStatus[status] || 0) + 1;
    if (error) this.errorsTotal += 1;
  }

  snapshot(service, limiter) {
    const deployments = [...service.deployments.values()];
    const sessions = [...service.sessions.values()];
    const deploymentStatuses = {};
    const sessionStatuses = {};
    for (const item of deployments) deploymentStatuses[item.status] = (deploymentStatuses[item.status] || 0) + 1;
    for (const item of sessions) sessionStatuses[item.status] = (sessionStatuses[item.status] || 0) + 1;
    return {
      schemaVersion: HOSTED_METRICS_SCHEMA_VERSION,
      uptimeSeconds: Math.max(0, Math.floor((this.clock() - this.startedAt) / 1000)),
      requests: { total: this.requestsTotal, errors: this.errorsTotal, responsesByStatus: { ...this.responsesByStatus }, rateLimited: limiter?.rateLimitedTotal || 0 },
      resources: { deployments: deployments.length, deploymentStatuses, sessions: sessions.length, sessionStatuses, events: sessions.reduce((total, session) => total + session.eventCount, 0) },
      limiter: limiter?.snapshot() || { enabled: false, trackedKeys: 0, rateLimitedTotal: 0, maxEntries: 0 },
    };
  }
}
