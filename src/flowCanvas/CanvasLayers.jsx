import { branchStyle, edgePath } from './layout.js';
import { nodePortGeometry } from './interactions.js';

// Pure SVG render layer for FlowCanvas: edges, alignment guides, drag-connection
// preview, marquee box, groups and node cards. Receives plain data + stable
// callbacks, so it re-renders only when the flow actually changes.
export default function CanvasLayers({ flow, nodeById, stepsById, selectedNodeIds, searchQuery, filteredIds, draggingId, disabled, stimuli, questionnaires, dragConnection, marquee, pan, zoom, guides, worldW, worldH, canvasRef, NodeCard, tint, beginDrag, handleNodeClick, handleNodeDoubleClick, handleNodeContextMenu, beginConnDrag, handleNodeInputClick, handleNodePreview, handleNodeDuplicate, handleNodeDelete, beginGroupDrag, toggleGroupCollapse, ungroupNode, renameGroup, edgeContextMenu, setSelectedEdgeId, setSelectedNodeIds, setContextMenu, deleteEdge, t }) {
  return <>
    <svg className="flow-bg" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
      <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>
      <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
        {flow.edges.map(edge => {
          const a = nodeById.get(edge.source), b = nodeById.get(edge.target);
          if (!a || !b) return null;
          const p1 = nodePortGeometry(a, true), p2 = nodePortGeometry(b, false);
          const x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y, m = x1 + (x2 - x1) / 2;
          const d = edgePath(x1, y1, x2, y2);
          const bs = branchStyle(edge.branch);
          const sel = selectedEdgeId === edge.id;
          const stroke = sel ? 'var(--green)' : bs.stroke;
          return <g key={edge.id} onContextMenu={e => edgeContextMenu(e, edge.id)} style={{ cursor: 'pointer', pointerEvents: 'auto' }} onClick={e => { e.stopPropagation(); setSelectedEdgeId(edge.id); setSelectedNodeIds(new Set()); setContextMenu(null); }}>
            <path d={d} className="edge-hit" />
            <path d={d} stroke={stroke} strokeWidth={sel ? 2.5 : 1.5} fill="none" strokeDasharray={sel ? undefined : bs.dash} markerEnd="url(#arrow)" />
            <rect x={m - 25} y={(y1 + y2) / 2 - 13} width="50" height="20" rx="10" fill={sel ? 'var(--green)' : '#e8ebe6'} />
            <text x={m} y={(y1 + y2) / 2 + 1} fill={sel ? 'white' : 'var(--ink)'} textAnchor="middle" fontSize="11" fontWeight={sel ? 700 : 400}>{edge.label || edge.branch}</text>
            {sel && <g transform={`translate(${m + 28},${(y1 + y2) / 2 - 10})`} onClick={e => { e.stopPropagation(); deleteEdge(edge.id); }}>
              <circle r="10" fill="#a32e25" /><text y="1" fill="white" textAnchor="middle" fontSize="12" fontWeight="700">×</text>
            </g>}
          </g>;
        })}
        {/* Alignment guides */}
        {guides.map((g, i) => <line key={`guide-${i}`} x1={g.orientation === 'v' ? g.pos : -10000} y1={g.orientation === 'h' ? g.pos : -10000} x2={g.orientation === 'v' ? g.pos : 10000} y2={g.orientation === 'h' ? g.pos : 10000} stroke="var(--green)" strokeWidth={1} strokeDasharray="4 2" opacity={0.6} />)}
      </g>
    </svg>
    {/* Drag-connection preview line */}
    {dragConnection && (() => {
      const srcNode = nodeById.get(dragConnection.source);
      if (!srcNode) return null;
      const cr = canvasRef.current?.getBoundingClientRect();
      if (!cr) return null;
      const noteH = srcNode.height || 100;
      const hasRule2 = (srcNode.type === 'condition' || srcNode.type === 'loop') ? 14 : 0;
      const hasMeta2 = srcNode.type === 'event' ? 14 : 0;
      const estH = 28 + hasRule2 + hasMeta2 + 24;
      const nodeW = srcNode.type === 'junction' ? 10 : srcNode.type === 'note' ? (srcNode.width || 180) : 180;
      const portY = srcNode.type === 'junction' ? 10 : srcNode.type === 'note' ? noteH / 2 : estH - 10;
      const sx = (srcNode.x + nodeW) * zoom + pan.x + cr.left;
      const sy = (srcNode.y + portY) * zoom + pan.y + cr.top;
      const ex = dragConnection.clientX;
      const ey = dragConnection.clientY;
      const mx = (sx + ex) / 2;
      return <svg style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 100, width: '100%', height: '100%', overflow: 'visible' }}>
        <path d={`M${sx},${sy} C${mx},${sy} ${mx},${ey} ${ex},${ey}`} stroke="var(--green)" strokeWidth={2} fill="none" strokeDasharray="6 3" markerEnd="url(#arrow)" />
      </svg>;
    })()}
    {/* Marquee selection box */}
    {marquee && (() => {
      const x = Math.min(marquee.x1, marquee.x2) * zoom + pan.x;
      const y = Math.min(marquee.y1, marquee.y2) * zoom + pan.y;
      const w = Math.abs(marquee.x2 - marquee.x1) * zoom;
      const h = Math.abs(marquee.y2 - marquee.y1) * zoom;
      return <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, border: '1px dashed var(--green)', background: 'rgba(25,116,83,0.06)', pointerEvents: 'none', zIndex: 40 }} />;
    })()}
    <div style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', position: 'relative', width: worldW + 200, height: worldH + 200, pointerEvents: 'none' }}>
      {/* Groups — drawn behind member nodes */}
      {flow.nodes.filter(n => n.type === 'group').map(group => {
        const memberCount = flow.nodes.filter(n => n.group_id === group.id).length;
        return (
          <div key={group.id} className={`clean-group${group.collapsed ? ' collapsed' : ''}`} style={{ left: group.x, top: group.y, width: group.width, height: group.height, borderColor: group.color }}>
            <div className="clean-group-header" style={{ background: tint(group.color, 0.12) }}
              onPointerDown={e => beginGroupDrag(e, group)}
              onDoubleClick={e => { e.stopPropagation(); renameGroup(group.id); }}>
              <span className="clean-group-dot" style={{ background: group.color }} />
              <span className="clean-group-title">{group.label}</span>
              <span className="clean-group-count">{memberCount} step{memberCount !== 1 ? 's' : ''}</span>
              <button className="clean-group-btn" title={group.collapsed ? t('Expand') : t('Collapse')} onClick={e => { e.stopPropagation(); toggleGroupCollapse(group.id); }}>{group.collapsed ? '▸' : '▾'}</button>
              <button className="clean-group-btn danger" title={t('Ungroup')} onClick={e => { e.stopPropagation(); ungroupNode(group.id); }}>✕</button>
            </div>
          </div>
        );
      })}
      {flow.nodes.map(node => {
        if (node.type === 'group') return null;
        if (node.group_id && flow.nodes.some(g => g.type === 'group' && g.id === node.group_id && g.collapsed)) return null;
        return <NodeCard
          key={node.id} node={node} step={stepsById.get(node.step_id) || null}
          isSelected={selectedNodeIds.has(node.id)} isDimmed={searchQuery && !filteredIds.has(node.id)}
          isDragging={draggingId === node.id} isDisabled={node.enabled === false} disabled={disabled}
          stimuli={stimuli} questionnaires={questionnaires}
          isAwaitingConnection={Boolean(dragConnection)} activeBranch={dragConnection?.source === node.id ? dragConnection.branch : null}
          onPointerDown={beginDrag} onClick={handleNodeClick} onDoubleClick={handleNodeDoubleClick}
          onContextMenu={handleNodeContextMenu} onPortPointerDown={beginConnDrag} onInputClick={handleNodeInputClick}
          onPreview={handleNodePreview} onDuplicate={handleNodeDuplicate} onDelete={handleNodeDelete}
        />;
      })}
    </div>
  </>;
}
