import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoreComponentRegistry, createProtocolGraph, createSequentialIdFactory, freezeProtocolGraph } from '../src/core/index.js';
import { createDeploymentBundle } from '../src/deployment/index.js';
import {
  createHostedHttpHandler,
  createPersistentHostedExecutionService,
  HostedExecutionClient,
  HostedHttpClient,
  HostedHttpError,
  HostedRuntimeSync,
  LocalHostedExecutionService,
  MemoryHostedStateStore,
} from '../src/hosted/index.js';
import { createRuntimeState, startRuntime } from '../src/runtime/index.js';

const actors = [
  { actorId: 'owner-http', role: 'owner', accessToken: 'owner-http-token' },
  { actorId: 'operator-http', role: 'operator', accessToken: 'operator-http-token' },
  { actorId: 'viewer-http', role: 'viewer', accessToken: 'viewer-http-token' },
];

async function fixture(deploymentOptions = {}) {
  const protocol = await freezeProtocolGraph(
    createProtocolGraph({ idFactory: createSequentialIdFactory(), now: '2026-08-23T00:00:00.000Z' }),
    createCoreComponentRegistry(),
    { now: '2026-08-23T01:00:00.000Z' },
  );
  return { protocol, bundle: await createDeploymentBundle(protocol, { bundleId: 'http_bundle', createdAt: '2026-08-23T02:00:00.000Z', ...deploymentOptions }) };
}

function serviceOptions() {
  let id = 0;
  return { actors, idFactory: prefix => `${prefix}_http_${++id}`, clock: () => '2026-08-23T03:00:00.000Z' };
}

test('Hosted HTTP API carries a complete Runtime V2 session with stable errors and bearer authorization', async () => {
  const { protocol, bundle } = await fixture();
  const service = new LocalHostedExecutionService(serviceOptions());
  const handler = createHostedHttpHandler(service);
  const transport = (input, init) => handler(new Request(input, init));
  const owner = new HostedHttpClient({ baseUrl: 'https://hosted.example', accessToken: 'owner-http-token', fetch: transport });
  const operator = new HostedHttpClient({ baseUrl: 'https://hosted.example', accessToken: 'operator-http-token', fetch: transport });
  const viewer = new HostedHttpClient({ baseUrl: 'https://hosted.example', accessToken: 'viewer-http-token', fetch: transport });
  const deployment = await owner.publish(bundle, { idempotencyKey: 'http-publish' });
  assert.equal((await handler(new Request('https://hosted.example/v1/audit'))).status, 401);
  assert.equal((await handler(new Request('https://hosted.example/v1/deployments', { method: 'POST', headers: { authorization: 'Bearer owner-http-token', 'content-type': 'application/json' }, body: '{' }))).status, 400);
  assert.equal(deployment.status, 'queued');
  assert.equal((await operator.processNextDeployment()).status, 'ready');
  const session = await operator.createSession(deployment.deploymentId, { idempotencyKey: 'http-session', participantId: 'P-HTTP' });
  const participant = new HostedHttpClient({ baseUrl: 'https://hosted.example', accessToken: session.participantAccessToken, fetch: transport });
  let eventId = 0;
  let tick = 0;
  const initial = createRuntimeState(protocol, { sessionId: session.sessionId, startedAtEpochMs: 1787454600000, startedAtMonotonicMs: 0 });
  const runtime = startRuntime(initial, protocol, createCoreComponentRegistry(), {
    idFactory: prefix => `${prefix}_http_${++eventId}`,
    clock: { now: () => ({ iso: '2026-08-23T03:10:00.000Z', epochMs: 1787454600000 + tick, monotonicMs: tick++ }) },
  });
  const sync = new HostedRuntimeSync({ client: participant, session });
  assert.equal((await sync.enqueue({ events: runtime.events, runtime: runtime.state })).outcome, 'completed');
  const stored = await owner.sessionData(session.sessionId);
  assert.equal(stored.session.status, 'completed');
  assert.deepEqual(stored.events, runtime.events);
  const exported = await owner.deploymentData(deployment.deploymentId);
  assert.equal(exported.schemaVersion, '1.0.0');
  assert.equal(exported.bundle.bundleHash, bundle.bundleHash);
  assert.deepEqual(exported.summary, { sessionCount: 1, eventCount: runtime.events.length, statusCounts: { completed: 1 } });
  assert.equal(exported.integrity.valid, true);
  assert.deepEqual(exported.sessions[0].events, runtime.events);
  assert.equal(exported.audit.every(entry => entry.resource.deploymentId === deployment.deploymentId || entry.resource.sessionId === session.sessionId), true);
  assert.equal(JSON.stringify(exported).includes(session.participantAccessToken), false);
  await assert.rejects(() => viewer.sessionData(session.sessionId), error => error instanceof HostedHttpError && error.status === 403 && error.code === 'forbidden');
  await assert.rejects(() => viewer.deploymentData(deployment.deploymentId), error => error instanceof HostedHttpError && error.status === 403 && error.code === 'forbidden');
  const missingAuth = new HostedHttpClient({ baseUrl: 'https://hosted.example', accessToken: 'invalid-token', fetch: transport });
  await assert.rejects(() => missingAuth.deployment(deployment.deploymentId), error => error.status === 403);
});

