import assert from 'node:assert/strict';
import test from 'node:test';
import { HostedOperationalMetrics, HostedRequestRateLimiter, normalizeRateLimits, requestRateScope, requestSourceAddress } from '../server/requestProtection.mjs';

test('hosted request limiter enforces independent fixed windows with bounded keys', () => {
  let now = 1_000;
  const limiter = new HostedRequestRateLimiter({ limits: { windowMs: 1_000, maxEntries: 2, publicRedemption: 2, api: 1, assetUpload: 1, assetDownload: 1 }, clock: () => now, salt: Buffer.alloc(32, 1) });
  assert.equal(limiter.consume('publicRedemption', 'source-a').allowed, true);
  assert.equal(limiter.consume('publicRedemption', 'source-a').remaining, 0);
  const denied = limiter.consume('publicRedemption', 'source-a');
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 1);
  assert.equal(limiter.consume('api', 'source-a').allowed, true);
  assert.equal(limiter.consume('api', 'source-b').allowed, true);
  assert.equal(limiter.snapshot().trackedKeys, 2);
  now = 2_001;
  assert.equal(limiter.consume('publicRedemption', 'source-a').allowed, true);
  assert.equal(limiter.snapshot().trackedKeys <= 2, true);
  assert.equal(new HostedRequestRateLimiter({ limits: false }).consume('api', 'source').allowed, true);
  assert.throws(() => normalizeRateLimits({ api: 0 }), /positive integer/);
});

test('hosted source address ignores forwarding by default and honors only configured proxy hops', () => {
  const request = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '198.51.100.10, 192.0.2.5' } };
  assert.equal(requestSourceAddress(request), '127.0.0.1');
  assert.equal(requestSourceAddress(request, 1), '192.0.2.5');
  assert.equal(requestSourceAddress(request, 2), '198.51.100.10');
  assert.equal(requestSourceAddress({ ...request, headers: { 'x-forwarded-for': 'not-an-address' } }, 1), '127.0.0.1');
  assert.equal(requestRateScope('/healthz', 'GET'), null);
  assert.equal(requestRateScope('/v1/launch-links/redeem', 'POST'), 'publicRedemption');
  assert.equal(requestRateScope('/v1/deployments/id/assets/asset', 'PUT'), 'assetUpload');
  assert.equal(requestRateScope('/assets/bundle/asset', 'GET'), 'assetDownload');
});

test('hosted operational metrics expose aggregates without record identities', () => {
  let now = 5_000;
  const metrics = new HostedOperationalMetrics({ clock: () => now });
  metrics.record(200);
  metrics.record(403, true);
  now = 8_500;
  const service = {
    deployments: new Map([['secret-deployment-id', { status: 'ready' }]]),
    sessions: new Map([['secret-session-id', { status: 'completed', eventCount: 4 }]]),
  };
  const snapshot = metrics.snapshot(service, new HostedRequestRateLimiter({ limits: false }));
  assert.equal(snapshot.uptimeSeconds, 3);
  assert.deepEqual(snapshot.resources, { deployments: 1, deploymentStatuses: { ready: 1 }, sessions: 1, sessionStatuses: { completed: 1 }, events: 4 });
  assert.equal(JSON.stringify(snapshot).includes('secret-deployment-id'), false);
  assert.equal(JSON.stringify(snapshot).includes('secret-session-id'), false);
});
