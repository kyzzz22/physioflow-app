import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addVariable,
  addNode,
  assignNodeToGroup,
  connect,
  createId,
  createNodeGroup,
  createSubflowTemplate,
  disconnect,
  duplicateNode,
  insertNodeOnControlEdge,
  instantiateSubflowTemplate,
  loadFlowSnapshots,
  mapUiElement,
  moveNodes,
  protocolNameOf,
  removeFlowSnapshot,
  removeVariable,
  removeNodeGroup,
  removeSubflowTemplate,
  removeNode,
  saveFlowSnapshot,
  updateVariable,
  updateNodeGroup,
  serializeProtocolGraph,
  updateNode,
  validateProtocolGraphConfiguration,
} from './core/index.js';
import { calibrationReport } from './visualAngle.js';
import { generateGonogoTrials, generateStroopTrials } from './core/index.js';
import ParticipantUiBuilder from './ParticipantUiBuilder.jsx';
import ParticipantRenderer from './ParticipantRenderer.jsx';
import QuestionnaireEditor from './QuestionnaireEditorV2.jsx';
import { findUiElement, localResourceManifest, schemaForNode } from './runtime/index.js';
import { translate, useLanguage } from './i18n.jsx';
import { createProjectComponentRegistry, exampleReactionButtonPackage, installComponentPackage, uninstallComponentPackage } from './sdk/index.js';
import { exampleSimulatedConnector, installDeviceConnector, uninstallDeviceConnector } from './devices/index.js';
import { createProtocolChangeSet, mergeProtocolChangeSet } from './collaboration/index.js';
import { createDeploymentBundle, validateDeploymentBundle } from './deployment/index.js';
import { HostedExecutionClient, LocalHostedExecutionService, validateParticipantBootstrap } from './hosted/index.js';

const UI_TEMPLATE_KIND = {
  'display.screen': 'instruction',
  'display.media': 'media',
  'input.rating': 'rating',
  'input.text': 'text',
  'timing.wait': 'instruction',
  'stimulus.fixation': 'fixation',
  'stimulus.attention-check': 'attention',
  'setup.device-check': 'device',
  'operator.manual-event': 'manual',
  'stimulus.screen-calibration': 'calibration',
  'stimulus.custom-html': 'html',
  'utility.note': 'instruction',
  'utility.junction': 'instruction',
};

const NODE_WIDTH = 188;
const NODE_HEIGHT = 112;

