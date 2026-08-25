import { useEffect } from 'react';

/**
 * Global keyboard shortcuts owned by the app shell.
 *
 * Ctrl/Cmd+S saves the current protocol, Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z
 * (or Ctrl+Y) undo/redo while a builder view is active. Shortcuts are ignored
 * while the participant UI builder is focused or an editable element has
 * focus. Escape is intentionally NOT handled here — inside the editors it
 * means "cancel/deselect" (ComposerV2/FlowCanvas), not "leave". Leaving has
 * an explicit ← Projects button so an accidental Escape never discards work.
 *
 * @param {object} params
 * @param {{ current: any }} params.viewRef ref to the active view name
 * @param {{ current: any }} params.currentRef ref to the current protocol
 * @param {(v: any) => void} params.onSave save handler
 * @param {() => void} params.onUndo undo handler
 * @param {() => void} params.onRedo redo handler
 */
export function useGlobalShortcuts({ viewRef, currentRef, onSave, onUndo, onRedo }) {
  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 's') { e.preventDefault(); const cur = currentRef.current; if (cur) onSave(cur); return; }
      if (mod && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y') && document.querySelector('.participant-ui-builder')) return;
      if (mod && e.key === 'z' && !e.shiftKey && viewRef.current === 'builder') { e.preventDefault(); onUndo(); return; }
      if (mod && ((e.key === 'z' && e.shiftKey) || e.key === 'y') && viewRef.current === 'builder') { e.preventDefault(); onRedo(); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSave, onUndo, onRedo, viewRef, currentRef]);
}
