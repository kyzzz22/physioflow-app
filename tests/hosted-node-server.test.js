import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createCoreComponentRegistry, createProtocolGraph, createSequentialIdFactory, freezeProtocolGraph } from '../src/core/index.js';
import { createDeploymentBundle } from '../src/deployment/index.js';
import { HostedHttpClient, validateParticipantBootstrap } from '../src/hosted/index.js';
import { createHostedNodeServer } from '../server/createHostedNodeServer.mjs';
import { FileHostedStateStore } from '../server/fileHostedStateStore.mjs';

const actors = [
  { actorId: 'node-owner', role: 'owner', accessToken: 'node-owner-token' },
  { actorId: 'node-viewer', role: 'viewer', accessToken: 'node-viewer-token' },
  { actorId: 'node-other-owner', role: 'owner', tenantId: 'node-other', accessToken: 'node-other-owner-token' },
];
const oldCredentialKey = { keyId: 'node-old', secret: 'node-old-credential-secret-at-least-32-characters' };
const newCredentialKey = { keyId: 'node-new', secret: 'node-new-credential-secret-at-least-32-characters' };

async function fixture(root) {
  const content = Buffer.from('verified hosted asset');
  const checksum = `sha256:${createHash('sha256').update(content).digest('hex')}`;
  const protocol = createProtocolGraph({ idFactory: createSequentialIdFactory(), name: 'Hosted Node Server', now: '2026-08-23T00:00:00.000Z' });
  protocol.assets = [{ id: 'asset_node', name: 'Node asset', mediaType: 'text/plain', checksum }];
  const frozen = await freezeProtocolGraph(protocol, createCoreComponentRegistry(), { now: '2026-08-23T01:00:00.000Z' });
  const bundle = await createDeploymentBundle(frozen, { bundleId: 'node_server_bundle', createdAt: '2026-08-23T02:00:00.000Z' });
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'dist', 'index.html'), '<!doctype html><title>Hosted participant</title><main>participant application</main>');
  return { bundle, content };
}

function serverOptions(root, sequence, credentialKeys = [oldCredentialKey]) {
  let id = sequence;
  return {
    actors,
    credentialKeys,
    primaryCredentialKeyId: credentialKeys[0].keyId,
    stateFile: join(root, 'state', 'hosted.json'),
    staticDirectory: join(root, 'dist'),
    assetDirectory: join(root, 'assets'),
    assetSecret: 'node-server-test-secret-at-least-32-characters',
    serviceOptions: { idFactory: prefix => `${prefix}_node_${++id}`, clock: () => '2026-08-23T03:00:00.000Z' },
  };
}

