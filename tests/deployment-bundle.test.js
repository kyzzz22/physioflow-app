import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoreComponentRegistry, createProtocolGraph, createSequentialIdFactory, freezeProtocolGraph } from '../src/core/index.js';
import { createDeploymentBundle, createInMemoryExecutionProvider, ExecutionProviderRegistry, validateDeploymentBundle } from '../src/deployment/index.js';

async function frozenProtocol() {
  const protocol = createProtocolGraph({ idFactory: createSequentialIdFactory(), now: '2026-08-23T00:00:00.000Z' });
  return freezeProtocolGraph(protocol, createCoreComponentRegistry(), { now: '2026-08-23T01:00:00.000Z' });
}

test('deployment bundle preserves frozen protocol identity, dependencies and integrity', async () => {
  const protocol = await frozenProtocol();
  const bundle = await createDeploymentBundle(protocol, { bundleId: 'deployment_one', createdAt: '2026-08-23T02:00:00.000Z', createdBy: 'researcher-1', providerId: 'org.example.lab', environment: 'pilot', dataRetentionDays: 365 });
  assert.equal(bundle.protocol.configHash, protocol.freeze.configHash);
  assert.equal(bundle.protocol.snapshot.protocolId, protocol.protocolId);
  assert.equal(bundle.target.providerId, 'org.example.lab');
  assert.equal(bundle.executionPolicy.dataRetentionDays, 365);
  assert.equal(bundle.bundleHash.length, 64);
  assert.deepEqual(await validateDeploymentBundle(bundle), { valid: true, errors: [] });
});

test('deployment data retention is opt-in and bounded', async () => {
  const protocol = await frozenProtocol();
  assert.equal((await createDeploymentBundle(protocol, { bundleId: 'retention_default' })).executionPolicy.dataRetentionDays, null);
  await assert.rejects(() => createDeploymentBundle(protocol, { bundleId: 'retention_zero', dataRetentionDays: 0 }), /integer from 1 to 36500/);
  await assert.rejects(() => createDeploymentBundle(protocol, { bundleId: 'retention_fraction', dataRetentionDays: 1.5 }), /integer from 1 to 36500/);
  await assert.rejects(() => createDeploymentBundle(protocol, { bundleId: 'retention_large', dataRetentionDays: 36501 }), /integer from 1 to 36500/);
});

test('deployment bundle rejects drafts and detects protocol or manifest tampering', async () => {
  await assert.rejects(() => createDeploymentBundle(createProtocolGraph()), /frozen Protocol Graph/);
  const bundle = await createDeploymentBundle(await frozenProtocol(), { bundleId: 'deployment_two' });
  const changedProtocol = structuredClone(bundle);
  changedProtocol.protocol.snapshot.metadata.name = 'Tampered';
  assert.match((await validateDeploymentBundle(changedProtocol)).errors.join('\n'), /snapshot hash/);
  const changedManifest = structuredClone(bundle);
  changedManifest.executionPolicy.maximumSessions = 10;
  assert.match((await validateDeploymentBundle(changedManifest)).errors.join('\n'), /bundle content/);
  const changedIdentity = structuredClone(bundle);
  changedIdentity.protocol.protocolId = 'protocol_elsewhere';
  assert.match((await validateDeploymentBundle(changedIdentity)).errors.join('\n'), /identity does not match/);
});

test('execution providers are validated, registered and receive portable bundles', async () => {
  const times = ['2026-08-23T03:00:00.000Z', '2026-08-23T03:00:01.000Z', '2026-08-23T03:00:02.000Z'];
  const provider = createInMemoryExecutionProvider({ now: () => times.shift() });
  const registry = new ExecutionProviderRegistry().register(provider);
  assert.equal(registry.get(provider.providerId, provider.version), provider);
  const bundle = await createDeploymentBundle(await frozenProtocol(), { bundleId: 'deployment_three' });
  const queued = await provider.submit(bundle, { jobId: 'job_one', participantId: 'P001' });
  assert.equal(queued.status, 'queued');
  assert.equal((await provider.status('job_one')).participantId, 'P001');
  assert.equal((await provider.cancel('job_one')).status, 'cancelled');
  assert.equal((await provider.cancel('job_one')).status, 'cancelled');
});
