const DB_NAME = 'physioflow-data-v1', DB_VERSION = 1, SESSIONS = 'sessions', CURRENT = 'current';

// Single shared connection — reused across calls
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSIONS)) db.createObjectStore(SESSIONS, { keyPath: 'session_id' });
      if (!db.objectStoreNames.contains(CURRENT)) db.createObjectStore(CURRENT, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { dbPromise = null; reject(request.error); };
    request.onblocked = () => { dbPromise = null; reject(new Error('Database blocked — close other tabs')); };
  });
  return dbPromise;
}

async function put(store, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error('Transaction aborted'));
    } catch (err) { reject(err); }
  });
}

async function get(store, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    try {
      const request = db.transaction(store).objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    } catch (err) { reject(err); }
  });
}

async function remove(store, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error('Delete transaction aborted'));
    } catch (err) { reject(err); }
  });
}

export const saveSessionDetail = async (session) => { try { await put(SESSIONS, session); } catch (err) { console.warn('Failed to save session detail:', err); } };
export const loadSessionDetail = async (sessionId) => { try { return await get(SESSIONS, sessionId); } catch (err) { console.warn('Failed to load session detail:', err); return null; } };
export const deleteSessionDetail = async (sessionId) => { try { await remove(SESSIONS, sessionId); } catch (err) { console.warn('Failed to delete session detail:', err); } };
export const saveCurrentDetail = async (snapshot) => { try { await put(CURRENT, { ...snapshot, id: 'active' }); } catch (err) { console.warn('Failed to save current run:', err); } };
export const loadCurrentDetail = async () => {
  try {
    const value = await get(CURRENT, 'active');
    if (value) delete value.id;
    return value;
  } catch (err) { console.warn('Failed to load current run:', err); return null; }
};
export const clearCurrentDetail = async () => { try { await remove(CURRENT, 'active'); } catch (err) { console.warn('Failed to clear current run:', err); } };
