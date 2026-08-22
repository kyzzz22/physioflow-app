import { useMemo, useRef, useState } from 'react';
import {
  addNode,
  connect,
  createCoreComponentRegistry,
  disconnect,
  insertNodeOnControlEdge,
  moveNodes,
  protocolNameOf,
  removeNode,
  updateNode,
  validateProtocolGraph,
} from './core/index.js';
import ParticipantUiBuilder from './ParticipantUiBuilder.jsx';

const registry = createCoreComponentRegistry();
const NODE_WIDTH = 188;
const NODE_HEIGHT = 112;
const paletteGroups = Object.entries(registry.list()
  .filter(item => !['core.start', 'core.end', 'legacy.step'].includes(item.type))
  .reduce((groups, item) => { (groups[item.category] ??= []).push(item); return groups; }, {}));

function getPath(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
}

function setPath(value, path, nextValue) {
  const next = structuredClone(value || {});
  const keys = path.split('.');
  let cursor = next;
  keys.slice(0, -1).forEach(key => { cursor[key] = { ...(cursor[key] || {}) }; cursor = cursor[key]; });
  cursor[keys.at(-1)] = nextValue;
  return next;
}

function portPosition(node, port, definition) {
  const ports = definition.ports.filter(item => item.direction === port.direction);
  const index = ports.findIndex(item => item.id === port.id);
  const gap = NODE_HEIGHT / (ports.length + 1);
  return {
    x: node.layout.x + (port.direction === 'output' ? NODE_WIDTH : 0),
    y: node.layout.y + gap * (index + 1),
  };
}

function edgePath(source, target) {
  const bend = Math.max(54, Math.abs(target.x - source.x) * 0.45);
  return `M ${source.x} ${source.y} C ${source.x + bend} ${source.y}, ${target.x - bend} ${target.y}, ${target.x} ${target.y}`;
}

