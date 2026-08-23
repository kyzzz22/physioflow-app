import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoreComponentRegistry, createProtocolGraph, createSequentialIdFactory, freezeProtocolGraph } from '../src/core/index.js';
import { createDeploymentBundle } from '../src/deployment/index.js';
import { createHostedHttpHandler, HostedExecutionClient, HostedHttpClient, HostedRuntimeSync, LocalHostedExecutionService, resolveParticipantResourceUrl, validateParticipantBootstrap } from '../src/hosted/index.js';
import { createRuntimeState, startRuntime } from '../src/runtime/index.js';

async function fixture() {
  const protocol = createProtocolGraph({ idFactory: createSequentialIdFactory(), now: '2026-08-23T00:00:00.000Z' });
  protocol.assets = [
    { id: 'asset_remote', name: 'Remote image', mediaType: 'image/png', sourceUrl: 'https://cdn.example.test/image.png', checksum: 'sha256:remote' },
    { id: 'asset_workspace', name: 'Workspace video', mediaType: 'video/mp4', checksum: 'sha256:workspace' },
    { id: 'asset_unsafe', name: 'Unsafe media', mediaType: 'text/html', sourceUrl: 'javascript:alert(1)' },
  ];
  const frozen = await freezeProtocolGraph(protocol, createCoreComponentRegistry(), { now: '2026-08-23T01:00:00.000Z' });
  return { protocol: frozen, bundle: await createDeploymentBundle(frozen, { bundleId: 'bootstrap_bundle', createdAt: '2026-08-23T02:00:00.000Z', maximumSessions: 3 }) };
}

function serviceOptions() {
  let id = 0;
  return {
    actors: [
      { actorId: 'bootstrap-owner', role: 'owner', accessToken: 'bootstrap-owner-token' },
      { actorId: 'bootstrap-operator', role: 'operator', accessToken: 'bootstrap-operator-token' },
      { actorId: 'bootstrap-viewer', role: 'viewer', accessToken: 'bootstrap-viewer-token' },
    ],
    idFactory: prefix => `${prefix}_bootstrap_${++id}`,
    clock: () => '2026-08-23T03:00:00.000Z',
    assetResolver: async asset => asset.id === 'asset_workspace' ? { mode: 'signed', url: 'https://assets.example.test/signed/video.mp4', checksum: asset.checksum, expiresAt: '2026-08-23T04:00:00.000Z' } : null,
  };
}

test('participant bootstrap verifies the frozen protocol and exposes only safe resource delivery metadata', async () => {
  const { bundle } = await fixture();
  const service = new LocalHostedExecutionService(serviceOptions());
  const owner = new HostedExecutionClient(service, 'bootstrap-owner-token');
  const operator = new HostedExecutionClient(service, 'bootstrap-operator-token');
  const viewer = new HostedExecutionClient(service, 'bootstrap-viewer-token');
  const deployment = await owner.publish(bundle, { idempotencyKey: 'bootstrap-publish' });
  operator.processNextDeployment();
  const session = await operator.createSession(deployment.deploymentId, { idempotencyKey: 'bootstrap-session', participantId: 'P-BOOTSTRAP' });
  const participant = new HostedExecutionClient(service, session.participantAccessToken);
  const bootstrap = await participant.bootstrap(session.sessionId);
  assert.deepEqual(await validateParticipantBootstrap(bootstrap), { valid: true, errors: [] });
  assert.equal(bootstrap.protocol.protocolId, session.protocolId);
  assert.equal(bootstrap.resources.filter(item => item.status === 'ready').length, 2);
  assert.equal(bootstrap.resources.find(item => item.assetId === 'asset_unsafe').reason, 'unsafe_or_unsupported_url');
  assert.equal(resolveParticipantResourceUrl(bootstrap.resources, { assetId: 'asset_workspace', fallbackUrl: 'workspace://video' }), 'https://assets.example.test/signed/video.mp4');
  assert.equal(resolveParticipantResourceUrl(bootstrap.resources, { assetId: 'asset_unsafe', fallbackUrl: 'javascript:alert(1)' }), '');
  assert.equal(resolveParticipantResourceUrl(undefined, { fallbackUrl: 'https://preview.example.test/local.png' }), 'https://preview.example.test/local.png');
  assert.equal(JSON.stringify(bootstrap).includes(session.participantAccessToken), false);
  await assert.rejects(() => viewer.bootstrap(session.sessionId), /session.bootstrap/);
  const tampered = structuredClone(bootstrap);
  tampered.protocol.metadata.name = 'Tampered bootstrap';
  assert.match((await validateParticipantBootstrap(tampered)).errors.join('\n'), /protocol hash|bootstrap content/i);
});

