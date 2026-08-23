import { resolve } from 'node:path';
import { createHostedBackup, restoreHostedBackup, verifyHostedBackup } from './hostedBackup.mjs';

const [command, first, second, third] = process.argv.slice(2);

if (command === 'create') {
  if (!first) throw new Error('Usage: npm run hosted:backup -- <destination>');
  const result = await createHostedBackup({
    stateFile: resolve(process.env.PHYSIOFLOW_STATE_FILE || './var/hosted-state.json'),
    assetDirectory: process.env.PHYSIOFLOW_ASSET_DIR ? resolve(process.env.PHYSIOFLOW_ASSET_DIR) : null,
    destination: resolve(first),
  });
  console.log(JSON.stringify({ status: 'created', destination: result.destination, files: result.manifest.files.length }, null, 2));
} else if (command === 'verify') {
  if (!first) throw new Error('Usage: npm run hosted:backup:verify -- <backup-directory>');
  const result = await verifyHostedBackup(resolve(first));
  console.log(JSON.stringify({ status: 'valid', files: result.fileCount, bytes: result.totalBytes }, null, 2));
} else if (command === 'restore') {
  if (!first || !second) throw new Error('Usage: npm run hosted:restore -- <backup-directory> <new-state-file> [new-asset-directory]');
  const result = await restoreHostedBackup({ backupDirectory: resolve(first), stateFile: resolve(second), assetDirectory: third ? resolve(third) : null });
  console.log(JSON.stringify({ status: 'restored', stateFile: result.stateFile, assetDirectory: result.assetDirectory }, null, 2));
} else {
  throw new Error('Hosted backup command must be create, verify, or restore');
}
