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

const actors = [{ actorId: 'node-owner', role: 'owner', accessToken: 'node-owner-token' }];

async function fixture(root) {
  const content = Buffer.from('verified hosted asset');
  const checksum = `sha256:${createHash('sha256').update(content).digest('hex')}`;
  const protocol = createProtocolGraph({ idFactory: createSequentialIdFactory(), name: 'Hosted Node Server', now: '2026-08-23T00:00:00.000Z' });
  protocol.assets = [{ id: 'asset_node', name: 'Node asset', mediaType: 'text/plain', checksum }];
  const frozen = await freezeProtocolGraph(protocol, createCoreComponentRegistry(), { now: '2026-08-23T01:00:00.000Z' });
  const bundle = await createDeploymentBundle(frozen, { bundleId: 'node_server_bundle', createdAt: '2026-08-23T02:00:00.000Z' });
  await mkdir(join(root, 'assets', bundle.bundleId), { recursive: true });
  await writeFile(join(root, 'assets', bundle.bundleId, 'asset_node'), content);
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'dist', 'index.html'), '<!doctype html><title>Hosted participant</title><main>participant application</main>');
  return { bundle, content };
}

function serverOptions(root, sequence) {
  let id = sequence;
  return {
    actors,
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
  const deployment = await owner.publish(bundle, { idempotencyKey: 'node-publish' });
  await owner.processNextDeployment();
  const link = await owner.createLaunchLink(deployment.deploymentId, { idempotencyKey: 'node-link', maximumUses: 1 });
  assert.match(await fetch(`${firstAddress.baseUrl}/participant`).then(response => response.text()), /participant application/);
  assert.deepEqual(await fetch(`${firstAddress.baseUrl}/healthz`).then(response => response.json()), { status: 'ok' });
  await first.close();

  const persisted = JSON.parse(await readFile(join(root, 'state', 'hosted.json'), 'utf8'));
  assert.equal(persisted.deployments.length, 1);
  assert.equal((await stat(join(root, 'state', 'hosted.json'))).mode & 0o777, 0o600);

  const restarted = await createHostedNodeServer(serverOptions(root, 100));
  t.after(async () => restarted.close());
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
  const tampered = new URL(resource.delivery.url);
  tampered.searchParams.set('type', 'text/html');
  assert.equal((await fetch(tampered)).status, 403);
  await writeFile(join(root, 'assets', bundle.bundleId, 'asset_node'), 'replaced asset content');
  assert.equal((await fetch(resource.delivery.url)).status, 409);
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
  await assert.rejects(() => createHostedNodeServer({ actors, stateFile: join(root, 'server.json'), assetDirectory: root, assetSecret: 'node-server-test-secret-at-least-32-characters', host: '0.0.0.0' }), /explicit HTTPS public base URL/);
  await assert.rejects(() => createHostedNodeServer({ actors, stateFile: join(root, 'server.json'), publicBaseUrl: 'http://experiments.example' }), /must use HTTPS/);
});
