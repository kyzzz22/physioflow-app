import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const SAFE_ID = /^[A-Za-z0-9._-]+$/;
const SAFE_MEDIA_TYPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i;

function safeId(value, label) {
  if (!SAFE_ID.test(value || '')) throw new Error(`Hosted asset ${label} is invalid`);
  return value;
}

function assetPath(rootDirectory, bundleId, assetId) {
  const root = resolve(rootDirectory);
  const file = resolve(root, safeId(bundleId, 'bundle ID'), safeId(assetId, 'ID'));
  if (!file.startsWith(`${root}${sep}`)) throw new Error('Hosted asset path escapes its root');
  return file;
}

function signature(secret, pathname, expires, mediaType, checksum) {
  return createHmac('sha256', secret).update(`${pathname}\n${expires}\n${mediaType}\n${checksum}`).digest('hex');
}

function equalSignature(left, right) {
  if (!left?.match(/^[a-f0-9]{64}$/) || !right?.match(/^[a-f0-9]{64}$/)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function verifyContentChecksum(content, checksum) {
  if (!checksum) return;
  const expected = checksum.replace(/^sha256:/, '');
  if (!expected.match(/^[a-f0-9]{64}$/i)) throw new Error('Hosted asset checksum must be SHA-256');
  const actual = createHash('sha256').update(content).digest('hex');
  if (actual !== expected.toLowerCase()) throw new Error('Hosted asset content does not match its checksum');
}

async function verifyChecksum(file, checksum) { verifyContentChecksum(await readFile(file), checksum); }

export function createFilesystemAssetDelivery(options = {}) {
  if (!options.rootDirectory) throw new Error('Filesystem asset delivery requires a root directory');
  if (!options.secret || String(options.secret).length < 32) throw new Error('Filesystem asset delivery requires a secret of at least 32 characters');
  const clock = options.clock || (() => Date.now());
  const ttlMs = options.ttlMs || 15 * 60 * 1000;
  const publicBaseUrl = typeof options.publicBaseUrl === 'function' ? options.publicBaseUrl : () => options.publicBaseUrl;

  return {
    async resolve(asset, context) {
      const assetId = safeId(asset.id || asset.assetId, 'ID');
      const bundleId = safeId(context.bundleId, 'bundle ID');
      const file = assetPath(options.rootDirectory, bundleId, assetId);
      const details = await stat(file);
      if (!details.isFile()) throw new Error('Hosted asset is not a file');
      await verifyChecksum(file, asset.checksum || asset.hash);
      const mediaType = SAFE_MEDIA_TYPE.test(asset.mediaType || asset.type || '') ? asset.mediaType || asset.type : 'application/octet-stream';
      const checksum = asset.checksum || asset.hash || '';
      const expires = String(clock() + ttlMs);
      const pathname = `/assets/${encodeURIComponent(bundleId)}/${encodeURIComponent(assetId)}`;
      const token = signature(options.secret, pathname, expires, mediaType, checksum);
      return { mode: 'signed', url: `${publicBaseUrl()}${pathname}?expires=${expires}&type=${encodeURIComponent(mediaType)}&checksum=${encodeURIComponent(checksum)}&signature=${token}`, checksum: checksum || null, expiresAt: new Date(Number(expires)).toISOString() };
    },

    async response(request) {
      const url = new URL(request.url);
      const match = url.pathname.match(/^\/assets\/([^/]+)\/([^/]+)$/);
      if (!match) return null;
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
      let bundleId;
      let assetId;
      try { bundleId = decodeURIComponent(match[1]); assetId = decodeURIComponent(match[2]); }
      catch { return new Response('Invalid asset path', { status: 400 }); }
      const expires = url.searchParams.get('expires') || '';
      const mediaType = url.searchParams.get('type') || '';
      const checksum = url.searchParams.get('checksum') || '';
      const supplied = url.searchParams.get('signature') || '';
      const expected = signature(options.secret, url.pathname, expires, mediaType, checksum);
      if (!Number.isFinite(Number(expires)) || Number(expires) < clock() || !SAFE_MEDIA_TYPE.test(mediaType) || !equalSignature(supplied, expected)) return new Response('Asset link is invalid or expired', { status: 403, headers: { 'cache-control': 'no-store' } });
      try {
        const content = await readFile(assetPath(options.rootDirectory, bundleId, assetId));
        try { verifyContentChecksum(content, checksum); }
        catch { return new Response('Asset checksum mismatch', { status: 409, headers: { 'cache-control': 'no-store' } }); }
        return new Response(content, { headers: { 'content-type': mediaType, 'content-length': String(content.length), 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' } });
      } catch (error) {
        if (error?.code === 'ENOENT') return new Response('Asset not found', { status: 404 });
        return new Response('Asset delivery failed', { status: 500 });
      }
    },
  };
}
