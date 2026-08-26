import { edgePath, groupBounds, portPosition } from './toolbox.js';

export default function Canvas({ s }) {
  const {
    protocol, t, registry,
    canvasRef, canvasSize, pan, setPan, zoom, setZoom, marquee,
    snapEnabled, setSnapEnabled, autoLayout,
    snapshotsOpen, setSnapshotsOpen, snapshots, snapshotName, setSnapshotName,
    renameId, setRenameId, persistSnapshot, commitRename, restoreSnapshot, deleteSnapshot,
    searchRef, searchQuery, setSearchQuery, searchResults, focusNode,
    pendingPort, setPendingPort, setMessage, message,
    selectedIds, setSelectedIds, setSelectedNodeId, selectedEdgeId, setSelectedEdgeId,
    nodeLabelById, pendingWire, guides, suppressWireClickRef,
    onCanvasWheel, onCanvasPointerDown, viewportPoint, addNodeAt,
    startDrag, dragNode, endDrag, selectNode, startWire, selectPort,
    setPreviewNodeId, setPreviewEdit,
  } = s;
  return <section className="composer-canvas-wrap">
    <div className="composer-canvas-toolbar">
      <span>{protocol.graph.nodes.length} nodes · {protocol.graph.edges.length} connections</span>
      <span className="composer-search">
        <input ref={searchRef} aria-label="Search nodes" placeholder="Search nodes… (Ctrl+F)" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter') { const first = searchResults[0]; if (first) { event.preventDefault(); focusNode(first.id); } }
          else if (event.key === 'Escape') { setSearchQuery(''); event.currentTarget.blur(); event.stopPropagation(); }
        }} />
        {searchQuery.trim() !== '' && <small className="composer-search-count">{searchResults.length} match{searchResults.length === 1 ? '' : 'es'}</small>}
        {searchResults.length > 0 && <div className="composer-search-results">{searchResults.slice(0, 8).map(node => <button key={node.id} onClick={() => focusNode(node.id)}><b>{node.label}</b><small>{node.component.type}</small></button>)}</div>}
      </span>
      <button title="Toggle snap to grid" className={snapEnabled ? 'active' : ''} onClick={() => setSnapEnabled(v => !v)}>Snap</button>
      <button title="Auto layout" onClick={autoLayout}>Auto layout</button>
      <button title="Flow snapshots" className={snapshotsOpen ? 'active' : ''} onClick={() => setSnapshotsOpen(v => !v)}>Snapshots ({snapshots.length})</button>
      {pendingPort && <button onClick={() => { setPendingPort(null); setMessage(''); }}>{t('Cancel connection')}</button>}
      <span className="composer-zoom">
        <button title="Zoom out" onClick={() => setZoom(z => Math.max(0.4, +(z * 0.8).toFixed(2)))}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button title="Zoom in" onClick={() => setZoom(z => Math.min(2.5, +(z * 1.25).toFixed(2)))}>＋</button>
        <button title="Reset view" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>1:1</button>
      </span>
      {message && <small>{message}</small>}
    </div>
    {snapshotsOpen && <div className="composer-snapshots-panel">
      <div className="composer-snapshots-row"><input aria-label="Snapshot name" placeholder="Snapshot name" value={snapshotName} onChange={event => setSnapshotName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') persistSnapshot(); else if (event.key === 'Escape') { event.currentTarget.blur(); event.stopPropagation(); } }} /><button onClick={persistSnapshot}>Save</button></div>
      {snapshots.length === 0 && <small>No snapshots yet. Save one to preserve the current graph state.</small>}
      {snapshots.map(snapshot => <div key={snapshot.id} className="composer-snapshots-row">
        {renameId === snapshot.id
          ? <input aria-label="Rename snapshot" defaultValue={snapshot.name} autoFocus onKeyDown={event => { if (event.key === 'Enter') commitRename(snapshot.id, event.currentTarget.value); else if (event.key === 'Escape') { setRenameId(null); event.stopPropagation(); } }} onBlur={event => commitRename(snapshot.id, event.currentTarget.value)} />
          : <span>{snapshot.name}</span>}
        <small>{snapshot.savedAt}</small>
        <button onClick={() => setRenameId(snapshot.id)}>Rename</button>
        <button onClick={() => restoreSnapshot(snapshot)}>Restore</button>
        <button className="danger" onClick={() => deleteSnapshot(snapshot.id)}>×</button>
      </div>)}
    </div>}
    <div ref={canvasRef} className="composer-canvas" onWheel={onCanvasWheel} onPointerDown={onCanvasPointerDown} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={event => { event.preventDefault(); const type = event.dataTransfer.getData("application/x-physioflow-node"); if (!type) return; const point = viewportPoint(event); addNodeAt(type, point.x, point.y); }} onClick={() => { if (!marquee) { setSelectedIds(new Set()); setSelectedNodeId(null); setSelectedEdgeId(null); } }}>
      <div className="composer-viewport" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
        {(protocol.graph.groups || []).map(group => {
          const bounds = groupBounds(group, protocol.graph.nodes);
          return bounds && <section key={group.id} className="composer-group" style={bounds}><b>{group.name}</b><small>{group.nodeIds.length} node(s)</small></section>;
        })}
        <svg className="composer-wires" aria-label="Graph connections">
          {protocol.graph.edges.map(edge => {
            const sourceNode = protocol.graph.nodes.find(node => node.id === edge.source.nodeId);
            const targetNode = protocol.graph.nodes.find(node => node.id === edge.target.nodeId);
            const sourceDef = sourceNode && registry.get(sourceNode.component.type, sourceNode.component.version);
            const targetDef = targetNode && registry.get(targetNode.component.type, targetNode.component.version);
            const sourcePort = sourceDef?.ports.find(port => port.id === edge.source.portId);
            const targetPort = targetDef?.ports.find(port => port.id === edge.target.portId);
            if (!sourcePort || !targetPort) return null;
            return <path key={edge.id} className={`${edge.kind} ${selectedEdgeId === edge.id ? 'selected' : ''}`} d={edgePath(portPosition(sourceNode, sourcePort, sourceDef), portPosition(targetNode, targetPort, targetDef))} onClick={event => { event.stopPropagation(); setSelectedEdgeId(edge.id); setSelectedNodeId(null); }} />;
          })}
          {pendingWire && <path className="composer-wire temp" d={edgePath(pendingWire.from, pendingWire.to)} />}
        </svg>
        {protocol.graph.nodes.map(node => {
          const definition = registry.get(node.component.type, node.component.version);
          return <article key={node.id} data-node-id={node.id} className={`composer-node ${selectedIds.has(node.id) ? 'selected' : ''}`} style={{ left: node.layout.x, top: node.layout.y }} onClick={event => selectNode(node, event)} onDoubleClick={() => { setPreviewNodeId(node.id); setPreviewEdit(true); }} onPointerDown={event => startDrag(event, node)} onPointerMove={dragNode} onPointerUp={endDrag}>
            <span className="node-category">{definition?.category}</span>
            <b>{node.label}</b>
            <small>{node.component.type}</small>
            {(definition?.ports || []).map(port => {
              const downstream = port.direction === 'output' && port.kind === 'data'
                ? protocol.graph.edges.filter(edge => edge.kind === 'data' && edge.source.nodeId === node.id && edge.source.portId === port.id).map(edge => nodeLabelById.get(edge.target.nodeId) || edge.target.nodeId)
                : [];
              const hint = downstream.length ? `${port.label} → ${downstream.join(', ')}` : `${port.label} · ${port.kind} ${port.direction}`;
              return <button key={port.id} data-port-id={port.id} title={hint} className={`composer-port ${port.direction} ${port.kind} ${pendingPort?.nodeId === node.id && pendingPort?.portId === port.id ? 'pending' : ''}`} style={{ top: portPosition({ layout: { x: 0, y: 0 } }, port, definition).y }} onPointerDown={event => startWire(event, node, port)} onClick={event => { event.stopPropagation(); if (suppressWireClickRef.current) return; selectPort(node, port); }}><span>{port.label}</span></button>;
            })}
            {(definition?.dataFields || []).length > 0 && <span className="node-data-fields" title={`${t('Data columns')}: ${definition.dataFields.join(', ')}`}>{definition.dataFields.length} output{definition.dataFields.length > 1 ? 's' : ''}</span>}
          </article>;
        })}
        {marquee && <div className="composer-marquee" style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }} />}
        {guides.map((guide, index) => guide.dir === 'v'
          ? <div key={`gv${index}`} className="composer-guide guide-v" style={{ left: guide.pos * zoom + pan.x, top: guide.a * zoom + pan.y, height: (guide.b - guide.a) * zoom }} />
          : <div key={`gh${index}`} className="composer-guide guide-h" style={{ top: guide.pos * zoom + pan.y, left: guide.a * zoom + pan.x, width: (guide.b - guide.a) * zoom }} />)}
      </div>
      <div className="composer-minimap" onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        const mx = ((event.clientX - rect.left) / rect.width) * 1800;
        const my = ((event.clientY - rect.top) / rect.height) * 1100;
        const canvasRect = canvasRef.current?.getBoundingClientRect();
        const cx = canvasRect ? canvasRect.width / 2 : 420;
        const cy = canvasRect ? canvasRect.height / 2 : 300;
        setPan({ x: cx - mx * zoom, y: cy - my * zoom });
      }}>
        <svg viewBox="0 0 1800 1100" preserveAspectRatio="xMidYMid meet">
          {protocol.graph.nodes.map(node => <rect key={node.id} x={node.layout.x} y={node.layout.y} width={188} height={112} rx={4} className={`mm-node${selectedIds.has(node.id) ? ' selected' : ''}`} />)}
          <rect className="mm-viewport" x={-pan.x / zoom} y={-pan.y / zoom} width={canvasSize.width / zoom} height={canvasSize.height / zoom} />
        </svg>
      </div>
    </div>
  </section>;
}
