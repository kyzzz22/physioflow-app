import { useCallback, useEffect } from 'react';

// Wheel zoom for FlowCanvas. Attaches a document-level wheel listener that
// zooms toward the cursor only when the pointer is on the canvas/center area
// (or anywhere in fullscreen), leaving sidebars and scrollable panels alone.
export function useWheelZoom({ setZoom, setPan, canvasRef }) {
  const handleWheel = useCallback(e => {
    const target = canvasRef.current;
    if (!target) return;
    // In fullscreen, the canvas may fill the entire screen — use the fullscreen element's rect
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    const refEl = fsEl || target;
    const rect = refEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    e.preventDefault();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    setZoom(z => {
      const newZoom = Math.min(2, Math.max(0.3, z + (e.deltaY > 0 ? -0.08 : 0.08)));
      if (z !== newZoom) {
        const ratio = newZoom / z;
        setPan(p => ({ x: mouseX - ratio * (mouseX - p.x), y: mouseY - ratio * (mouseY - p.y) }));
      }
      return newZoom;
    });
  }, [setZoom, setPan, canvasRef]);

  useEffect(() => {
    const SCROLLABLE_SELECTORS = [
      '.studio-palette', '.studio-inspector', '.snapshots-dropdown',
      '.node-preview-overlay', '.overflow-dropdown', '.context-menu',
      '.unplaced-step-panel', '.canvas-bar', '.guide-panel', '.guide-content',
      '.modal-panel', '.markers', '.node-search-bar', '.zoom-controls',
      '.flow-minimap', '[role="complementary"]',
    ];
    const handler = e => {
      // In fullscreen: always zoom
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        handleWheel(e); return;
      }
      // Inside a scrollable panel: let native scroll work, don't zoom
      if (SCROLLABLE_SELECTORS.some(sel => e.target.closest(sel))) return;
      // Only zoom when scrolling on the canvas itself or the studio center
      if (e.target.closest('.clean-canvas') || e.target.closest('.studio-center')) {
        handleWheel(e);
      }
    };
    document.addEventListener('wheel', handler, { passive: false });
    return () => document.removeEventListener('wheel', handler);
  }, [handleWheel]);
}
