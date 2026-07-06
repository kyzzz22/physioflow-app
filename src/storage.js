// storage.js — Compatibility layer
// Delegates to fsStorage.js (local folder first, browser fallback)
// All existing callers continue to work with the same API

import {
  clearDataDirectory as _clearDataDirectory,
  getStorageInfo as _getStorageInfo,
  loadProjects as _loadProjects,
  openDataDirectory as _openDataDirectory,
  saveAllProjects,
  selectDataDirectory as _selectDataDirectory,
  loadSessions as _loadSessions,
  saveSession as _saveSession,
  loadSession as _loadSession,
  deleteSession as _deleteSession,
  updateSession as _updateSession,
  saveCurrentRun as _saveCurrentRun,
  loadCurrentRun as _loadCurrentRun,
  clearCurrentRun as _clearCurrentRun,
} from './fsStorage.js';

export const getStorageInfo = async () => {
  try { return await _getStorageInfo(); }
  catch { return { supported: false, selected: false, name: '', permission: 'missing' }; }
};

export const selectDataDirectory = async () => _selectDataDirectory();
export const openDataDirectory = async () => _openDataDirectory();
export const clearDataDirectory = async () => _clearDataDirectory();

export const loadSession = async (sessionId) => {
  try { return await _loadSession(sessionId); }
  catch { return null; }
};

// ── Protocols ──
export const loadProtocols = async () => {
  try { return await _loadProjects(); }
  catch { return []; }
};

export const saveProtocols = async (protocols) => {
  try { await saveAllProjects(protocols); }
  catch (err) { console.warn('Failed to save protocols:', err); throw err; }
};

// ── Sessions ──
export const loadSessions = async () => {
  try { return await _loadSessions(); }
  catch { return []; }
};

export const saveSession = async (session) => {
  try { await _saveSession(session); }
  catch (err) { console.warn('Failed to save session:', err); throw err; }
};

export const updateSession = async (sessionId, changes) => {
  try { await _updateSession(sessionId, changes); }
  catch (err) { console.warn('Failed to update session:', err); }
};

export const deleteSession = async (sessionId) => {
  try { await _deleteSession(sessionId); }
  catch (err) { console.warn('Failed to delete session:', err); }
};

// ── Current run (recovery) ──
export const saveCurrentRun = async (snapshot) => {
  try { await _saveCurrentRun(snapshot); }
  catch (err) { console.warn('Failed to save current run:', err); }
};

export const loadCurrentRun = () => null; // sync fallback — always use async

export const loadCurrentRunAsync = async () => {
  try { return await _loadCurrentRun(); }
  catch (err) { console.warn('Failed to load current run:', err); return null; }
};

export const clearCurrentRun = async () => {
  try { await _clearCurrentRun(); }
  catch (err) { console.warn('Failed to clear current run:', err); }
};
