import { useEffect, useRef, useState } from 'react';

// Undo / redo history. Every mutation goes through commit() so the editor behaves
// like a real builder (Ctrl+Z / Ctrl+Shift+Z), mirroring craft.js and friends.
export function useParticipantUiHistory(normalized, onChange) {
  const [, setHistoryTick] = useState(0);
  const historyRef = useRef({ stack: [normalized], cursor: 0 });
  useEffect(() => {
    const h = historyRef.current;
    if (JSON.stringify(h.stack[h.cursor]) !== JSON.stringify(normalized)) {
      historyRef.current = { stack: [normalized], cursor: 0 };
      setHistoryTick(tick => tick + 1);
    }
  }, [normalized]);

  const commit = next => {
    const h = historyRef.current;
    const current = h.stack[h.cursor];
    if (current && JSON.stringify(current) === JSON.stringify(next)) {
      onChange(next);
      return;
    }
    let stack = h.stack.slice(0, h.cursor + 1);
    stack.push(next);
    if (stack.length > 80) stack = stack.slice(stack.length - 80);
    historyRef.current = { stack, cursor: stack.length - 1 };
    setHistoryTick(tick => tick + 1);
    onChange(next);
  };

  const canUndo = historyRef.current.cursor > 0;
  const canRedo = historyRef.current.cursor < historyRef.current.stack.length - 1;
  const undo = () => {
    const h = historyRef.current;
    if (h.cursor <= 0) return;
    h.cursor -= 1;
    setHistoryTick(tick => tick + 1);
    onChange(h.stack[h.cursor]);
  };
  const redo = () => {
    const h = historyRef.current;
    if (h.cursor >= h.stack.length - 1) return;
    h.cursor += 1;
    setHistoryTick(tick => tick + 1);
    onChange(h.stack[h.cursor]);
  };

  return { commit, canUndo, canRedo, undo, redo };
}
