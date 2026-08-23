import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoreComponentRegistry, createProtocolGraph, createSequentialIdFactory, freezeProtocolGraph, hashProtocolGraph } from '../src/core/index.js';
import { createDeploymentBundle, uploadDeploymentAssets, workspaceDeploymentAssets } from '../src/deployment/index.js';

const checksum = 'a'.repeat(64);

test('deployment asset coordinator uploads every workspace dependency and confirms readiness', async () => {
  const bundle = { dependencies: { assets: [
    { id: 'workspace_image', name: 'Image', mediaType: 'image/png', checksum: `sha256:${checksum}`, source: 'workspace' },
    { id: 'remote_video', name: 'Video', mediaType: 'video/mp4', checksum: null, source: 'remote' },
  ] } };
  const calls = [];
  const progress = [];
  const client = {
    async uploadDeploymentAsset(deploymentId, assetId, content, options) { calls.push({ deploymentId, assetId, content, options }); return { assetId, status: 'ready' }; },
    async deploymentAssets(deploymentId) { return { deploymentId, ready: true, assets: [{ id: 'workspace_image', status: 'ready' }] }; },
  };
  const result = await uploadDeploymentAssets({ client, deploymentId: 'deployment_1', bundle, loadAsset: async () => ({ content: new Uint8Array([1, 2, 3]), checksum, type: 'image/png' }), onProgress: item => progress.push(item) });
  assert.deepEqual(workspaceDeploymentAssets(bundle).map(asset => asset.id), ['workspace_image']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.mediaType, 'image/png');
  assert.equal(progress[0].total, 1);
  assert.equal(result.status.ready, true);
});

test('deployment asset coordinator stops on missing or mismatched local content', async () => {
  const bundle = { dependencies: { assets: [{ id: 'asset_required', name: 'Required', mediaType: 'text/plain', checksum, source: 'workspace' }] } };
  const client = { uploadDeploymentAsset() { throw new Error('must not upload'); }, deploymentAssets() { return { ready: false }; } };
  await assert.rejects(() => uploadDeploymentAssets({ client, deploymentId: 'deployment_2', bundle, loadAsset: async () => null }), /unavailable locally/);
  await assert.rejects(() => uploadDeploymentAssets({ client, deploymentId: 'deployment_2', bundle, loadAsset: async () => ({ content: 'x', checksum: 'b'.repeat(64) }) }), /checksum does not match/);
});

test('deployment bundles normalize legacy asset fields and require workspace integrity', async () => {
  const ids = createSequentialIdFactory();
  const protocol = createProtocolGraph({ idFactory: ids, now: '2026-08-23T00:00:00.000Z' });
  protocol.assets = [{ asset_id: 'legacy_asset', file_name: 'legacy.png', mime_type: 'image/png', checksum }];
  const frozen = await freezeProtocolGraph(protocol, createCoreComponentRegistry(), { now: '2026-08-23T01:00:00.000Z' });
  const bundle = await createDeploymentBundle(frozen, { createdAt: '2026-08-23T02:00:00.000Z' });
  assert.deepEqual(bundle.dependencies.assets[0], { id: 'legacy_asset', name: 'legacy.png', mediaType: 'image/png', checksum, source: 'workspace' });
  const invalid = structuredClone(frozen);
  invalid.assets[0].checksum = '';
  invalid.freeze.configHash = await hashProtocolGraph(invalid);
  await assert.rejects(() => createDeploymentBundle(invalid), /requires a SHA-256 checksum/);
});
