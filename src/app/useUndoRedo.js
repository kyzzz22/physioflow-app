import { useCallback, useRef, useState } from 'react';

const MAX_UNDO = 60;
const clone = x => structuredClone(x);

/**
 * App-level undo/redo stack for protocol editors.
 *
 * Owns the undo/redo snapshot stacks and the interaction throttle. The dirty
 * flag is delegated to `setHasUnsaved` (owned by the caller) so that save
 * flow and editor state stay decoupled. Later work (W5) can scope this stack
 * per editor session without touching the caller's contract.
 *
 * @param {object} params
 * @param {any} params.current the current protocol being edited
 * @param {(v: any) => void} params.setCurrent updates the current protocol
 * @param {(v: boolean) => void} params.setHasUnsaved marks the project dirty
 */
export function useUndoRedo({ current, setCurrent, setHasUnsaved }) {
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const undoThrottle = useRef(0);

  const pushUndo = useCallback((val, pushRedo = true) => {
    setUndoStack(prev => {
      const next = [...prev, val];
      return next.length > MAX_UNDO ? next.slice(-MAX_UNDO) : next;
    });
    if (pushRedo) setRedoStack([]);
    setHasUnsaved(true);
  }, [setHasUnsaved]);

  const undo = useCallback(() => {
    setUndoStack(prev => {
      if (!prev.length) return prev;
      const snapshot = prev[prev.length - 1];
      setRedoStack(r => [...r, clone(current)]);
      setCurrent(clone(snapshot));
      setHasUnsaved(true);
      return prev.slice(0, -1);
    });
  }, [current, setCurrent, setHasUnsaved]);

  const redo = useCallback(() => {
    setRedoStack(prev => {
      if (!prev.length) return prev;
      const snapshot = prev[prev.length - 1];
      setUndoStack(u => [...u, clone(current)]);
      setCurrent(clone(snapshot));
      setHasUnsaved(true);
      return prev.slice(0, -1);
    });
  }, [current, setCurrent, setHasUnsaved]);

  const resetUndo = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  return {
    undoStack,
    setUndoStack,
    redoStack,
    setRedoStack,
    undoThrottle,
    pushUndo,
    undo,
    redo,
    resetUndo,
  };
}
