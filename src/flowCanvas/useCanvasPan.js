import { useCallback, useRef } from 'react';
import { nodeHeight, nodeWidth } from './layout.js';

// Canvas pan (middle/space/right-drag) and box/marquee selection for FlowCanvas.
export function useCanvasPan({ disabled, zoom, pan, setPan, setMarquee, setSelectedNodeIds, flowRef, canvasRef, spaceHeld }) {
  const panDragRef = useRef(null);

  // Pan with middle mouse / space+drag / right-drag
  const beginPan = useCallback(e => {
    if (e.button !== 1 && e.button !== 2 && !spaceHeld.current) return;
    e.preventDefault();
    panDragRef.current = { startX: e.clientX, startY: e.clientY, startPan: { ...pan } };
    const move = ev => {
      if (!panDragRef.current) return;
      setPan({ x: panDragRef.current.startPan.x + (ev.clientX - panDragRef.current.startX), y: panDragRef.current.startPan.y + (ev.clientY - panDragRef.current.startY) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      panDragRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [pan, setPan, spaceHeld]);

  // Box/marquee selection
  const beginMarquee = useCallback(e => {
    if (e.button !== 0 || disabled) return;
    if (e.target !== canvasRef.current && !e.target.classList.contains('flow-bg') && e.target !== canvasRef.current.querySelector('.flow-bg')) return;
    if (e.target.closest('[data-node-id]') || e.target.closest('button')) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x1 = (e.clientX - rect.left - pan.x) / zoom;
    const y1 = (e.clientY - rect.top - pan.y) / zoom;
    setMarquee({ x1, y1, x2: x1, y2: y1 });
    const move = ev => {
      const x2 = (ev.clientX - rect.left - pan.x) / zoom;
      const y2 = (ev.clientY - rect.top - pan.y) / zoom;
      setMarquee(prev => prev ? { ...prev, x2, y2 } : null);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setMarquee(prev => {
        if (!prev) return null;
        const minX = Math.min(prev.x1, prev.x2), maxX = Math.max(prev.x1, prev.x2);
        const minY = Math.min(prev.y1, prev.y2), maxY = Math.max(prev.y1, prev.y2);
        const inside = flowRef.current.nodes.filter(n => {
          const nw = nodeWidth(n);
          const nh = nodeHeight(n);
          return n.x + nw > minX && n.x < maxX && n.y + nh > minY && n.y < maxY;
        }).map(n => n.id);
        if (inside.length > 0) setSelectedNodeIds(new Set(inside));
        return null;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [disabled, canvasRef, pan, zoom, setMarquee, setSelectedNodeIds, flowRef]);

  return { beginPan, beginMarquee, panDragRef };
}
