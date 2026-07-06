import * as tauriStorage from './tauriStorage.js';

const DB_NAME = 'physioflow-workspace-v1';
const STORE = 'handles';
const KEY = 'data-directory';

let dbPromise = null;
let cachedHandle = null;

export function supportsLocalWorkspace() {
  return tauriStorage.isTauriRuntime() || (typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined');
}

function openDb() {
  if (!supportsLocalWorkspace()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { dbPromise = null; reject(request.error); };
    request.onblocked = () => { dbPromise = null; reject(new Error('Workspace DB blocked — close other tabs')); };
  });
  return dbPromise;
}

async function saveHandle(handle) {
  const db = await openDb();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Workspace handle save aborted'));
  });
}

async function loadHandle() {
  if (cachedHandle) return cachedHandle;
  const db = await openDb();
  if (!db) return null;
  cachedHandle = await new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  return cachedHandle;
}

export async function clearWorkspaceHandle() {
  if (tauriStorage.isTauriRuntime()) return;
  cachedHandle = null;
  const db = await openDb();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function permission(handle, request = false) {
  if (!handle) return 'missing';
  const options = { mode: 'readwrite' };
  if (await handle.queryPermission(options) === 'granted') return 'granted';
  if (request && await handle.requestPermission(options) === 'granted') return 'granted';
  return 'denied';
}

export async function selectWorkspaceDirectory() {
  if (tauriStorage.isTauriRuntime()) return tauriStorage.selectDataDirectory();
  if (!supportsLocalWorkspace()) throw new Error('This browser does not support choosing a local data folder. Use Chrome or Edge.');
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  if (await permission(handle, true) !== 'granted') throw new Error('Permission to write this folder was not granted.');
  cachedHandle = handle;
  await saveHandle(handle);
  await ensureDir('projects');
  await ensureDir('sessions');
  await ensureDir('assets');
  return handle;
}

export async function openWorkspaceDirectory() {
  if (tauriStorage.isTauriRuntime()) return tauriStorage.openDataDirectory();
  throw new Error('Opening the data folder directly is only available in the desktop app.');
}

export async function workspaceInfo() {
  if (tauriStorage.isTauriRuntime()) return tauriStorage.storageInfo();
  const handle = await loadHandle();
  return {
    supported: supportsLocalWorkspace(),
    selected: Boolean(handle),
    name: handle?.name || '',
    permission: handle ? await permission(handle, false) : 'missing',
  };
}

export async function activeWorkspace({ request = false } = {}) {
  if (tauriStorage.isTauriRuntime()) return { kind: 'tauri' };
  const handle = await loadHandle();
  if (!handle) return null;
  return await permission(handle, request) === 'granted' ? handle : null;
}

export async function ensureDir(path) {
  if (tauriStorage.isTauriRuntime()) return { kind: 'tauri', path };
  const root = await activeWorkspace({ request: false });
  if (!root) return null;
  let dir = root;
  for (const part of path.split('/').filter(Boolean)) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
}

async function getParentDir(filePath, create = false) {
  const parts = filePath.split('/').filter(Boolean);
  const filename = parts.pop();
  let dir = await activeWorkspace({ request: false });
  if (!dir) return null;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
  return { dir, filename };
}

export async function writeText(filePath, text) {
  if (tauriStorage.isTauriRuntime()) return tauriStorage.writeText(filePath, text);
  const target = await getParentDir(filePath, true);
  if (!target) return false;
  const file = await target.dir.getFileHandle(target.filename, { create: true });
  const writable = await file.createWritable();
  await writable.write(text);
  await writable.close();
  return true;
}

export async function readText(filePath) {
  if (tauriStorage.isTauriRuntime()) return tauriStorage.readText(filePath);
  try {
    const target = await getParentDir(filePath, false);
    if (!target) return null;
    const file = await target.dir.getFileHandle(target.filename);
    return await (await file.getFile()).text();
  } catch { return null; }
}

export async function writeBlob(filePath, blob) {
  if (tauriStorage.isTauriRuntime()) return tauriStorage.writeBlob(filePath, blob);
  const target = await getParentDir(filePath, true);
  if (!target) return false;
  const file = await target.dir.getFileHandle(target.filename, { create: true });
  const writable = await file.createWritable();
  await writable.write(blob);
  await writable.close();
  return true;
}

export async function readBlob(filePath) {
  if (tauriStorage.isTauriRuntime()) return tauriStorage.readBlob(filePath);
  try {
    const target = await getParentDir(filePath, false);
    if (!target) return null;
    const file = await target.dir.getFileHandle(target.filename);
    return await file.getFile();
  } catch { return null; }
}

export async function removeEntry(path) {
  if (tauriStorage.isTauriRuntime()) return tauriStorage.removeEntry(path);
  try {
    const target = await getParentDir(path, false);
    if (!target) return false;
    await target.dir.removeEntry(target.filename, { recursive: true });
    return true;
  } catch { return false; }
}

export async function listFiles(path) {
  if (tauriStorage.isTauriRuntime()) return tauriStorage.listFiles(path);
  try {
    const root = await activeWorkspace({ request: false });
    if (!root) return [];
    let dir = root;
    for (const part of path.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(part);
    const files = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file') files.push(name);
    }
    return files.sort();
  } catch { return []; }
}

export async function listDirectories(path) {
  if (tauriStorage.isTauriRuntime()) return tauriStorage.listDirectories(path);
  try {
    const root = await activeWorkspace({ request: false });
    if (!root) return [];
    let dir = root;
    for (const part of path.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(part);
    const dirs = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'directory') dirs.push(name);
    }
    return dirs.sort();
  } catch { return []; }
}