test('Hosted HTTP API grants CORS only to configured participant application origins', async () => {
  const service = new LocalHostedExecutionService(serviceOptions());
  const handler = createHostedHttpHandler(service, { allowedOrigins: ['https://experiments.example'] });
  const allowed = await handler(new Request('https://hosted.example/v1/launch-links/redeem', { method: 'OPTIONS', headers: { origin: 'https://experiments.example', 'access-control-request-method': 'POST' } }));
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://experiments.example');
  assert.match(allowed.headers.get('access-control-allow-headers'), /authorization/);
  const denied = await handler(new Request('https://hosted.example/v1/launch-links/redeem', { method: 'OPTIONS', headers: { origin: 'https://untrusted.example' } }));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('persistent hosted state restores deployments, scoped sessions and data after service restart', async () => {
  const { bundle } = await fixture();
  const store = new MemoryHostedStateStore();
  const firstService = await createPersistentHostedExecutionService({ ...serviceOptions(), store });
  const firstOwner = new HostedExecutionClient(firstService, 'owner-http-token');
  const firstOperator = new HostedExecutionClient(firstService, 'operator-http-token');
  const deployment = await firstOwner.publish(bundle, { idempotencyKey: 'persist-publish' });
  await firstOperator.processNextDeployment();
  const session = await firstOperator.createSession(deployment.deploymentId, { idempotencyKey: 'persist-session', participantId: 'P-PERSIST' });
  const serialized = JSON.parse(JSON.stringify(await store.load()));
  assert.equal(serialized.deployments.length, 1);
  assert.equal(serialized.sessions.length, 1);

  const restartedService = await createPersistentHostedExecutionService({ ...serviceOptions(), store: new MemoryHostedStateStore(serialized) });
  const restartedOwner = new HostedExecutionClient(restartedService, 'owner-http-token');
  const restartedParticipant = new HostedExecutionClient(restartedService, session.participantAccessToken);
  assert.equal((await restartedOwner.deployment(deployment.deploymentId)).status, 'ready');
  assert.equal((await restartedOwner.publish(bundle, { idempotencyKey: 'persist-publish' })).deploymentId, deployment.deploymentId);
  assert.equal((await restartedParticipant.session(session.sessionId)).participantId, 'P-PERSIST');
  assert.equal((await restartedOwner.audit()).length, 3);
  const invalid = structuredClone(serialized);
  invalid.sessions[0].deploymentId = 'missing-deployment';
  await assert.rejects(() => createPersistentHostedExecutionService({ ...serviceOptions(), store: new MemoryHostedStateStore(invalid) }), /unknown deployment/);
  const legacy = structuredClone(serialized);
  legacy.schemaVersion = '1.0.0';
  delete legacy.launchLinks;
  delete legacy.launchTokens;
  const migratedLegacy = await createPersistentHostedExecutionService({ ...serviceOptions(), store: new MemoryHostedStateStore(legacy) });
  assert.equal((await new HostedExecutionClient(migratedLegacy, 'owner-http-token').deployment(deployment.deploymentId)).status, 'ready');
});

test('public launch token survives persistence and enforces anonymous redemption and deployment shutdown over HTTP', async () => {
  const { bundle } = await fixture({ maximumSessions: 1, expiresAt: '2026-08-24T00:00:00.000Z' });
  const store = new MemoryHostedStateStore();
  const firstService = await createPersistentHostedExecutionService({ ...serviceOptions(), store });
  const firstTransport = (input, init) => createHostedHttpHandler(firstService)(new Request(input, init));
  const owner = new HostedHttpClient({ baseUrl: 'https://hosted.example', accessToken: 'owner-http-token', fetch: firstTransport });
  const operator = new HostedHttpClient({ baseUrl: 'https://hosted.example', accessToken: 'operator-http-token', fetch: firstTransport });
  const deployment = await owner.publish(bundle, { idempotencyKey: 'public-publish' });
  await operator.processNextDeployment();
  const link = await operator.createLaunchLink(deployment.deploymentId, { idempotencyKey: 'public-link', maximumUses: 1, expiresAt: '2026-08-23T23:00:00.000Z' });

  const restarted = await createPersistentHostedExecutionService({ ...serviceOptions(), store });
  const secondTransport = (input, init) => createHostedHttpHandler(restarted)(new Request(input, init));
  const anonymous = new HostedHttpClient({ baseUrl: 'https://hosted.example', fetch: secondTransport });
  const restartedOwner = new HostedHttpClient({ baseUrl: 'https://hosted.example', accessToken: 'owner-http-token', fetch: secondTransport });
  const restartedOperator = new HostedHttpClient({ baseUrl: 'https://hosted.example', accessToken: 'operator-http-token', fetch: secondTransport });
  const redeemed = await anonymous.redeemLaunchLink(link.launchToken, { idempotencyKey: 'public-redeem', participantId: 'PUBLIC-HTTP' });
  assert.equal(redeemed.session.participantId, 'PUBLIC-HTTP');
  assert.equal((await anonymous.redeemLaunchLink(link.launchToken, { idempotencyKey: 'public-redeem', participantId: 'PUBLIC-HTTP' })).session.sessionId, redeemed.session.sessionId);
  await assert.rejects(() => anonymous.redeemLaunchLink(link.launchToken, { idempotencyKey: 'public-redeem-2' }), error => error.status === 409 && error.code === 'conflict');
  const current = await restartedOperator.deployment(deployment.deploymentId);
  assert.equal((await restartedOperator.deactivateDeployment(deployment.deploymentId, { idempotencyKey: 'public-stop', expectedRevision: current.revision })).status, 'deactivated');
  const saved = await store.load();
  assert.equal(saved.launchLinks[0].useCount, 1);
  assert.equal(saved.sessions.length, 1);
  const exported = await restartedOwner.deploymentData(deployment.deploymentId);
  assert.equal(exported.launchLinks[0].launchLinkId, link.launchLinkId);
  assert.equal(JSON.stringify(exported).includes(link.launchToken), false);
  assert.equal(JSON.stringify(exported).includes(redeemed.session.participantAccessToken), false);
});
