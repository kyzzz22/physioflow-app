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
  // Editor-session scope: frames recorded inside `beginScope()` are discarded
  // when the editor is exited via `endScope()`, so global navigation actions
  // never share a history stack with editor work.
  const scopeBase = useRef(0);
  const scopeActive = useRef(false);
  const undoStackRef = useRef([]);
  undoStackRef.current = undoStack;

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
      // Never undo past the editor-session boundary
      if (scopeActive.current && prev.length <= scopeBase.current) return prev;
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
    scopeBase.current = 0;
    scopeActive.current = false;
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  /** Begin an editor session scope. Frames recorded after this point are
   *  owned by the editor and are discarded when `endScope()` is called. */
  const beginScope = useCallback(() => {
    scopeBase.current = undoStackRef.current.length;
    scopeActive.current = true;
    setRedoStack([]);
  }, []);

  /** End the editor session scope, discarding editor-owned history frames so
   *  they do not leak into global navigation history. */
  const endScope = useCallback(() => {
    if (!scopeActive.current) return;
    scopeActive.current = false;
    setUndoStack(prev => (prev.length > scopeBase.current ? prev.slice(0, scopeBase.current) : prev));
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
    beginScope,
    endScope,
  };
}