function downloadJson(name, value) {
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

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

function groupBounds(group, nodes) {
  const members = nodes.filter(node => group.nodeIds.includes(node.id));
  if (!members.length) return null;
  const left = Math.min(...members.map(node => node.layout.x)) - 34;
  const top = Math.min(...members.map(node => node.layout.y)) - 42;
  const right = Math.max(...members.map(node => node.layout.x + NODE_WIDTH)) + 34;
  const bottom = Math.max(...members.map(node => node.layout.y + NODE_HEIGHT)) + 34;
  return { left, top, width: right - left, height: bottom - top };
}

export default function ComposerV2({ protocol, onChange, onSave, onBack, onExport, onPreview, onFreeze, onCreateDraft, onHostedRun, onUndo, onRedo, canUndo, canRedo, hasUnsaved, saveAnim }) {
  const { language } = useLanguage();
  const t = key => translate(key, language);
  const [selectedNodeId, setSelectedNodeId] = useState(protocol.graph.entryNodeId);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [pendingPort, setPendingPort] = useState(null);
  const [message, setMessage] = useState('');
  const [editorMode, setEditorMode] = useState('quick');
  const [codeView, setCodeView] = useState(false);
  const [codeText, setCodeText] = useState('');
  const [codeError, setCodeError] = useState('');
  const [previewNodeId, setPreviewNodeId] = useState(null);
  const [previewEdit, setPreviewEdit] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [marquee, setMarquee] = useState(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [snapshotName, setSnapshotName] = useState('');
  const [snapshots, setSnapshots] = useState(() => loadFlowSnapshots(protocol.protocolId));
  const [deletePending, setDeletePending] = useState(null);
  const clipboardRef = useRef([]);
  const [collaborationBaseline, setCollaborationBaseline] = useState(() => structuredClone(protocol));
  const collaborationProtocolRef = useRef(protocol);
  collaborationProtocolRef.current = protocol;
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const registry = useMemo(() => createProjectComponentRegistry(protocol), [protocol]);
  const paletteGroups = useMemo(() => Object.entries(registry.list()
    .filter(item => !['core.start', 'core.end', 'legacy.step'].includes(item.type))
    .reduce((groups, item) => { (groups[item.category] ??= []).push(item); return groups; }, {})), [registry]);
  const validation = useMemo(() => validateProtocolGraphConfiguration(protocol, registry), [protocol, registry]);
  const selectedNode = protocol.graph.nodes.find(node => node.id === selectedNodeId) || null;
  const selectedEdge = protocol.graph.edges.find(edge => edge.id === selectedEdgeId) || null;
  const previewNode = previewNodeId ? protocol.graph.nodes.find(node => node.id === previewNodeId) : null;
  const previewDefinition = previewNode ? registry.get(previewNode.component.type, previewNode.component.version) : null;
  const updatePreviewUi = ui => { if (previewNode) commit(updateNode(protocol, previewNode.id, { config: { ...previewNode.config, ui } })); };

  useEffect(() => {
    setCollaborationBaseline(structuredClone(collaborationProtocolRef.current));
  }, [protocol.protocolId, protocol.version?.number]);

  const locked = protocol.version?.status === 'frozen';
  const migrationReviewRequired = protocol.legacy?.migrationReport?.formalRunAllowed === false;
  const commit = next => { if (!locked) onChange(next, true); };
  const openCodeView = () => { setCodeText(serializeProtocolGraph(protocol, 2)); setCodeError(''); setCodeView(true); };
  const applyCode = () => {
    try {
      const parsed = JSON.parse(codeText);
      const check = validateProtocolGraphConfiguration(parsed, registry);
      if (!check.valid) { setCodeError(check.errors.map(error => error.message).join(' · ')); return; }
      commit(parsed);
      setCodeView(false);
      setCodeError('');
    } catch (error) { setCodeError(error.message); }
  };
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

  const addNodeAt = (type, x, y) => {
    const definition = registry.get(type);
    if (!definition) return;
    try {
      const result = addNode(protocol, type, { config: definition.defaultConfig, label: definition.label, layout: { x: Math.max(12, Math.round(x - NODE_WIDTH / 2)), y: Math.max(12, Math.round(y - NODE_HEIGHT / 2)) } });
      commit(result.protocol);
      setSelectedIds(new Set([result.node.id]));
      setSelectedNodeId(result.node.id);
      setMessage(`Added ${definition.label}`);
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

  const selectedSet = () => (selectedIds.size ? selectedIds : new Set(selectedNodeId ? [selectedNodeId] : []));
  const selectNode = (node, event) => {
    event.stopPropagation();
    setSelectedEdgeId(null);
    if (event.shiftKey) {
      setSelectedIds(current => {
        const next = new Set(current);
        if (next.has(node.id)) {
          next.delete(node.id);
          if (selectedNodeId === node.id) setSelectedNodeId(next.values().next().value || null);
        } else {
          next.add(node.id);
          setSelectedNodeId(node.id);
        }
        return next;
      });
    } else {
      setSelectedIds(new Set([node.id]));
      setSelectedNodeId(node.id);
    }
  };

  const startDrag = (event, node) => {
    if (event.button !== 0 || event.target.closest('.composer-port')) return;
    const set = selectedSet();
    const ids = set.has(node.id) && set.size > 1 ? [...set] : [node.id];
    dragRef.current = {
      ids,
      startX: event.clientX,
      startY: event.clientY,
      origins: Object.fromEntries(ids.map(id => {
        const target = protocol.graph.nodes.find(item => item.id === id);
        return [id, { x: target.layout.x, y: target.layout.y }];
      })),
    };
    onChange(protocol, true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const dragNode = event => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / zoom;
    const dy = (event.clientY - drag.startY) / zoom;
    const snap = value => (snapEnabled ? Math.round(value / 24) * 24 : value);
    const positions = Object.fromEntries(drag.ids.map(id => {
      const origin = drag.origins[id];
      return [id, { x: snap(Math.max(12, origin.x + dx)), y: snap(Math.max(12, origin.y + dy)) }];
    }));
    onChange(moveNodes(protocol, positions), false);
  };
  const endDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
  };

  const updateSelected = patch => commit(updateNode(protocol, selectedNode.id, patch));
  const performDelete = targets => {
    try {
      let next = protocol;
      for (const id of targets) next = removeNode(next, id).protocol;
      commit(next);
      setSelectedIds(new Set());
      setSelectedNodeId(null);
      setMessage(`Deleted ${targets.length} node(s)`);
    } catch (error) { setMessage(error.message); }
  };
  const deleteSelection = () => {
    if (selectedEdge) {
      commit(disconnect(protocol, selectedEdge.id));
      setSelectedEdgeId(null);
      return;
    }
    const targets = [...selectedSet()];
    if (!targets.length) return;
    setDeletePending({ ids: targets });
  };
  const confirmDelete = () => {
    if (deletePending) performDelete(deletePending.ids);
    setDeletePending(null);
  };
  const cancelDelete = () => setDeletePending(null);
  const copySelection = () => {
    const targets = [...selectedSet()];
    clipboardRef.current = targets.map(id => {
      const node = protocol.graph.nodes.find(item => item.id === id);
      if (!node) return null;
      return { component: node.component, label: node.label, config: structuredClone(node.config), bindings: structuredClone(node.bindings), layout: { x: node.layout.x, y: node.layout.y } };
    }).filter(Boolean);
    if (clipboardRef.current.length) setMessage(`Copied ${clipboardRef.current.length} node(s)`);
  };
  const pasteClipboard = () => {
    if (!clipboardRef.current.length) return;
    try {
      let next = protocol;
      const ids = [];
      for (const item of clipboardRef.current) {
        const result = addNode(next, item.component.type, { label: item.label, config: structuredClone(item.config), bindings: structuredClone(item.bindings), layout: { x: item.layout.x + 40, y: item.layout.y + 40 } });
        next = result.protocol;
        ids.push(result.node.id);
      }
      commit(next);
      setSelectedIds(new Set(ids));
      setSelectedNodeId(ids[ids.length - 1]);
      setMessage(`Pasted ${ids.length} node(s)`);
    } catch (error) { setMessage(error.message); }
  };

  const viewportPoint = event => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: (event.clientX - rect.left - pan.x) / zoom, y: (event.clientY - rect.top - pan.y) / zoom };
  };
  const onCanvasPointerDown = event => {
    if (event.button !== 0 || event.target.closest('.composer-node, .composer-port, .composer-wires')) return;
    const point = viewportPoint(event);
    setMarquee({ x0: point.x, y0: point.y, x1: point.x, y1: point.y });
    const move = moveEvent => {
      const next = viewportPoint(moveEvent);
      setMarquee(current => (current ? { ...current, x1: next.x, y1: next.y } : current));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setMarquee(current => {
        if (current) {
          const left = Math.min(current.x0, current.x1), right = Math.max(current.x0, current.x1);
          const top = Math.min(current.y0, current.y1), bottom = Math.max(current.y0, current.y1);
          const inside = protocol.graph.nodes.filter(node => node.layout.x >= left && node.layout.x <= right && node.layout.y >= top && node.layout.y <= bottom).map(node => node.id);
          setSelectedIds(new Set(inside));
          setSelectedNodeId(inside.length ? inside[0] : null);
        }
        return null;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const onCanvasWheel = event => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const rect = canvasRef.current.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      const nextZoom = Math.min(2.5, Math.max(0.4, zoom * factor));
      const ratio = nextZoom / zoom;
      setPan(previous => ({ x: mx - (mx - previous.x) * ratio, y: my - (my - previous.y) * ratio }));
      setZoom(nextZoom);
    } else {
      setPan(previous => ({ x: previous.x - event.deltaX, y: previous.y - event.deltaY }));
    }
  };

  const autoLayout = () => {
    const adjacency = new Map();
    protocol.graph.edges.filter(edge => edge.kind === 'control').forEach(edge => {
      if (!adjacency.has(edge.source.nodeId)) adjacency.set(edge.source.nodeId, []);
      adjacency.get(edge.source.nodeId).push(edge.target.nodeId);
    });
    const levels = new Map([[protocol.graph.entryNodeId, 0]]);
    const positions = {};
    const levelCounts = new Map();
    const queue = [protocol.graph.entryNodeId];
    const visited = new Set(queue);
    let head = 0;
    while (head < queue.length) {
      const id = queue[head++];
      const level = levels.get(id) || 0;
      const count = levelCounts.get(level) || 0;
      levelCounts.set(level, count + 1);
      positions[id] = { x: 80 + level * 220, y: 100 + count * 140 };
      for (const next of adjacency.get(id) || []) {
        if (!visited.has(next)) { visited.add(next); levels.set(next, level + 1); queue.push(next); }
      }
    }
    protocol.graph.nodes.forEach(node => { if (!positions[node.id]) positions[node.id] = { ...node.layout }; });
    commit(moveNodes(protocol, positions));
    setMessage('Auto layout applied');
  };

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return protocol.graph.nodes.filter(node => node.label.toLowerCase().includes(query) || node.component.type.toLowerCase().includes(query));
  }, [searchQuery, protocol]);
  const focusNode = id => {
    const node = protocol.graph.nodes.find(item => item.id === id);
    if (!node) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 420;
    const cy = rect ? rect.height / 2 : 300;
    setPan({ x: cx - (node.layout.x + 94) * zoom, y: cy - (node.layout.y + 56) * zoom });
    setSelectedIds(new Set([id]));
    setSelectedNodeId(id);
    setSearchQuery('');
  };

  const persistSnapshot = () => {
    const snapshot = { id: `snap_${Date.now()}`, name: snapshotName.trim() || `Snapshot ${snapshots.length + 1}`, savedAt: new Date().toISOString(), nodes: protocol.graph.nodes.map(node => ({ id: node.id, layout: node.layout })) };
    setSnapshots(saveFlowSnapshot(protocol.protocolId, snapshot));
    setSnapshotName('');
    setMessage('Flow snapshot saved');
  };
  const restoreSnapshot = snapshot => {
    const positions = Object.fromEntries(snapshot.nodes.map(node => [node.id, node.layout]));
    commit(moveNodes(protocol, positions));
    setMessage(`Restored ${snapshot.name}`);
  };
  const deleteSnapshot = id => setSnapshots(removeFlowSnapshot(protocol.protocolId, id));

  const duplicateSelection = () => {
    const targets = [...selectedSet()].filter(id => id !== protocol.graph.entryNodeId);
    if (!targets.length) return;
    try {
      let next = protocol;
      for (const id of targets) {
        const result = duplicateNode(next, id, { insertAfter: false });
        next = result.protocol;
      }
      commit(next);
      setMessage(`Duplicated ${targets.length} node(s)`);
    } catch (error) { setMessage(error.message); }
  };

  useEffect(() => {
    const onKey = event => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (event.metaKey || event.ctrlKey) {
        const key = event.key.toLowerCase();
        if (key === 'c') { copySelection(); }
        else if (key === 'v') { event.preventDefault(); pasteClipboard(); }
        else if (key === 'd') { event.preventDefault(); duplicateSelection(); }
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && (selectedSet().size || selectedEdge)) {
        event.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return <main className={`composer-v2 ${locked ? 'locked' : ''}`}>
    <header className="composer-header">
      <div className="brand"><span>PF</span> Composer V2 {hasUnsaved && <small className="unsaved-dot">●</small>}</div>
      <input disabled={locked} className="composer-title" aria-label="Protocol name" value={protocolNameOf(protocol)} onChange={event => onChange({ ...protocol, metadata: { ...protocol.metadata, name: event.target.value }, audit: { ...protocol.audit, updatedAt: new Date().toISOString() } }, true)} />
      <div className="composer-mode-switch" aria-label={t('Editor mode')}>
        {['quick', 'design', 'advanced'].map(mode => <button key={mode} aria-pressed={editorMode === mode && !codeView} className={editorMode === mode && !codeView ? 'active' : ''} onClick={() => { setEditorMode(mode); setCodeView(false); }}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}
        <button aria-pressed={codeView} className={codeView ? 'active' : ''} onClick={() => codeView ? setCodeView(false) : openCodeView()}>{'{ } ' + t('Code')}</button>
      </div>
      <div className="header-tools">
        <button disabled={!canUndo} onClick={onUndo}>↩ {t('Undo')}</button>
        <button disabled={!canRedo} onClick={onRedo}>↪ {t('Redo')}</button>
        <button disabled={!validation.valid} onClick={onPreview}>{t('Preview run')}</button>
        {migrationReviewRequired && !locked && <button onClick={() => commit({ ...protocol, legacy: { ...protocol.legacy, migrationReport: { ...protocol.legacy.migrationReport, formalRunAllowed: true, reviewedAt: new Date().toISOString() } } })}>Mark migration reviewed</button>}
        {locked ? <button onClick={onCreateDraft}>Create editable version</button> : <button disabled={!validation.valid || migrationReviewRequired} onClick={onFreeze}>{t('Freeze version')}</button>}
        <button onClick={onExport}>{t('Export')}</button>
        <button className={saveAnim ? 'saved' : ''} onClick={() => onSave(protocol)}>{saveAnim ? '✓ ' + t('Saved') : t('Save')}</button>
        <button onClick={onBack}>← {t('Projects')}</button>
      </div>
    </header>
    {deletePending && <div className="composer-delete-confirm">Delete {deletePending.ids.length} node(s)? This cannot be undone.
      <button className="danger" onClick={confirmDelete}>Delete</button>
      <button onClick={cancelDelete}>Cancel</button>
    </div>}
    {codeView ? <CodeView text={codeText} error={codeError} locked={locked} onChange={setCodeText} onApply={applyCode} /> : <div className="composer-layout">
      <aside className="composer-palette">
        <h2>{t('Components')}</h2>
        <p>{t('Click to insert into the selected flow.')}</p>
        {paletteGroups.map(([category, definitions]) => <section key={category}>
          <h3>{category}</h3>
          {definitions.map(definition => <button key={definition.type} draggable={!locked} title="Drag onto the canvas" onClick={() => addComponent(definition)} onDragStart={event => { event.dataTransfer.setData('application/x-physioflow-node', definition.type); event.dataTransfer.effectAllowed = 'copy'; }}><b>{definition.label}</b><small>{definition.type}</small></button>)}
        </section>)}
        {editorMode !== 'quick' && <AssetLibrary assets={protocol.assets || []} locked={locked} onUpdate={assets => commit({ ...protocol, assets })} />}
        {editorMode !== 'quick' && <VisualAngleCalculator />}
        {editorMode !== 'quick' && <VariableCatalog mode={editorMode} variables={protocol.variables || []} locked={locked} onError={error => setMessage(error.message || String(error))} onAdd={variable => commit(addVariable(protocol, variable))} onUpdate={(name, changes) => commit(updateVariable(protocol, name, changes))} onRemove={name => {
          try { commit(removeVariable(protocol, name)); }
          catch (error) { setMessage(error.message); }
        }} />}
        {editorMode !== 'quick' && <GroupCatalog registry={registry} groups={protocol.graph.groups || []} nodes={protocol.graph.nodes} locked={locked} onUpdate={(groupId, changes) => commit(updateNodeGroup(protocol, groupId, changes))} onRemove={groupId => commit(removeNodeGroup(protocol, groupId))} onPublish={groupId => {
          try { const result = createSubflowTemplate(protocol, groupId); commit(result.protocol); setMessage(`Published reusable subflow ${result.template.name}`); }
          catch (error) { setMessage(error.message); }
        }} />}
        {editorMode === 'advanced' && <ComponentPackageCatalog packages={protocol.componentPackages || []} locked={locked} onInstallExample={() => {
          try { commit(installComponentPackage(protocol, exampleReactionButtonPackage(), { approvedPermissions: ['events.emit'] })); setMessage('Installed Reaction Button example package'); }
          catch (error) { setMessage(error.message); }
        }} onImport={componentPackage => {
          try { commit(installComponentPackage(protocol, componentPackage, { approvedPermissions: componentPackage.permissions || [] })); setMessage(`Installed ${componentPackage.name}`); }
          catch (error) { setMessage(error.message); }
        }} onRemove={(packageId, version) => {
          try { commit(uninstallComponentPackage(protocol, packageId, version)); }
          catch (error) { setMessage(error.message); }
        }} />}
        {editorMode === 'advanced' && <DeviceConnectorCatalog connectors={protocol.deviceConnectors || []} locked={locked} onInstallExample={() => {
          try { const connector = exampleSimulatedConnector(); commit(installDeviceConnector(protocol, connector, { approvedPermissions: connector.permissions })); setMessage('Installed simulated physiology connector'); }
          catch (error) { setMessage(error.message); }
        }} onImport={connector => {
          try { commit(installDeviceConnector(protocol, connector, { approvedPermissions: connector.permissions || [] })); setMessage(`Installed ${connector.name}`); }
          catch (error) { setMessage(error.message); }
        }} onRemove={(connectorId, version) => {
          try { commit(uninstallDeviceConnector(protocol, connectorId, version)); }
          catch (error) { setMessage(error.message); }
        }} />}
        {editorMode === 'advanced' && <CollaborationCatalog protocol={protocol} baseline={collaborationBaseline} locked={locked} onSetBaseline={() => { setCollaborationBaseline(structuredClone(protocol)); setMessage('Collaboration baseline updated'); }} onApply={next => { commit(next); setCollaborationBaseline(structuredClone(next)); setMessage('Collaboration change set applied'); }} onMessage={setMessage} />}
        {editorMode === 'advanced' && <DeploymentCatalog protocol={protocol} onHostedRun={onHostedRun} onMessage={setMessage} />}
        {editorMode !== 'quick' && <SubflowTemplateCatalog templates={protocol.subflowTemplates || []} variables={protocol.variables || []} locked={locked} onInstantiate={(templateId, parameterMappings) => {
          try { const result = instantiateSubflowTemplate(protocol, templateId, { parameterMappings, position: { x: 320, y: 180 + (protocol.graph.groups?.length || 0) * 170 } }); commit(result.protocol); setSelectedNodeId(result.group.entryNodeId); setMessage(`Created ${result.group.name}`); }
          catch (error) { setMessage(error.message); }
        }} onRemove={templateId => {
          try { commit(removeSubflowTemplate(protocol, templateId)); }
          catch (error) { setMessage(error.message); }
        }} />}
      </aside>
      <section className="composer-canvas-wrap">
        <div className="composer-canvas-toolbar">
          <span>{protocol.graph.nodes.length} nodes · {protocol.graph.edges.length} connections</span>
          <span className="composer-search">
            <input aria-label="Search nodes" placeholder="Search nodes…" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} />
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
          <div className="composer-snapshots-row"><input aria-label="Snapshot name" placeholder="Snapshot name" value={snapshotName} onChange={event => setSnapshotName(event.target.value)} /><button onClick={persistSnapshot}>Save</button></div>
          {snapshots.length === 0 && <small>No snapshots yet. Save one to preserve the current layout.</small>}
          {snapshots.map(snapshot => <div key={snapshot.id} className="composer-snapshots-row"><span>{snapshot.name}</span><small>{snapshot.savedAt}</small><button onClick={() => restoreSnapshot(snapshot)}>Restore</button><button className="danger" onClick={() => deleteSnapshot(snapshot.id)}>×</button></div>)}
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
            </svg>
            {protocol.graph.nodes.map(node => {
              const definition = registry.get(node.component.type, node.component.version);
              return <article key={node.id} className={`composer-node ${selectedIds.has(node.id) ? 'selected' : ''}`} style={{ left: node.layout.x, top: node.layout.y }} onClick={event => selectNode(node, event)} onDoubleClick={() => { setPreviewNodeId(node.id); setPreviewEdit(true); }} onPointerDown={event => startDrag(event, node)} onPointerMove={dragNode} onPointerUp={endDrag}>
                <span className="node-category">{definition?.category}</span>
                <b>{node.label}</b>
                <small>{node.component.type}</small>
                {(definition?.ports || []).map(port => <button key={port.id} title={`${port.label} · ${port.kind} ${port.direction}`} className={`composer-port ${port.direction} ${port.kind} ${pendingPort?.nodeId === node.id && pendingPort?.portId === port.id ? 'pending' : ''}`} style={{ top: portPosition({ layout: { x: 0, y: 0 } }, port, definition).y }} onClick={event => { event.stopPropagation(); selectPort(node, port); }}><span>{port.label}</span></button>)}
              </article>;
            })}
            {marquee && <div className="composer-marquee" style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }} />}
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
              <rect className="mm-viewport" x={-pan.x / zoom} y={-pan.y / zoom} width={1800 / zoom} height={1100 / zoom} />
            </svg>
          </div>
        </div>
      </section>
      <aside className="composer-inspector">
        <h2>{t('Inspector')}</h2>
        {migrationReviewRequired && <div className="migration-review-warning"><b>Migration review required</b><span>{protocol.legacy.migrationReport.issues.length} item(s) must be checked before this draft can be frozen.</span></div>}
        {selectedNode && <NodeInspector node={selectedNode} definition={registry.get(selectedNode.component.type, selectedNode.component.version)} variables={protocol.variables || []} groups={protocol.graph.groups || []} mode={editorMode} onUpdate={updateSelected} onAssignGroup={groupId => commit(assignNodeToGroup(protocol, selectedNode.id, groupId))} questionnaireLibrary={protocol.questionnaireLibrary || []} onLibraryChange={library => commit({ ...protocol, questionnaireLibrary: library })} assets={protocol.assets || []} onCreateGroup={() => {
          try {
            const result = createNodeGroup(protocol, [selectedNode.id], { name: `${selectedNode.label} group` });
            commit(result.protocol);
            setMessage(`Created group ${result.group.name}`);
          } catch (error) { setMessage(error.message); }
        }} />}
        {selectedEdge && <div className="inspector-card"><b>{selectedEdge.kind} connection</b><code>{selectedEdge.source.portId} → {selectedEdge.target.portId}</code><button className="danger" onClick={deleteSelection}>Delete connection</button></div>}
        {!selectedNode && !selectedEdge && <p>{t('Select a node or connection to configure it.')}</p>}
        {!locked && selectedNode && !['core.start', 'core.end'].includes(selectedNode.component.type) && <button onClick={duplicateSelection}>Duplicate node</button>}
        {!locked && selectedNode && selectedNode.component.type !== 'core.start' && <button className="danger" onClick={deleteSelection}>Delete node</button>}
        <section className={`composer-validation ${validation.valid ? 'valid' : 'invalid'}`}>
          <h3>{validation.valid ? `✓ ${t('Graph valid')}` : `${validation.errors.length} ${t('blocking issues')}`}</h3>
          {[...validation.errors, ...validation.warnings].slice(0, 8).map((issue, index) => <button key={`${issue.code}-${index}`} onClick={() => issue.nodeId && setSelectedNodeId(issue.nodeId)}><b>{issue.code}</b><span>{issue.message}</span></button>)}
        </section>
      </aside>
    </div>}
    {previewNode && <div className="node-editor-fullscreen">
      <div className="node-editor-header">
        <b>{previewNode.label}</b><small>{previewNode.component.type}@{previewNode.component.version}</small>
        <button disabled={locked} onClick={() => setPreviewEdit(value => !value)}>{previewEdit ? 'View' : '✎ Edit'}</button>
        <button className="node-editor-close" onClick={() => setPreviewNodeId(null)}>✕ Done</button>
      </div>
      {previewEdit && previewNode.config?.ui
        ? <ParticipantUiBuilder schema={previewNode.config.ui} defaultTemplate={UI_TEMPLATE_KIND[previewNode.component.type] || 'instruction'} onChange={updatePreviewUi} />
        : <div className="node-editor-preview"><ParticipantRenderer schema={schemaForNode(previewNode, previewDefinition, null)} preview /></div>}
    </div>}
  </main>;
}

function CodeView({ text, error, locked, onChange, onApply }) {
  return <div className="composer-code-view">
    <div className="composer-code-toolbar">
      <b>Protocol JSON</b>
      <span>Edit the full protocol graph as JSON. Changes apply only when validation passes.</span>
      <button disabled={locked} onClick={onApply}>Apply changes</button>
    </div>
    {error && <div className="composer-code-error">{error}</div>}
    <textarea disabled={locked} value={text} onChange={event => onChange(event.target.value)} spellCheck={false} aria-label="Protocol JSON" />
  </div>;
}

function NodeInspector({ node, definition, variables, groups, mode, onUpdate, onAssignGroup, onCreateGroup, questionnaireLibrary, onLibraryChange, assets }) {
  const { language } = useLanguage();
  const t = key => translate(key, language);
  const currentGroup = groups.find(group => group.nodeIds.includes(node.id));

  const contentSpec = {
    'display.media': { elementType: 'Media', fields: [{ key: 'mediaType', label: 'Media type', type: 'select', options: ['image', 'audio', 'video'] }, { key: 'sourceUrl', label: 'Source URL', type: 'text' }, { key: 'assetId', label: 'Asset', type: 'asset' }] },
    'input.rating': { elementType: 'Input', fields: [{ key: 'min', label: 'Minimum', type: 'number' }, { key: 'max', label: 'Maximum', type: 'number' }, { key: 'required', label: 'Required', type: 'boolean' }] },
    'input.text': { elementType: 'Input', fields: [{ key: 'placeholder', label: 'Placeholder', type: 'text' }, { key: 'required', label: 'Required', type: 'boolean' }, { key: 'multiline', label: 'Multiline', type: 'boolean' }] },
  }[node.component.type] || null;
  const contentKeys = contentSpec ? new Set(contentSpec.fields.map(field => field.key)) : null;

  const updateContentField = (key, value) => {
    if (!node.config?.ui || !contentSpec) return;
    const element = findUiElement(node.config.ui.root, contentSpec.elementType);
    if (!element) return;
    const ui = mapUiElement(node.config.ui, element.id, el => ({ ...el, props: { ...el.props, [key]: value } }));
    // Picking an asset also bakes its source URL into the node so local runs and the
    // inline preview render without a hosted resource resolver.
    const extra = {};
    if (key === 'assetId' && value) {
      const asset = (assets || []).find(item => (item.id || item.assetId) === value);
      if (asset?.sourceUrl) extra.sourceUrl = asset.sourceUrl;
    }
    onUpdate({ config: { ...node.config, ui, [key]: value, ...extra } });
  };

  const fieldGroups = [];
  const groupIndex = new Map();
  for (const field of definition?.editorFields || []) {
    if (contentKeys?.has(field.path)) continue;
    const group = field.group || 'General';
    if (!groupIndex.has(group)) { groupIndex.set(group, fieldGroups.length); fieldGroups.push([group, []]); }
    fieldGroups[groupIndex.get(group)][1].push(field);
  }

  const renderField = field => {
    if (field.showWhen && getPath(node.config, field.showWhen.path) !== field.showWhen.equals) return null;
    // Type-aware Expected value for conditions: follow the bound input variable's type.
    if (node.component.type === 'logic.condition' && field.path === 'expected' && node.bindings?.value?.kind === 'variable') {
      const boundVariable = variables.find(variable => variable.name === node.bindings.value.variable);
      const expected = node.config?.expected;
      if (boundVariable?.type === 'number') {
        return <label key={field.path}>{field.label}<input type="number" value={typeof expected === 'number' ? expected : Number.isFinite(Number(expected)) ? Number(expected) : ''} onChange={event => onUpdate({ config: setPath(node.config, 'expected', event.target.value === '' ? '' : Number(event.target.value)) })} />{field.help && <small className="field-help">{field.help}</small>}</label>;
      }
      if (boundVariable?.type === 'boolean') {
        const boolValue = String(expected) === 'true' ? 'true' : String(expected) === 'false' ? 'false' : '';
        return <label key={field.path}>{field.label}<select value={boolValue} onChange={event => onUpdate({ config: setPath(node.config, 'expected', event.target.value === '' ? null : event.target.value === 'true') })}><option value="">choose…</option><option value="true">true</option><option value="false">false</option></select>{field.help && <small className="field-help">{field.help}</small>}</label>;
      }
    }
    const value = getPath(node.config, field.path);
    const change = raw => {
      const nextValue = field.type === 'number' ? Number(raw) : field.type === 'boolean' ? Boolean(raw) : raw;
      const patch = setPath(node.config, field.path, nextValue);
      if (field.type === 'asset' && raw && field.path === 'assetId') {
        const asset = (assets || []).find(item => (item.id || item.assetId) === raw);
        if (asset?.sourceUrl) patch.sourceUrl = asset.sourceUrl;
      }
      onUpdate({ config: patch });
    };
    let control;
    if (field.type === 'textarea') control = <textarea value={value ?? ''} onChange={event => change(event.target.value)} />;
    else if (field.type === 'select') control = <select value={value ?? ''} onChange={event => change(event.target.value)}>{field.options.map(option => <option key={option} value={option}>{option}</option>)}</select>;
    else if (field.type === 'color') control = <span className="color-field"><input type="color" value={toHexColor(value)} onChange={event => change(event.target.value)} /><input value={value ?? ''} onChange={event => change(event.target.value)} /></span>;
    else if (field.type === 'asset') control = <select value={value ?? ''} onChange={event => change(event.target.value || null)}><option value="">— none —</option>{(assets || []).map(asset => <option key={asset.id || asset.assetId} value={asset.id || asset.assetId}>{asset.name || asset.id}</option>)}</select>;
    else if (field.type === 'variable') control = <select value={value ?? ''} onChange={event => change(event.target.value)}><option value="">— choose —</option>{variables.map(variable => <option key={variable.name} value={variable.name}>{variable.name} · {variable.type}</option>)}</select>;
    else if (field.type === 'boolean') control = <input type="checkbox" checked={Boolean(value)} onChange={event => change(event.target.checked)} />;
    else control = <input type={field.type || 'text'} min={field.min} max={field.max} step={field.step} value={value ?? ''} onChange={event => change(event.target.value)} />;
    return <label key={field.path}>{field.label}{control}{field.help && <small className="field-help">{field.help}</small>}</label>;
  };

  const emptyHint = node.component.type === 'display.media' && !node.config?.sourceUrl && !node.config?.assetId
    ? 'Add a source URL or pick an asset below to show media.'
    : node.component.type === 'input.questionnaire' && !node.config?.questionnaire?.questions?.length
      ? 'Open the Questionnaire editor to add questions.'
      : node.component.type === 'stimulus.custom-html' && !node.config?.html
        ? 'Paste an HTML fragment below.'
        : null;

  return <div className="inspector-card">
    <label>{t('Label')}<input value={node.label} onChange={event => onUpdate({ label: event.target.value })} /></label>
    <small>{node.component.type}@{node.component.version}</small>
    {emptyHint && <div className="node-empty-hint">▶ {emptyHint}</div>}
    {node.config?.ui && !['core.start', 'core.end'].includes(node.component.type) && <div className="node-inline-preview"><ParticipantRenderer key={node.id} schema={schemaForNode(node, definition, localResourceManifest(assets || []))} preview /></div>}
    {contentSpec && <div className="content-fields"><b>Content</b>{contentSpec.fields.map(field => <ContentField key={field.key} field={field} value={node.config?.[field.key]} assets={assets} onChange={value => updateContentField(field.key, value)} />)}</div>}
    {fieldGroups.map(([group, fields]) => <details key={group} className="field-group" open={group === 'General' || fieldGroups.length === 1}><summary>{group}</summary>{fields.map(renderField)}</details>)}
    {node.component.type === 'logic.condition' && <label>Input variable<select aria-label="Condition input variable" value={node.bindings?.value?.kind === 'variable' ? node.bindings.value.variable : ''} onChange={event => onUpdate({ bindings: event.target.value ? { ...node.bindings, value: { kind: 'variable', variable: event.target.value } } : Object.fromEntries(Object.entries(node.bindings || {}).filter(([key]) => key !== 'value')) })}>
      <option value="">Choose a variable…</option>
      {variables.map(variable => <option key={variable.name} value={variable.name}>{variable.name} · {variable.type} / {variable.scope}</option>)}
    </select></label>}
    {node.component.type === 'logic.condition' && <label>Compare with variable<select aria-label="Condition compare variable" value={node.bindings?.compare?.kind === 'variable' ? node.bindings.compare.variable : ''} onChange={event => onUpdate({ bindings: event.target.value ? { ...node.bindings, compare: { kind: 'variable', variable: event.target.value } } : Object.fromEntries(Object.entries(node.bindings || {}).filter(([key]) => key !== 'compare')) })}>
      <option value="">— none (use Expected value) —</option>
      {variables.map(variable => <option key={variable.name} value={variable.name}>{variable.name} · {variable.type} / {variable.scope}</option>)}
    </select></label>}
    {node.component.type === 'logic.loop' && <label>Until variable<select aria-label="Loop until variable" value={node.bindings?.until?.kind === 'variable' ? node.bindings.until.variable : ''} onChange={event => onUpdate({ bindings: event.target.value ? { ...node.bindings, until: { kind: 'variable', variable: event.target.value } } : Object.fromEntries(Object.entries(node.bindings || {}).filter(([key]) => key !== 'until')) })}>
      <option value="">— none (iterate by maxIterations) —</option>
      {variables.map(variable => <option key={variable.name} value={variable.name}>{variable.name} · {variable.type} / {variable.scope}</option>)}
    </select></label>}
    {node.component.type === 'input.questionnaire' && <QuestionnaireEditor value={node.config.questionnaire} onChange={questionnaire => onUpdate({ config: { ...node.config, questionnaire } })} library={questionnaireLibrary} onLibraryChange={onLibraryChange} />}
    {node.component.type === 'experiment.cognitive-task' && <div className="cognitive-generate">
      <button type="button" onClick={() => {
        const kind = node.config?.taskKind === 'gonogo' ? 'gonogo' : 'stroop';
        const generator = kind === 'gonogo' ? generateGonogoTrials : generateStroopTrials;
        const trials = generator({ trials: kind === 'gonogo' ? 40 : 16, goRatio: Number(node.config?.goRatio ?? 70), seed: Number(node.config?.seed ?? 1), jitter: Number(node.config?.jitterMs ?? 0) });
        onUpdate({ config: { ...node.config, trials } });
      }}>Generate trials</button>
      <small>{node.config?.trials?.length || 0} trial(s) · {node.config?.taskKind || 'stroop'}</small>
    </div>}
    {mode !== 'quick' && node.config && <details className="advanced-fields"><summary>Analysis & recovery</summary>
      <label>Analysis role<select aria-label="Analysis role" value={node.config.analysisRole || ''} onChange={event => onUpdate({ config: { ...node.config, analysisRole: event.target.value } })}><option value="">none</option>{['baseline', 'stimulus', 'recovery', 'task', 'exclude', 'custom'].map(role => <option key={role} value={role}>{role}</option>)}</select></label>
      <label>Analysis label<input aria-label="Analysis label" value={node.config.analysisLabel || ''} onChange={event => onUpdate({ config: { ...node.config, analysisLabel: event.target.value } })} /></label>
      <label>Recovery after interruption<select aria-label="Recovery behavior" value={node.config.recoveryBehavior || ''} onChange={event => onUpdate({ config: { ...node.config, recoveryBehavior: event.target.value } })}><option value="">default</option>{['resume', 'restart', 'wait-operator'].map(behavior => <option key={behavior} value={behavior}>{behavior}</option>)}</select></label>
    </details>}
    {mode !== 'quick' && !['core.start', 'core.end'].includes(node.component.type) && <label>{t('Node group')}<select aria-label={t('Node group')} value={currentGroup?.id || ''} onChange={event => onAssignGroup(event.target.value || null)}><option value="">{t('No group')}</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
    {mode !== 'quick' && !currentGroup && !['core.start', 'core.end'].includes(node.component.type) && <button onClick={onCreateGroup}>{t('Create group from node')}</button>}
    {mode !== 'quick' && node.component.type !== 'input.questionnaire' && node.config?.ui && <ParticipantUiBuilder schema={node.config.ui} defaultTemplate={UI_TEMPLATE_KIND[node.component.type] || 'instruction'} onChange={ui => onUpdate({ config: { ...node.config, ui } })} />}
    {definition?.events?.length > 0 && <details className="node-data-note"><summary>Records</summary>
      <small>Events: {definition.events.join(', ')}</small>
      {definition.dataFields?.length > 0 && <small>Data columns: {definition.dataFields.join(', ')}</small>}
    </details>}
    {mode === 'advanced' && <><details><summary>Node ID</summary><code>{node.id}</code></details><details><summary>Node JSON</summary><pre>{JSON.stringify(node, null, 2)}</pre></details></>}
  </div>;
}

function ContentField({ field, value, assets, onChange }) {
  if (field.type === 'select') return <label>{field.label}<select value={value ?? ''} onChange={event => onChange(event.target.value)}>{field.options.map(option => <option key={option} value={option}>{option}</option>)}</select></label>;
  if (field.type === 'asset') return <label>{field.label}<select value={value ?? ''} onChange={event => onChange(event.target.value || null)}><option value="">— none / direct URL —</option>{(assets || []).map(asset => <option key={asset.id || asset.assetId} value={asset.id || asset.assetId}>{asset.name || asset.id}</option>)}</select></label>;
  if (field.type === 'boolean') return <label className="checkbox-row"><input type="checkbox" checked={Boolean(value)} onChange={event => onChange(event.target.checked)} /> {field.label}</label>;
  return <label>{field.label}<input type={field.type || 'text'} value={value ?? ''} onChange={event => onChange(field.type === 'number' ? Number(event.target.value) : event.target.value)} /></label>;
}

function toHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
}
function groupDataPorts(group, nodes, direction, componentRegistry) {
  return group.nodeIds.flatMap(nodeId => {
    const node = nodes.find(item => item.id === nodeId);
    const definition = node && componentRegistry.get(node.component.type, node.component.version);
    return (definition?.ports || []).filter(port => port.kind === 'data' && port.direction === direction).map(port => ({ nodeId, portId: port.id, dataType: port.dataType, label: `${node.label} · ${port.label || port.id}` }));
  });
}

function endpointValue(endpoint) {
  return endpoint ? `${endpoint.nodeId}::${endpoint.portId}` : '';
}

function parseEndpoint(value) {
  const [nodeId, portId] = value.split('::');
  return nodeId && portId ? { nodeId, portId } : null;
}

function GroupCatalog({ registry: componentRegistry, groups, nodes, locked, onUpdate, onRemove, onPublish }) {
  const { language } = useLanguage();
  const t = key => translate(key, language);

  return <section className="group-catalog">
    <h3>{t('Groups')}</h3>
    <p>Visual containers organize related nodes without creating a second execution model.</p>
    {!groups.length && <small>No groups yet. Select a node and create one from its Inspector.</small>}
    {groups.map(group => <article key={group.id}>
      <input disabled={locked} aria-label={`${group.name} group name`} value={group.name} onChange={event => onUpdate(group.id, { name: event.target.value })} />
      <select disabled={locked} aria-label={`${group.name} group kind`} value={group.kind || 'container'} onChange={event => {
        const kind = event.target.value;
        onUpdate(group.id, kind === 'subflow' ? { kind, entryNodeId: group.entryNodeId || group.nodeIds[0], exitNodeIds: group.exitNodeIds?.length ? group.exitNodeIds : [group.nodeIds.at(-1)] } : { kind, entryNodeId: null, exitNodeIds: [] });
      }}><option value="container">container</option><option value="subflow">subflow</option></select>
      <small>{group.nodeIds.length} node(s) · {group.kind}</small>
      {group.kind === 'subflow' && <div className="subflow-settings">
        <label>Entry<select disabled={locked} aria-label={`${group.name} subflow entry`} value={group.entryNodeId || ''} onChange={event => onUpdate(group.id, { entryNodeId: event.target.value })}>{group.nodeIds.map(nodeId => <option key={nodeId} value={nodeId}>{nodes.find(node => node.id === nodeId)?.label || nodeId}</option>)}</select></label>
        <fieldset className="subflow-exits"><legend>Exits</legend>{group.nodeIds.map(nodeId => <label key={nodeId}><input disabled={locked} type="checkbox" checked={(group.exitNodeIds || []).includes(nodeId)} onChange={event => onUpdate(group.id, { exitNodeIds: event.target.checked ? [...(group.exitNodeIds || []), nodeId] : (group.exitNodeIds || []).filter(id => id !== nodeId) })} />{nodes.find(node => node.id === nodeId)?.label || nodeId}</label>)}</fieldset>
        {(group.parameters || []).map((parameter, index) => {
          const ports = groupDataPorts(group, nodes, parameter.direction, componentRegistry);
          const endpointName = parameter.direction === 'output' ? 'source' : 'target';
          return <div className="subflow-parameter" key={index}>
          <input disabled={locked} aria-label={`${group.name} parameter ${index + 1} name`} value={parameter.name} onChange={event => onUpdate(group.id, { parameters: group.parameters.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} />
          <select disabled={locked} aria-label={`${group.name} parameter ${index + 1} type`} value={parameter.type} onChange={event => onUpdate(group.id, { parameters: group.parameters.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value } : item) })}>{['string', 'number', 'boolean', 'enum', 'object', 'array', 'unknown'].map(type => <option key={type}>{type}</option>)}</select>
          <select disabled={locked} aria-label={`${group.name} parameter ${index + 1} direction`} value={parameter.direction} onChange={event => {
            const direction = event.target.value;
            const firstPort = groupDataPorts(group, nodes, direction, componentRegistry)[0];
            onUpdate(group.id, { parameters: group.parameters.map((item, itemIndex) => itemIndex === index ? { ...item, direction, type: firstPort?.dataType || item.type, target: direction === 'input' && firstPort ? { nodeId: firstPort.nodeId, portId: firstPort.portId } : undefined, source: direction === 'output' && firstPort ? { nodeId: firstPort.nodeId, portId: firstPort.portId } : undefined } : item) });
          }}><option value="input">input</option><option value="output">output</option></select>
          <select disabled={locked || !ports.length} aria-label={`${group.name} parameter ${index + 1} endpoint`} value={endpointValue(parameter[endpointName])} onChange={event => onUpdate(group.id, { parameters: group.parameters.map((item, itemIndex) => itemIndex === index ? { ...item, [endpointName]: parseEndpoint(event.target.value) } : item) })}><option value="">Select port</option>{ports.map(port => <option key={`${port.nodeId}:${port.portId}`} value={endpointValue(port)}>{port.label}</option>)}</select>
          <button disabled={locked} aria-label={`Delete parameter ${parameter.name}`} onClick={() => onUpdate(group.id, { parameters: group.parameters.filter((_, itemIndex) => itemIndex !== index) })}>×</button>
        </div>})}
        <button disabled={locked || (!groupDataPorts(group, nodes, 'input', componentRegistry).length && !groupDataPorts(group, nodes, 'output', componentRegistry).length)} onClick={() => {
          const direction = groupDataPorts(group, nodes, 'input', componentRegistry).length ? 'input' : 'output';
          const port = groupDataPorts(group, nodes, direction, componentRegistry)[0];
          const endpointName = direction === 'output' ? 'source' : 'target';
          onUpdate(group.id, { parameters: [...(group.parameters || []), { name: `parameter_${(group.parameters || []).length + 1}`, type: port.dataType || 'unknown', direction, [endpointName]: { nodeId: port.nodeId, portId: port.portId } }] });
        }}>Add parameter</button>
        <button disabled={locked} onClick={() => onPublish(group.id)}>Publish reusable template</button>
      </div>}
      <button disabled={locked} aria-label={`Delete group ${group.name}`} onClick={() => onRemove(group.id)}>×</button>
    </article>)}
  </section>;
}

function SubflowTemplateCatalog({ templates, variables, locked, onInstantiate, onRemove }) {
  const { language } = useLanguage();
  const t = key => translate(key, language);

  const [mappings, setMappings] = useState({});
  if (!templates.length) return null;
  return <section className="subflow-template-catalog">
    <h3>{t('Reusable subflows')}</h3>
    <p>Instances are expanded into the same executable graph and keep their template provenance.</p>
    {templates.map(template => {
      const compatible = parameter => variables.filter(variable => parameter.type === 'unknown' || variable.type === 'unknown' || variable.type === parameter.type);
      const currentMappings = mappings[template.id] || {};
      const resolvedMappings = Object.fromEntries((template.parameters || []).map(parameter => [parameter.name, currentMappings[parameter.name] || compatible(parameter)[0]?.name || '']));
      const ready = (template.parameters || []).every(parameter => resolvedMappings[parameter.name]);
      return <article key={template.id}>
        <div><b>{template.name}</b><small>v{template.version} · {template.nodes.length} nodes</small></div>
        {(template.parameters || []).map(parameter => <label key={parameter.name}>{parameter.direction} {parameter.name}<select disabled={locked} aria-label={`${template.name} ${parameter.name} variable mapping`} value={resolvedMappings[parameter.name]} onChange={event => setMappings(current => ({ ...current, [template.id]: { ...(current[template.id] || {}), [parameter.name]: event.target.value } }))}><option value="">Select variable</option>{compatible(parameter).map(variable => <option key={variable.name}>{variable.name}</option>)}</select></label>)}
        {!ready && Boolean(template.parameters?.length) && <small>Add compatible protocol variables before instantiating.</small>}
        <div className="subflow-template-actions"><button disabled={locked || !ready} onClick={() => onInstantiate(template.id, resolvedMappings)}>Create instance</button><button disabled={locked} onClick={() => onRemove(template.id)}>Delete template</button></div>
      </article>;
    })}
  </section>;
}

function snapshotLabel(state) {
  if (!state?.exists) return '(missing)';
  const serialized = typeof state.value === 'string' ? state.value : JSON.stringify(state.value);
  const text = serialized === undefined ? String(state.value) : serialized;
  return text.length > 90 ? `${text.slice(0, 87)}…` : text;
}

function CollaborationCatalog({ protocol, baseline, locked, onSetBaseline, onApply, onMessage }) {
  const { language } = useLanguage();
  const t = key => translate(key, language);

  const [author, setAuthor] = useState('local-author');
  const [summary, setSummary] = useState('');
  const [pending, setPending] = useState(null);
  const [resolutions, setResolutions] = useState({});
  const [error, setError] = useState('');
  const preview = useMemo(() => {
    if (!pending) return null;
    try { return mergeProtocolChangeSet(protocol, pending, { resolutions }); }
    catch (nextError) { return { error: nextError.message, conflicts: [], unresolved: 0 }; }
  }, [pending, protocol, resolutions]);
  const exportChanges = async () => {
    try {
      const changeSet = await createProtocolChangeSet(baseline, protocol, { authorId: author.trim() || 'local-author', authorName: author.trim() || 'Local author', summary: summary.trim() });
      if (!changeSet.operations.length) throw new Error('No changes exist relative to the current collaboration baseline');
      downloadJson(`${protocol.metadata?.name || 'protocol'}.${changeSet.id}.changeset.json`, changeSet);
      setError('');
      onMessage(`Exported ${changeSet.operations.length} collaboration operation(s)`);
    } catch (nextError) { setError(nextError.message); }
  };
  const readChangeSet = async event => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      setPending(JSON.parse(await file.text()));
      setResolutions({});
      setError('');
    } catch (nextError) { setPending(null); setError(nextError.message); }
    event.target.value = '';
  };
  const history = protocol.collaboration?.history || [];
  return <section className="collaboration-catalog">
    <h3>{t('Collaboration change sets')}</h3>
    <p>Exchange auditable protocol changes without requiring a server. Independent fields merge automatically; same-field edits require an explicit choice.</p>
    <label>Author ID<input value={author} onChange={event => setAuthor(event.target.value)} /></label>
    <label>Summary<input value={summary} onChange={event => setSummary(event.target.value)} placeholder="What changed?" /></label>
    <small>Baseline: v{baseline.version?.number} · {baseline.audit?.updatedAt || 'unknown time'}</small>
    <div className="collaboration-actions"><button disabled={locked} onClick={onSetBaseline}>Use current as baseline</button><button disabled={locked} onClick={exportChanges}>Export changes</button></div>
    <label className="collaboration-import">Import change set<input disabled={locked} type="file" accept="application/json,.json" onChange={readChangeSet} /></label>
    {error && <small className="package-error">{error}</small>}
    {preview?.error && <small className="package-error">{preview.error}</small>}
    {pending && !preview?.error && <article className="collaboration-preview">
      <b>{pending.summary || pending.id}</b>
      <small>{pending.author?.name || pending.author?.id} · {pending.operations?.length || 0} operation(s)</small>
      <small>{preview.appliedOperations} ready · {preview.alreadyAppliedOperations} already applied · {preview.unresolved} conflict(s)</small>
      {preview.conflicts.map(conflict => <label key={conflict.operationId} className="collaboration-conflict">
        <span><b>{conflict.target}{conflict.entityKey ? ` · ${conflict.entityKey}` : ''}</b><small>{conflict.path.join('.') || '(whole entity)'}</small><small>Local: {snapshotLabel(conflict.local)}</small><small>Incoming: {snapshotLabel(conflict.incoming)}</small></span>
        <select aria-label={`${conflict.operationId} conflict resolution`} value={resolutions[conflict.operationId] || ''} onChange={event => setResolutions(current => ({ ...current, [conflict.operationId]: event.target.value }))}><option value="">Resolve…</option><option value="local">Keep local</option><option value="incoming">Use incoming</option></select>
      </label>)}
      <div><button disabled={locked || preview.unresolved > 0} onClick={() => { onApply(preview.protocol); setPending(null); setResolutions({}); }}>Apply change set</button><button onClick={() => { setPending(null); setResolutions({}); }}>Cancel</button></div>
    </article>}
    <details><summary>Applied history ({history.length})</summary>{history.map(item => <small key={`${item.changeSetId}:${item.appliedAt}`}>{item.changeSetId} · {item.author?.name || item.author?.id} · {item.appliedOperations} applied · {item.appliedAt}</small>)}</details>
  </section>;
}

function DeploymentCatalog({ protocol, onHostedRun, onMessage }) {
  const [providerId, setProviderId] = useState('org.physioflow.portable');
  const [environment, setEnvironment] = useState('portable');
  const [error, setError] = useState('');
  const [inspection, setInspection] = useState(null);
  const [hostedDeployment, setHostedDeployment] = useState(null);
  const [hostedSession, setHostedSession] = useState(null);
  const [hostedBootstrap, setHostedBootstrap] = useState(null);
  const [participantId, setParticipantId] = useState('SANDBOX-P001');
  const [maximumSessions, setMaximumSessions] = useState('5');
  const [launchLink, setLaunchLink] = useState(null);
  const sandboxRef = useRef(null);
  const participantClientRef = useRef(null);
  if (!sandboxRef.current) {
    const service = new LocalHostedExecutionService({ actors: [{ actorId: 'local-owner', role: 'owner', accessToken: 'local-owner-token' }] });
    sandboxRef.current = new HostedExecutionClient(service, 'local-owner-token');
  }
  const frozen = protocol.version?.status === 'frozen';
  const exportBundle = async () => {
    try {
      const bundle = await createDeploymentBundle(protocol, { providerId: providerId.trim(), environment: environment.trim(), createdBy: 'local-operator', maximumSessions: Number(maximumSessions) });
      downloadJson(`${protocol.metadata?.name || 'protocol'}.deployment.json`, bundle);
      setError('');
      onMessage(`Exported deployment bundle ${bundle.bundleId}`);
    } catch (nextError) { setError(nextError.message); }
  };
  const inspectBundle = async event => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      const bundle = JSON.parse(await file.text());
      const result = await validateDeploymentBundle(bundle);
      setInspection({ bundle, result });
      setError('');
    } catch (nextError) { setInspection(null); setError(nextError.message); }
    event.target.value = '';
  };
  const publishToSandbox = async () => {
    try {
      const bundle = await createDeploymentBundle(protocol, { providerId: 'org.physioflow.local-sandbox', environment: 'sandbox', createdBy: 'local-owner', maximumSessions: Number(maximumSessions) });
      const client = sandboxRef.current;
      const queued = await client.publish(bundle, { idempotencyKey: `composer:${protocol.protocolId}:${protocol.freeze.configHash}:${maximumSessions}` });
      const ready = client.processNextDeployment() || client.deployment(queued.deploymentId);
      setHostedDeployment(ready);
      setHostedSession(null);
      setHostedBootstrap(null);
      setLaunchLink(null);
      setError('');
      onMessage(`Sandbox deployment ${ready.status}`);
    } catch (nextError) { setError(nextError.message); }
  };
  const createSandboxSession = async () => {
    try {
      const session = await sandboxRef.current.createSession(hostedDeployment.deploymentId, { participantId: participantId.trim() || undefined, idempotencyKey: `participant:${participantId.trim() || 'generated'}` });
      participantClientRef.current = new HostedExecutionClient(sandboxRef.current.service, session.participantAccessToken);
      const bootstrap = await participantClientRef.current.bootstrap(session.sessionId);
      const check = await validateParticipantBootstrap(bootstrap);
      if (!check.valid) throw new Error(`Participant bootstrap failed validation: ${check.errors.join('; ')}`);
      setHostedSession(session);
      setHostedBootstrap(bootstrap);
      setError('');
      onMessage(`Created hosted sandbox session ${session.sessionId}`);
    } catch (nextError) { setError(nextError.message); }
  };
  const createSandboxLaunchLink = async () => {
    try {
      const link = await sandboxRef.current.createLaunchLink(hostedDeployment.deploymentId, { idempotencyKey: `launch:${hostedDeployment.deploymentId}`, maximumUses: 1 });
      setLaunchLink(link);
      setError('');
      onMessage(`Created revocable launch token ${link.launchLinkId}`);
    } catch (nextError) { setError(nextError.message); }
  };
  const redeemSandboxLaunchLink = async () => {
    try {
      const result = await sandboxRef.current.redeemLaunchLink(launchLink.launchToken, { idempotencyKey: `redeem:${participantId.trim() || 'generated'}`, participantId: participantId.trim() || undefined });
      participantClientRef.current = new HostedExecutionClient(sandboxRef.current.service, result.session.participantAccessToken);
      const bootstrap = await participantClientRef.current.bootstrap(result.session.sessionId);
      const check = await validateParticipantBootstrap(bootstrap);
      if (!check.valid) throw new Error(`Participant bootstrap failed validation: ${check.errors.join('; ')}`);
      setHostedSession(result.session);
      setHostedBootstrap(bootstrap);
      setLaunchLink(current => ({ ...current, ...result.launchLink }));
      setError('');
      onMessage(`Redeemed launch token for ${result.session.sessionId}`);
    } catch (nextError) { setError(nextError.message); }
  };
  const revokeSandboxLaunchLink = async () => {
    try {
      const revoked = await sandboxRef.current.revokeLaunchLink(launchLink.launchLinkId, { idempotencyKey: `revoke:${launchLink.launchLinkId}`, expectedRevision: launchLink.revision });
      setLaunchLink(current => ({ ...current, ...revoked }));
      setError('');
      onMessage(`Revoked launch token ${revoked.launchLinkId}`);
    } catch (nextError) { setError(nextError.message); }
  };
  const deactivateSandbox = async () => {
    try {
      const deactivated = await sandboxRef.current.deactivateDeployment(hostedDeployment.deploymentId, { idempotencyKey: `deactivate:${hostedDeployment.deploymentId}`, expectedRevision: hostedDeployment.revision });
      setHostedDeployment(deactivated);
      setError('');
      onMessage(`Deactivated sandbox deployment ${deactivated.deploymentId}`);
    } catch (nextError) { setError(nextError.message); }
  };
  return <section className="deployment-catalog">
    <h3>Portable deployment</h3>
    <p>Package one frozen protocol, its dependency manifest, execution policy, and integrity hashes for a compatible local or remote execution provider.</p>
    <label>Provider ID<input value={providerId} onChange={event => setProviderId(event.target.value)} /></label>
    <label>Environment<input value={environment} onChange={event => setEnvironment(event.target.value)} /></label>
    <label>Session quota<input type="number" min="1" step="1" value={maximumSessions} onChange={event => setMaximumSessions(event.target.value)} /></label>
    <button disabled={!frozen} onClick={exportBundle}>Export deployment bundle</button>
    <button disabled={!frozen} onClick={publishToSandbox}>Publish to local hosted sandbox</button>
    {!frozen && <small>Freeze this protocol version before deployment.</small>}
    <label className="deployment-import">Inspect deployment bundle<input type="file" accept="application/json,.json" onChange={inspectBundle} /></label>
    {error && <small className="package-error">{error}</small>}
    {inspection && <article className={inspection.result.valid ? 'deployment-valid' : 'deployment-invalid'}>
      <b>{inspection.result.valid ? 'Bundle integrity verified' : 'Bundle rejected'}</b>
      <small>{inspection.bundle.bundleId || 'Unknown bundle'} · {inspection.bundle.target?.providerId || 'Unknown provider'}</small>
      {inspection.result.errors.map(item => <small key={item}>{item}</small>)}
    </article>}
    {hostedDeployment && <article className="deployment-valid">
      <b>Hosted sandbox · {hostedDeployment.status}</b>
      <small>{hostedDeployment.deploymentId} · revision {hostedDeployment.revision} · {hostedDeployment.sessionCount}/{hostedDeployment.maximumSessions ?? '∞'} sessions</small>
      <label>Participant ID<input value={participantId} onChange={event => setParticipantId(event.target.value)} /></label>
      <button disabled={hostedDeployment.status !== 'ready'} onClick={createSandboxSession}>Create sandbox session</button>
      <button disabled={hostedDeployment.status !== 'ready' || Boolean(launchLink)} onClick={createSandboxLaunchLink}>Create one-use launch token</button>
      {launchLink && <><small>Launch {launchLink.launchLinkId} · {launchLink.status} · {launchLink.useCount}/{launchLink.maximumUses} uses</small><code>{launchLink.launchToken}</code><button disabled={launchLink.status !== 'active' || launchLink.useCount >= launchLink.maximumUses} onClick={redeemSandboxLaunchLink}>Redeem launch token</button><button disabled={launchLink.status !== 'active'} onClick={revokeSandboxLaunchLink}>Revoke launch token</button></>}
      <button disabled={hostedDeployment.status === 'deactivated'} onClick={deactivateSandbox}>Deactivate deployment</button>
      {hostedSession && <><small>Session {hostedSession.sessionId} · {hostedSession.status} · revision {hostedSession.revision}</small>{hostedBootstrap && <small>Bootstrap verified · {hostedBootstrap.resources.filter(item => item.status === 'ready').length}/{hostedBootstrap.resources.length} resources ready</small>}<button disabled={!hostedBootstrap} onClick={() => {
        const session = structuredClone(hostedSession);
        delete session.participantAccessToken;
        onHostedRun?.({ client: participantClientRef.current, session, protocol: hostedBootstrap.protocol, resources: hostedBootstrap.resources });
      }}>Run hosted session</button></>}
    </article>}
  </section>;
}

