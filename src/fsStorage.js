// fsStorage.js — persistence layer.
// Primary mode: user-selected local folder via File System Access API.
// Fallback mode: browser localStorage + IndexedDB when a folder is not selected.

import { loadSessionDetail, saveSessionDetail, deleteSessionDetail, saveCurrentDetail, loadCurrentDetail, clearCurrentDetail } from './dataStore.js';
import { loadAsset, saveAsset as idbSaveAsset, verifyProtocolAssets as verifyAssets } from './assetStore.js';
import { bundle as exporterBundle } from './exporter.js';
import { withSessionIntegrity } from './sessionReview.js';
import {
  activeWorkspace,
  clearWorkspaceHandle,
  listDirectories,
  listFiles,
  openWorkspaceDirectory,
  readBlob,
  readText,
  removeEntry,
  selectWorkspaceDirectory,
  supportsLocalWorkspace,
  workspaceInfo,
  writeBlob,
  writeText,
} from './localWorkspace.js';

export const localFolderSupported = supportsLocalWorkspace;
export const getStorageInfo = workspaceInfo;
export const selectDataDirectory = selectWorkspaceDirectory;
export const openDataDirectory = openWorkspaceDirectory;
export const clearDataDirectory = clearWorkspaceHandle;

async function hasWorkspace() {
  return Boolean(await activeWorkspace({ request: false }));
}

// ── Data directory ──
export async function getDataDir() {
  const info = await workspaceInfo();
  return info.selected ? info.name : null;
}

// ── Settings ──
export async function loadSettings() {
  const raw = await readText('settings.json');
  if (raw) { try { return JSON.parse(raw); } catch { return null; } }
  try {
    const fallback = localStorage.getItem('physioflow.settings');
    return fallback ? JSON.parse(fallback) : null;
  } catch { return null; }
}

export async function saveSettings(settings) {
  const json = JSON.stringify(settings, null, 2);
  if (await hasWorkspace()) { await writeText('settings.json', json); return; }
  try { localStorage.setItem('physioflow.settings', json); } catch { /* ignore */ }
}

// ── Projects ──
export async function saveProject(project) {
  if (await hasWorkspace()) {
    await writeText(`projects/${project.protocol_id}.json`, JSON.stringify(project, null, 2));
    return;
  }
  try {
    const existing = JSON.parse(localStorage.getItem('physioflow.protocols.v1') || '[]');
    const idx = existing.findIndex(p => p.protocol_id === project.protocol_id);
    if (idx >= 0) existing[idx] = project; else existing.push(project);
    localStorage.setItem('physioflow.protocols.v1', JSON.stringify(existing));
  } catch (err) {
    console.warn('Failed to save project to localStorage:', err);
    throw err;
  }
}

export async function loadProjects() {
  if (await hasWorkspace()) {
    const projects = [];
    for (const name of await listFiles('projects')) {
      if (!name.endsWith('.json')) continue;
      const raw = await readText(`projects/${name}`);
      if (raw) { try { projects.push(JSON.parse(raw)); } catch { /* skip corrupt file */ } }
    }
    return projects.sort((left, right) => String(left.created_at || '').localeCompare(String(right.created_at || '')));
  }
  try { return JSON.parse(localStorage.getItem('physioflow.protocols.v1')) || []; }
  catch { return []; }
}

export async function deleteProject(projectId) {
  if (await hasWorkspace()) {
    for (const project of await loadProjects()) {
      if (project.project_id === projectId) await removeEntry(`projects/${project.protocol_id}.json`);
    }
    return;
  }
  try {
    const existing = JSON.parse(localStorage.getItem('physioflow.protocols.v1') || '[]');
    localStorage.setItem('physioflow.protocols.v1', JSON.stringify(existing.filter(p => p.project_id !== projectId)));
  } catch { /* ignore */ }
}