export default function ComposerV2({ protocol, onChange, onSave, onBack, onExport, onPreview, onFreeze, onUnfreeze, onUndo, onRedo, canUndo, canRedo, hasUnsaved, saveAnim }) {
  const [selectedNodeId, setSelectedNodeId] = useState(protocol.graph.entryNodeId);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [pendingPort, setPendingPort] = useState(null);
  const [message, setMessage] = useState('');
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const validation = useMemo(() => validateProtocolGraph(protocol, registry), [protocol]);
  const selectedNode = protocol.graph.nodes.find(node => node.id === selectedNodeId) || null;
  const selectedEdge = protocol.graph.edges.find(edge => edge.id === selectedEdgeId) || null;

  const locked = protocol.version?.status === 'frozen';
  const migrationReviewRequired = protocol.legacy?.migrationReport?.formalRunAllowed === false;
  const commit = next => { if (!locked) onChange(next, true); };
  const addComponent = definition => {
    const controlIn = definition.ports.find(port => port.kind === 'control' && port.direction === 'input');
    const controlOut = definition.ports.find(port => port.kind === 'control' && port.direction === 'output');
    const edge = selectedEdge?.kind === 'control' ? selectedEdge : protocol.graph.edges.find(item => item.kind === 'control' && item.source.nodeId === protocol.graph.entryNodeId);
    try {
      if (edge && controlIn && controlOut) {
        const sourceNode = protocol.graph.nodes.find(node => node.id === edge.source.nodeId);
        const shiftedPositions = Object.fromEntries(protocol.graph.nodes
          .filter(node => node.layout.x > sourceNode.layout.x)
          .map(node => [node.id, { x: node.layout.x + 240, y: node.layout.y }]));
        const prepared = moveNodes(protocol, shiftedPositions);
        const result = insertNodeOnControlEdge(prepared, edge.id, definition.type, {
          config: definition.defaultConfig,
          label: definition.label,
          layout: { x: sourceNode.layout.x + 240, y: sourceNode.layout.y },
          inputPortId: controlIn.id,
          outputPortId: controlOut.id,
        });
        commit(result.protocol);
        setSelectedNodeId(result.node.id);
      } else {
        const result = addNode(protocol, definition.type, {
          config: definition.defaultConfig,
          label: definition.label,
          layout: { x: 280 + (protocol.graph.nodes.length % 3) * 220, y: 100 + Math.floor(protocol.graph.nodes.length / 3) * 160 },
        });
        commit(result.protocol);
        setSelectedNodeId(result.node.id);
      }
      setSelectedEdgeId(null);
    } catch (error) { setMessage(error.message); }
  };

  const selectPort = (node, port) => {
    if (port.direction === 'output') {
      setPendingPort({ nodeId: node.id, portId: port.id, kind: port.kind, dataType: port.dataType });
      setMessage(`Choose a ${port.kind} input port`);
      return;
    }
    if (!pendingPort) return;
    if (pendingPort.kind !== port.kind) { setMessage('Port kinds must match'); return; }
    try {
      const result = connect(protocol, port.kind, pendingPort, { nodeId: node.id, portId: port.id });
      commit(result.protocol);
      setSelectedEdgeId(result.edge.id);
      setPendingPort(null);
      setMessage('Connection created');
    } catch (error) { setMessage(error.message); }
  };

  const startDrag = (event, node) => {
    if (event.button !== 0 || event.target.closest('.composer-port')) return;
    dragRef.current = { nodeId: node.id, startX: event.clientX, startY: event.clientY, x: node.layout.x, y: node.layout.y };
    onChange(protocol, true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const dragNode = event => {
    const drag = dragRef.current;
    if (!drag) return;
    const x = Math.max(12, drag.x + event.clientX - drag.startX);
    const y = Math.max(12, drag.y + event.clientY - drag.startY);
    onChange(moveNodes(protocol, { [drag.nodeId]: { x, y } }), false);
  };
  const endDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
  };

  const updateSelected = patch => commit(updateNode(protocol, selectedNode.id, patch));
  const deleteSelection = () => {
    try {
      if (selectedEdge) {
        commit(disconnect(protocol, selectedEdge.id));
        setSelectedEdgeId(null);
      } else if (selectedNode) {
        commit(removeNode(protocol, selectedNode.id));
        setSelectedNodeId(null);
      }
    } catch (error) { setMessage(error.message); }
  };

  return <main className={`composer-v2 ${locked ? 'locked' : ''}`}>
    <header className="composer-header">
      <div className="brand"><span>PF</span> Composer V2 {hasUnsaved && <small className="unsaved-dot">●</small>}</div>
      <input disabled={locked} className="composer-title" aria-label="Protocol name" value={protocolNameOf(protocol)} onChange={event => onChange({ ...protocol, metadata: { ...protocol.metadata, name: event.target.value }, audit: { ...protocol.audit, updatedAt: new Date().toISOString() } }, true)} />
      <div className="header-tools">
        <button disabled={!canUndo} onClick={onUndo}>↩ Undo</button>
        <button disabled={!canRedo} onClick={onRedo}>↪ Redo</button>
        <button disabled={!validation.valid} onClick={onPreview}>Preview run</button>
        {migrationReviewRequired && !locked && <button onClick={() => commit({ ...protocol, legacy: { ...protocol.legacy, migrationReport: { ...protocol.legacy.migrationReport, formalRunAllowed: true, reviewedAt: new Date().toISOString() } } })}>Mark migration reviewed</button>}
        {locked ? <button onClick={onUnfreeze}>Unfreeze draft</button> : <button disabled={!validation.valid || migrationReviewRequired} onClick={onFreeze}>Freeze version</button>}
        <button onClick={onExport}>Export</button>
        <button className={saveAnim ? 'saved' : ''} onClick={() => onSave(protocol)}>{saveAnim ? '✓ Saved' : 'Save'}</button>
        <button onClick={onBack}>← Projects</button>
      </div>
    </header>
    <div className="composer-layout">
      <aside className="composer-palette">
        <h2>Components</h2>
        <p>Click to insert into the selected flow.</p>
        {paletteGroups.map(([category, definitions]) => <section key={category}>
          <h3>{category}</h3>
          {definitions.map(definition => <button key={definition.type} onClick={() => addComponent(definition)}><b>{definition.label}</b><small>{definition.type}</small></button>)}
        </section>)}
      </aside>
      <section className="composer-canvas-wrap">
        <div className="composer-canvas-toolbar">
          <span>{protocol.graph.nodes.length} nodes · {protocol.graph.edges.length} connections</span>
          {pendingPort && <button onClick={() => { setPendingPort(null); setMessage(''); }}>Cancel connection</button>}
          {message && <small>{message}</small>}
        </div>
        <div ref={canvasRef} className="composer-canvas" onClick={() => { setSelectedNodeId(null); setSelectedEdgeId(null); }}>
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
          </svg>
          {protocol.graph.nodes.map(node => {
            const definition = registry.get(node.component.type, node.component.version);
            return <article key={node.id} className={`composer-node ${selectedNodeId === node.id ? 'selected' : ''}`} style={{ left: node.layout.x, top: node.layout.y }} onClick={event => { event.stopPropagation(); setSelectedNodeId(node.id); setSelectedEdgeId(null); }} onPointerDown={event => startDrag(event, node)} onPointerMove={dragNode} onPointerUp={endDrag}>
              <span className="node-category">{definition?.category}</span>
              <b>{node.label}</b>
              <small>{node.component.type}</small>
              {(definition?.ports || []).map(port => <button key={port.id} title={`${port.label} · ${port.kind} ${port.direction}`} className={`composer-port ${port.direction} ${port.kind} ${pendingPort?.nodeId === node.id && pendingPort?.portId === port.id ? 'pending' : ''}`} style={{ top: portPosition({ layout: { x: 0, y: 0 } }, port, definition).y }} onClick={event => { event.stopPropagation(); selectPort(node, port); }}><span>{port.label}</span></button>)}
            </article>;
          })}
        </div>
      </section>
      <aside className="composer-inspector">
        <h2>Inspector</h2>
        {migrationReviewRequired && <div className="migration-review-warning"><b>Migration review required</b><span>{protocol.legacy.migrationReport.issues.length} item(s) must be checked before this draft can be frozen.</span></div>}
        {selectedNode && <NodeInspector node={selectedNode} definition={registry.get(selectedNode.component.type, selectedNode.component.version)} onUpdate={updateSelected} />}
        {selectedEdge && <div className="inspector-card"><b>{selectedEdge.kind} connection</b><code>{selectedEdge.source.portId} → {selectedEdge.target.portId}</code><button className="danger" onClick={deleteSelection}>Delete connection</button></div>}
        {!selectedNode && !selectedEdge && <p>Select a node or connection to configure it.</p>}
        {selectedNode && selectedNode.component.type !== 'core.start' && <button className="danger" onClick={deleteSelection}>Delete node</button>}
        <section className={`composer-validation ${validation.valid ? 'valid' : 'invalid'}`}>
          <h3>{validation.valid ? '✓ Graph valid' : `${validation.errors.length} blocking issues`}</h3>
          {[...validation.errors, ...validation.warnings].slice(0, 8).map((issue, index) => <button key={`${issue.code}-${index}`} onClick={() => issue.nodeId && setSelectedNodeId(issue.nodeId)}><b>{issue.code}</b><span>{issue.message}</span></button>)}
        </section>
      </aside>
    </div>
  </main>;
}

function NodeInspector({ node, definition, onUpdate }) {
  return <div className="inspector-card">
    <label>Label<input value={node.label} onChange={event => onUpdate({ label: event.target.value })} /></label>
    <small>{node.component.type}@{node.component.version}</small>
    {(definition?.editorFields || []).map(field => {
      if (field.showWhen && getPath(node.config, field.showWhen.path) !== field.showWhen.equals) return null;
      const value = getPath(node.config, field.path);
      const change = raw => {
        const nextValue = field.type === 'number' ? Number(raw) : field.type === 'boolean' ? Boolean(raw) : raw;
        onUpdate({ config: setPath(node.config, field.path, nextValue) });
      };
      return <label key={field.path}>{field.label}
        {field.type === 'textarea' ? <textarea value={value ?? ''} onChange={event => change(event.target.value)} />
          : field.type === 'select' ? <select value={value ?? ''} onChange={event => change(event.target.value)}>{field.options.map(option => <option key={option} value={option}>{option}</option>)}</select>
            : field.type === 'boolean' ? <input type="checkbox" checked={Boolean(value)} onChange={event => change(event.target.checked)} />
              : <input type={field.type} min={field.min} value={value ?? ''} onChange={event => change(event.target.value)} />}
      </label>;
    })}
    {node.component.type === 'display.screen' && <ParticipantUiBuilder schema={node.config.ui} onChange={ui => onUpdate({ config: { ...node.config, ui } })} />}
    <details className="component-events"><summary>Recorded events ({definition?.events?.length || 0})</summary>{(definition?.events || []).map(eventType => <code key={eventType}>{eventType}</code>)}</details>
    <details><summary>Node ID</summary><code>{node.id}</code></details>
  </div>;
}