function ComponentPackageCatalog({ packages, locked, onInstallExample, onImport, onRemove }) {
  const { language } = useLanguage();
  const t = key => translate(key, language);

  const [pending, setPending] = useState(null);
  const [approved, setApproved] = useState([]);
  const [error, setError] = useState('');
  const readPackage = async event => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      const parsed = JSON.parse(await file.text());
      setPending(parsed);
      setApproved([]);
      setError('');
    } catch (nextError) { setError(nextError.message); setPending(null); }
    event.target.value = '';
  };
  const permissions = pending?.permissions || [];
  return <section className="component-package-catalog">
    <h3>{t('Project component library')}</h3>
    <p>SDK packages are declarative, versioned, permission-gated, and cannot inject JavaScript into Runtime V2.</p>
    <button disabled={locked || packages.some(item => item.packageId === 'org.physioflow.examples.reaction-button')} onClick={onInstallExample}>Install Reaction Button example</button>
    <label className="component-package-import">Import SDK package<input disabled={locked} type="file" accept="application/json,.json" onChange={readPackage} /></label>
    {error && <small className="package-error">{error}</small>}
    {pending && <article className="package-approval">
      <b>{pending.name || pending.packageId}</b><small>{pending.packageId}@{pending.version}</small>
      <p>Approve every requested capability before installation:</p>
      {!permissions.length && <small>No permissions requested.</small>}
      {permissions.map(permission => <label key={permission}><input type="checkbox" checked={approved.includes(permission)} onChange={event => setApproved(current => event.target.checked ? [...current, permission] : current.filter(item => item !== permission))} />{permission}</label>)}
      <div><button disabled={permissions.some(permission => !approved.includes(permission))} onClick={() => { onImport(pending); setPending(null); setApproved([]); }}>Approve and install</button><button onClick={() => setPending(null)}>Cancel</button></div>
    </article>}
    {packages.map(componentPackage => <article key={`${componentPackage.packageId}@${componentPackage.version}`}>
      <div><b>{componentPackage.name}</b><small>{componentPackage.packageId}@{componentPackage.version} · {componentPackage.components.length} component(s)</small></div>
      <small>{componentPackage.permissions?.length ? `Permissions: ${componentPackage.permissions.join(', ')}` : 'No permissions'}</small>
      <button disabled={locked} onClick={() => onRemove(componentPackage.packageId, componentPackage.version)}>Uninstall</button>
    </article>)}
  </section>;
}

