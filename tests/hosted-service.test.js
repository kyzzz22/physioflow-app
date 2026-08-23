import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoreComponentRegistry, createProtocolGraph, createSequentialIdFactory, freezeProtocolGraph } from '../src/core/index.js';
import { createDeploymentBundle } from '../src/deployment/index.js';
import { HostedExecutionClient, HostedRuntimeSync, LocalHostedExecutionService } from '../src/hosted/index.js';
import { createRuntimeState, startRuntime } from '../src/runtime/index.js';

async function fixture(deploymentOptions = {}) {
  const protocol = await freezeProtocolGraph(
    createProtocolGraph({ idFactory: createSequentialIdFactory(), now: '2026-08-23T00:00:00.000Z' }),
    createCoreComponentRegistry(),
    { now: '2026-08-23T01:00:00.000Z' },
  );
  return { protocol, bundle: await createDeploymentBundle(protocol, { bundleId: 'hosted_bundle', createdAt: '2026-08-23T02:00:00.000Z', ...deploymentOptions }) };
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

test('hosted tenant capacity is isolated, observable, and enforced without charging idempotent retries', async () => {
  const { bundle } = await fixture();
  let id = 0;
  const actors = [
    { actorId: 'owner-a', role: 'owner', accessToken: 'owner-a-token', tenantId: 'tenant-a' },
    { actorId: 'owner-b', role: 'owner', accessToken: 'owner-b-token', tenantId: 'tenant-b' },
  ];
  const firstEventBytes = new TextEncoder().encode(JSON.stringify(event({ sessionId: 'placeholder', protocolId: bundle.protocol.protocolId, protocolVersion: bundle.protocol.version }, 1))).length;
  const service = new LocalHostedExecutionService({
    actors,
    tenantLimits: {
      'tenant-a': { maximumDeployments: 1, maximumSessions: 1, maximumLaunchLinks: 1, maximumStoredEvents: 1, maximumStoredEventBytes: firstEventBytes + 100 },
      'tenant-b': { maximumStoredEventBytes: 0 },
    },
    idFactory: prefix => `${prefix}_capacity_${++id}`,
    clock: () => '2026-08-23T03:00:00.000Z',
  });
  const ownerA = new HostedExecutionClient(service, 'owner-a-token');
  const ownerB = new HostedExecutionClient(service, 'owner-b-token');
  const deployment = await ownerA.publish(bundle, { idempotencyKey: 'capacity-publish' });
  assert.equal((await ownerA.publish(bundle, { idempotencyKey: 'capacity-publish' })).deploymentId, deployment.deploymentId);
  await assert.rejects(() => ownerA.publish(bundle, { idempotencyKey: 'capacity-publish-2' }), /deployments quota is exhausted/);
  const deploymentB = await ownerB.publish(bundle, { idempotencyKey: 'tenant-b-publish' });
  assert.equal(deploymentB.tenantId, 'tenant-b');
  ownerA.processNextDeployment();
  ownerA.createLaunchLink(deployment.deploymentId, { idempotencyKey: 'capacity-link' });
  assert.throws(() => ownerA.createLaunchLink(deployment.deploymentId, { idempotencyKey: 'capacity-link-2' }), /launch links quota is exhausted/);
  const session = await ownerA.createSession(deployment.deploymentId, { idempotencyKey: 'capacity-session' });
  await assert.rejects(() => ownerA.createSession(deployment.deploymentId, { idempotencyKey: 'capacity-session-2' }), /sessions quota is exhausted/);
  const participant = new HostedExecutionClient(service, session.participantAccessToken);
  const storedEvent = event(session, 1);
  participant.appendEvents(session.sessionId, [storedEvent], { batchId: 'capacity-events', expectedRevision: 1 });
  assert.equal(participant.appendEvents(session.sessionId, [storedEvent], { batchId: 'capacity-events', expectedRevision: 1 }).accepted, 1);
  assert.throws(() => participant.appendEvents(session.sessionId, [event(session, 2)], { batchId: 'capacity-events-2', expectedRevision: 2 }), /stored events quota is exhausted/);
  const capacity = ownerA.tenantCapacity();
  assert.deepEqual(capacity.usage, { deployments: 1, sessions: 1, launchLinks: 1, storedEvents: 1, storedEventBytes: new TextEncoder().encode(JSON.stringify(storedEvent)).length });
  assert.equal(capacity.remaining.deployments, 0);
  assert.equal(capacity.remaining.storedEvents, 0);
  assert.equal(ownerB.tenantCapacity().limits.maximumDeployments, null);
  ownerB.processNextDeployment();
  const sessionB = await ownerB.createSession(deploymentB.deploymentId, { idempotencyKey: 'tenant-b-session' });
  const participantB = new HostedExecutionClient(service, sessionB.participantAccessToken);
  assert.throws(() => participantB.appendEvents(sessionB.sessionId, [event(sessionB, 1)], { batchId: 'tenant-b-events', expectedRevision: 1 }), /stored event bytes quota is exhausted/);
  assert.throws(() => new LocalHostedExecutionService({ actors, tenantLimits: { 'tenant-a': { maximumSessions: -1 } } }), /non-negative safe integer/);
  assert.throws(() => new LocalHostedExecutionService({ actors, tenantLimits: { 'tenant-a': { unknown: 1 } } }), /unsupported field/);
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
  assert.throws(() => participant.syncState(created.sessionId, { ...snapshot, eventSequence: 1 }, { syncId: 'state-invalid', expectedRevision: 2 }), /does not match ingested sequence/);
  assert.equal(participant.syncState(created.sessionId, snapshot, { syncId: 'state-1', expectedRevision: 2 }).revision, 3);
  assert.equal(participant.syncState(created.sessionId, snapshot, { syncId: 'state-1', expectedRevision: 2 }).revision, 3);
  assert.throws(() => participant.syncState(created.sessionId, snapshot, { syncId: 'state-2', expectedRevision: 2 }), /revision conflict/);
  assert.equal(participant.completeSession(created.sessionId, { completionId: 'complete-1', expectedRevision: 3 }).status, 'completed');
  assert.equal(participant.completeSession(created.sessionId, { completionId: 'complete-1', expectedRevision: 3 }).status, 'completed');
  assert.throws(() => participant.session(created.sessionId), /session.read/);
  const data = owner.sessionData(created.sessionId);
  assert.equal(data.events.length, 2);
  assert.equal(data.session.status, 'completed');
  assert.deepEqual(owner.audit().map(item => item.sequence), [1, 2, 3, 4, 5, 6]);
});

test('Runtime V2 sync retries lost acknowledgements and completes the hosted session exactly once', async () => {
  const { bundle, protocol } = await fixture();
  const service = createService();
  const owner = new HostedExecutionClient(service, 'owner-token');
  const operator = new HostedExecutionClient(service, 'operator-token');
  const deployment = await owner.publish(bundle, { idempotencyKey: 'publish-runtime' });
  operator.processNextDeployment();
  const hostedSession = await operator.createSession(deployment.deploymentId, { idempotencyKey: 'runtime-session', participantId: 'P-RUNTIME' });
  const participant = new HostedExecutionClient(service, hostedSession.participantAccessToken);
  let eventId = 0;
  let tick = 0;
  const initial = createRuntimeState(protocol, { sessionId: hostedSession.sessionId, startedAtEpochMs: 1787454600000, startedAtMonotonicMs: 0 });
  const result = startRuntime(initial, protocol, createCoreComponentRegistry(), {
    idFactory: prefix => `${prefix}_${++eventId}`,
    clock: { now: () => ({ iso: '2026-08-23T03:10:00.000Z', epochMs: 1787454600000 + tick, monotonicMs: tick++ }) },
  });
  assert.equal(result.state.status, 'completed');

  let loseAppend = true;
  let loseState = true;
  const unreliableClient = {
    appendEvents: async (...args) => {
      const receipt = await participant.appendEvents(...args);
      if (loseAppend) { loseAppend = false; throw new Error('simulated lost event acknowledgement'); }
      return receipt;
    },
    syncState: async (...args) => {
      const receipt = await participant.syncState(...args);
      if (loseState) { loseState = false; throw new Error('simulated lost state acknowledgement'); }
      return receipt;
    },
    completeSession: (...args) => participant.completeSession(...args),
  };
  const sync = new HostedRuntimeSync({ client: unreliableClient, session: hostedSession });
  await assert.rejects(() => sync.enqueue({ events: result.events, runtime: result.state }), /lost event acknowledgement/);
  await assert.rejects(() => sync.enqueue({ events: result.events, runtime: result.state }), /lost state acknowledgement/);
  const completed = await sync.enqueue({ events: result.events, runtime: result.state, complete: true });
  assert.equal(completed.completed, true);
  assert.equal(completed.nextEventSequence, result.events.length + 1);
  const stored = owner.sessionData(hostedSession.sessionId);
  assert.equal(stored.session.status, 'completed');
  assert.equal(stored.events.length, result.events.length);
  assert.deepEqual(stored.runtimeSnapshot, result.state);
  assert.equal(owner.audit().filter(item => item.action === 'session.events_appended').length, 1);
  assert.equal(owner.audit().filter(item => item.action === 'session.state_synced').length, 1);
  assert.equal(owner.audit().filter(item => item.action === 'session.completed').length, 1);
});

test('hosted session state resumes from pause and records a terminal runtime failure', async () => {
  const { bundle } = await fixture();
  const service = createService();
  const owner = new HostedExecutionClient(service, 'owner-token');
  const operator = new HostedExecutionClient(service, 'operator-token');
  const deployment = await owner.publish(bundle, { idempotencyKey: 'publish-failure' });
  operator.processNextDeployment();
  const created = await operator.createSession(deployment.deploymentId, { idempotencyKey: 'failure-session', participantId: 'P-FAIL' });
  const participant = new HostedExecutionClient(service, created.participantAccessToken);
  const identity = { sessionId: created.sessionId, protocolId: created.protocolId, protocolVersion: created.protocolVersion, eventSequence: 0 };
  assert.equal(participant.syncState(created.sessionId, { ...identity, status: 'paused' }, { syncId: 'pause', expectedRevision: 1 }).status, 'paused');
  assert.equal(participant.syncState(created.sessionId, { ...identity, status: 'running' }, { syncId: 'resume', expectedRevision: 2 }).status, 'running');
  const failed = participant.completeSession(created.sessionId, { completionId: 'failed-runtime', outcome: 'failed', expectedRevision: 3 });
  assert.equal(failed.status, 'failed');
  assert.equal(participant.completeSession(created.sessionId, { completionId: 'failed-runtime', outcome: 'failed', expectedRevision: 3 }).status, 'failed');
  assert.throws(() => participant.session(created.sessionId), /session.read/);
  assert.equal(owner.audit().filter(item => item.action === 'session.failed').length, 1);
});

test('launch links are idempotent, revocable and constrained by link and deployment quotas', async () => {
  const { bundle } = await fixture({ maximumSessions: 3 });
  const service = createService();
  const owner = new HostedExecutionClient(service, 'owner-token');
  const operator = new HostedExecutionClient(service, 'operator-token');
  const deployment = await owner.publish(bundle, { idempotencyKey: 'publish-launch' });
  operator.processNextDeployment();
  const link = await operator.createLaunchLink(deployment.deploymentId, { idempotencyKey: 'link-1', maximumUses: 2 });
  assert.equal((await operator.createLaunchLink(deployment.deploymentId, { idempotencyKey: 'link-1', maximumUses: 2 })).launchToken, link.launchToken);
  const first = await operator.redeemLaunchLink(link.launchToken, { idempotencyKey: 'redeem-1', participantId: 'PUBLIC-1' });
  assert.equal((await operator.redeemLaunchLink(link.launchToken, { idempotencyKey: 'redeem-1', participantId: 'PUBLIC-1' })).session.sessionId, first.session.sessionId);
  await operator.redeemLaunchLink(link.launchToken, { idempotencyKey: 'redeem-2', participantId: 'PUBLIC-2' });
  assert.throws(() => operator.redeemLaunchLink(link.launchToken, { idempotencyKey: 'redeem-3', participantId: 'PUBLIC-3' }), /use quota/);
  const revoked = await operator.revokeLaunchLink(link.launchLinkId, { idempotencyKey: 'revoke-1', expectedRevision: 3 });
  assert.equal(revoked.status, 'revoked');
  assert.throws(() => operator.redeemLaunchLink(link.launchToken, { idempotencyKey: 'redeem-4' }), /revoked/);

  const pendingLink = await operator.createLaunchLink(deployment.deploymentId, { idempotencyKey: 'link-2', maximumUses: 1 });
  await operator.createSession(deployment.deploymentId, { idempotencyKey: 'direct-third', participantId: 'DIRECT-3' });
  assert.throws(() => operator.redeemLaunchLink(pendingLink.launchToken, { idempotencyKey: 'quota-fourth' }), /session quota/);
  const current = await owner.deployment(deployment.deploymentId);
  const deactivated = await operator.deactivateDeployment(deployment.deploymentId, { idempotencyKey: 'deactivate-1', expectedRevision: current.revision });
  assert.equal(deactivated.status, 'deactivated');
  await assert.rejects(() => operator.createSession(deployment.deploymentId, { idempotencyKey: 'after-deactivate' }), /deactivated/);
  const participant = new HostedExecutionClient(service, first.session.participantAccessToken);
  assert.equal((await participant.session(first.session.sessionId)).participantId, 'PUBLIC-1');
  assert.equal((await owner.audit()).filter(item => item.action === 'launch_link.redeemed').length, 2);

  let now = '2026-08-23T03:00:00.000Z';
  let id = 0;
  const expiringService = new LocalHostedExecutionService({ actors: [{ actorId: 'expiry-owner', role: 'owner', accessToken: 'expiry-token' }], clock: () => now, idFactory: prefix => `${prefix}_expiry_${++id}` });
  const expiryOwner = new HostedExecutionClient(expiringService, 'expiry-token');
  const expiringBundle = (await fixture({ maximumSessions: 2, expiresAt: '2026-08-23T04:00:00.000Z' })).bundle;
  const expiringDeployment = await expiryOwner.publish(expiringBundle, { idempotencyKey: 'expiry-publish' });
  expiryOwner.processNextDeployment();
  const expiringLink = expiryOwner.createLaunchLink(expiringDeployment.deploymentId, { idempotencyKey: 'expiry-link', maximumUses: 1, expiresAt: '2026-08-23T03:30:00.000Z' });
  now = '2026-08-23T03:31:00.000Z';
  assert.throws(() => expiryOwner.redeemLaunchLink(expiringLink.launchToken, { idempotencyKey: 'expired-link' }), /expired/);
  now = '2026-08-23T04:01:00.000Z';
  assert.equal(expiryOwner.deployment(expiringDeployment.deploymentId).status, 'expired');
  await assert.rejects(() => expiryOwner.createSession(expiringDeployment.deploymentId, { idempotencyKey: 'expired-deployment' }), /expired/);
});
