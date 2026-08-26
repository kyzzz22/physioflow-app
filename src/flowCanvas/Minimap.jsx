import { nodeColor, tint } from '../flowIcons.jsx';
import { nodeWidth } from './layout.js';

export default function Minimap({ nodes, bounds, worldW, worldH, pan, zoom, setPan, canvasRef }) {
  if (nodes.length === 0) return null;
  return (
    <div className="flow-minimap" ref={minimapRef => { if (minimapRef) minimapRef._drag = e => {
      if (!minimapRef) return;
      const rect = minimapRef.getBoundingClientRect();
      const cr = canvasRef.current.getBoundingClientRect();
      if (!cr.width || !rect.width) return;
      const startX = e.clientX, startY = e.clientY, startPan = { ...pan };
      const move = ev => {
        const scaleX = worldW / rect.width;
        const scaleY = worldH / rect.height;
        setPan({ x: startPan.x - (ev.clientX - startX) * scaleX, y: startPan.y - (ev.clientY - startY) * scaleY });
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }; }}
      onClick={e => {
        if (e.target.classList.contains('viewport')) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const cr = canvasRef.current.getBoundingClientRect();
        if (!cr.width || !rect.width) return;
        setPan({ x: -((e.clientX - rect.left) / rect.width * worldW - cr.width / 2), y: -((e.clientY - rect.top) / rect.height * worldH - cr.height / 2) });
      }}>
      <svg viewBox={`${bounds.minX} ${bounds.minY} ${worldW} ${worldH}`}>
        <rect x={bounds.minX} y={bounds.minY} width={worldW} height={worldH} fill="#1a2e2420" rx="4" />
        {nodes.map(n => <rect key={n.id} x={n.x} y={n.y} width={nodeWidth(n)} height={n.type === 'group' ? (n.height || 120) : n.type === 'note' ? (n.height || 100) : n.type === 'junction' ? 20 : 35} rx="4" fill={tint(nodeColor(n.type), 0.4)} />)}
        <rect className="viewport" x={-(pan.x / zoom) + bounds.minX} y={-(pan.y / zoom) + bounds.minY} width={(canvasRef.current?.clientWidth || 800) / zoom} height={(canvasRef.current?.clientHeight || 600) / zoom} onPointerDown={e => { e.stopPropagation(); e.preventDefault(); const minimap = e.target.closest('.flow-minimap'); if (minimap?._drag) minimap._drag(e); }} style={{ cursor: 'grab', pointerEvents: 'auto' }} />
      </svg>
    </div>
  );
}
