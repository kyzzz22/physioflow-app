import { resolve } from 'node:path';
import { createHostedNodeServer } from './createHostedNodeServer.mjs';

function jsonEnvironment(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try { return JSON.parse(raw); }
  catch { throw new Error(`${name} must contain valid JSON`); }
}

const actors = jsonEnvironment('PHYSIOFLOW_ACTORS_JSON', null);
if (!Array.isArray(actors) || !actors.length) throw new Error('Set PHYSIOFLOW_ACTORS_JSON to a non-empty actor credential array');
const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
const stateFile = resolve(process.env.PHYSIOFLOW_STATE_FILE || './var/hosted-state.json');
const staticDirectory = process.env.PHYSIOFLOW_STATIC_DIR ? resolve(process.env.PHYSIOFLOW_STATIC_DIR) : resolve('./dist');
const assetDirectory = process.env.PHYSIOFLOW_ASSET_DIR ? resolve(process.env.PHYSIOFLOW_ASSET_DIR) : null;
const allowedOrigins = jsonEnvironment('PHYSIOFLOW_ALLOWED_ORIGINS_JSON', null);
const maximumAssetBytes = Number(process.env.PHYSIOFLOW_MAX_ASSET_BYTES || 250 * 1024 * 1024);
if (!Number.isInteger(maximumAssetBytes) || maximumAssetBytes < 1) throw new Error('PHYSIOFLOW_MAX_ASSET_BYTES must be a positive integer');

const hosted = await createHostedNodeServer({
  actors,
  port,
  host: process.env.HOST || '127.0.0.1',
  stateFile,
  staticDirectory,
  assetDirectory,
  assetSecret: process.env.PHYSIOFLOW_ASSET_SECRET,
  publicBaseUrl: process.env.PHYSIOFLOW_PUBLIC_BASE_URL || null,
  allowedOrigins,
  maximumAssetBytes,
});
const listening = await hosted.listen();
console.log(`PhysioFlow hosted service listening at ${listening.baseUrl}`);

let closing = false;
const close = async signal => {
  if (closing) return;
  closing = true;
  await hosted.close();
  process.exit(signal === 'SIGTERM' ? 0 : 130);
};
process.on('SIGINT', () => close('SIGINT'));
process.on('SIGTERM', () => close('SIGTERM'));
