import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoreComponentRegistry, createProtocolGraph, freezeProtocolGraph } from '../src/core/index.js';
import { createDeploymentBundle } from '../src/deployment/index.js';
import {
  createHostedHttpHandler,
  createPersistentHostedExecutionService,
  HostedHttpClient,
  HostedHttpError,
  LocalHostedExecutionService,
  MemoryHostedStateStore,
} from '../src/hosted/index.js';

const actors = [
  { actorId: 'shared-owner', role: 'owner', tenantId: 'tenant-a', accessToken: 'tenant-a-owner' },
  { actorId: 'shared-operator', role: 'operator', tenantId: 'tenant-a', accessToken: 'tenant-a-operator' },
  { actorId: 'shared-analyst', role: 'analyst', tenantId: 'tenant-a', accessToken: 'tenant-a-analyst' },
  { actorId: 'shared-owner', role: 'owner', tenantId: 'tenant-b', accessToken: 'tenant-b-owner' },
  { actorId: 'shared-operator', role: 'operator', tenantId: 'tenant-b', accessToken: 'tenant-b-operator' },
  { actorId: 'shared-analyst', role: 'analyst', tenantId: 'tenant-b', accessToken: 'tenant-b-analyst' },
];

async function fixture() {
  const protocol = await freezeProtocolGraph(createProtocolGraph(), createCoreComponentRegistry());
  return createDeploymentBundle(protocol, { bundleId: 'tenant_bundle', dataRetentionDays: 30 });
}

function expectNotFound(operation) {
  return assert.rejects(operation, error => error instanceof HostedHttpError && error.status === 404 && error.code === 'not_found');
}

test('hosted resources, queues, idempotency and audit are isolated by tenant', async () => {
  const bundle = await fixture();
  const store = new MemoryHostedStateStore();
  let id = 0;
  const options = { actors, store, clock: () => '2026-08-23T00:00:00.000Z', idFactory: prefix => `${prefix}_tenant_${++id}` };
  const service = await createPersistentHostedExecutionService(options);
  const handler = createHostedHttpHandler(service);
  const fetch = (input, init) => handler(new Request(input, init));
  const client = accessToken => new HostedHttpClient({ baseUrl: 'https://tenants.example', accessToken, fetch });
  const ownerA = client('tenant-a-owner');
  const operatorA = client('tenant-a-operator');
  const analystA = client('tenant-a-analyst');
  const ownerB = client('tenant-b-owner');
  const operatorB = client('tenant-b-operator');
  const analystB = client('tenant-b-analyst');

  const deploymentA = await ownerA.publish(bundle, { idempotencyKey: 'same-publish-key', tenantId: 'tenant-b' });
  const deploymentB = await ownerB.publish(bundle, { idempotencyKey: 'same-publish-key' });
  assert.notEqual(deploymentA.deploymentId, deploymentB.deploymentId);
  assert.equal(deploymentA.tenantId, 'tenant-a');
  assert.equal(deploymentB.tenantId, 'tenant-b');

  assert.equal((await operatorA.processNextDeployment()).deploymentId, deploymentA.deploymentId);
  assert.equal((await ownerB.deployment(deploymentB.deploymentId)).status, 'queued');
  assert.equal((await operatorB.processNextDeployment()).deploymentId, deploymentB.deploymentId);
  const sessionA = await operatorA.createSession(deploymentA.deploymentId, { idempotencyKey: 'same-session-key', participantId: 'TENANT-A-PARTICIPANT' });
  const sessionB = await operatorB.createSession(deploymentB.deploymentId, { idempotencyKey: 'same-session-key', participantId: 'TENANT-B-PARTICIPANT' });
  const linkA = await operatorA.createLaunchLink(deploymentA.deploymentId, { idempotencyKey: 'same-link-key' });
  const linkB = await operatorB.createLaunchLink(deploymentB.deploymentId, { idempotencyKey: 'same-link-key' });
  assert.notEqual(sessionA.sessionId, sessionB.sessionId);
  assert.notEqual(linkA.launchLinkId, linkB.launchLinkId);

  await expectNotFound(() => ownerA.deployment(deploymentB.deploymentId));
  await expectNotFound(() => ownerA.createSession(deploymentB.deploymentId, { idempotencyKey: 'cross-start' }));
  await expectNotFound(() => ownerA.createLaunchLink(deploymentB.deploymentId, { idempotencyKey: 'cross-link' }));
  await expectNotFound(() => ownerA.deactivateDeployment(deploymentB.deploymentId, { idempotencyKey: 'cross-deactivate', expectedRevision: 2 }));
  await expectNotFound(() => ownerA.retentionPlan(deploymentB.deploymentId, { asOf: '2026-10-01T00:00:00.000Z' }));
  await expectNotFound(() => analystA.deploymentData(deploymentB.deploymentId));
  await expectNotFound(() => analystA.sessionData(sessionB.sessionId));
  await expectNotFound(() => ownerB.revokeLaunchLink(linkA.launchLinkId, { idempotencyKey: 'cross-revoke', expectedRevision: 1 }));
  await expectNotFound(() => ownerB.completeSession(sessionA.sessionId, {}));

  const participantA = client(sessionA.participantAccessToken);
  await assert.rejects(() => participantA.session(sessionB.sessionId), error => error instanceof HostedHttpError && error.status === 403);
  assert.equal((await participantA.session(sessionA.sessionId)).tenantId, 'tenant-a');

  const auditA = await ownerA.audit();
  const auditB = await ownerB.audit();
  assert.ok(auditA.length > 0 && auditB.length > 0);
  assert.equal(auditA.every(entry => entry.tenantId === 'tenant-a'), true);
  assert.equal(auditB.every(entry => entry.tenantId === 'tenant-b'), true);
  assert.equal(JSON.stringify(auditA).includes(deploymentB.deploymentId), false);
  assert.equal(JSON.stringify(auditB).includes(deploymentA.deploymentId), false);

  const state = await store.load();
  assert.equal(state.schemaVersion, '1.3.0');
  assert.equal(state.deployments.every(record => record.tenantId), true);
  assert.equal(state.sessions.every(record => record.tenantId), true);
  assert.equal(state.participantTokens.every(([, record]) => record.tenantId), true);
  assert.equal(state.launchLinks.every(record => record.tenantId), true);
  assert.equal(state.auditEntries.every(record => record.tenantId), true);
  const tamperedState = structuredClone(state);
  tamperedState.sessions[0].tenantId = 'tenant-b';
  await assert.rejects(() => new MemoryHostedStateStore().save(tamperedState), /tenant does not match its deployment/);
  const invalidNamespace = structuredClone(state);
  invalidNamespace.deployments[0].assetNamespaceVersion = 99;
  await assert.rejects(() => new MemoryHostedStateStore().save(invalidNamespace), /asset namespace version/);

  const restarted = await createPersistentHostedExecutionService({ ...options, store });
  assert.equal((await restarted.getDeployment(deploymentA.deploymentId, { accessToken: 'tenant-a-owner' })).tenantId, 'tenant-a');
  await assert.rejects(() => restarted.getDeployment(deploymentA.deploymentId, { accessToken: 'tenant-b-owner' }), /Unknown hosted deployment/);
  assert.equal((await restarted.readAudit({ accessToken: 'tenant-b-owner' })).every(entry => entry.tenantId === 'tenant-b'), true);
  assert.equal((await analystB.deploymentData(deploymentB.deploymentId)).deployment.tenantId, 'tenant-b');
});

