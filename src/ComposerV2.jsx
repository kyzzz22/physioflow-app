import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addVariable,
  addNode,
  assignNodeToGroup,
  connect,
  createNodeGroup,
  createSubflowTemplate,
  disconnect,
  duplicateNode,
  insertNodeOnControlEdge,
  instantiateSubflowTemplate,
  loadFlowSnapshots,
  moveNodes,
  protocolNameOf,
  removeFlowSnapshot,
  removeVariable,
  removeNodeGroup,
  removeSubflowTemplate,
  removeNode,
  renameFlowSnapshot,
  saveFlowSnapshot,
  updateVariable,
  updateNodeGroup,
  serializeProtocolGraph,
  updateNode,
  validateProtocolGraphConfiguration,
} from './core/index.js';
import ParticipantUiBuilder from './ParticipantUiBuilder.jsx';
import ParticipantRenderer from './ParticipantRenderer.jsx';
import QuestionnaireEditor from './QuestionnaireEditorV2.jsx';
import { localResourceManifest, schemaForNode } from './runtime/index.js';
import { translate, useLanguage } from './i18n.jsx';
import { createProjectComponentRegistry, exampleReactionButtonPackage, installComponentPackage, uninstallComponentPackage } from './sdk/index.js';
import { exampleSimulatedConnector, installDeviceConnector, uninstallDeviceConnector } from './devices/index.js';
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  UI_TEMPLATE_KIND,
  computeGuides,
  edgePath,
  groupBounds,
  portPosition,
  validationIssueMessage,
} from './composer/toolbox.js';
import { CodeView, NodeInspector } from './composer/NodeInspector.jsx';
import {
  AssetLibrary,
  CollaborationCatalog,
  ComponentPackageCatalog,
  DeploymentCatalog,
  DeviceConnectorCatalog,
  GroupCatalog,
  SubflowTemplateCatalog,
  VariableCatalog,
  VisualAngleCalculator,
} from './composer/Catalogs.jsx';

