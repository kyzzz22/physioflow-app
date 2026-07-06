import { activeWorkspace, readBlob, readText, writeBlob, writeText } from './localWorkspace.js';

const DB_NAME = 'physioflow-assets-v1';
const STORE = 'assets';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { dbPromise = null; reject(request.error); };
    request.onblocked = () => { dbPromise = null; reject(new Error('Asset DB blocked — close other tabs')); };
  });
  return dbPromise;
}

export async function saveAsset(file) {
  if (!file || !(file instanceof File)) throw new Error('Invalid file');
  if (await activeWorkspace({ request: false })) {
    const id = `asset_${crypto.randomUUID()}`;
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const checksum = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const meta = { id, name: file.name, type: file.type, size: file.size, checksum, updated_at: new Date().toISOString() };
    await writeBlob(`assets/${id}.bin`, new Blob([buffer], { type: file.type }));
    await writeText(`assets/${id}.meta.json`, JSON.stringify(meta, null, 2));
    return { asset_id: id, file_name: file.name, mime_type: file.type, file_size: file.size, checksum };
  }
  const db = await openDb();
  const id = `asset_${crypto.randomUUID()}`;
  let checksum = '';
  try {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    checksum = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  } catch (err) { console.warn('Could not compute SHA-256 for', file.name, err); }

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ id, file, name: file.name, type: file.type, size: file.size, checksum, updated_at: new Date().toISOString() });
      tx.oncomplete = () => resolve({ asset_id: id, file_name: file.name, mime_type: file.type, file_size: file.size, checksum });
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error('Asset save aborted'));
    } catch (err) { reject(err); }
  });
}

export async function loadAsset(id) {
  if (!id) return null;
  if (await activeWorkspace({ request: false })) {
    const metaRaw = await readText(`assets/${id}.meta.json`);
    const file = await readBlob(`assets/${id}.bin`);
    if (!metaRaw || !file) return null;
    const meta = JSON.parse(metaRaw);
    return { id, file, name: meta.name, type: meta.type, size: meta.size, checksum: meta.checksum };
  }
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      try {
        const request = db.transaction(STORE).objectStore(STORE).get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      } catch (err) { reject(err); }
    });
  } catch (err) { console.warn('Failed to load asset', id, ':', err); return null; }
}

export function protocolAssetReferences(protocol) {
  try {
    const resources = [...(protocol.stimuli || []), ...(protocol.blocks || []).flatMap(block => (block.trials || []).flatMap(trial => trial.steps || []))];
    return [...new Map(resources.filter(item => item.asset_id).map(item => [item.asset_id, { asset_id: item.asset_id, file_name: item.file_name || '', checksum: item.checksum || '' }])).values()];
  } catch { return []; }
}

export async function verifyProtocolAssets(protocol, loader = loadAsset) {
  const issues = [];
  try {
    for (const reference of protocolAssetReferences(protocol)) {
      try {
        const asset = await loader(reference.asset_id);
        if (!asset) { issues.push({ asset_id: reference.asset_id, type: 'missing', message: `Missing local asset ${reference.file_name || reference.asset_id}` }); continue; }
        if (reference.checksum && asset.checksum && asset.checksum !== reference.checksum) issues.push({ asset_id: reference.asset_id, type: 'checksum_mismatch', message: `Checksum mismatch for ${reference.file_name || reference.asset_id}` });
      } catch (err) { issues.push({ asset_id: reference.asset_id, type: 'load_error', message: `Failed to load ${reference.file_name || reference.asset_id}: ${err.message}` }); }
    }
  } catch (err) { issues.push({ asset_id: '', type: 'verification_error', message: `Asset verification failed: ${err.message}` }); }
  return { valid: issues.length === 0, issues };
}