function DeviceConnectorCatalog({ connectors, locked, onInstallExample, onImport, onRemove }) {
  const { language } = useLanguage();
  const t = key => translate(key, language);

  const [pending, setPending] = useState(null);
  const [approved, setApproved] = useState([]);
  const [error, setError] = useState('');
  const readConnector = async event => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      setPending(JSON.parse(await file.text()));
      setApproved([]);
      setError('');
    } catch (nextError) { setError(nextError.message); setPending(null); }
    event.target.value = '';
  };
  const permissions = pending?.permissions || [];
  return <section className="device-connector-catalog">
    <h3>{t('Device connectors')}</h3>
    <p>Versioned adapters expose typed I/O channels with explicit connect/read/write permissions and provenance events.</p>
    <button disabled={locked || connectors.some(item => item.connectorId === 'org.physioflow.simulated-sensor')} onClick={onInstallExample}>Install simulated sensor</button>
    <label className="device-connector-import">Import connector manifest<input disabled={locked} type="file" accept="application/json,.json" onChange={readConnector} /></label>
    {error && <small className="package-error">{error}</small>}
    {pending && <article className="package-approval">
      <b>{pending.name || pending.connectorId}</b><small>{pending.connectorId}@{pending.version} · {pending.transport}</small>
      <p>Approve every requested device capability:</p>
      {permissions.map(permission => <label key={permission}><input type="checkbox" checked={approved.includes(permission)} onChange={event => setApproved(current => event.target.checked ? [...current, permission] : current.filter(item => item !== permission))} />{permission}</label>)}
      <div><button disabled={permissions.some(permission => !approved.includes(permission))} onClick={() => { onImport(pending); setPending(null); setApproved([]); }}>Approve and install</button><button onClick={() => setPending(null)}>Cancel</button></div>
    </article>}
    {connectors.map(connector => <article key={`${connector.connectorId}@${connector.version}`}>
      <div><b>{connector.name}</b><small>{connector.connectorId}@{connector.version} · {connector.transport}</small></div>
      <small>{(connector.channels || []).map(channel => `${channel.direction} ${channel.id}:${channel.dataType}${channel.unit ? ` (${channel.unit})` : ''}`).join(' · ') || 'No channels'}</small>
      <small>Permissions: {(connector.approvedPermissions || []).join(', ') || 'none'}</small>
      <button disabled={locked} onClick={() => onRemove(connector.connectorId, connector.version)}>Uninstall</button>
    </article>)}
  </section>;
}

