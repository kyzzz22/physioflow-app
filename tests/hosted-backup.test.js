import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHostedBackup, restoreHostedBackup, verifyHostedBackup } from '../server/hostedBackup.mjs';
import { FileHostedStateStore } from '../server/fileHostedStateStore.mjs';
import { HOSTED_STATE_SCHEMA_VERSION } from '../src/hosted/index.js';
import { assertFileMode } from './helpers/assertFileMode.js';

function emptyState() {
  return { schemaVersion: HOSTED_STATE_SCHEMA_VERSION, deployments: [], sessions: [], participantTokens: [], launchLinks: [], launchTokens: [], idempotency: [], auditEntries: [] };
}

test('hosted backup creates a private verified inventory and restores only to new targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'physioflow-backup-'));
  const stateFile = join(root, 'source', 'state.json');
  const assetDirectory = join(root, 'source', 'assets');
  await new FileHostedStateStore(stateFile).save(emptyState());
  await mkdir(join(assetDirectory, 'bundle_1'), { recursive: true });
  await writeFile(join(assetDirectory, 'bundle_1', 'asset_1'), 'experiment media');

  const destination = join(root, 'backup-1');
  const created = await createHostedBackup({ stateFile, assetDirectory, destination, createdAt: '2026-08-23T08:00:00.000Z' });
  assert.equal(created.manifest.files.length, 2);
  assert.equal(created.manifest.source.includesAssets, true);
  const verified = await verifyHostedBackup(destination);
  assert.equal(verified.valid, true);
  await assertFileMode(join(destination, 'state.json'), 0o600);
  await assertFileMode(join(destination, 'assets', 'bundle_1', 'asset_1'), 0o600);

  const restoredState = join(root, 'restored', 'state.json');
  const restoredAssets = join(root, 'restored', 'assets');
  await restoreHostedBackup({ backupDirectory: destination, stateFile: restoredState, assetDirectory: restoredAssets });
  assert.deepEqual(await new FileHostedStateStore(restoredState).load(), emptyState());
  assert.equal(await readFile(join(restoredAssets, 'bundle_1', 'asset_1'), 'utf8'), 'experiment media');
  await assert.rejects(() => restoreHostedBackup({ backupDirectory: destination, stateFile: restoredState, assetDirectory: join(root, 'another-assets') }), /already exists/);
  await assert.rejects(() => createHostedBackup({ stateFile, assetDirectory, destination }), /already exists/);
});

test('hosted backup verification rejects content tampering and symbolic-link assets', async t => {
  const root = await mkdtemp(join(tmpdir(), 'physioflow-backup-invalid-'));
  const stateFile = join(root, 'state.json');
  await new FileHostedStateStore(stateFile).save(emptyState());
  const destination = join(root, 'backup');
  await createHostedBackup({ stateFile, destination });
  await writeFile(join(destination, 'state.json'), '{}\n');
  await assert.rejects(() => verifyHostedBackup(destination), /checksum mismatch/);

  const assets = join(root, 'assets');
  await mkdir(assets);
  const external = join(root, 'external.txt');
  await writeFile(external, 'outside');
  try {
    const { symlink } = await import('node:fs/promises');
    await symlink(external, join(assets, 'linked'));
  } catch (error) {
    if (process.platform === 'win32') { t.skip(`Symbolic links unavailable: ${error.message}`); return; }
    throw error;
  }
  await assert.rejects(() => createHostedBackup({ stateFile, assetDirectory: assets, destination: join(root, 'linked-backup') }), /symbolic link/);
});