test('Node hosted server persists its service, serves the participant app, and delivers signed assets', async t => {
  const root = await mkdtemp(join(tmpdir(), 'physioflow-hosted-node-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { bundle, content } = await fixture(root);
  const first = await createHostedNodeServer(serverOptions(root, 0));
  t.after(async () => first.close());
  const firstAddress = await first.listen(0);
  const owner = new HostedHttpClient({ baseUrl: firstAddress.baseUrl, accessToken: 'node-owner-token' });
  const viewer = new HostedHttpClient({ baseUrl: firstAddress.baseUrl, accessToken: 'node-viewer-token' });
  const otherOwner = new HostedHttpClient({ baseUrl: firstAddress.baseUrl, accessToken: 'node-other-owner-token' });
  const deployment = await owner.publish(bundle, { idempotencyKey: 'node-publish' });
  await assert.rejects(() => owner.processNextDeployment(), error => error.status === 409 && error.code === 'assets_incomplete');
  assert.equal((await owner.deploymentAssets(deployment.deploymentId)).assets[0].status, 'missing');
  await assert.rejects(() => otherOwner.deploymentAssets(deployment.deploymentId), error => error.status === 404 && error.code === 'not_found');
  await assert.rejects(() => viewer.uploadDeploymentAsset(deployment.deploymentId, 'asset_node', content, { mediaType: 'text/plain' }), error => error.status === 403 && error.code === 'forbidden');
  await assert.rejects(() => owner.uploadDeploymentAsset(deployment.deploymentId, 'asset_node', 'incorrect content', { mediaType: 'text/plain' }), error => error.status === 409);
  const uploaded = await owner.uploadDeploymentAsset(deployment.deploymentId, 'asset_node', content, { mediaType: 'text/plain' });
  assert.equal(uploaded.status, 'ready');
  assert.equal((await owner.uploadDeploymentAsset(deployment.deploymentId, 'asset_node', content, { mediaType: 'text/plain' })).outcome, 'unchanged');
  assert.equal((await owner.deploymentAssets(deployment.deploymentId)).ready, true);
  await owner.processNextDeployment();
  await assert.rejects(() => owner.uploadDeploymentAsset(deployment.deploymentId, 'asset_node', content, { mediaType: 'text/plain' }), error => error.status === 409);
  const link = await owner.createLaunchLink(deployment.deploymentId, { idempotencyKey: 'node-link', maximumUses: 1 });
  assert.match(await fetch(`${firstAddress.baseUrl}/participant`).then(response => response.text()), /participant application/);
  assert.deepEqual(await fetch(`${firstAddress.baseUrl}/healthz`).then(response => response.json()), { status: 'ok' });
  const ready = await fetch(`${firstAddress.baseUrl}/readyz`);
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).status, 'ready');
  assert.equal((await fetch(`${firstAddress.baseUrl}/readyz`, { method: 'POST' })).status, 405);
  const metricsResponse = await fetch(`${firstAddress.baseUrl}/metrics`, { headers: { authorization: 'Bearer node-owner-token' } });
  assert.equal(metricsResponse.status, 200);
  const metrics = await metricsResponse.json();
  assert.equal(metrics.schemaVersion, '1.0.0');
  assert.equal(metrics.resources.deployments, 1);
  assert.equal(metrics.resources.sessions, 0);
  assert.equal(JSON.stringify(metrics).includes('node-owner-token'), false);
  assert.equal((await fetch(`${firstAddress.baseUrl}/metrics`, { headers: { authorization: 'Bearer node-viewer-token' } })).status, 403);
  const otherMetrics = await fetch(`${firstAddress.baseUrl}/metrics`, { headers: { authorization: 'Bearer node-other-owner-token' } }).then(response => response.json());
  assert.equal(otherMetrics.tenantId, 'node-other');
  assert.equal(otherMetrics.resources.deployments, 0);
  assert.equal(otherMetrics.requests.responsesByStatus[201], undefined);
  const otherDeployment = await otherOwner.publish(bundle, { idempotencyKey: 'node-other-publish' });
  await otherOwner.uploadDeploymentAsset(otherDeployment.deploymentId, 'asset_node', content, { mediaType: 'text/plain' });
  await otherOwner.processNextDeployment();
  assert.equal((await stat(join(root, 'assets', 'default', deployment.deploymentId, 'asset_node'))).isFile(), true);
  assert.equal((await stat(join(root, 'assets', 'node-other', otherDeployment.deploymentId, 'asset_node'))).isFile(), true);
  await first.close();

  const persisted = JSON.parse(await readFile(join(root, 'state', 'hosted.json'), 'utf8'));
  assert.equal(persisted.deployments.length, 2);
  assert.equal(persisted.auditEntries.filter(entry => entry.action === 'deployment.asset_uploaded').length, 2);
  assert.equal((await stat(join(root, 'state', 'hosted.json'))).mode & 0o777, 0o600);
  assert.equal(persisted.credentialProtection.primaryKeyId, 'node-old');
  assert.equal(persisted.credentialProtection.auditIntegrity.keyId, 'node-old');
  assert.equal(persisted.credentialProtection.auditIntegrity.entryCount, persisted.auditEntries.length);
  assert.equal(JSON.stringify(persisted).includes(link.launchToken), false);
  assert.match(persisted.launchTokens[0][0], /^hmac-sha256:node-old:/);
  const tamperedStateFile = join(root, 'state', 'hosted-audit-tampered.json');
  const auditTampered = structuredClone(persisted);
  auditTampered.auditEntries[0].action = 'deployment.deleted';
  await writeFile(tamperedStateFile, JSON.stringify(auditTampered), { mode: 0o600 });
  await assert.rejects(() => createHostedNodeServer({ ...serverOptions(root, 90), stateFile: tamperedStateFile }), /digest does not match/);
  const liveIntegrityFile = join(root, 'state', 'hosted-audit-live.json');
  await writeFile(liveIntegrityFile, JSON.stringify(persisted), { mode: 0o600 });
  const integrityServer = await createHostedNodeServer({ ...serverOptions(root, 95), stateFile: liveIntegrityFile });
  t.after(async () => integrityServer.close());
  const integrityAddress = await integrityServer.listen(0);
  const verifiedReadiness = await fetch(`${integrityAddress.baseUrl}/readyz`).then(response => response.json());
  assert.equal(verifiedReadiness.checks.state.integrityVerified, true);
  await writeFile(liveIntegrityFile, JSON.stringify(auditTampered), { mode: 0o600 });
  const tamperedReadiness = await fetch(`${integrityAddress.baseUrl}/readyz`);
  assert.equal(tamperedReadiness.status, 503);
  assert.equal((await tamperedReadiness.json()).checks.state.ready, false);
  await integrityServer.close();

  const restarted = await createHostedNodeServer(serverOptions(root, 100, [newCredentialKey, oldCredentialKey]));
  t.after(async () => restarted.close());
  const eagerlyRotated = JSON.parse(await readFile(join(root, 'state', 'hosted.json'), 'utf8'));
  assert.equal(eagerlyRotated.credentialProtection.primaryKeyId, 'node-new');
  assert.equal(eagerlyRotated.credentialProtection.auditIntegrity.keyId, 'node-new');
  const restartedAddress = await restarted.listen(0);
  const anonymous = new HostedHttpClient({ baseUrl: restartedAddress.baseUrl });
  const redemption = await anonymous.redeemLaunchLink(link.launchToken, { idempotencyKey: 'node-redeem', participantId: 'NODE-PARTICIPANT' });
  const participant = new HostedHttpClient({ baseUrl: restartedAddress.baseUrl, accessToken: redemption.session.participantAccessToken });
  const bootstrap = await participant.bootstrap(redemption.session.sessionId);
  assert.equal((await validateParticipantBootstrap(bootstrap)).valid, true);
  const resource = bootstrap.resources.find(item => item.assetId === 'asset_node');
  assert.equal(resource.status, 'ready');
  const delivered = await fetch(resource.delivery.url);
  assert.equal(delivered.headers.get('content-type'), 'text/plain');
  assert.deepEqual(Buffer.from(await delivered.arrayBuffer()), content);
  const rotatedState = JSON.parse(await readFile(join(root, 'state', 'hosted.json'), 'utf8'));
  assert.equal(rotatedState.credentialProtection.primaryKeyId, 'node-new');
  assert.equal(JSON.stringify(rotatedState).includes(link.launchToken), false);
  assert.equal(JSON.stringify(rotatedState).includes(redemption.session.participantAccessToken), false);
  assert.match(rotatedState.participantTokens[0][0], /^hmac-sha256:node-new:/);
  const tampered = new URL(resource.delivery.url);
  tampered.searchParams.set('type', 'text/html');
  assert.equal((await fetch(tampered)).status, 403);
  await writeFile(join(root, 'assets', 'default', deployment.deploymentId, 'asset_node'), 'replaced asset content');
  assert.equal((await fetch(resource.delivery.url)).status, 409);
  const notReady = await fetch(`${restartedAddress.baseUrl}/readyz`);
  assert.equal(notReady.status, 503);
  assert.equal((await notReady.json()).checks.assets.ready, false);
});