export async function saveAllProjects(projects) {
  if (await hasWorkspace()) {
    const keep = new Set(projects.map(project => `${project.protocol_id}.json`));
    for (const name of await listFiles('projects')) {
      if (name.endsWith('.json') && !keep.has(name)) await removeEntry(`projects/${name}`);
    }
    for (const project of projects) await saveProject(project);
    return;
  }
  try { localStorage.setItem('physioflow.protocols.v1', JSON.stringify(projects)); }
  catch (err) {
    console.warn('Failed to save projects to localStorage:', err);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════
// Sessions
// ═══════════════════════════════════════════════════════════════

function sessionFolderName(session) {
  const participant = (session.participant_id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
  const date = (session.started_at || session.ended_at || new Date().toISOString()).substring(0, 10);
  const shortId = (session.session_id || 'x').substring(0, 8);
  return `${participant}_${date}_${shortId}`;
}

function sessionSummary(session, folder) {
  return {
    session_id: session.session_id,
    participant_id: session.participant_id,
    protocol_id: session.protocol_id,
    protocol_version: session.protocol_version,
    protocol_hash: session.protocol_hash,
    protocol_name: session.protocol_name,
    run_mode: session.run_mode || (session.protocol_hash ? 'formal' : 'preview'),
    status: session.status,
    started_at: session.started_at,
    ended_at: session.ended_at,
    event_count: session.event_count,
    integrity: session.integrity,
    notes: session.notes || '',
    researcher_validity: session.researcher_validity || 'unreviewed',
    _folder: folder,
  };
}

export async function saveSession(session) {
  const prepared = withSessionIntegrity(session);
  const folder = sessionFolderName(prepared);

  if (await hasWorkspace()) {
    const protocol = prepared.protocol_snapshot;
    const events = prepared.events || [];
    const responses = prepared.responses || [];
    const files = protocol ? exporterBundle(prepared, protocol, events, responses) : {};
    for (const [filename, content] of Object.entries(files)) await writeText(`sessions/${folder}/${filename}`, content);
    await writeText(`sessions/${folder}/session_detail.json`, JSON.stringify(prepared, null, 2));
    return;
  }

  try {
    const summaries = JSON.parse(localStorage.getItem('physioflow.sessions.v2') || '[]')
      .filter(s => s.session_id !== prepared.session_id);
    summaries.push(sessionSummary(prepared, folder));
    localStorage.setItem('physioflow.sessions.v2', JSON.stringify(summaries));
  } catch (err) { console.warn('Failed to sync session summary:', err); }

  try { await saveSessionDetail(prepared); } catch (err) { console.warn('IndexedDB session save failed:', err); }
}

export async function loadSessions() {
  if (await hasWorkspace()) {
    const sessions = [];
    for (const folder of await listDirectories('sessions')) {
      const raw = await readText(`sessions/${folder}/session_detail.json`) || await readText(`sessions/${folder}/session.json`);
      if (!raw) continue;
      try { sessions.push(sessionSummary(JSON.parse(raw), folder)); } catch { /* skip */ }
    }
    return sessions.sort((left, right) => String(left.started_at || '').localeCompare(String(right.started_at || '')));
  }
  try { return JSON.parse(localStorage.getItem('physioflow.sessions.v2')) || []; }
  catch { return []; }
}

export async function loadSession(sessionId) {
  if (await hasWorkspace()) {
    for (const folder of await listDirectories('sessions')) {
      const raw = await readText(`sessions/${folder}/session_detail.json`);
      if (!raw) continue;
      try {
        const session = JSON.parse(raw);
        if (session.session_id === sessionId) return session;
      } catch { /* skip */ }
    }
    return null;
  }
  try { return await loadSessionDetail(sessionId); } catch { return null; }
}

export async function deleteSession(sessionId) {
  if (await hasWorkspace()) {
    for (const folder of await listDirectories('sessions')) {
      const raw = await readText(`sessions/${folder}/session_detail.json`) || await readText(`sessions/${folder}/session.json`);
      if (!raw) continue;
      try {
        if (JSON.parse(raw).session_id === sessionId) {
          await removeEntry(`sessions/${folder}`);
          return;
        }
      } catch { /* skip */ }
    }
    return;
  }
  try {
    const summaries = JSON.parse(localStorage.getItem('physioflow.sessions.v2') || '[]')
      .filter(s => s.session_id !== sessionId);
    localStorage.setItem('physioflow.sessions.v2', JSON.stringify(summaries));
  } catch { /* ignore */ }
  try { await deleteSessionDetail(sessionId); } catch { /* ignore */ }
}

export async function updateSession(sessionId, changes) {
  const session = await loadSession(sessionId);
  if (session) {
    await saveSession({ ...session, ...changes });
    return;
  }
  if (await hasWorkspace()) return;
  try {
    const summaries = JSON.parse(localStorage.getItem('physioflow.sessions.v2') || '[]');
    localStorage.setItem('physioflow.sessions.v2',
      JSON.stringify(summaries.map(s => s.session_id === sessionId ? { ...s, ...changes } : s)));
  } catch { /* ignore */ }
}

// ── Current run (recovery snapshot) ──
export async function saveCurrentRun(snapshot) {
  if (await hasWorkspace()) {
    await writeText('current_run.json', JSON.stringify(snapshot, null, 2));
    return;
  }
  try {
    localStorage.setItem('physioflow.current-run-pointer.v2',
      JSON.stringify({ session_id: snapshot.session?.session_id, saved_at: snapshot.saved_at }));
  } catch { /* ignore */ }
  await saveCurrentDetail(snapshot);
}

export async function loadCurrentRun() {
  if (await hasWorkspace()) {
    const raw = await readText('current_run.json');
    if (raw) { try { return JSON.parse(raw); } catch { return null; } }
    return null;
  }
  return loadCurrentDetail();
}

export async function clearCurrentRun() {
  if (await hasWorkspace()) {
    await removeEntry('current_run.json');
    return;
  }
  try { localStorage.removeItem('physioflow.current-run-pointer.v2'); } catch { /* ignore */ }
  await clearCurrentDetail();
}

// ── Assets ──
export async function saveAsset(file) {
  if (!file || !(file instanceof File)) throw new Error('Invalid file');
  if (!(await hasWorkspace())) return idbSaveAsset(file);

  const id = `asset_${crypto.randomUUID()}`;
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const checksum = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const meta = { id, name: file.name, type: file.type, size: file.size, checksum, updated_at: new Date().toISOString() };
  await writeBlob(`assets/${id}.bin`, new Blob([buffer], { type: file.type }));
  await writeText(`assets/${id}.meta.json`, JSON.stringify(meta, null, 2));
  return { asset_id: id, file_name: file.name, mime_type: file.type, file_size: file.size, checksum };
}

export async function loadAssetFile(id) {
  if (!id) return null;
  if (await hasWorkspace()) {
    const metaRaw = await readText(`assets/${id}.meta.json`);
    const blob = await readBlob(`assets/${id}.bin`);
    if (!metaRaw || !blob) return null;
    const meta = JSON.parse(metaRaw);
    return { id, file: blob, name: meta.name, type: meta.type, size: meta.size, checksum: meta.checksum };
  }
  try { return await loadAsset(id); } catch { return null; }
}

export async function verifyProtocolAssets(protocol) {
  if (!(await hasWorkspace())) return verifyAssets(protocol);
  const issues = [];
  const resources = [
    ...(protocol.stimuli || []),
    ...(protocol.blocks || []).flatMap(block => (block.trials || []).flatMap(trial => trial.steps || [])),
  ];
  const refs = [...new Map(resources.filter(item => item.asset_id).map(item => [item.asset_id, item])).values()];
  for (const ref of refs) {
    const asset = await loadAssetFile(ref.asset_id);
    if (!asset) { issues.push({ asset_id: ref.asset_id, type: 'missing', message: `Missing local asset ${ref.file_name || ref.asset_id}` }); continue; }
    if (ref.checksum && asset.checksum && ref.checksum !== asset.checksum) issues.push({ asset_id: ref.asset_id, type: 'checksum_mismatch', message: `Checksum mismatch for ${ref.file_name || ref.asset_id}` });
  }
  return { valid: issues.length === 0, issues };
}
