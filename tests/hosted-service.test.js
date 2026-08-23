import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoreComponentRegistry, createProtocolGraph, createSequentialIdFactory, freezeProtocolGraph } from '../src/core/index.js';
import { createDeploymentBundle } from '../src/deployment/index.js';
import { HostedExecutionClient, LocalHostedExecutionService } from '../src/hosted/index.js';

async function fixture() {
  const protocol = await freezeProtocolGraph(
    createProtocolGraph({ idFactory: createSequentialIdFactory(), now: '2026-08-23T00:00:00.000Z' }),
    createCoreComponentRegistry(),
    { now: '2026-08-23T01:00:00.000Z' },
  );
  return { protocol, bundle: await createDeploymentBundle(protocol, { bundleId: 'hosted_bundle', createdAt: '2026-08-23T02:00:00.000Z' }) };
}

function createService() {
  let id = 0;
  let second = 0;
  return new LocalHostedExecutionService({
    actors: [
      { actorId: 'owner-1', role: 'owner', accessToken: 'owner-token' },
      { actorId: 'operator-1', role: 'operator', accessToken: 'operator-token' },
      { actorId: 'viewer-1', role: 'viewer', accessToken: 'viewer-token' },
    ],
    idFactory: prefix => `${prefix}_${++id}`,
    clock: () => `2026-08-23T03:00:${String(second++).padStart(2, '0')}.000Z`,
  });
}

function event(session, sequence, eventId = `event_${sequence}`) {
  return {
    schemaVersion: '1.0.0',
    eventId,
    sequence,
    sessionId: session.sessionId,
    protocolId: session.protocolId,
    protocolVersion: session.protocolVersion,
    nodeId: null,
    componentType: null,
    componentVersion: null,
    eventType: sequence === 1 ? 'protocol_started' : 'component_entered',
    timestampIso: '2026-08-23T03:10:00.000Z',
    timestampEpochMs: 1787454600000 + sequence,
    elapsedMonotonicMs: sequence,
    payload: {},
  };
}

test('hosted service enforces roles, queues deployments and honors publish idempotency', async () => {
  const { bundle } = await fixture();
  const service = createService();
  const owner = new HostedExecutionClient(service, 'owner-token');
  const operator = new HostedExecutionClient(service, 'operator-token');
  const viewer = new HostedExecutionClient(service, 'viewer-token');
  const published = await owner.publish(bundle, { idempotencyKey: 'publish-1' });
  const repeated = await owner.publish(bundle, { idempotencyKey: 'publish-1' });
  assert.deepEqual(repeated, published);
  assert.equal(published.status, 'queued');
  await assert.rejects(() => viewer.publish(bundle, { idempotencyKey: 'forbidden' }), /deployment.publish/);
  assert.equal(operator.processNextDeployment().status, 'ready');
  assert.equal(viewer.deployment(published.deploymentId).status, 'ready');
});

test('hosted participant sessions ingest contiguous idempotent batches with revision control', async () => {
  const { bundle } = await fixture();
  const service = createService();
  const owner = new HostedExecutionClient(service, 'owner-token');
  const operator = new HostedExecutionClient(service, 'operator-token');
  const viewer = new HostedExecutionClient(service, 'viewer-token');
  const deployment = await owner.publish(bundle, { idempotencyKey: 'publish-2' });
  operator.processNextDeployment();
  const created = await operator.createSession(deployment.deploymentId, { idempotencyKey: 'session-1', participantId: 'P001' });
  const participant = new HostedExecutionClient(service, created.participantAccessToken);
  assert.equal(participant.session(created.sessionId).status, 'ready');
  assert.equal('events' in viewer.session(created.sessionId), false);
  assert.throws(() => viewer.sessionData(created.sessionId), /data.read/);

  const batch = [event(created, 1), event(created, 2)];
  const receipt = participant.appendEvents(created.sessionId, batch, { batchId: 'batch-1', expectedRevision: 1 });
  assert.equal(receipt.revision, 2);
  assert.deepEqual(participant.appendEvents(created.sessionId, batch, { batchId: 'batch-1', expectedRevision: 1 }), receipt);
  assert.throws(() => participant.appendEvents(created.sessionId, [event(created, 3, 'different')], { batchId: 'batch-1', expectedRevision: 2 }), /different content/);
  assert.throws(() => participant.appendEvents(created.sessionId, [event(created, 4)], { batchId: 'batch-2', expectedRevision: 2 }), /expected 3/);

  const snapshot = { sessionId: created.sessionId, protocolId: created.protocolId, protocolVersion: created.protocolVersion, eventSequence: 2, status: 'paused' };
  assert.throws(() => participant.syncState(created.sessionId, { ...snapshot, eventSequence: 1 }, { expectedRevision: 2 }), /does not match ingested sequence/);
  assert.equal(participant.syncState(created.sessionId, snapshot, { expectedRevision: 2 }).revision, 3);
  assert.throws(() => participant.syncState(created.sessionId, snapshot, { expectedRevision: 2 }), /revision conflict/);
  assert.equal(participant.completeSession(created.sessionId, { expectedRevision: 3 }).status, 'completed');
  assert.throws(() => participant.session(created.sessionId), /session.read/);
  const data = owner.sessionData(created.sessionId);
  assert.equal(data.events.length, 2);
  assert.equal(data.session.status, 'completed');
  assert.deepEqual(owner.audit().map(item => item.sequence), [1, 2, 3, 4, 5, 6]);
});
