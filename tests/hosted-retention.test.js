import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoreComponentRegistry, createProtocolGraph, createSequentialIdFactory, freezeProtocolGraph } from '../src/core/index.js';
import { createDeploymentBundle } from '../src/deployment/index.js';
import { createHostedHttpHandler, createPersistentHostedExecutionService, HostedHttpClient, HostedHttpError, MemoryHostedStateStore } from '../src/hosted/index.js';

const actors = [
  { actorId: 'retention-owner', role: 'owner', accessToken: 'retention-owner-token' },
  { actorId: 'retention-operator', role: 'operator', accessToken: 'retention-operator-token' },
  { actorId: 'retention-analyst', role: 'analyst', accessToken: 'retention-analyst-token' },
  { actorId: 'retention-viewer', role: 'viewer', accessToken: 'retention-viewer-token' },
];

async function retentionBundle() {
  const protocol = await freezeProtocolGraph(
    createProtocolGraph({ idFactory: createSequentialIdFactory(), now: '2026-01-01T00:00:00.000Z' }),
    createCoreComponentRegistry(),
    { now: '2026-01-01T01:00:00.000Z' },
  );
  const bundle = await createDeploymentBundle(protocol, {
    bundleId: 'retention_bundle',
    createdAt: '2026-01-01T02:00:00.000Z',
    dataRetentionDays: 30,
  });
  return { protocol, bundle };
}