test('Node hosted server applies bounded source rate limits without trusting forwarded addresses', async t => {
  const root = await mkdtemp(join(tmpdir(), 'physioflow-hosted-limit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const hosted = await createHostedNodeServer({ actors, credentialKeys: [oldCredentialKey], stateFile: join(root, 'state.json'), rateLimits: { api: 1 } });
  t.after(async () => hosted.close());
  const address = await hosted.listen(0);
  const headers = { authorization: 'Bearer node-owner-token', 'x-forwarded-for': '198.51.100.10' };
  const accepted = await fetch(`${address.baseUrl}/v1/audit`, { headers });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get('x-ratelimit-remaining'), '0');
  const rejected = await fetch(`${address.baseUrl}/v1/audit`, { headers: { ...headers, 'x-forwarded-for': '203.0.113.20' } });
  assert.equal(rejected.status, 429);
  assert.equal((await rejected.json()).error.code, 'rate_limited');
  assert.equal(rejected.headers.get('retry-after'), '60');
  assert.equal(hosted.metrics.snapshot(hosted.service, hosted.limiter).requests.rateLimited, 1);
  assert.equal((await fetch(`${address.baseUrl}/healthz`)).status, 200);
});

test('file hosted state store rejects corrupt or insecurely edited state content', async t => {
  const root = await mkdtemp(join(tmpdir(), 'physioflow-hosted-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'state.json');
  await writeFile(file, '{');
  await assert.rejects(() => new FileHostedStateStore(file).load(), /not valid JSON/);
  await writeFile(file, JSON.stringify({ schemaVersion: '1.1.0', deployments: [] }));
  await chmod(file, 0o600);
  await assert.rejects(() => new FileHostedStateStore(file).load(), /Invalid hosted state/);
  await assert.rejects(() => createHostedNodeServer({ actors, stateFile: join(root, 'missing-key.json') }), /credential protection requires at least one key/);
  await assert.rejects(() => createHostedNodeServer({ actors, stateFile: join(root, 'server.json'), assetDirectory: root, assetSecret: 'node-server-test-secret-at-least-32-characters', host: '0.0.0.0' }), /explicit HTTPS public base URL/);
  await assert.rejects(() => createHostedNodeServer({ actors, stateFile: join(root, 'server.json'), publicBaseUrl: 'http://experiments.example' }), /must use HTTPS/);
});
