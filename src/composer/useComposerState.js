import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addNode,
  connect,
  disconnect,
  duplicateNode,
  insertNodeOnControlEdge,
  loadFlowSnapshots,
  moveNodes,
  removeFlowSnapshot,
  removeNode,
  renameFlowSnapshot,
  saveFlowSnapshot,
  serializeProtocolGraph,
  updateNode,
  validateProtocolGraphConfiguration,
} from '../core/index.js';
import { createProjectComponentRegistry } from '../sdk/index.js';
import { NODE_HEIGHT, NODE_WIDTH, computeGuides } from './toolbox.js';
import { useCatalogActions } from './useCatalogActions.js';
import { translate, useLanguage } from '../i18n.jsx';

function jsonErrorMessage(error, source) {
  const position = Number(error?.message?.match(/position\s+(\d+)/i)?.[1]);
  if (!Number.isFinite(position)) return `JSON syntax error: ${error.message}`;
  const before = source.slice(0, position).split('\n');
  return `JSON syntax error at line ${before.length}, column ${before.at(-1).length + 1}: ${error.message}`;
}

export function useComposerState({ protocol, onChange }) {
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
  const [codeOriginal, setCodeOriginal] = useState('');
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

  useEffect(() => {
    setCollaborationBaseline(structuredClone(collaborationProtocolRef.current));
  }, [protocol.protocolId, protocol.version?.number]);

  const locked = protocol.version?.status === 'frozen';
  const migrationReviewRequired = protocol.legacy?.migrationReport?.formalRunAllowed === false;
  const commit = next => { if (!locked) onChange(next, true); };
  const openCodeView = () => { const serialized = serializeProtocolGraph(protocol, 2); setCodeText(serialized); setCodeOriginal(serialized); setCodeError(''); setCodeView(true); };
  const closeCodeView = () => {
    if (codeText !== codeOriginal && !window.confirm('Discard unapplied JSON changes?')) return false;
    setCodeView(false);
    setCodeError('');
    return true;
  };
  const formatCode = () => {
    try { setCodeText(serializeProtocolGraph(JSON.parse(codeText), 2)); setCodeError(''); }
    catch (error) { setCodeError(jsonErrorMessage(error, codeText)); }
  };
  const applyCode = () => {
    try {
      const parsed = JSON.parse(codeText);
      const check = validateProtocolGraphConfiguration(parsed, registry);
      if (!check.valid) { setCodeError(check.errors.map(error => `${error.path || 'protocol'}: ${error.message}`).join('\n')); return; }
      commit(parsed);
      setCodeOriginal(serializeProtocolGraph(parsed, 2));
      setCodeView(false);
      setCodeError('');
    } catch (error) { setCodeError(jsonErrorMessage(error, codeText)); }
  };
  const addComponent = definition => {
    const controlIn = definition.ports.find(port => port.kind === 'control' && port.direction === 'input');
    const controlOut = definition.ports.find(port => port.kind === 'control' && port.direction === 'output');
    const selectedNodeEdge = selectedNode && protocol.graph.edges.find(item => item.kind === 'control' && item.source.nodeId === selectedNode.id && item.source.portId === 'next');
    const edge = selectedEdge?.kind === 'control' ? selectedEdge : selectedNodeEdge || protocol.graph.edges.find(item => item.kind === 'control' && item.source.nodeId === protocol.graph.entryNodeId);
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
        setMessage(`Inserted ${definition.label} after ${sourceNode.label}`);
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

  const actions = useCatalogActions({ protocol, commit, setMessage, setSelectedNodeId, selectedNode, previewNode, setCollaborationBaseline });

  return {
    protocol, commit, locked, migrationReviewRequired, language, t,
    selectedNodeId, setSelectedNodeId, selectedEdgeId, setSelectedEdgeId,
    pendingPort, setPendingPort, showAllValidation, setShowAllValidation,
    message, setMessage, editorMode, setEditorMode, codeView, setCodeView,
    codeText, setCodeText, codeError, setCodeError,
    previewNodeId, setPreviewNodeId, previewEdit, setPreviewEdit,
    selectedIds, setSelectedIds, zoom, setZoom, pan, setPan,
    marquee, setMarquee, snapEnabled, setSnapEnabled,
    searchQuery, setSearchQuery, snapshotsOpen, setSnapshotsOpen,
    snapshotName, setSnapshotName, renameId, setRenameId,
    searchRef, snapshots, deletePending,
    guides, pendingWire, suppressWireClickRef,
    collaborationBaseline, setCollaborationBaseline,
    canvasRef, canvasSize,
    registry, paletteGroups, validation, nodeLabelById, dataOutputOptions,
    selectedNode, selectedEdge, previewNode, previewDefinition,
    actions,
    openCodeView, closeCodeView, formatCode, codeDirty: codeText !== codeOriginal, applyCode, addComponent, addNodeAt, selectPort,
    selectedSet, selectNode, startDrag, dragNode, endDrag,
    updateSelected, performDelete, deleteSelection, confirmDelete, cancelDelete,
    copySelection, pasteClipboard, viewportPoint, startWire,
    onCanvasPointerDown, onCanvasWheel, autoLayout,
    searchResults, focusNode, persistSnapshot, restoreSnapshot, commitRename, deleteSnapshot,
    duplicateSelection,
  };
}