test('hosted retention requires an owner plan and irreversibly pseudonymizes all live-state copies', async () => {
  const { bundle } = await retentionBundle();
  const store = new MemoryHostedStateStore();
  let now = '2026-01-02T00:00:00.000Z';
  let id = 0;
  const serviceOptions = { actors, store, clock: () => now, idFactory: prefix => `${prefix}_retention_${++id}` };
  const service = await createPersistentHostedExecutionService(serviceOptions);
  const handler = createHostedHttpHandler(service);
  const fetch = (input, init) => handler(new Request(input, init));
  const client = token => new HostedHttpClient({ baseUrl: 'https://retention.example', accessToken: token, fetch });
  const owner = client('retention-owner-token');
  const operator = client('retention-operator-token');
  const analyst = client('retention-analyst-token');
  const viewer = client('retention-viewer-token');

  const deployment = await owner.publish(bundle, { idempotencyKey: 'retention-publish' });
  await operator.processNextDeployment();
  const session = await operator.createSession(deployment.deploymentId, { idempotencyKey: 'retention-session', participantId: 'PARTICIPANT-TO-PURGE' });
  const participant = client(session.participantAccessToken);
  const event = {
    schemaVersion: '1.0.0', eventId: 'EVENT-TO-PURGE', eventType: 'response.submitted', sequence: 1,
    sessionId: session.sessionId, protocolId: session.protocolId, protocolVersion: session.protocolVersion,
    timestamp: now, timestampEpochMs: Date.parse(now), elapsedMonotonicMs: 1,
    payload: { secretAnswer: 'PAYLOAD-TO-PURGE' },
  };
  const receipt = await participant.appendEvents(session.sessionId, [event], { batchId: 'retention-events', expectedRevision: session.revision });
  const snapshot = {
    sessionId: session.sessionId, protocolId: session.protocolId, protocolVersion: session.protocolVersion,
    eventSequence: 1, status: 'running', variables: { secret: 'SNAPSHOT-TO-PURGE' },
  };
  const synced = await participant.syncState(session.sessionId, snapshot, { syncId: 'retention-state', expectedRevision: receipt.revision });
  await participant.completeSession(session.sessionId, { completionId: 'retention-complete', expectedRevision: synced.revision });

  const early = await owner.retentionPlan(deployment.deploymentId, { asOf: '2026-01-31T23:59:59.999Z' });
  assert.equal(early.enabled, true);
  assert.equal(early.eligibleSessions.length, 0);
  now = '2026-02-02T00:00:00.000Z';
  const plan = await owner.retentionPlan(deployment.deploymentId, { asOf: now });
  assert.deepEqual(plan.eligibleSessions.map(item => item.sessionId), [session.sessionId]);
  assert.equal(JSON.stringify(plan).includes('PARTICIPANT-TO-PURGE'), false);
  await assert.rejects(() => operator.retentionPlan(deployment.deploymentId, { asOf: now }), error => error instanceof HostedHttpError && error.status === 403);
  await assert.rejects(() => analyst.retentionPlan(deployment.deploymentId, { asOf: now }), error => error instanceof HostedHttpError && error.status === 403);
  await assert.rejects(() => viewer.retentionPlan(deployment.deploymentId, { asOf: now }), error => error instanceof HostedHttpError && error.status === 403);
  await assert.rejects(
    () => owner.purgeExpiredData(deployment.deploymentId, { asOf: now, confirmationCode: 'wrong', idempotencyKey: 'retention-purge' }),
    error => error instanceof HostedHttpError && error.status === 409,
  );

  const purgeRequest = { asOf: now, confirmationCode: plan.confirmationCode, idempotencyKey: 'retention-purge' };
  const purged = await owner.purgeExpiredData(deployment.deploymentId, purgeRequest);
  assert.deepEqual(purged.purgedSessions, [session.sessionId]);
  assert.equal(purged.purgedEventCount, 1);
  assert.deepEqual(await owner.purgeExpiredData(deployment.deploymentId, purgeRequest), purged);

  const purgedCreationRetry = await operator.createSession(deployment.deploymentId, { idempotencyKey: 'retention-session', participantId: 'PARTICIPANT-TO-PURGE' });
  assert.equal(purgedCreationRetry.sessionId, session.sessionId);
  assert.equal(purgedCreationRetry.participantId, null);
  assert.equal(purgedCreationRetry.participantAccessToken, null);

  const exported = await owner.deploymentData(deployment.deploymentId);
  assert.deepEqual(exported.summary, { sessionCount: 1, eventCount: 0, purgedSessionCount: 1, purgedEventCount: 1, statusCounts: { completed: 1 } });
  assert.equal(exported.integrity.valid, true);
  assert.equal(exported.sessions[0].session.participantId, null);
  assert.equal(exported.sessions[0].session.dataPurgedAt, now);
  assert.equal(exported.sessions[0].session.purgedRuntimeSnapshot, true);
  assert.deepEqual(exported.sessions[0].events, []);
  assert.equal(exported.sessions[0].runtimeSnapshot, null);
  assert.deepEqual(exported.audit.map(entry => entry.sequence), exported.audit.map((_, index) => index + 1));
  assert.equal(exported.audit.at(-1).action, 'session.data_purged');
  assert.equal(exported.audit.some(entry => entry.actor.kind === 'participant' && entry.actor.id !== null), false);

  const persistedJson = JSON.stringify(await store.load());
  for (const secret of [session.participantAccessToken, 'PARTICIPANT-TO-PURGE', 'EVENT-TO-PURGE', 'PAYLOAD-TO-PURGE', 'SNAPSHOT-TO-PURGE']) {
    assert.equal(persistedJson.includes(secret), false, `purged state retained ${secret}`);
  }
  await assert.rejects(() => participant.session(session.sessionId), error => error instanceof HostedHttpError && error.status === 403);

  const restarted = await createPersistentHostedExecutionService({ ...serviceOptions, store });
  const restored = await restarted.readSessionData(session.sessionId, { accessToken: 'retention-owner-token' });
  assert.equal(restored.session.dataPurgedAt, now);
  assert.equal(restored.session.participantId, null);
  assert.deepEqual(restored.events, []);
  assert.equal(restored.runtimeSnapshot, null);
});

test('hosted retention stays disabled when a deployment declares no policy', async () => {
  const protocol = await freezeProtocolGraph(createProtocolGraph(), createCoreComponentRegistry());
  const bundle = await createDeploymentBundle(protocol, { bundleId: 'no_retention_bundle' });
  const service = await createPersistentHostedExecutionService({
    actors,
    store: new MemoryHostedStateStore(),
    clock: () => '2026-02-02T00:00:00.000Z',
    idFactory: prefix => `${prefix}_no_retention`,
  });
  const deployment = await service.publishDeployment(bundle, { idempotencyKey: 'no-retention-publish' }, { accessToken: 'retention-owner-token' });
  const plan = await service.planDataRetention(deployment.deploymentId, {}, { accessToken: 'retention-owner-token' });
  assert.equal(plan.enabled, false);
  assert.equal(plan.confirmationCode, null);
});
