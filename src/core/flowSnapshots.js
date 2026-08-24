// Flow snapshots for Composer V2 — named, restorable node-layout checkpoints.
// Pure helpers are testable; localStorage wrappers guard for non-browser runtimes.

const STORE_KEY = protocolId => `physioflow.graph-snapshots.${protocolId}`;
export const MAX_FLOW_SNAPSHOTS = 20;

export function mergeFlowSnapshot(snapshots, snapshot) {
  return [...(snapshots || []).filter(item => item.id !== snapshot.id), snapshot].slice(-MAX_FLOW_SNAPSHOTS);
}

export function withoutFlowSnapshot(snapshots, snapshotId) {
  return (snapshots || []).filter(item => item.id !== snapshotId);
}

export function loadFlowSnapshots(protocolId) {
  if (typeof localStorage === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(STORE_KEY(protocolId))) || []; } catch { return []; }
}

export function saveFlowSnapshot(protocolId, snapshot) {
  const next = mergeFlowSnapshot(loadFlowSnapshots(protocolId), snapshot);
  if (typeof localStorage !== 'undefined') {
    try { localStorage.setItem(STORE_KEY(protocolId), JSON.stringify(next)); } catch { /* storage unavailable */ }
  }
  return next;
}

export function removeFlowSnapshot(protocolId, snapshotId) {
  const next = withoutFlowSnapshot(loadFlowSnapshots(protocolId), snapshotId);
  if (typeof localStorage !== 'undefined') {
    try { localStorage.setItem(STORE_KEY(protocolId), JSON.stringify(next)); } catch { /* storage unavailable */ }
  }
  return next;
}
