import { useEffect } from 'react';

// Keyboard shortcuts for the FlowCanvas editor: undo/redo, copy/paste/duplicate,
// select-all, search focus, shortcuts help, delete and space-to-pan tracking.
export function useCanvasShortcuts({ selectedNodeIds, selectedEdgeId, flow, copyNode, pasteNode, duplicateNode, deleteEdge, onChange, updateFlow, trialRef, flowRef, performUndo, performRedo, spaceHeld, setContextMenu, setDragConnection, setSearchQuery, setSelectedNodeIds, setSelectedEdgeId, setShortcutsOpen }) {
  useEffect(() => {
    const handler = e => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.key === 'Escape') { setContextMenu(null); setDragConnection(null); setSearchQuery(''); }
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      // Space tracking for pan mode
      if (e.key === ' ' && !e.repeat) { spaceHeld.current = true; }
      // Undo / Redo (visual flow editor)
      if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); performUndo(); return; }
      if (mod && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) { e.preventDefault(); performRedo(); return; }
      // Copy / Paste / Duplicate / Select all
      if (mod && e.key === 'c') { e.preventDefault(); const primaryId = [...selectedNodeIds][0]; const n = flow.nodes.find(nd => nd.id === primaryId); if (n) copyNode(n); }
      if (mod && e.key === 'v') { e.preventDefault(); pasteNode(); }
      if (mod && e.key === 'd') { e.preventDefault(); [...selectedNodeIds].forEach(id => { const n = flow.nodes.find(nd => nd.id === id); if (n) duplicateNode(n); }); }
      if (mod && e.key === 'a') { e.preventDefault(); setSelectedNodeIds(new Set(flow.nodes.map(n => n.id))); setSelectedEdgeId(null); }
      // Search
      if (mod && e.key === 'f') { e.preventDefault(); setSearchQuery(''); }
      // Shortcuts help
      if (mod && e.key === '/') { e.preventDefault(); setShortcutsOpen(prev => !prev); }
      if (!mod && e.key === '?' && !e.shiftKey) { e.preventDefault(); setShortcutsOpen(prev => !prev); }
      // Delete
      if ((e.key === 'Delete' || e.key === 'Backspace') && !document.activeElement?.closest('.studio-inspector')) {
        if (selectedEdgeId) { e.preventDefault(); deleteEdge(selectedEdgeId); }
        else if (selectedNodeIds.size > 0) {
          e.preventDefault();
          const toDelete = flow.nodes.filter(n => selectedNodeIds.has(n.id) && !['start', 'end'].includes(n.type));
          if (toDelete.length > 0) {
            const deleteIds = new Set(toDelete.map(n => n.id));
            const stepIdsToRemove = toDelete.filter(n => n.type === 'event').map(n => n.step_id);
            if (stepIdsToRemove.length > 0) {
              onChange({
                ...trialRef.current,
                steps: trialRef.current.steps.filter(s => !stepIdsToRemove.includes(s.step_id)),
                flow: {
                  nodes: flowRef.current.nodes.filter(n => !deleteIds.has(n.id)),
                  edges: flowRef.current.edges.filter(edge => !deleteIds.has(edge.source) && !deleteIds.has(edge.target)),
                },
              });
            } else {
              updateFlow({
                nodes: flowRef.current.nodes.filter(n => !deleteIds.has(n.id)),
                edges: flowRef.current.edges.filter(edge => !deleteIds.has(edge.source) && !deleteIds.has(edge.target)),
              });
            }
            setSelectedNodeIds(new Set());
            setSelectedEdgeId(null);
            setContextMenu(null);
          }
        }
      }
      if (e.key === 'Escape') { setContextMenu(null); setDragConnection(null); setSearchQuery(''); }
    };
    const keyup = e => { if (e.key === ' ') spaceHeld.current = false; };
    window.addEventListener('keydown', handler);
    window.addEventListener('keyup', keyup);
    return () => { window.removeEventListener('keydown', handler); window.removeEventListener('keyup', keyup); };
  }, [selectedNodeIds, selectedEdgeId, flow, copyNode, pasteNode, duplicateNode, deleteEdge, onChange, updateFlow, trialRef, flowRef, performUndo, performRedo, spaceHeld, setContextMenu, setDragConnection, setSearchQuery, setSelectedNodeIds, setSelectedEdgeId, setShortcutsOpen]);
}
