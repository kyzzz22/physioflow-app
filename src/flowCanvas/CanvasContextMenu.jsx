import { PALETTE } from '../constants.js';

export default function CanvasContextMenu({ contextMenu, setContextMenu, setSelectedNodeIds, deleteEdge, addEvent, addLogic, addNote, addJunction, pasteNode, clipboardNode, selectedNodeIds, t, groupSelected, flow, autoLayout }) {
  if (!contextMenu) return null;
  if (contextMenu.type === 'edge') {
    return (
      <div className="context-menu" style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 999 }}>
        <button className="danger" onClick={() => deleteEdge(contextMenu.id)}>Delete connection</button>
      </div>
    );
  }
  if (contextMenu.type === 'canvas') {
    return (
      <div className="context-menu" style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 999 }}>
        <button onClick={() => { setContextMenu(null); }}>Add from palette →</button>
        <div style={{ paddingLeft: '8px', borderLeft: '1px solid var(--line)' }}>
          {PALETTE.flatMap(g => g.items).map(([type, icon, label]) => (
            <button key={type} onClick={() => { addEvent(type); setContextMenu(null); }} style={{ fontSize: '12px', padding: '4px 8px' }}>{icon} {label}</button>
          ))}
          <hr style={{ margin: '4px 0', borderColor: 'var(--line)' }} />
          <button onClick={() => { addLogic('condition'); setContextMenu(null); }} style={{ fontSize: '12px', padding: '4px 8px' }}>◇ Condition</button>
          <button onClick={() => { addLogic('loop'); setContextMenu(null); }} style={{ fontSize: '12px', padding: '4px 8px' }}>↻ Loop</button>
          <button onClick={() => { addNote(); setContextMenu(null); }} style={{ fontSize: '12px', padding: '4px 8px' }}>✎ Sticky note</button>
          <button onClick={() => { addJunction(); setContextMenu(null); }} style={{ fontSize: '12px', padding: '4px 8px' }}>● Junction</button>
        </div>
        {clipboardNode && <button onClick={() => { pasteNode(); setContextMenu(null); }}>Paste {clipboardNode.label || clipboardNode.type}</button>}
        {selectedNodeIds.size >= 2 && <button onClick={() => { groupSelected(); }}>{t('Group selected')} ({selectedNodeIds.size})</button>}
        <button onClick={() => { setSelectedNodeIds(new Set(flow.nodes.map(n => n.id))); setContextMenu(null); }}>Select all</button>
        <button onClick={() => { autoLayout(); setContextMenu(null); }}>Auto layout</button>
      </div>
    );
  }
  return null;
}