function VariableCatalog({ variables, locked, mode, onAdd, onUpdate, onRemove, onError }) {
  const { language } = useLanguage();
  const t = key => translate(key, language);

  const [draft, setDraft] = useState({ name: '', type: 'string', scope: 'session', defaultValue: '' });
  const submit = () => {
    let defaultValue = draft.defaultValue;
    if (draft.type === 'number') defaultValue = draft.defaultValue === '' ? 0 : Number(draft.defaultValue);
    if (draft.type === 'boolean') defaultValue = draft.defaultValue === 'true';
    try {
      onAdd({ ...draft, defaultValue });
      setDraft({ name: '', type: 'string', scope: 'session', defaultValue: '' });
    } catch (error) { onError(error); }
  };
  return <section className="variable-catalog">
    <h3>{t('Variables')}</h3>
    <p>Typed values available to conditions and participant UI bindings.</p>
    {variables.map(variable => <article key={variable.name}>
      <input disabled={locked} aria-label={`${variable.name} variable name`} value={variable.name} onChange={event => {
        try { onUpdate(variable.name, { name: event.target.value }); } catch { /* keep editing stable until valid */ }
      }} />
      <select disabled={locked} aria-label={`${variable.name} variable type`} value={variable.type} onChange={event => { try { onUpdate(variable.name, { type: event.target.value }); } catch (error) { onError(error); } }}>{['string', 'number', 'boolean', 'enum', 'object', 'array', 'unknown'].map(type => <option key={type}>{type}</option>)}</select>
      <select disabled={locked} aria-label={`${variable.name} variable scope`} value={variable.scope} onChange={event => onUpdate(variable.name, { scope: event.target.value })}>{['session', 'trial', 'component', 'container', 'project'].map(scope => <option key={scope}>{scope}</option>)}</select>
      {variable.type === 'boolean' ? <select disabled={locked} aria-label={`${variable.name} default value`} value={String(Boolean(variable.defaultValue))} onChange={event => onUpdate(variable.name, { defaultValue: event.target.value === 'true' })}><option value="false">false</option><option value="true">true</option></select>
        : <input disabled={locked} aria-label={`${variable.name} default value`} value={typeof variable.defaultValue === 'object' ? JSON.stringify(variable.defaultValue) : variable.defaultValue ?? ''} onChange={event => onUpdate(variable.name, { defaultValue: variable.type === 'number' ? Number(event.target.value) : event.target.value })} />}
      {mode === 'advanced' && <><select disabled={locked} aria-label={`${variable.name} variable source`} value={variable.source || 'manual'} onChange={event => onUpdate(variable.name, { source: event.target.value })}><option value="manual">manual</option><option value="participant">participant</option><option value="component">component</option><option value="computed">computed</option></select>
        <select disabled={locked} aria-label={`${variable.name} export policy`} value={variable.exportPolicy || 'include'} onChange={event => onUpdate(variable.name, { exportPolicy: event.target.value })}><option value="include">include</option><option value="exclude">exclude</option><option value="hash">hash</option></select></>}
      <button disabled={locked} aria-label={`Delete variable ${variable.name}`} onClick={() => onRemove(variable.name)}>×</button>
    </article>)}
    {!locked && <div className="variable-create">
      <input aria-label="New variable name" placeholder="variable_name" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} />
      <select aria-label="New variable type" value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value })}>{['string', 'number', 'boolean', 'enum'].map(type => <option key={type}>{type}</option>)}</select>
      <select aria-label="New variable scope" value={draft.scope} onChange={event => setDraft({ ...draft, scope: event.target.value })}>{['session', 'trial', 'component', 'container', 'project'].map(scope => <option key={scope}>{scope}</option>)}</select>
      <input aria-label="New variable default" placeholder="Default" value={draft.defaultValue} onChange={event => setDraft({ ...draft, defaultValue: event.target.value })} />
      <button disabled={!draft.name.trim()} onClick={submit}>Add variable</button>
    </div>}
  </section>;
}