test('anonymous HTTP launch redemption yields a scoped client that downloads a valid bootstrap', async () => {
  const { bundle } = await fixture();
  const service = new LocalHostedExecutionService(serviceOptions());
  const handler = createHostedHttpHandler(service);
  const transport = (input, init) => handler(new Request(input, init));
  const owner = new HostedHttpClient({ baseUrl: 'https://hosted.example', accessToken: 'bootstrap-owner-token', fetch: transport });
  const operator = new HostedHttpClient({ baseUrl: 'https://hosted.example', accessToken: 'bootstrap-operator-token', fetch: transport });
  const deployment = await owner.publish(bundle, { idempotencyKey: 'http-bootstrap-publish' });
  await operator.processNextDeployment();
  const link = await operator.createLaunchLink(deployment.deploymentId, { idempotencyKey: 'http-bootstrap-link', maximumUses: 1 });
  const anonymous = new HostedHttpClient({ baseUrl: 'https://hosted.example', fetch: transport });
  const redemption = await anonymous.redeemLaunchLink(link.launchToken, { idempotencyKey: 'http-bootstrap-redeem', participantId: 'P-PUBLIC' });
  const participant = new HostedHttpClient({ baseUrl: 'https://hosted.example', accessToken: redemption.session.participantAccessToken, fetch: transport });
  const bootstrap = await participant.bootstrap(redemption.session.sessionId);
  assert.equal((await validateParticipantBootstrap(bootstrap)).valid, true);
  assert.equal(bootstrap.session.participantId, 'P-PUBLIC');
  assert.equal(bootstrap.deployment.bundleHash, bundle.bundleHash);
});

test('participant bootstrap carries a consistent hosted recovery checkpoint', async () => {
  const { bundle, protocol } = await fixture();
  const service = new LocalHostedExecutionService(serviceOptions());
  const owner = new HostedExecutionClient(service, 'bootstrap-owner-token');
  const deployment = await owner.publish(bundle, { idempotencyKey: 'recovery-publish' });
  owner.processNextDeployment();
  const session = await owner.createSession(deployment.deploymentId, { idempotencyKey: 'recovery-session', participantId: 'P-RECOVERY' });
  const participant = new HostedExecutionClient(service, session.participantAccessToken);
  let eventId = 0;
  const started = startRuntime(createRuntimeState(protocol, { sessionId: session.sessionId, startedAtEpochMs: 1, startedAtMonotonicMs: 1 }), protocol, createCoreComponentRegistry(), {
    idFactory: prefix => `${prefix}_recovery_${++eventId}`,
    clock: { now: () => ({ epochMs: 2 + eventId, monotonicMs: 2 + eventId, iso: '2026-08-23T03:00:00.000Z' }) },
  });
  await new HostedRuntimeSync({ client: participant, session }).enqueue({ events: started.events, runtime: started.state, complete: false });
  const bootstrap = await participant.bootstrap(session.sessionId);
  assert.equal((await validateParticipantBootstrap(bootstrap)).valid, true);
  assert.equal(bootstrap.recovery.runtime.eventSequence, started.state.eventSequence);
  assert.deepEqual(bootstrap.recovery.events, started.events);
});
