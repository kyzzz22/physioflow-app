import { useCallback, useEffect, useRef, useState } from 'react';
import { GRID_SIZE, SCROLL_EDGE, SCROLL_SPEED } from './layout.js';
import { buildAlignmentGuides } from './interactions.js';

// Node drag + drag-to-connect interactions for FlowCanvas.
// Owns the transient drag state (draggingId, guides) so the canvas component
// stays free of pointer plumbing.
export function useNodeDrag({ disabled, pushUndo, updateNode, updateFlow, snapEnabled, zoomRef, panRef, selectedIdsRef, flowRef, canvasRef, setSelectedNodeIds, setDragConnection, setPan }) {
  const snapRef = useRef(snapEnabled);
  useEffect(() => { snapRef.current = snapEnabled; }, [snapEnabled]);

  const dragRef = useRef(null);
  const dragConnRef = useRef(null);
  const [draggingId, setDraggingId] = useState(null);
  const [guides, setGuides] = useState([]);

  const snapVal = useCallback(v => snapEnabled ? Math.round(v / GRID_SIZE) * GRID_SIZE : v, [snapEnabled]);

  const beginDrag = useCallback((e, node) => {
    if (disabled || e.target.closest('button,input,select')) return;
    pushUndo(); // capture state before drag
    const rect = canvasRef.current.getBoundingClientRect();
    const dx = (e.clientX - rect.left) / zoomRef.current - node.x - panRef.current.x / zoomRef.current;
    const dy = (e.clientY - rect.top) / zoomRef.current - node.y - panRef.current.y / zoomRef.current;
    const isMultiDrag = selectedIdsRef.current.size > 1 && selectedIdsRef.current.has(node.id);
    if (isMultiDrag) {
      const offsets = {};
      selectedIdsRef.current.forEach(id => { const n = flowRef.current.nodes.find(nd => nd.id === id); if (n) offsets[id] = { dx: n.x - node.x, dy: n.y - node.y }; });
      dragRef.current = { nodeIds: [...selectedIdsRef.current], offsets, dx, dy, startX: node.x, startY: node.y };
    } else {
      setSelectedNodeIds(new Set([node.id]));
      dragRef.current = { nodeId: node.id, dx, dy, startX: node.x, startY: node.y };
    }
    setDraggingId(node.id);
    let raf = null;
    const move = ev => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        if (!dragRef.current) return;
        const shouldSnap = snapRef.current && !ev.altKey;
        const rawX = (ev.clientX - rect.left) / zoomRef.current - dragRef.current.dx - panRef.current.x / zoomRef.current;
        const rawY = (ev.clientY - rect.top) / zoomRef.current - dragRef.current.dy - panRef.current.y / zoomRef.current;
        const nx = Math.max(20, shouldSnap ? snapVal(rawX) : rawX);
        const ny = Math.max(20, shouldSnap ? snapVal(rawY) : rawY);
        // Auto-scroll near edges
        const cr = canvasRef.current.getBoundingClientRect();
        const edgeThreshold = SCROLL_EDGE;
        if (ev.clientX - cr.left < edgeThreshold) setPan(p => ({ ...p, x: p.x + SCROLL_SPEED }));
        else if (cr.right - ev.clientX < edgeThreshold) setPan(p => ({ ...p, x: p.x - SCROLL_SPEED }));
        if (ev.clientY - cr.top < edgeThreshold) setPan(p => ({ ...p, y: p.y + SCROLL_SPEED }));
        else if (cr.bottom - ev.clientY < edgeThreshold) setPan(p => ({ ...p, y: p.y - SCROLL_SPEED }));
        // Alignment guides
        let newGuides = [];
        if (shouldSnap) {
          const draggedNode = flowRef.current.nodes.find(n => n.id === dragRef.current.nodeId) || flowRef.current.nodes.find(n => n.id === dragRef.current.nodeIds?.[0]);
          if (draggedNode) newGuides = buildAlignmentGuides(nx, ny, flowRef.current.nodes, draggedNode.id);
        }
        setGuides(newGuides);
        // Apply positions
        if (dragRef.current.nodeIds) {
          const ids = dragRef.current.nodeIds;
          const firstId = ids[0];
          const firstNode = flowRef.current.nodes.find(n => n.id === firstId);
          if (firstNode) {
            const deltaX = nx - firstNode.x;
            const deltaY = ny - firstNode.y;
            const updates = {};
            ids.forEach(id => {
              const n = flowRef.current.nodes.find(nd => nd.id === id);
              if (n) updates[id] = { x: Math.max(20, n.x + deltaX), y: Math.max(20, n.y + deltaY) };
            });
            updateFlow({ ...flowRef.current, nodes: flowRef.current.nodes.map(n => updates[n.id] ? { ...n, ...updates[n.id] } : n) });
          }
        } else {
          updateNode(node.id, { x: nx, y: ny });
        }
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      dragRef.current = null;
      setDraggingId(null);
      setGuides([]);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [disabled, pushUndo, updateNode, updateFlow, snapVal, canvasRef, zoomRef, panRef, selectedIdsRef, flowRef, setSelectedNodeIds, setPan]);

  // Drag-to-connect: keep the live wire in component state for rendering, and a
  // ref mirror so the pointerup handler never reads stale closure state.
  const beginConnDrag = useCallback((e, node, branch) => {
    e.stopPropagation(); e.preventDefault();
    const conn = { source: node.id, branch, clientX: e.clientX, clientY: e.clientY };
    setDragConnection(conn);
    dragConnRef.current = conn;
    const move = ev => {
      const next = { ...dragConnRef.current, clientX: ev.clientX, clientY: ev.clientY };
      setDragConnection(next);
      dragConnRef.current = next;
    };
    const up = ev => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const current = dragConnRef.current;
      if (!current) { setDragConnection(null); dragConnRef.current = null; return; }
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      const targetNode = target?.closest('[data-node-id]');
      if (targetNode) {
        const targetId = targetNode.getAttribute('data-node-id');
        if (targetId && targetId !== node.id) {
          const sourceNode = flowRef.current.nodes.find(n => n.id === current.source);
          if (sourceNode) {
            pushUndo();
            const withoutSameBranch = flowRef.current.edges.filter(e => !(e.source === current.source && e.branch === current.branch));
            updateFlow({ ...flowRef.current, edges: [...withoutSameBranch, { id: `edge_${crypto.randomUUID()}`, source: current.source, target: targetId, branch: current.branch }] });
          }
        }
      }
      setDragConnection(null);
      dragConnRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [pushUndo, updateFlow, setDragConnection, flowRef]);

  return { draggingId, setDraggingId, guides, setGuides, beginDrag, beginConnDrag, snapVal, dragConnRef };
}