function VisualAngleCalculator() {
  const [state, setState] = useState({ displayWidthPx: 1920, displayWidthCm: 60, viewingDistanceCm: 60 });
  const widthPx = Number(state.displayWidthPx) || 1920;
  const widthCm = Number(state.displayWidthCm) || 60;
  const distanceCm = Number(state.viewingDistanceCm) || 60;
  const report = calibrationReport({ displayWidthPx: widthPx, displayHeightPx: 1080, displayWidthCm: widthCm, displayHeightCm: Math.round(widthCm * 9 / 16), viewingDistanceCm: distanceCm });
  return <details className="va-calculator"><summary>Visual angle calculator</summary>
    <div className="va-row">
      <label>Width (px)<input type="number" value={state.displayWidthPx} onChange={event => setState(s => ({ ...s, displayWidthPx: event.target.value }))} /></label>
      <label>Width (cm)<input type="number" value={state.displayWidthCm} onChange={event => setState(s => ({ ...s, displayWidthCm: event.target.value }))} /></label>
      <label>Distance (cm)<input type="number" value={state.viewingDistanceCm} onChange={event => setState(s => ({ ...s, viewingDistanceCm: event.target.value }))} /></label>
    </div>
    <div className="va-results">
      {report.pixels_per_degree != null && <><span>1° = {report.references.one_degree_px} px</span><span>px/degree: {Math.round(report.pixels_per_degree * 100) / 100}</span><span>2° = {report.references.two_degrees_px} px</span><span>5° = {report.references.five_degrees_px} px</span></>}
      {report.pixels_per_degree == null && <span>Enter a screen width to compute.</span>}
    </div>
  </details>;
}