test('hosted state 1.1 migrates into the default tenant without breaking idempotency', async () => {
  const bundle = await fixture();
  let id = 0;
  const serviceOptions = {
    actors: [{ actorId: 'legacy-owner', role: 'owner', accessToken: 'legacy-owner-token' }],
    clock: () => '2026-08-23T00:00:00.000Z',
    idFactory: prefix => `${prefix}_legacy_${++id}`,
  };
  const original = new LocalHostedExecutionService(serviceOptions);
  const deployment = await original.publishDeployment(bundle, { idempotencyKey: 'legacy-publish' }, { accessToken: 'legacy-owner-token' });
  const legacy = original.exportState();
  legacy.schemaVersion = '1.1.0';
  for (const collection of [legacy.deployments, legacy.sessions, legacy.launchLinks, legacy.auditEntries]) for (const record of collection) delete record.tenantId;
  for (const record of legacy.deployments) delete record.assetNamespaceVersion;
  for (const [, record] of legacy.participantTokens) delete record.tenantId;
  legacy.idempotency = legacy.idempotency.map(([, value]) => ['legacy-owner:deployment.publish:legacy-publish', value]);

  const restored = new LocalHostedExecutionService({ ...serviceOptions, state: legacy });
  const retried = await restored.publishDeployment(bundle, { idempotencyKey: 'legacy-publish' }, { accessToken: 'legacy-owner-token' });
  assert.equal(retried.deploymentId, deployment.deploymentId);
  assert.equal((await restored.getDeployment(deployment.deploymentId, { accessToken: 'legacy-owner-token' })).tenantId, 'default');
  const upgraded = restored.exportState();
  assert.equal(upgraded.schemaVersion, '1.3.0');
  assert.equal(upgraded.deployments[0].tenantId, 'default');
  assert.equal(upgraded.deployments[0].assetNamespaceVersion, 1);
  assert.equal(upgraded.auditEntries.every(entry => entry.tenantId === 'default'), true);
});

test('hosted actor configuration rejects malformed tenant IDs', () => {
  assert.throws(() => new LocalHostedExecutionService({ actors: [{ actorId: 'owner', role: 'owner', tenantId: '../other', accessToken: 'token' }] }), /tenant ID is invalid/);
});
