import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { step as createStep, stepContentIssues } from './domain';
import { normalizeFlow, validateFlow } from './flowEngine';
import { Inspector } from './Inspector';
import { PALETTE } from './constants.js';

const nodeIcons = { start: 'START', end: 'END', condition: 'IF', loop: 'LOOP', event: 'STEP', note: '✎', junction: '●' };
const branchesFor = node => node.type === 'note' ? [] : node.type === 'condition' ? ['true', 'false'] : node.type === 'loop' ? ['body', 'exit'] : ['next'];

const GRID_SIZE = 24;
const SNAP_THRESHOLD = 4;
const SCROLL_EDGE = 40;
const SCROLL_SPEED = 8;

let clipboardNode = null;

export default function FlowCanvas({ trial, onChange, disabled, stimuli = [], questionnaires = [], focusTarget }) {
  const flow = useMemo(() => normalizeFlow(trial), [trial]);
  const trialRef = useRef(trial);
  const flowRef = useRef(flow);
  useEffect(() => { trialRef.current = trial; flowRef.current = flow; }, [trial, flow]);
  const [selectedNodeIds, setSelectedNodeIds] = useState(new Set());
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [dragConnection, setDragConnection] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [contextMenu, setContextMenu] = useState(null);
  const [focusMessage, setFocusMessage] = useState('');
  const [snapEnabled, setSnapEnabled] = useState(() => { try { return localStorage.getItem('physioflow.snap') !== '0'; } catch { return true; } });
  const [searchQuery, setSearchQuery] = useState('');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [snapshots, setSnapshots] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`physioflow.snapshots.${trial.trial_id}`) || '[]'); }
    catch { return []; }
  });
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const handledFocus = useRef(null);
  const canvasRef = useRef(null);
  const panDragRef = useRef(null);
  const spaceHeld = useRef(false);
  const check = validateFlow(flow, trial.steps || []);
  const unplacedSteps = useMemo(() => {
    const placed = new Set(flow.nodes.filter(node => node.type === 'event').map(node => node.step_id));
    return (trial.steps || []).filter(step => !placed.has(step.step_id));
  }, [flow.nodes, trial.steps]);

  useEffect(() => {
    if (!focusTarget) return;
    const focusKey = `${focusTarget.nonce || ''}:${trial.trial_id}`;
    if (handledFocus.current === focusKey) return;
    const targetStepId = focusTarget.step_id || (focusTarget.stepIndex != null ? trial.steps?.[focusTarget.stepIndex]?.step_id : '');
    if (!targetStepId && focusTarget.trial_id !== trial.trial_id) return;
    handledFocus.current = focusKey;
    const targetNode = flow.nodes.find(node => node.type === 'event' && node.step_id === targetStepId);
    setSelectedEdgeId(null);
    if (targetNode) {
      setSelectedNodeIds(new Set([targetNode.id]));
      setZoom(1);
      setPan({ x: 120 - targetNode.x, y: 160 - targetNode.y });
      setFocusMessage('');
    } else if (targetStepId) {
      const targetStep = trial.steps.find(step => step.step_id === targetStepId);
      setSelectedNodeIds(new Set());
      setFocusMessage(`${targetStep?.name || targetStep?.type || 'This step'} is not placed in the flow. Use the "Steps outside flow" panel to insert or remove it.`);
    } else {
      setSelectedNodeIds(new Set());
      setFocusMessage('Open this Trial and review its flow connections.');
    }
  }, [focusTarget, flow.nodes, trial.steps, trial.trial_id]);

  const updateFlow = useCallback(next => onChange({ ...trialRef.current, flow: next }), [onChange]);
  const updateNode = (id, values) => updateFlow({ ...flowRef.current, nodes: flowRef.current.nodes.map(n => n.id === id ? { ...n, ...values } : n) });
  const updateStep = (stepId, values) => onChange({ ...trialRef.current, steps: trialRef.current.steps.map(s => s.step_id === stepId ? { ...s, ...values } : s), flow: flowRef.current });
  // Shared helper to clone an event node (used by paste and duplicate)
  const cloneEventNode = useCallback((sourceNode, sourceStep, offsetX = 40, offsetY = 40) => {
    const newStepId = crypto.randomUUID();
    const newStep = structuredClone(sourceStep);
    newStep.step_id = newStepId;
    newStep.name = `${sourceStep.name} (copy)`;
    if (newStep.questionnaire) {
      newStep.questionnaire = structuredClone(newStep.questionnaire);
      newStep.questionnaire.questionnaire_id = crypto.randomUUID();
      newStep.questionnaire.questions = (newStep.questionnaire.questions || []).map(q => ({ ...structuredClone(q), question_id: crypto.randomUUID() }));
      newStep.questionnaire_id = newStep.questionnaire.questionnaire_id;
    }
    const newNode = { ...sourceNode, id: `node_${newStepId}`, step_id: newStepId, label: newStep.name, x: sourceNode.x + offsetX, y: sourceNode.y + offsetY };
    return { newNode, newStep };
  }, []);

  const placeExistingStep = step => {
    if (!step || disabled) return;
    const currentFlow = flowRef.current;
    const end = currentFlow.nodes.find(node => node.type === 'end');
    const incoming = end ? currentFlow.edges.find(edge => edge.target === end.id && edge.branch === 'next') || currentFlow.edges.find(edge => edge.target === end.id) : null;
    const node = {
      id: `node_${step.step_id}`,
      type: 'event',
      step_id: step.step_id,
      label: step.name || step.type,
      x: end ? Math.max(80, end.x - 220) : 260 + currentFlow.nodes.length * 24,
      y: end ? end.y - 10 : 140 + currentFlow.nodes.length * 24,
    };
    let edges = currentFlow.edges;
    if (incoming && end) {
      edges = currentFlow.edges.filter(edge => edge.id !== incoming.id).concat(
        { ...incoming, target: node.id },
        { id: `edge_${crypto.randomUUID()}`, source: node.id, target: end.id, branch: 'next' }
      );
    }
    const nextFlow = { ...currentFlow, nodes: [...currentFlow.nodes, node], edges };
    onChange({ ...trialRef.current, flow: nextFlow });
    setSelectedNodeIds(new Set([node.id]));
    setSelectedEdgeId(null);
    setFocusMessage('');
    setZoom(1);
    setPan({ x: 120 - node.x, y: 160 - node.y });
  };
  const removeUnplacedStep = stepId => {
    if (!stepId || disabled) return;
    const currentFlow = flowRef.current;
    const removedNodeIds = new Set(currentFlow.nodes.filter(node => node.step_id === stepId).map(node => node.id));
    onChange({
      ...trialRef.current,
      steps: trialRef.current.steps.filter(step => step.step_id !== stepId),
      flow: {
        ...currentFlow,
        nodes: currentFlow.nodes.filter(node => node.step_id !== stepId),
        edges: currentFlow.edges.filter(edge => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target)),
      },
    });
    setFocusMessage('');
  };

  const addEvent = type => {
    const item = createStep(type, { name: type[0].toUpperCase() + type.slice(1).replace('_', ' ') });
    const node = { id: `node_${item.step_id}`, type: 'event', step_id: item.step_id, label: item.name, x: 260, y: 140 + flow.nodes.length * 24 };
    onChange({ ...trial, steps: [...trial.steps, item], flow: { ...flow, nodes: [...flow.nodes, node] } });
    setSelectedNodeIds(new Set([node.id]));
  };
  const addLogic = type => {
    const node = { id: `${type}_${crypto.randomUUID()}`, type, label: type === 'condition' ? 'Condition' : 'Repeat', x: 480, y: 180, ...(type === 'condition' ? { rule: { variable: 'participant_language', operator: 'equals', value: 'zh' } } : { max_iterations: 3, rule: { variable: '', operator: 'equals', value: '' } }) };
    updateFlow({ ...flow, nodes: [...flow.nodes, node] });
    setSelectedNodeIds(new Set([node.id]));
  };
  const addNote = () => {
    const node = { id: `note_${crypto.randomUUID()}`, type: 'note', label: 'Note', content: '', color: '#fff9c4', x: 260, y: 140 + flow.nodes.length * 24, width: 180, height: 100 };
    updateFlow({ ...flow, nodes: [...flow.nodes, node] });
    setSelectedNodeIds(new Set([node.id]));
  };
  const addJunction = () => {
    const node = { id: `junction_${crypto.randomUUID()}`, type: 'junction', label: '●', x: 480, y: 180 };
    updateFlow({ ...flow, nodes: [...flow.nodes, node] });
    setSelectedNodeIds(new Set([node.id]));
  };

  const copyNode = useCallback((node) => {
    if (!node || ['start', 'end'].includes(node.type)) return;
    clipboardNode = structuredClone(node);
  }, []);
  const pasteNode = useCallback(() => {
    if (!clipboardNode) return;
    const original = structuredClone(clipboardNode);
    let newNode;
    if (original.type === 'event') {
      const sourceStep = trial.steps.find(s => s.step_id === original.step_id);
      if (!sourceStep) return;
      const cloned = cloneEventNode(original, sourceStep);
      newNode = cloned.newNode;
      onChange({ ...trial, steps: [...trial.steps, cloned.newStep], flow: { ...flow, nodes: [...flow.nodes, newNode] } });
    } else {
      newNode = { ...original, id: `${original.type}_${crypto.randomUUID()}`, x: original.x + 40, y: original.y + 40 };
      updateFlow({ ...flow, nodes: [...flow.nodes, newNode] });
    }
    setSelectedNodeIds(new Set([newNode.id]));
  }, [trial, flow, onChange, updateFlow, cloneEventNode]);
  const duplicateNode = useCallback((node) => {
    if (!node || ['start', 'end'].includes(node.type)) return;
    if (node.type === 'event') {
      const sourceStep = trial.steps.find(s => s.step_id === node.step_id);
      if (!sourceStep) return;
      const cloned = cloneEventNode(node, sourceStep);
      onChange({ ...trial, steps: [...trial.steps, cloned.newStep], flow: { ...flow, nodes: [...flow.nodes, cloned.newNode] } });
      setSelectedNodeIds(new Set([cloned.newNode.id]));
    } else {
      const newNode = { ...node, id: `${node.type}_${crypto.randomUUID()}`, x: node.x + 40, y: node.y + 40 };
      updateFlow({ ...flow, nodes: [...flow.nodes, newNode] });
      setSelectedNodeIds(new Set([newNode.id]));
    }
  }, [trial, flow, onChange, updateFlow, cloneEventNode]);

  const finishConnection = target => {
    const connState = dragConnection?.source ? dragConnection : null;
    if (!connState || connState.source === target) { setDragConnection(null); return; }
    const sourceNode = flow.nodes.find(n => n.id === connState.source);
    if (!sourceNode) { setDragConnection(null); return; }
    const withoutSameBranch = flow.edges.filter(e => !(e.source === connState.source && e.branch === connState.branch));
    updateFlow({ ...flow, edges: [...withoutSameBranch, { id: `edge_${crypto.randomUUID()}`, source: connState.source, target, branch: connState.branch }] });
    setDragConnection(null);
  };
  const removeNode = useCallback(id => {
    const node = flow.nodes.find(n => n.id === id);
    if (!node) return;
    const isEventNode = node.type === 'event' && node.step_id;
    if (isEventNode) {
      onChange({
        ...trialRef.current,
        steps: trialRef.current.steps.filter(s => s.step_id !== node.step_id),
        flow: {
          nodes: flow.nodes.filter(n => n.id !== id),
          edges: flow.edges.filter(e => e.source !== id && e.target !== id),
        },
      });
    } else {
      updateFlow({ nodes: flow.nodes.filter(n => n.id !== id), edges: flow.edges.filter(e => e.source !== id && e.target !== id) });
    }
    setSelectedNodeIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    setSelectedEdgeId(null);
    setContextMenu(null);
  }, [flow, updateFlow, onChange]);

  const deleteEdge = useCallback((edgeId) => {
    if (!edgeId) return;
    updateFlow({ ...flow, edges: flow.edges.filter(e => e.id !== edgeId) });
    setSelectedEdgeId(null); setContextMenu(null);
  }, [flow, updateFlow]);

  useEffect(() => {
    const handler = e => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.key === 'Escape') { setContextMenu(null); setDragConnection(null); setSearchQuery(''); }
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      // Space tracking for pan mode
      if (e.key === ' ' && !e.repeat) { spaceHeld.current = true; }
      // Copy / Paste / Duplicate / Select all
      if (mod && e.key === 'c') { e.preventDefault(); const primaryId = [...selectedNodeIds][0]; const n = flow.nodes.find(nd => nd.id === primaryId); if (n) copyNode(n); }
      if (mod && e.key === 'v') { e.preventDefault(); pasteNode(); }
      if (mod && e.key === 'd') { e.preventDefault(); [...selectedNodeIds].forEach(id => { const n = flow.nodes.find(nd => nd.id === id); if (n) duplicateNode(n); }); }
      if (mod && e.key === 'a') { e.preventDefault(); setSelectedNodeIds(new Set(flow.nodes.map(n => n.id))); setSelectedEdgeId(null); }
      // Search
      if (mod && e.key === 'f') { e.preventDefault(); setSearchQuery(''); }
      // Shortcuts help
      if (mod && e.key === '/') { e.preventDefault(); setShortcutsOpen(prev => !prev); }
      if (!mod && e.key === '?' && !e.shiftKey) { e.preventDefault(); setShortcutsOpen(prev => !prev); }
      // Delete
      if ((e.key === 'Delete' || e.key === 'Backspace') && !document.activeElement?.closest('.studio-inspector')) {
        if (selectedEdgeId) { e.preventDefault(); deleteEdge(selectedEdgeId); }
        else if (selectedNodeIds.size > 0) {
          e.preventDefault();
          const toDelete = flow.nodes.filter(n => selectedNodeIds.has(n.id) && !['start', 'end'].includes(n.type));
          if (toDelete.length > 0) {
            const deleteIds = new Set(toDelete.map(n => n.id));
            const stepIdsToRemove = toDelete.filter(n => n.type === 'event').map(n => n.step_id);
            if (stepIdsToRemove.length > 0) {
              onChange({
                ...trialRef.current,
                steps: trialRef.current.steps.filter(s => !stepIdsToRemove.includes(s.step_id)),
                flow: {
                  nodes: flowRef.current.nodes.filter(n => !deleteIds.has(n.id)),
                  edges: flowRef.current.edges.filter(edge => !deleteIds.has(edge.source) && !deleteIds.has(edge.target)),
                },
              });
            } else {
              updateFlow({
                nodes: flowRef.current.nodes.filter(n => !deleteIds.has(n.id)),
                edges: flowRef.current.edges.filter(edge => !deleteIds.has(edge.source) && !deleteIds.has(edge.target)),
              });
            }
            setSelectedNodeIds(new Set());
            setSelectedEdgeId(null);
            setContextMenu(null);
          }
        }
      }
      if (e.key === 'Escape') { setContextMenu(null); setDragConnection(null); setSearchQuery(''); }
    };
    const keyup = e => { if (e.key === ' ') spaceHeld.current = false; };
    window.addEventListener('keydown', handler);
    window.addEventListener('keyup', keyup);
    return () => { window.removeEventListener('keydown', handler); window.removeEventListener('keyup', keyup); };
  }, [selectedNodeIds, selectedEdgeId, flow, copyNode, pasteNode, duplicateNode, deleteEdge, removeNode, updateFlow, onChange]);

  const autoLayout = useCallback(() => {
    const start = flow.nodes.find(n => n.type === 'start');
    const levels = new Map(start ? [[start.id, 0]] : []);
    if (!start) return;
    const queue = [start.id]; let qhead = 0;
    while (qhead < queue.length) { const id = queue[qhead++], lvl = levels.get(id); flow.edges.filter(e => e.source === id).forEach(e => { if (!levels.has(e.target)) { levels.set(e.target, lvl + 1); queue.push(e.target); } }); }
    const counts = {};
    const nodes = flow.nodes.map((n, i) => { const lvl = levels.get(n.id) ?? i; counts[lvl] = (counts[lvl] || 0) + 1; return { ...n, x: 80 + lvl * 250, y: 90 + (counts[lvl] - 1) * 150 }; });
    updateFlow({ ...flow, nodes });
  }, [flow, updateFlow]);

  // ── Flow snapshots ──
  const saveSnapshot = useCallback(() => {
    const snapshot = {
      id: crypto.randomUUID(),
      name: `Snapshot ${snapshots.length + 1}`,
      created_at: new Date().toISOString(),
      flow: structuredClone(flow),
      steps: structuredClone(trial.steps),
    };
    const next = [...snapshots, snapshot].slice(-20); // keep last 20
    setSnapshots(next);
    try { localStorage.setItem(`physioflow.snapshots.${trial.trial_id}`, JSON.stringify(next)); } catch {}
  }, [snapshots, flow, trial.steps, trial.trial_id]);

  const restoreSnapshot = useCallback((snapshot) => {
    if (disabled) return;
    onChange({
      ...trialRef.current,
      steps: structuredClone(snapshot.steps),
      flow: structuredClone(snapshot.flow),
    });
    setSelectedNodeIds(new Set());
    setSelectedEdgeId(null);
  }, [disabled, onChange]);

  const deleteSnapshot = useCallback((snapshotId) => {
    const next = snapshots.filter(s => s.id !== snapshotId);
    setSnapshots(next);
    try { localStorage.setItem(`physioflow.snapshots.${trial.trial_id}`, JSON.stringify(next)); } catch {}
  }, [snapshots, trial.trial_id]);

  const renameSnapshot = useCallback((snapshotId, newName) => {
    const next = snapshots.map(s => s.id === snapshotId ? { ...s, name: newName } : s);
    setSnapshots(next);
    try { localStorage.setItem(`physioflow.snapshots.${trial.trial_id}`, JSON.stringify(next)); } catch {}
  }, [snapshots, trial.trial_id]);

  // Persist snapshots when trial changes
  useEffect(() => {
    try { localStorage.setItem(`physioflow.snapshots.${trial.trial_id}`, JSON.stringify(snapshots)); } catch {}
  }, [snapshots, trial.trial_id]);

  const handleWheel = e => {
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
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
  };

  const dragRef = useRef(null);
  const [draggingId, setDraggingId] = useState(null);
  const [guides, setGuides] = useState([]);

  const snapVal = useCallback((v) => snapEnabled ? Math.round(v / GRID_SIZE) * GRID_SIZE : v, [snapEnabled]);

  const beginDrag = (e, node) => {
    if (disabled || e.target.closest('button,input,select')) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const dx = (e.clientX - rect.left) / zoom - node.x - pan.x / zoom;
    const dy = (e.clientY - rect.top) / zoom - node.y - pan.y / zoom;
    const isMultiDrag = selectedNodeIds.size > 1 && selectedNodeIds.has(node.id);
    if (isMultiDrag) {
      const offsets = {};
      selectedNodeIds.forEach(id => { const n = flowRef.current.nodes.find(nd => nd.id === id); if (n) offsets[id] = { dx: n.x - node.x, dy: n.y - node.y }; });
      dragRef.current = { nodeIds: [...selectedNodeIds], offsets, dx, dy, startX: node.x, startY: node.y };
    } else {
      setSelectedNodeIds(new Set([node.id]));
      dragRef.current = { nodeId: node.id, dx, dy, startX: node.x, startY: node.y };
    }
    setDraggingId(node.id);
    let raf = null;
    const move = ev => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        if (!dragRef.current) return;
        const shouldSnap = snapEnabled && !ev.altKey;
        const rawX = (ev.clientX - rect.left) / zoom - dragRef.current.dx - pan.x / zoom;
        const rawY = (ev.clientY - rect.top) / zoom - dragRef.current.dy - pan.y / zoom;
        const nx = Math.max(20, shouldSnap ? snapVal(rawX) : rawX);
        const ny = Math.max(20, shouldSnap ? snapVal(rawY) : rawY);
        // Auto-scroll near edges
        const cr = canvasRef.current.getBoundingClientRect();
        const edgeThreshold = SCROLL_EDGE;
        if (ev.clientX - cr.left < edgeThreshold) setPan(p => ({ ...p, x: p.x + SCROLL_SPEED }));
        else if (cr.right - ev.clientX < edgeThreshold) setPan(p => ({ ...p, x: p.x - SCROLL_SPEED }));
        if (ev.clientY - cr.top < edgeThreshold) setPan(p => ({ ...p, y: p.y + SCROLL_SPEED }));
        else if (cr.bottom - ev.clientY < edgeThreshold) setPan(p => ({ ...p, y: p.y - SCROLL_SPEED }));
        // Alignment guides
        const newGuides = [];
        if (shouldSnap) {
          const draggedNode = flowRef.current.nodes.find(n => n.id === dragRef.current.nodeId) || flowRef.current.nodes.find(n => n.id === dragRef.current.nodeIds?.[0]);
          if (draggedNode) {
            const dcx = nx + 92, dcy = ny + 52, dl = nx, dr = nx + 184, dt = ny, db = ny + 104;
            flowRef.current.nodes.forEach(other => {
              if (other.id === draggedNode.id) return;
              const ocx = other.x + 92, ocy = other.y + 52, ol = other.x, or = other.x + 184, ot = other.y, ob = other.y + 104;
              if (Math.abs(dcx - ocx) < SNAP_THRESHOLD) newGuides.push({ orientation: 'v', pos: ocx });
              if (Math.abs(dcy - ocy) < SNAP_THRESHOLD) newGuides.push({ orientation: 'h', pos: ocy });
              if (Math.abs(dl - ol) < SNAP_THRESHOLD) newGuides.push({ orientation: 'v', pos: ol });
              if (Math.abs(dr - or) < SNAP_THRESHOLD) newGuides.push({ orientation: 'v', pos: or });
              if (Math.abs(dt - ot) < SNAP_THRESHOLD) newGuides.push({ orientation: 'h', pos: ot });
              if (Math.abs(db - ob) < SNAP_THRESHOLD) newGuides.push({ orientation: 'h', pos: ob });
            });
          }
        }
        setGuides(newGuides);
        // Apply positions
        if (dragRef.current.nodeIds) {
          const ids = dragRef.current.nodeIds;
          const firstId = ids[0];
          const firstNode = flowRef.current.nodes.find(n => n.id === firstId);
          if (firstNode) {
            const deltaX = nx - firstNode.x;
            const deltaY = ny - firstNode.y;
            const updates = {};
            ids.forEach(id => {
              const n = flowRef.current.nodes.find(nd => nd.id === id);
              if (n) updates[id] = { x: Math.max(20, n.x + deltaX), y: Math.max(20, n.y + deltaY) };
            });
            updateFlow({ ...flowRef.current, nodes: flowRef.current.nodes.map(n => updates[n.id] ? { ...n, ...updates[n.id] } : n) });
          }
        } else {
          updateNode(node.id, { x: nx, y: ny });
        }
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      dragRef.current = null;
      setDraggingId(null);
      setGuides([]);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Drag-to-connect from output ports
  const beginConnDrag = (e, node, branch) => {
    e.stopPropagation(); e.preventDefault();
    setDragConnection({ source: node.id, branch, clientX: e.clientX, clientY: e.clientY });
    const move = ev => { setDragConnection(prev => prev ? { ...prev, clientX: ev.clientX, clientY: ev.clientY } : null); };
    const up = ev => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      const targetNode = target?.closest('[data-node-id]');
      if (targetNode) {
        const targetId = targetNode.getAttribute('data-node-id');
        if (targetId && targetId !== node.id) finishConnection(targetId);
      }
      setDragConnection(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Pan with middle mouse / space+drag / right-drag
  const beginPan = e => {
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
  };

  // Box/marquee selection
  const beginMarquee = e => {
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
          const nw = n.type === 'note' ? (n.width || 180) : n.type === 'junction' ? 24 : 184;
          const nh = n.type === 'note' ? (n.height || 100) : n.type === 'junction' ? 24 : 104;
          return n.x + nw > minX && n.x < maxX && n.y + nh > minY && n.y < maxY;
        }).map(n => n.id);
        if (inside.length > 0) setSelectedNodeIds(new Set(inside));
        return null;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const edgeContextMenu = (e, edgeId) => {
    e.preventDefault(); e.stopPropagation();
    setSelectedEdgeId(edgeId); setSelectedNodeIds(new Set());
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'edge', id: edgeId });
  };

  const bounds = useMemo(() => {
    if (!flow.nodes.length) return { minX: 0, minY: 0, maxX: 400, maxY: 300 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    flow.nodes.forEach(n => { const w = n.type === 'note' ? (n.width || 180) : n.type === 'junction' ? 24 : 200; const h = n.type === 'note' ? (n.height || 100) : n.type === 'junction' ? 24 : 80; minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x + w); maxY = Math.max(maxY, n.y + h); });
    return { minX: minX - 40, minY: minY - 40, maxX: maxX + 40, maxY: maxY + 40 };
  }, [flow.nodes]);
  const worldW = bounds.maxX - bounds.minX;
  const worldH = bounds.maxY - bounds.minY;

  const selectedNode = (selectedNodeIds.size === 1) ? flow.nodes.find(n => selectedNodeIds.has(n.id)) : null;
  const selectedEdge = flow.edges.find(e => e.id === selectedEdgeId);

  const isSelected = id => selectedNodeIds.has(id);
  const filteredNodes = useMemo(() => {
    if (!searchQuery) return flow.nodes;
    const q = searchQuery.toLowerCase();
    return flow.nodes.filter(n => n.label?.toLowerCase().includes(q) || (n.type === 'event' && trial.steps.find(s => s.step_id === n.step_id)?.name?.toLowerCase().includes(q)));
  }, [flow.nodes, searchQuery, trial.steps]);

  return <div className="studio">
    <aside className="studio-palette">
      <div className="studio-brand"><span>＋</span><div><b>Add to flow</b><small>Drag nodes to arrange</small></div></div>
      {PALETTE.map(group => <section key={group.title}><h4>{group.title}</h4>{group.items.map(([type, icon, label]) => <button key={type} disabled={disabled} onClick={() => addEvent(type)}><i>{icon}</i><span>{label}</span></button>)}</section>)}
      <section><h4>Flow</h4><button disabled={disabled} onClick={() => addLogic('condition')}><i>◇</i><span>Condition</span></button><button disabled={disabled} onClick={() => addLogic('loop')}><i>↻</i><span>Loop</span></button></section>
      <section><h4>Utils</h4><button disabled={disabled} onClick={addNote}><i>✎</i><span>Note</span></button><button disabled={disabled} onClick={addJunction}><i>●</i><span>Junction</span></button></section>
    </aside>

    <section className="studio-center">
      <div className="canvas-bar">
        <div><b>{trial.name}</b><span>{flow.nodes.length} nodes · {flow.edges.length} connections</span></div>
        <div className={`connection-hint ${focusMessage ? 'focus-warning' : ''}`}>{focusMessage ? <span>{focusMessage}</span> : dragConnection ? <>Connect <strong>{dragConnection.branch}</strong> → <button onClick={() => setDragConnection(null)}>Cancel</button></> : null}</div>
        <label className="check-row" style={{ fontSize: '12px', whiteSpace: 'nowrap', gap: '4px', display: 'flex', alignItems: 'center', margin: 0 }}>
          <input type="checkbox" checked={snapEnabled} onChange={e => { setSnapEnabled(e.target.checked); try { localStorage.setItem('physioflow.snap', e.target.checked ? '1' : '0'); } catch {} }} /> Snap
        </label>
        <button onClick={autoLayout}>Auto layout</button>
        <div style={{ position: 'relative' }}>
          <button onClick={() => setSnapshotsOpen(o => !o)} title="Flow snapshots">{snapshots.length > 0 ? `📸 ${snapshots.length}` : '📸'}</button>
          {snapshotsOpen && <div className="snapshots-dropdown" style={{ position: 'absolute', top: '100%', right: 0, zIndex: 50, background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 8, padding: '.5rem', minWidth: 240, maxHeight: 320, overflowY: 'auto', boxShadow: 'var(--shadow-md)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.3rem .5rem' }}>
              <b style={{ fontSize: '.78rem' }}>Flow snapshots</b>
              <button onClick={() => { saveSnapshot(); setSnapshotsOpen(true); }} style={{ fontSize: '.72rem', padding: '.25rem .5rem' }}>+ Save</button>
            </div>
            {snapshots.length === 0 && <p style={{ padding: '.5rem', color: 'var(--muted)', fontSize: '.78rem' }}>No snapshots yet. Save a snapshot to preserve your current flow layout.</p>}
            {snapshots.map((s, _i) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', padding: '.35rem .5rem', borderBottom: '1px solid var(--line)' }}>
                <span style={{ fontSize: '.72rem', flex: 1 }} title={s.created_at}>{s.name}</span>
                <small style={{ color: 'var(--muted)', fontSize: '.65rem' }}>{s.created_at?.slice(11, 19) || ''}</small>
                <button onClick={() => restoreSnapshot(s)} style={{ fontSize: '.68rem', padding: '.2rem .4rem' }} title="Restore">↩</button>
                <button onClick={() => { const name = window.prompt('Snapshot name:', s.name); if (name) renameSnapshot(s.id, name); }} style={{ fontSize: '.68rem', padding: '.2rem .4rem' }} title="Rename">✎</button>
                <button onClick={() => deleteSnapshot(s.id)} className="danger" style={{ fontSize: '.68rem', padding: '.2rem .4rem' }} title="Delete">×</button>
              </div>
            ))}
          </div>}
        </div>
        <span className={check.valid ? 'flow-status valid' : 'flow-status invalid'} title={check.errors.concat(check.warnings).slice(0, 5).join('\n')}>{check.valid ? '✓ Ready' : `! ${check.errors.length} issues`}</span>
      </div>
      {searchQuery !== '' && (
        <div className="node-search-bar">
          <input autoFocus value={searchQuery} placeholder="Find node by name..." onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setSearchQuery(''); if (e.key === 'Enter' && filteredNodes.length > 0) { const node = filteredNodes[0]; setSelectedNodeIds(new Set([node.id])); setPan({ x: 120 - node.x, y: 160 - node.y }); setZoom(1); } }} />
          <span>{searchQuery ? `${filteredNodes.length} match${filteredNodes.length !== 1 ? 'es' : ''}` : ''}</span>
        </div>
      )}
      {unplacedSteps.length > 0 && !disabled && (
        <div className="unplaced-step-panel" role="status">
          <b>Steps outside flow · {unplacedSteps.length}</b>
          <span>These steps exist in the Trial but will not run until placed in the graph.</span>
          <div>
            {unplacedSteps.map(step => (
              <article key={step.step_id}>
                <i>{step.type}</i>
                <strong>{step.name || step.type}</strong>
                <button onClick={() => placeExistingStep(step)}>Insert</button>
                <button className="danger" onClick={() => removeUnplacedStep(step.step_id)}>Remove unused</button>
              </article>
            ))}
          </div>
        </div>
      )}
      <div className="clean-canvas" ref={canvasRef} onWheel={handleWheel}
        onPointerDown={e => {
          if (e.target === canvasRef.current || e.target.classList.contains('flow-bg') || e.target.closest('svg.flow-bg')) {
            if (e.button === 0 && !e.shiftKey) beginMarquee(e);
            else if (e.button === 1 || e.button === 2 || spaceHeld.current) beginPan(e);
            else { setSelectedNodeIds(new Set()); setSelectedEdgeId(null); setContextMenu(null); }
          } else if (e.button === 1 || e.button === 2) beginPan(e);
        }}
        onContextMenu={e => {
          if (e.target === canvasRef.current || e.target.classList.contains('flow-bg') || e.target.closest('svg.flow-bg')) {
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY, type: 'canvas' });
          }
        }}
        style={{ cursor: panDragRef.current ? 'grabbing' : spaceHeld.current ? 'grab' : '' }}
      >
        <svg className="flow-bg" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
          <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {flow.edges.map(edge => {
              const a = flow.nodes.find(n => n.id === edge.source), b = flow.nodes.find(n => n.id === edge.target);
              if (!a || !b) return null;
              const getPort = (node, isSource) => isSource ? { x: node.x + (node.type === 'junction' ? 12 : 184), y: node.y + (node.type === 'junction' ? 12 : node.type === 'note' ? (node.height || 100) / 2 : 55) } : { x: node.x + (node.type === 'junction' ? 0 : node.type === 'note' ? 0 : 0), y: node.y + (node.type === 'junction' ? 12 : node.type === 'note' ? (node.height || 100) / 2 : 55) };
              const p1 = getPort(a, true), p2 = getPort(b, false);
              const x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y, m = x1 + (x2 - x1) / 2;
              const sel = selectedEdgeId === edge.id;
              return <g key={edge.id}
                onContextMenu={e => edgeContextMenu(e, edge.id)}
                style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                onClick={e => { e.stopPropagation(); setSelectedEdgeId(edge.id); setSelectedNodeIds(new Set()); setContextMenu(null); }}
              >
                <path d={`M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}`} className="edge-hit" />
                <path d={`M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}`} stroke={sel ? 'var(--green)' : '#8f9d95'} strokeWidth={sel ? 2.5 : 1.5} fill="none" markerEnd="url(#arrow)" />
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
          const srcNode = flow.nodes.find(n => n.id === dragConnection.source);
          if (!srcNode) return null;
          const cr = canvasRef.current?.getBoundingClientRect();
          if (!cr) return null;
          const sx = (srcNode.x + (srcNode.type === 'junction' ? 12 : 184)) * zoom + pan.x;
          const sy = (srcNode.y + (srcNode.type === 'junction' ? 12 : srcNode.type === 'note' ? (srcNode.height || 100) / 2 : 55)) * zoom + pan.y;
          const ex = dragConnection.clientX - cr.left;
          const ey = dragConnection.clientY - cr.top;
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
          {flow.nodes.map(node => {
            const step = node.type === 'event' ? trial.steps.find(s => s.step_id === node.step_id) : null;
            const nodeIssues = (step && !disabled) ? stepContentIssues(step, stimuli, questionnaires) : [];
            const nodeHasError = nodeIssues.some(i => i.kind === 'error');
            const nodeHasWarn = !nodeHasError && nodeIssues.some(i => i.kind === 'warn');
            const sel = isSelected(node.id);
            const isDisabled = node.enabled === false;
            const highlightStyle = searchQuery && !filteredNodes.some(fn => fn.id === node.id) ? { opacity: 0.15 } : {};

            // Note node (sticky note)
            if (node.type === 'note') {
              return <div className={`clean-node note ${sel ? 'selected' : ''}`} data-node-id={node.id}
                style={{ left: node.x, top: node.y, pointerEvents: 'auto', background: node.color || '#fff9c4', width: node.width || 180, minWidth: node.width || 180, maxWidth: node.width || 180, height: node.height || 100, minHeight: node.height || 100, ...highlightStyle }}
                key={node.id}
                onPointerDown={e => beginDrag(e, node)}
                onClick={e => { e.stopPropagation(); if (e.shiftKey) { setSelectedNodeIds(prev => { const next = new Set(prev); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; }); } else { setSelectedNodeIds(new Set([node.id])); } setSelectedEdgeId(null); setContextMenu(null); }}
              >
                <div className="sticky-content" style={{ padding: '8px 12px', fontSize: '13px', color: '#333', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: '"Comic Sans MS", "Marker Felt", cursive', height: '100%', overflow: 'hidden' }}>
                  {node.content || node.label || 'Note'}
                </div>
              </div>;
            }
            // Junction node
            if (node.type === 'junction') {
              return <div className={`clean-node junction ${sel ? 'selected' : ''}`} data-node-id={node.id}
                style={{ left: node.x, top: node.y, pointerEvents: 'auto', ...highlightStyle }}
                key={node.id}
                onPointerDown={e => beginDrag(e, node)}
                onClick={e => { e.stopPropagation(); if (e.shiftKey) { setSelectedNodeIds(prev => { const next = new Set(prev); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; }); } else { setSelectedNodeIds(new Set([node.id])); } setSelectedEdgeId(null); setContextMenu(null); }}
              >
                <button className="node-input" title="Connect a wire to here" onClick={e => { e.stopPropagation(); finishConnection(node.id); }} />
                <div className="junction-dot" />
                <div className="node-outputs">{branchesFor(node).map(branch => <button key={branch} onPointerDown={e => beginConnDrag(e, node, branch)} title={`Drag from ${branch} port`}>{branch}<i /></button>)}</div>
              </div>;
            }

            return (
            <div className={`clean-node ${node.type} ${sel ? 'selected' : ''} ${draggingId === node.id ? 'dragging' : ''} ${isDisabled ? 'disabled' : ''}`}
              data-node-id={node.id}
              style={{ left: node.x, top: node.y, pointerEvents: 'auto', ...(node.color ? { borderColor: node.color, boxShadow: `0 0 0 2px ${node.color}20` } : {}), ...highlightStyle }} key={node.id}
              onPointerDown={e => beginDrag(e, node)}
              onClick={e => { e.stopPropagation(); if (e.shiftKey) { setSelectedNodeIds(prev => { const next = new Set(prev); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; }); } else { setSelectedNodeIds(new Set([node.id])); } setSelectedEdgeId(null); setContextMenu(null); }}
              onContextMenu={e => { e.stopPropagation(); setSelectedNodeIds(new Set([node.id])); setSelectedEdgeId(null); }}
            >
              {!['start', 'end'].includes(node.type) && <button className={`node-input ${dragConnection ? 'awaiting' : ''}`} title="Connect a wire to here" onClick={e => { e.stopPropagation(); finishConnection(node.id); }} />}
              <div className="node-title"><i style={node.color ? { background: `${node.color}30`, color: node.color } : {}}>{nodeIcons[node.type]}</i><div><small>{node.type}</small><b>{node.label}</b></div></div>
              {node.type === 'event' && <span className="event-kind">{step?.type}
                {nodeHasError && <span className="node-issue-dot error" title={nodeIssues.filter(i => i.kind === 'error').map(i => i.message).join('; ')}>!</span>}
                {nodeHasWarn && <span className="node-issue-dot warn" title={nodeIssues.map(i => i.message).join('; ')}>△</span>}
              </span>}
              {branchesFor(node).length > 0 && <div className="node-outputs">
                {branchesFor(node).map(branch => <button className={dragConnection?.source === node.id && dragConnection.branch === branch ? 'active' : ''} key={branch} onPointerDown={e => beginConnDrag(e, node, branch)} onClick={e => { e.stopPropagation(); setDragConnection(null); setDragConnection({ source: node.id, branch, clientX: e.clientX, clientY: e.clientY }); }} title={`Drag to connect ${branch}`}>{branch}<i /></button>)}
              </div>}
            </div>
          )})}
        </div>

        {flow.nodes.length > 0 && (
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
              {flow.nodes.map(n => <rect key={n.id} x={n.x} y={n.y} width={n.type === 'junction' ? 24 : n.type === 'note' ? (n.width || 180) : 180} height={n.type === 'junction' ? 24 : n.type === 'note' ? (n.height || 100) : 50} rx="6" fill={n.type === 'event' ? '#5ee0a660' : n.type === 'condition' ? '#f4d77e60' : n.type === 'loop' ? '#89c4f460' : n.type === 'note' ? '#ffe08260' : n.type === 'junction' ? '#ce93d860' : '#bec8c160'} />)}
              <rect className="viewport" x={-(pan.x / zoom) + bounds.minX} y={-(pan.y / zoom) + bounds.minY} width={(canvasRef.current?.clientWidth || 800) / zoom} height={(canvasRef.current?.clientHeight || 600) / zoom} onPointerDown={e => { e.stopPropagation(); e.preventDefault(); const minimap = e.target.closest('.flow-minimap'); if (minimap?._drag) minimap._drag(e); }} style={{ cursor: 'grab', pointerEvents: 'auto' }} />
            </svg>
          </div>
        )}

        <div className="zoom-controls">
          <button onClick={() => setZoom(z => Math.min(2, z + 0.15))} title="Zoom in">+</button>
          <button onClick={() => setZoom(z => Math.max(0.3, z - 0.15))} title="Zoom out">−</button>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} title="Reset zoom" style={{ fontSize: '.65rem' }}>1:1</button>
          <span style={{ fontSize: '.65rem', padding: '.35rem .5rem', color: '#7b867f' }}>{Math.round(zoom * 100)}%</span>
        </div>
      </div>

      {contextMenu && contextMenu.type === 'edge' && (
        <div className="context-menu" style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 999 }}>
          <button className="danger" onClick={() => deleteEdge(contextMenu.id)}>Delete connection</button>
        </div>
      )}
      {contextMenu && contextMenu.type === 'canvas' && (
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
          <button onClick={() => { setSelectedNodeIds(new Set(flow.nodes.map(n => n.id))); setContextMenu(null); }}>Select all</button>
          <button onClick={() => { autoLayout(); setContextMenu(null); }}>Auto layout</button>
        </div>
      )}
      {/* Keyboard shortcuts panel */}
      {shortcutsOpen && <>
        <div className="guide-backdrop" style={{ zIndex: 150 }} onClick={() => setShortcutsOpen(false)} />
        <div className="guide-panel" style={{ zIndex: 151, position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', maxWidth: '440px', maxHeight: '80vh' }}>
          <div className="guide-head"><div><span>SHORTCUTS</span></div><button onClick={() => setShortcutsOpen(false)} style={{ width: 34, height: 34, fontSize: 22 }}>×</button></div>
          <div className="guide-content" style={{ padding: '12px 16px' }}>
            <div className="guide-table">
              {[
                ['Ctrl+C/V/D', 'Copy / Paste / Duplicate'], ['Ctrl+A', 'Select all'],
                ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / Redo'], ['Ctrl+F', 'Search nodes'],
                ['Del', 'Delete selected'], ['Shift+Click', 'Toggle selection'],
                ['Drag output port', 'Connect nodes'], ['Space/Middle+Drag', 'Pan canvas'],
                ['Scroll', 'Zoom in/out'], ['Alt+Drag', 'Disable snap'], ['Escape', 'Cancel'],
              ].map(([key, desc], i) => <div key={i}><code>{key}</code><span>{desc}</span></div>)}
            </div>
          </div>
        </div>
      </>}
    </section>

    <Inspector
      node={selectedNode} edge={selectedEdge} trial={trial} stimuli={stimuli}
      questionnaires={questionnaires} disabled={disabled}
      selectedCount={selectedNodeIds.size}
      updateNode={values => selectedNode && updateNode(selectedNode.id, values)}
      updateStep={values => selectedNode && selectedNode.step_id && updateStep(selectedNode.step_id, values)}
      removeNode={() => { [...selectedNodeIds].forEach(id => removeNode(id)); }}
      deleteEdgeFromInspector={() => selectedEdge && deleteEdge(selectedEdge.id)}
      onCopyNode={() => selectedNode && copyNode(selectedNode)}
      onPasteNode={pasteNode}
      onDuplicateNode={() => selectedNode && duplicateNode(selectedNode)}
      hasClipboard={!!clipboardNode}
      flow={flow}
      updateFlow={updateFlow}
    />
  </div>;
}