function AssetLibrary({ assets, locked, onUpdate }) {
  const [draft, setDraft] = useState({ name: '', mediaType: 'image', url: '' });
  const add = () => {
    if (!draft.name.trim() && !draft.url.trim()) return;
    onUpdate([...(assets || []), { id: createId('asset'), name: draft.name || draft.url, mediaType: draft.mediaType, sourceUrl: draft.url, checksum: null }]);
    setDraft({ name: '', mediaType: 'image', url: '' });
  };
  const remove = id => onUpdate((assets || []).filter(asset => (asset.id || asset.assetId) !== id));
  return <details className="asset-library"><summary>Media library ({assets.length})</summary>
    {(assets || []).map(asset => <div key={asset.id || asset.assetId} className="asset-row">
      <span>{asset.name || asset.fileName || asset.id}</span>
      <small>{asset.mediaType || asset.type || ''}</small>
      <button disabled={locked} onClick={() => remove(asset.id || asset.assetId)}>×</button>
    </div>)}
    <div className="asset-add">
      <input aria-label="Asset name" placeholder="Name" value={draft.name} onChange={event => setDraft(s => ({ ...s, name: event.target.value }))} />
      <select aria-label="Asset type" value={draft.mediaType} onChange={event => setDraft(s => ({ ...s, mediaType: event.target.value }))}><option>image</option><option>audio</option><option>video</option></select>
      <input aria-label="Asset URL" placeholder="URL" value={draft.url} onChange={event => setDraft(s => ({ ...s, url: event.target.value }))} />
      <button disabled={locked} onClick={add}>Add</button>
    </div>
  </details>;
}
