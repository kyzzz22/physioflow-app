import { useCallback, useEffect, useState } from 'react';

// Flow snapshot persistence scoped to a single trial.
export function useFlowSnapshots(trial, flow, disabled, onChange, setSelectedNodeIds, setSelectedEdgeId) {
  const [snapshots, setSnapshots] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`physioflow.snapshots.${trial.trial_id}`) || '[]'); }
    catch { return []; }
  });

  const saveSnapshot = useCallback(() => {
    const snapshot = {
      id: crypto.randomUUID(),
      name: `Snapshot ${snapshots.length + 1}`,
      created_at: new Date().toISOString(),
      flow: structuredClone(flow),
      steps: structuredClone(trial.steps),
    };
    const next = [...snapshots, snapshot].slice(-20); // keep last 20
    setSnapshots(next);
    try { localStorage.setItem(`physioflow.snapshots.${trial.trial_id}`, JSON.stringify(next)); } catch {}
  }, [snapshots, flow, trial.steps, trial.trial_id]);

  const restoreSnapshot = useCallback((snapshot) => {
    if (disabled) return;
    onChange({
      ...trial,
      steps: structuredClone(snapshot.steps),
      flow: structuredClone(snapshot.flow),
    });
    setSelectedNodeIds(new Set());
    setSelectedEdgeId(null);
  }, [disabled, onChange, trial, setSelectedNodeIds, setSelectedEdgeId]);

  const deleteSnapshot = useCallback((snapshotId) => {
    const next = snapshots.filter(s => s.id !== snapshotId);
    setSnapshots(next);
    try { localStorage.setItem(`physioflow.snapshots.${trial.trial_id}`, JSON.stringify(next)); } catch {}
  }, [snapshots, trial.trial_id]);

  const renameSnapshot = useCallback((snapshotId, newName) => {
    const next = snapshots.map(s => s.id === snapshotId ? { ...s, name: newName } : s);
    setSnapshots(next);
    try { localStorage.setItem(`physioflow.snapshots.${trial.trial_id}`, JSON.stringify(next)); } catch {}
  }, [snapshots, trial.trial_id]);

  // Persist snapshots when they change
  useEffect(() => {
    try { localStorage.setItem(`physioflow.snapshots.${trial.trial_id}`, JSON.stringify(snapshots)); } catch {}
  }, [snapshots, trial.trial_id]);

  return { snapshots, saveSnapshot, restoreSnapshot, deleteSnapshot, renameSnapshot };
}
