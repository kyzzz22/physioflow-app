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

async function fixture() {
  const protocol = await freezeProtocolGraph(
    createProtocolGraph({ idFactory: createSequentialIdFactory(), now: '2026-08-23T00:00:00.000Z' }),
    createCoreComponentRegistry(),
    { now: '2026-08-23T01:00:00.000Z' },
  );
  return { protocol, bundle: await createDeploymentBundle(protocol, { bundleId: 'http_bundle', createdAt: '2026-08-23T02:00:00.000Z' }) };
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
  await assert.rejects(() => viewer.sessionData(session.sessionId), error => error instanceof HostedHttpError && error.status === 403 && error.code === 'forbidden');
  const missingAuth = new HostedHttpClient({ baseUrl: 'https://hosted.example', accessToken: 'invalid-token', fetch: transport });
  await assert.rejects(() => missingAuth.deployment(deployment.deploymentId), error => error.status === 403);
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
});