export default function ComposerV2({ protocol, onChange, onSave, onBack, onExport, onPreview, onFreeze, onCreateDraft, onHostedRun, onUndo, onRedo, canUndo, canRedo, hasUnsaved, saveAnim }) {
  const { language } = useLanguage();
  const t = key => translate(key, language);
  const [selectedNodeId, setSelectedNodeId] = useState(protocol.graph.entryNodeId);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [pendingPort, setPendingPort] = useState(null);
  const [showAllValidation, setShowAllValidation] = useState(false);
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
  const [renameId, setRenameId] = useState(null);
  const searchRef = useRef(null);
  const [snapshots, setSnapshots] = useState(() => loadFlowSnapshots(protocol.protocolId));
  const [deletePending, setDeletePending] = useState(null);
  const clipboardRef = useRef({ nodes: [], edges: [] });
  const [guides, setGuides] = useState([]);
  // Drag-to-connect: while the pointer is down on an output port we render a
  // temporary wire (pendingWire) and, on release over an input port, connect.
  const [pendingWire, setPendingWire] = useState(null);
  const suppressWireClickRef = useRef(false);
  // When Escape cancels an in-flight drag-connect, this flag makes the eventual
  // pointerup a no-op so releasing the mouse cannot complete the wire.
  const wireCancelRef = useRef(false);
  const pasteCountRef = useRef(0);
  const [collaborationBaseline, setCollaborationBaseline] = useState(() => structuredClone(protocol));
  const collaborationProtocolRef = useRef(protocol);
  collaborationProtocolRef.current = protocol;
  const canvasRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 600 });
  useEffect(() => {
    const measure = () => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) setCanvasSize({ width: rect.width, height: rect.height });
    };
    measure();
    if (canvasRef.current) {
      const observer = new globalThis.ResizeObserver(measure);
      observer.observe(canvasRef.current);
      return () => observer.disconnect();
    }
  }, []);
  const dragRef = useRef(null);
  const registry = useMemo(() => createProjectComponentRegistry(protocol), [protocol]);
  const paletteGroups = useMemo(() => Object.entries(registry.list()
    .filter(item => !['core.start', 'core.end', 'legacy.step'].includes(item.type))
    .reduce((groups, item) => { (groups[item.category] ??= []).push(item); return groups; }, {})), [registry]);
  const validation = useMemo(() => validateProtocolGraphConfiguration(protocol, registry), [protocol, registry]);
  const nodeLabelById = useMemo(() => new Map(protocol.graph.nodes.map(node => [node.id, node.label])), [protocol.graph.nodes]);
  const controlPredecessors = useMemo(() => {
    const edges = protocol.graph.edges.filter(edge => edge.kind === 'control');
    const memo = new Map();
    const collect = (nodeId, seen) => {
      if (memo.has(nodeId)) return memo.get(nodeId);
      if (seen.has(nodeId)) return new Set();
      seen.add(nodeId);
      const result = new Set();
      for (const edge of edges) {
        if (edge.target.nodeId === nodeId) {
          result.add(edge.source.nodeId);
          for (const pred of collect(edge.source.nodeId, seen)) result.add(pred);
        }
      }
      seen.delete(nodeId);
      memo.set(nodeId, result);
      return result;
    };
    return nodeId => (nodeId ? collect(nodeId, new Set()) : new Set());
  }, [protocol.graph.edges]);
  const dataOutputOptions = useMemo(() => {
    if (!selectedNodeId) return [];
    const predecessors = controlPredecessors(selectedNodeId);
    const list = [];
    for (const item of protocol.graph.nodes) {
      if (item.id === selectedNodeId || !predecessors.has(item.id)) continue;
      const definition = registry.get(item.component.type, item.component.version);
      const ports = (definition?.ports || []).filter(port => port.direction === 'output' && port.kind === 'data');
      if (ports.length) list.push({ nodeId: item.id, label: item.label, ports });
    }
    return list;
  }, [protocol.graph.nodes, selectedNodeId, registry, controlPredecessors]);
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
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 指针捕获不可用时忽略 */ }
  };
  const dragNode = event => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / zoom;
    const dy = (event.clientY - drag.startY) / zoom;
    const snap = value => (snapEnabled ? Math.round(value / 24) * 24 : value);
    const raw = Object.fromEntries(drag.ids.map(id => {
      const origin = drag.origins[id];
      return [id, { x: Math.max(12, origin.x + dx), y: Math.max(12, origin.y + dy) }];
    }));
    const { guides, dx: gdx, dy: gdy } = computeGuides(drag.ids, raw, protocol.graph.nodes);
    const positions = Object.fromEntries(drag.ids.flatMap(id => {
      const p = raw[id];
      if (!p) return [];
      let x = p.x, y = p.y;
      if (guides.length) { x += gdx; y += gdy; }
      else if (snapEnabled) { x = snap(x); y = snap(y); }
      return [[id, { x: Math.max(12, Math.round(x)), y: Math.max(12, Math.round(y)) }]];
    }));
    setGuides(guides);
    onChange(moveNodes(protocol, positions), false);
  };
  const endDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setGuides([]);
  };

  const updateSelected = patch => commit(updateNode(protocol, selectedNode.id, patch));
  const performDelete = targets => {
    try {
      let next = protocol;
      for (const id of targets) next = removeNode(next, id);
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
    const ids = new Set(targets);
    const nodes = targets.map(id => {
      const node = protocol.graph.nodes.find(item => item.id === id);
      if (!node) return null;
      return { __srcId: id, component: node.component, label: node.label, config: structuredClone(node.config), bindings: structuredClone(node.bindings), layout: { x: node.layout.x, y: node.layout.y } };
    }).filter(Boolean);
    const edges = protocol.graph.edges
      .filter(edge => ids.has(edge.source.nodeId) && ids.has(edge.target.nodeId))
      .map(edge => ({ kind: edge.kind, source: { nodeId: edge.source.nodeId, portId: edge.source.portId }, target: { nodeId: edge.target.nodeId, portId: edge.target.portId } }));
    clipboardRef.current = { nodes, edges };
    pasteCountRef.current = 0;
    if (nodes.length) setMessage(`Copied ${nodes.length} node(s)`);
  };
  const pasteClipboard = () => {
    const clip = clipboardRef.current;
    if (!clip?.nodes?.length) return;
    try {
      pasteCountRef.current += 1;
      const offset = 40 + (pasteCountRef.current - 1) * 24;
      const idMap = {};
      let next = protocol;
      const ids = [];
      for (const item of clip.nodes) {
        const result = addNode(next, item.component.type, { label: item.label, config: structuredClone(item.config), bindings: structuredClone(item.bindings), layout: { x: item.layout.x + offset, y: item.layout.y + offset } });
        next = result.protocol;
        idMap[item.__srcId] = result.node.id;
        ids.push(result.node.id);
      }
      for (const edge of clip.edges || []) {
        const from = idMap[edge.source.nodeId], to = idMap[edge.target.nodeId];
        if (!from || !to) continue;
        try {
          next = connect(next, edge.kind, { nodeId: from, portId: edge.source.portId }, { nodeId: to, portId: edge.target.portId }).protocol;
        } catch { /* 端口不兼容时跳过该连线 */ }
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
  // Drag-to-connect: press on an output port, drag to an input port, release.
  const startWire = (event, node, port) => {
    if (port.direction !== 'output') return;
    event.stopPropagation();
    const from = viewportPoint(event);
    setPendingWire({ nodeId: node.id, portId: port.id, from, to: from });
    let moved = false;
    const move = moveEvent => {
      const to = viewportPoint(moveEvent);
      if (Math.hypot(to.x - from.x, to.y - from.y) > 6) moved = true;
      setPendingWire(wire => (wire ? { ...wire, to } : wire));
    };
    const up = upEvent => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPendingWire(null);
      if (wireCancelRef.current) { wireCancelRef.current = false; return; }
      const element = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
      const portElement = element?.closest('.composer-port');
      const nodeElement = portElement?.closest('.composer-node');
      const targetId = nodeElement?.dataset?.nodeId;
      const targetPortId = portElement?.dataset?.portId;
      if (moved && targetId && targetPortId && targetId !== node.id) {
        const targetNode = protocol.graph.nodes.find(item => item.id === targetId);
        const targetDef = targetNode && registry.get(targetNode.component.type, targetNode.component.version);
        const targetPort = targetDef?.ports.find(item => item.id === targetPortId);
        if (targetPort && targetPort.direction === 'input' && targetPort.kind === port.kind) {
          try {
            const result = connect(protocol, port.kind, { nodeId: node.id, portId: port.id }, { nodeId: targetId, portId: targetPortId });
            commit(result.protocol);
            setMessage('Connected');
          } catch (error) { setMessage(error.message); }
        }
      }
      // A real drag (not a click) must not also toggle port selection.
      suppressWireClickRef.current = moved;
      setTimeout(() => { suppressWireClickRef.current = false; }, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
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
    const groupedIds = new Set((protocol.graph.groups || []).flatMap(group => group.nodeIds));
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
    // Grouped nodes keep their positions (their bounding box would break otherwise);
    // unreachable nodes are laid out by index, matching the legacy canvas behaviour.
    protocol.graph.nodes.forEach((node, i) => {
      if (groupedIds.has(node.id) || positions[node.id]) return;
      const level = i;
      const count = levelCounts.get(level) || 0;
      levelCounts.set(level, count + 1);
      positions[node.id] = { x: 80 + level * 220, y: 100 + count * 140 };
    });
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
    const snapshot = { id: `snap_${Date.now()}`, name: snapshotName.trim() || `Snapshot ${snapshots.length + 1}`, savedAt: new Date().toISOString(), graph: structuredClone(protocol.graph) };
    setSnapshots(saveFlowSnapshot(protocol.protocolId, snapshot));
    setSnapshotName('');
    setMessage('Flow snapshot saved');
  };
  const restoreSnapshot = snapshot => {
    if (snapshot.graph) {
      commit({ ...protocol, graph: structuredClone(snapshot.graph) });
    } else {
      // Legacy snapshots only recorded node positions.
      const positions = Object.fromEntries(snapshot.nodes.map(node => [node.id, node.layout]));
      commit(moveNodes(protocol, positions));
    }
    setMessage(`Restored ${snapshot.name}`);
  };
  const commitRename = (id, name) => {
    const trimmed = (name || '').trim();
    setRenameId(null);
    if (!trimmed || !snapshots.some(item => item.id === id)) return;
    setSnapshots(renameFlowSnapshot(protocol.protocolId, id, trimmed));
    setMessage('Snapshot renamed');
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((previewEdit && previewNode?.config?.ui) || (editorMode !== 'quick' && selectedNode?.config?.ui)) return;
      if (event.metaKey || event.ctrlKey) {
        const key = event.key.toLowerCase();
        if (key === 'c') { copySelection(); }
        else if (key === 'v') { event.preventDefault(); pasteClipboard(); }
        else if (key === 'd') { event.preventDefault(); duplicateSelection(); }
        else if (key === 'a') { event.preventDefault(); const ids = protocol.graph.nodes.filter(node => node.id !== protocol.graph.entryNodeId).map(node => node.id); setSelectedIds(new Set(ids)); setSelectedNodeId(null); setSelectedEdgeId(null); }
        else if (key === '0') { event.preventDefault(); setZoom(1); setPan({ x: 0, y: 0 }); }
        else if (key === '=' || key === '+') { event.preventDefault(); setZoom(z => Math.min(2.5, +(z * 1.25).toFixed(2))); }
        else if (key === '-' || key === '_') { event.preventDefault(); setZoom(z => Math.max(0.4, +(z * 0.8).toFixed(2))); }
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && (selectedSet().size || selectedEdge)) {
        event.preventDefault();
        deleteSelection();
      } else if (event.key === 'Escape') {
        // Cancel in-flight operations first (most urgent), then clear selection.
        if (pendingWire) { setPendingWire(null); wireCancelRef.current = true; return; }
        if (pendingPort) { setPendingPort(null); setMessage(''); return; }
        if (marquee) { setMarquee(null); return; }
        if (deletePending) { setDeletePending(null); return; }
        setSelectedIds(new Set());
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setGuides([]);
      } else if (event.key === 'Enter' && !selectedEdge && selectedSet().size === 1) {
        const only = [...selectedSet()][0];
        const node = protocol.graph.nodes.find(item => item.id === only);
        if (node?.config?.ui) { event.preventDefault(); setPreviewNodeId(node.id); setPreviewEdit(true); }
      } else if (event.key.startsWith('Arrow')) {
        const set = selectedSet();
        if (!set.size) return;
        event.preventDefault();
        const step = event.shiftKey ? 8 : 24;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        if (!dx && !dy) return;
        const positions = {};
        for (const id of set) {
          const node = protocol.graph.nodes.find(item => item.id === id);
          if (node) positions[id] = { x: Math.max(12, node.layout.x + dx), y: Math.max(12, node.layout.y + dy) };
        }
        commit(moveNodes(protocol, positions));
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
      </section>
      <aside className="composer-inspector">
        <h2>{t('Inspector')}</h2>
        {migrationReviewRequired && <div className="migration-review-warning"><b>Migration review required</b><span>{protocol.legacy.migrationReport.issues.length} item(s) must be checked before this draft can be frozen.</span></div>}
        {selectedNode && <NodeInspector node={selectedNode} definition={registry.get(selectedNode.component.type, selectedNode.component.version)} variables={protocol.variables || []} groups={protocol.graph.groups || []} mode={editorMode} onUpdate={updateSelected} onAssignGroup={groupId => commit(assignNodeToGroup(protocol, selectedNode.id, groupId))} questionnaireLibrary={protocol.questionnaireLibrary || []} onLibraryChange={library => commit({ ...protocol, questionnaireLibrary: library })} assets={protocol.assets || []} dataOutputOptions={dataOutputOptions} onCreateGroup={() => {
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
          {(() => {
            const allIssues = [...validation.errors, ...validation.warnings];
            const visible = showAllValidation ? allIssues : allIssues.slice(0, 8);
            return <>
              {visible.map((issue, index) => <button key={`${issue.code}-${index}`} onClick={() => issue.nodeId && setSelectedNodeId(issue.nodeId)}><b>{issue.code}</b><span>{validationIssueMessage(issue, language, protocol)}</span></button>)}
              {allIssues.length > 8 && <button className="composer-validation-more" onClick={() => setShowAllValidation(show => !show)}>{showAllValidation ? `− ${t('Show fewer')}` : `+ ${t('Show all')} (${allIssues.length})`}</button>}
            </>;
          })()}
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
        ? <ParticipantUiBuilder schema={schemaForNode(previewNode, previewDefinition, localResourceManifest(protocol.assets || []))} defaultTemplate={UI_TEMPLATE_KIND[previewNode.component.type] || 'instruction'} onChange={updatePreviewUi} />
        : <div className="node-editor-preview"><ParticipantRenderer schema={schemaForNode(previewNode, previewDefinition, localResourceManifest(protocol.assets || []))} preview /></div>}
    </div>}
  </main>;
}
