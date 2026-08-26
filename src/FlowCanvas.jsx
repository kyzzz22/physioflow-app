import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { step as createStep } from './domain';
import { normalizeFlow, validateFlow } from './flowEngine';
import { Inspector } from './Inspector';
import { FLOW_PRESETS, PALETTE } from './constants.js';
import QuestionnaireWorkspace from './QuestionnaireWorkspace';
import FlowJsonEditor from './FlowJsonEditor.jsx';
import { NodeGlyph, nodeBadgeStyle, nodeColor, tint } from './flowIcons.jsx';
import { useT } from './i18n.jsx';
import { GRID_SIZE, SCROLL_EDGE, SCROLL_SPEED, branchStyle, edgePath, nodeHeight, nodeWidth } from './flowCanvas/layout.js';
import NodeCard from './flowCanvas/NodeCard.jsx';
import { NodePreviewModal } from './flowCanvas/NodePreviewModal.jsx';
import PalettePanel from './flowCanvas/PalettePanel.jsx';
import Minimap from './flowCanvas/Minimap.jsx';
import CanvasContextMenu from './flowCanvas/CanvasContextMenu.jsx';
import ShortcutsModal from './flowCanvas/ShortcutsModal.jsx';
import { useFlowSnapshots } from './flowCanvas/snapshots.js';
import {
  autoLayoutPositions, boundsOf, buildAlignmentGuides, computeMarqueeSelection, dropPosition,
  fitViewTransform, nodePortGeometry, snapToGrid,
} from './flowCanvas/interactions.js';

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
  const [focusHighlightStepId, setFocusHighlightStepId] = useState(null);
  const [snapEnabled, setSnapEnabled] = useState(() => { try { return localStorage.getItem('physioflow.snap') !== '0'; } catch { return true; } });
  const [searchQuery, setSearchQuery] = useState('');
  const [paletteSearch, setPaletteSearch] = useState('');
  const [viewMode, setViewMode] = useState('canvas'); // 'canvas' | 'code'
  const t = useT();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { snapshots, saveSnapshot, restoreSnapshot, deleteSnapshot, renameSnapshot } = useFlowSnapshots(trial, flow, disabled, onChange, setSelectedNodeIds, setSelectedEdgeId);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [paletteCollapsed, setPaletteCollapsed] = useState(() => { try { return localStorage.getItem('physioflow.paletteCollapsed') === '1'; } catch { return false; } });
  const [inspectorCollapsed, setInspectorCollapsed] = useState(() => { try { return localStorage.getItem('physioflow.inspectorCollapsed') === '1'; } catch { return false; } });
  const [previewNode, setPreviewNode] = useState(null);
  const [questionnaireWorkspace, setQuestionnaireWorkspace] = useState(null);
  const handledFocus = useRef(null);
  const canvasRef = useRef(null);
  const panDragRef = useRef(null);
  const spaceHeld = useRef(false);
  // Live refs so drag handlers stay referentially stable across renders (keeps NodeCard memo effective)
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  const selectedIdsRef = useRef(selectedNodeIds);
  const snapRef = useRef(snapEnabled);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { selectedIdsRef.current = selectedNodeIds; }, [selectedNodeIds]);
  useEffect(() => { snapRef.current = snapEnabled; }, [snapEnabled]);
  // Undo/redo
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const undoThrottle = useRef(0);
  const MAX_UNDO = 40;
  const pushUndo = useCallback(() => {
    const now = Date.now();
    if (now - undoThrottle.current < 400) return; // throttle during drag
    undoThrottle.current = now;
    undoStack.current.push({ flow: structuredClone(flowRef.current), steps: structuredClone(trialRef.current.steps) });
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    redoStack.current = []; // clear redo on new action
  }, []);
  const performUndo = useCallback(() => {
    if (undoStack.current.length === 0 || disabled) return;
    redoStack.current.push({ flow: structuredClone(flowRef.current), steps: structuredClone(trialRef.current.steps) });
    const prev = undoStack.current.pop();
    onChange({ ...trialRef.current, flow: prev.flow, steps: prev.steps });
    setSelectedNodeIds(new Set()); setSelectedEdgeId(null);
  }, [disabled, onChange]);
  const performRedo = useCallback(() => {
    if (redoStack.current.length === 0 || disabled) return;
    undoStack.current.push({ flow: structuredClone(flowRef.current), steps: structuredClone(trialRef.current.steps) });
    const next = redoStack.current.pop();
    onChange({ ...trialRef.current, flow: next.flow, steps: next.steps });
    setSelectedNodeIds(new Set()); setSelectedEdgeId(null);
  }, [disabled, onChange]);
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
    setFocusHighlightStepId(null);
    if (targetNode) {
      setSelectedNodeIds(new Set([targetNode.id]));
      setZoom(1);
      setPan({ x: 120 - targetNode.x, y: 160 - targetNode.y });
      setFocusMessage('');
    } else if (targetStepId) {
      const targetStep = trial.steps.find(step => step.step_id === targetStepId);
      setSelectedNodeIds(new Set());
      setFocusHighlightStepId(targetStepId);
      setFocusMessage(`「${targetStep?.name || targetStep?.type || 'Step'}」未放入流程图。请在下方的"Steps outside flow"面板中点击 Insert，或从左侧 Add to flow 添加对应节点。`);
    } else {
      // Trial-level issue (no specific step) — e.g. ITI jitter, validation errors
      setSelectedNodeIds(new Set());
      const issueText = focusTarget.issueMessage || '';
      const trialName = focusTarget.trialName || trial.name || '';
      setFocusMessage(`此 Trial「${trialName}」有需要修复的设置项。${issueText ? `具体问题：${issueText}` : ''} 请点击顶部 ⋯ → "Advanced settings" 切换到文本编辑器修改 Trial 设置（如 ITI jitter、repeat count 等）。`);
    }
  }, [focusTarget, flow.nodes, trial.steps, trial.trial_id, trial.name]);

  const updateFlow = useCallback(next => onChange({ ...trialRef.current, flow: next }), [onChange]);
  const updateNode = useCallback((id, values) => { pushUndo(); updateFlow({ ...flowRef.current, nodes: flowRef.current.nodes.map(n => n.id === id ? { ...n, ...values } : n) }); }, [pushUndo, updateFlow]);
  const updateStep = (stepId, values) => { pushUndo(); onChange({ ...trialRef.current, steps: trialRef.current.steps.map(s => s.step_id === stepId ? { ...s, ...values } : s), flow: flowRef.current }); };
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

  const addEventAt = useCallback((type, x, y) => {
    if (disabled) return;
    pushUndo();
    const item = createStep(type, { name: type[0].toUpperCase() + type.slice(1).replace('_', ' ') });
    const node = { id: `node_${item.step_id}`, type: 'event', step_id: item.step_id, label: item.name, x, y };
    onChange({ ...trialRef.current, steps: [...trialRef.current.steps, item], flow: { ...flowRef.current, nodes: [...flowRef.current.nodes, node] } });
    setSelectedNodeIds(new Set([node.id]));
  }, [disabled, onChange, pushUndo]);
  const addEvent = type => addEventAt(type, 260, 140 + flow.nodes.length * 24);

  // Composite presets (enhanced components) — expand into a connected chain
  const addPreset = (preset, x, y) => {
    if (disabled || !preset) return;
    pushUndo();
    const newSteps = preset.steps.map(s => createStep(s.type, s));
    const nodes = newSteps.map((s, i) => ({ id: `node_${s.step_id}`, type: 'event', step_id: s.step_id, label: s.name, x: x + i * 230, y }));
    const edges = nodes.slice(0, -1).map((n, i) => ({ id: `edge_${crypto.randomUUID()}`, source: n.id, target: nodes[i + 1].id, branch: 'next' }));
    onChange({
      ...trialRef.current,
      steps: [...trialRef.current.steps, ...newSteps],
      flow: { ...flowRef.current, nodes: [...flowRef.current.nodes, ...nodes], edges: [...flowRef.current.edges, ...edges] },
    });
    setSelectedNodeIds(new Set(nodes.map(n => n.id)));
  };

  // Palette → canvas drag-and-drop (AWS Infrastructure Composer style)
  const onPaletteDragStart = (e, type) => {
    e.dataTransfer.setData('application/x-physioflow-step', type);
    e.dataTransfer.effectAllowed = 'copy';
  };
  const onPalettePresetDragStart = (e, presetId) => {
    e.dataTransfer.setData('application/x-physioflow-preset', presetId);
    e.dataTransfer.effectAllowed = 'copy';
  };
  const onCanvasDrop = e => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return;
    const rawX = (e.clientX - rect.left - pan.x) / zoom;
    const rawY = (e.clientY - rect.top - pan.y) / zoom;
    const x = Math.max(20, snapEnabled ? Math.round(rawX / GRID_SIZE) * GRID_SIZE : Math.round(rawX));
    const y = Math.max(20, snapEnabled ? Math.round(rawY / GRID_SIZE) * GRID_SIZE : Math.round(rawY));
    const presetId = e.dataTransfer.getData('application/x-physioflow-preset');
    if (presetId) {
      const preset = FLOW_PRESETS.find(p => p.id === presetId);
      if (preset) { addPreset(preset, x, y); return; }
    }
    const type = e.dataTransfer.getData('application/x-physioflow-step');
    if (!type) return;
    if (type === 'condition' || type === 'loop') addLogic(type, x, y);
    else if (type === 'note') addNote(x, y);
    else if (type === 'junction') addJunction(x, y);
    else addEventAt(type, x, y);
  };
  const addLogic = (type, x = 480, y = 180) => {
    pushUndo();
    const node = { id: `${type}_${crypto.randomUUID()}`, type, label: type === 'condition' ? 'Condition' : 'Repeat', x, y, ...(type === 'condition' ? { rule: { variable: 'participant_language', operator: 'equals', value: 'zh' } } : { max_iterations: 3, rule: { variable: '', operator: 'equals', value: '' } }) };
    updateFlow({ ...flowRef.current, nodes: [...flowRef.current.nodes, node] });
    setSelectedNodeIds(new Set([node.id]));
  };
  const addNote = (x, y) => {
    pushUndo();
    const nx = x ?? 260;
    const ny = y ?? 140 + flowRef.current.nodes.length * 24;
    const node = { id: `note_${crypto.randomUUID()}`, type: 'note', label: 'Note', content: '', color: '#fff9c4', x: nx, y: ny, width: 180, height: 100 };
    updateFlow({ ...flowRef.current, nodes: [...flowRef.current.nodes, node] });
    setSelectedNodeIds(new Set([node.id]));
  };
  const addJunction = (x = 480, y = 180) => {
    pushUndo();
    const node = { id: `junction_${crypto.randomUUID()}`, type: 'junction', label: '●', x, y };
    updateFlow({ ...flowRef.current, nodes: [...flowRef.current.nodes, node] });
    setSelectedNodeIds(new Set([node.id]));
  };

  // ── Group (visual container, AWS Infrastructure Composer style) ──
  const groupSelected = useCallback(() => {
    if (disabled || selectedNodeIds.size < 2) return;
    pushUndo();
    const members = flowRef.current.nodes.filter(n => selectedNodeIds.has(n.id) && n.type !== 'group' && !['start', 'end'].includes(n.type));
    if (members.length < 2) return;
    const minX = Math.min(...members.map(n => n.x));
    const minY = Math.min(...members.map(n => n.y));
    const maxX = Math.max(...members.map(n => n.x + nodeWidth(n)));
    const maxY = Math.max(...members.map(n => n.y + nodeHeight(n)));
    const pad = 44;
    const groupId = `group_${crypto.randomUUID()}`;
    const group = { id: groupId, type: 'group', label: 'Group', x: minX - pad, y: minY - pad, width: (maxX - minX) + pad * 2, height: (maxY - minY) + pad * 2, color: '#0ea5e9', collapsed: false };
    updateFlow({ ...flowRef.current, nodes: [...flowRef.current.nodes.map(n => members.some(m => m.id === n.id) ? { ...n, group_id: groupId } : n), group] });
    setSelectedNodeIds(new Set());
    setSelectedEdgeId(null);
    setContextMenu(null);
  }, [disabled, selectedNodeIds, updateFlow, pushUndo]);

  const ungroupNode = useCallback(groupId => {
    if (disabled) return;
    pushUndo();
    updateFlow({
      ...flowRef.current,
      nodes: flowRef.current.nodes.filter(n => n.id !== groupId).map(n => n.group_id === groupId ? { ...n, group_id: undefined } : n),
    });
  }, [disabled, updateFlow, pushUndo]);

  const toggleGroupCollapse = useCallback(groupId => {
    if (disabled) return;
    updateFlow({ ...flowRef.current, nodes: flowRef.current.nodes.map(n => n.id === groupId ? { ...n, collapsed: !n.collapsed } : n) });
  }, [disabled, updateFlow]);

  const renameGroup = useCallback(groupId => {
    if (disabled) return;
    const group = flowRef.current.nodes.find(n => n.id === groupId);
    if (!group) return;
    const name = window.prompt('Group name:', group.label);
    if (name) updateFlow({ ...flowRef.current, nodes: flowRef.current.nodes.map(n => n.id === groupId ? { ...n, label: name } : n) });
  }, [disabled, updateFlow]);

  const beginGroupDrag = (e, group) => {
    if (disabled) return;
    e.stopPropagation(); e.preventDefault();
    pushUndo();
    const startX = e.clientX, startY = e.clientY;
    const memberIds = new Set(flowRef.current.nodes.filter(n => n.group_id === group.id).map(n => n.id));
    const startPositions = new Map(flowRef.current.nodes.map(n => [n.id, { x: n.x, y: n.y }]));
    const move = ev => {
      const deltaX = (ev.clientX - startX) / zoom;
      const deltaY = (ev.clientY - startY) / zoom;
      updateFlow({
        ...flowRef.current,
        nodes: flowRef.current.nodes.map(n => {
          const s = startPositions.get(n.id);
          if (s && (n.id === group.id || memberIds.has(n.id))) return { ...n, x: Math.max(20, s.x + deltaX), y: Math.max(20, s.y + deltaY) };
          return n;
        }),
      });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ── Full-screen node preview ──
  const openPreview = useCallback((node) => {
    const step = node.type === 'event' ? trial.steps.find(s => s.step_id === node.step_id) : null;
    if (!step) return;
    const resource = (stimuli || []).find(s => s.stimulus_id === step.stimulus_id);
    const sharedQ = (questionnaires || []).find(q => q.questionnaire_id === step.questionnaire_id);
    const resolvedStep = {
      ...step,
      questionnaire: step.questionnaire || sharedQ,
      source_mode: step.source_url || step.asset_id ? step.source_mode : resource?.source_mode || step.source_mode,
      source_url: step.source_url || resource?.source_url || '',
      asset_id: step.asset_id || resource?.asset_id || '',
      file_name: step.file_name || resource?.file_name || '',
    };
    setPreviewNode({ node, step: resolvedStep, trialLayout: trial.layout });
  }, [trial.steps, trial.layout, stimuli, questionnaires]);

  const closePreview = useCallback(() => setPreviewNode(null), []);

  const openQuestionnaireWorkspace = useCallback((questionnaire, onSave) => {
    setQuestionnaireWorkspace({ data: questionnaire, onSave });
  }, []);

  // Close preview on Escape
  useEffect(() => {
    if (!previewNode) return;
    const handler = e => { if (e.key === 'Escape') closePreview(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [previewNode, closePreview]);

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

  // Direct click on input port (no drag)
  const finishConnection = useCallback(targetId => {
    const current = dragConnRef.current;
    if (!current?.source || current.source === targetId) return;
    const sourceNode = flowRef.current.nodes.find(n => n.id === current.source);
    if (!sourceNode) return;
    pushUndo();
    const withoutSameBranch = flowRef.current.edges.filter(e => !(e.source === current.source && e.branch === current.branch));
    updateFlow({ ...flowRef.current, edges: [...withoutSameBranch, { id: `edge_${crypto.randomUUID()}`, source: current.source, target: targetId, branch: current.branch }] });
  }, [pushUndo, updateFlow]);
  const removeNode = useCallback(id => {
    pushUndo();
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
  }, [flow, updateFlow, onChange, pushUndo]);

  const deleteEdge = useCallback((edgeId) => {
    if (!edgeId) return;
    pushUndo();
    updateFlow({ ...flow, edges: flow.edges.filter(e => e.id !== edgeId) });
    setSelectedEdgeId(null); setContextMenu(null);
  }, [flow, updateFlow, pushUndo]);

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
      // Undo / Redo (visual flow editor)
      if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); performUndo(); return; }
      if (mod && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) { e.preventDefault(); performRedo(); return; }
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
  }, [selectedNodeIds, selectedEdgeId, flow, copyNode, pasteNode, duplicateNode, deleteEdge, removeNode, updateFlow, onChange]); // eslint-disable-line react-hooks/exhaustive-deps

  const autoLayout = useCallback(() => {
    if (!flow.nodes.some(n => n.type === 'start')) return;
    updateFlow({ ...flow, nodes: autoLayoutPositions(flow.nodes, flow.edges) });
  }, [flow, updateFlow]);

  const handleWheel = e => {
    // Allow wheel zoom in fullscreen mode (document-level) and on the canvas
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
  };

  // Wheel zoom: only on the canvas / center area, not in sidebars or scrollable panels
  // In fullscreen mode, zoom works everywhere since the canvas fills the screen
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
  }, []);

  const dragRef = useRef(null);
  const [draggingId, setDraggingId] = useState(null);
  const [guides, setGuides] = useState([]);

  const snapVal = useCallback((v) => snapEnabled ? Math.round(v / GRID_SIZE) * GRID_SIZE : v, [snapEnabled]);

  const beginDrag = useCallback((e, node) => {
    if (disabled || e.target.closest('button,input,select')) return;
    pushUndo(); // capture state before drag
    const rect = canvasRef.current.getBoundingClientRect();
    const dx = (e.clientX - rect.left) / zoomRef.current - node.x - panRef.current.x / zoomRef.current;
    const dy = (e.clientY - rect.top) / zoomRef.current - node.y - panRef.current.y / zoomRef.current;
    const isMultiDrag = selectedIdsRef.current.size > 1 && selectedIdsRef.current.has(node.id);
    if (isMultiDrag) {
      const offsets = {};
      selectedIdsRef.current.forEach(id => { const n = flowRef.current.nodes.find(nd => nd.id === id); if (n) offsets[id] = { dx: n.x - node.x, dy: n.y - node.y }; });
      dragRef.current = { nodeIds: [...selectedIdsRef.current], offsets, dx, dy, startX: node.x, startY: node.y };
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
        const shouldSnap = snapRef.current && !ev.altKey;
        const rawX = (ev.clientX - rect.left) / zoomRef.current - dragRef.current.dx - panRef.current.x / zoomRef.current;
        const rawY = (ev.clientY - rect.top) / zoomRef.current - dragRef.current.dy - panRef.current.y / zoomRef.current;
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
        let newGuides = [];
        if (shouldSnap) {
          const draggedNode = flowRef.current.nodes.find(n => n.id === dragRef.current.nodeId) || flowRef.current.nodes.find(n => n.id === dragRef.current.nodeIds?.[0]);
          if (draggedNode) newGuides = buildAlignmentGuides(nx, ny, flowRef.current.nodes, draggedNode.id);
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
  }, [disabled, pushUndo, updateNode, updateFlow, snapVal]);

  // Drag-to-connect ref to avoid React closure stale state
  const dragConnRef = useRef(null);
  useEffect(() => { dragConnRef.current = dragConnection; }, [dragConnection]);

  const beginConnDrag = useCallback((e, node, branch) => {
    e.stopPropagation(); e.preventDefault();
    const conn = { source: node.id, branch, clientX: e.clientX, clientY: e.clientY };
    setDragConnection(conn);
    dragConnRef.current = conn;
    const move = ev => {
      const next = { ...dragConnRef.current, clientX: ev.clientX, clientY: ev.clientY };
      setDragConnection(next);
      dragConnRef.current = next;
    };
    const up = ev => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const current = dragConnRef.current;
      if (!current) { setDragConnection(null); dragConnRef.current = null; return; }
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      const targetNode = target?.closest('[data-node-id]');
      if (targetNode) {
        const targetId = targetNode.getAttribute('data-node-id');
        if (targetId && targetId !== node.id) {
          const sourceNode = flowRef.current.nodes.find(n => n.id === current.source);
          if (sourceNode) {
            pushUndo();
            const withoutSameBranch = flowRef.current.edges.filter(e => !(e.source === current.source && e.branch === current.branch));
            updateFlow({ ...flowRef.current, edges: [...withoutSameBranch, { id: `edge_${crypto.randomUUID()}`, source: current.source, target: targetId, branch: current.branch }] });
          }
        }
      }
      setDragConnection(null);
      dragConnRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [pushUndo, updateFlow]);

  // Stable node click handler (multi-select with shift)
  const handleNodeClick = useCallback((e, node) => {
    e.stopPropagation();
    if (e.shiftKey) { setSelectedNodeIds(prev => { const next = new Set(prev); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; }); }
    else { setSelectedNodeIds(new Set([node.id])); }
    setSelectedEdgeId(null); setContextMenu(null);
  }, []);

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
          const nw = nodeWidth(n);
          const nh = nodeHeight(n);
          return n.x + nw > minX && n.x < maxX && n.y + nh > minY && n.y < maxY;
        }).map(n => n.id);
        if (inside.length > 0) setSelectedNodeIds(new Set(inside));
        return null;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const edgeContextMenu = useCallback((e, edgeId) => {
    e.preventDefault(); e.stopPropagation();
    setSelectedEdgeId(edgeId); setSelectedNodeIds(new Set());
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'edge', id: edgeId });
  }, []);

  const bounds = useMemo(() => boundsOf(flow.nodes), [flow.nodes]);
  const worldW = bounds.maxX - bounds.minX;
  const worldH = bounds.maxY - bounds.minY;

  const fitView = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height || !flow.nodes.length) return;
    const next = fitViewTransform(bounds, rect);
    setZoom(next.zoom);
    setPan(next.pan);
  };

  const selectedNode = (selectedNodeIds.size === 1) ? flow.nodes.find(n => selectedNodeIds.has(n.id)) : null;
  const selectedEdge = flow.edges.find(e => e.id === selectedEdgeId);

  const filteredNodes = useMemo(() => {
    if (!searchQuery) return flow.nodes;
    const q = searchQuery.toLowerCase();
    return flow.nodes.filter(n => n.label?.toLowerCase().includes(q) || (n.type === 'event' && trial.steps.find(s => s.step_id === n.step_id)?.name?.toLowerCase().includes(q)));
  }, [flow.nodes, searchQuery, trial.steps]);

  // Derived indices so edges / node cards resolve in O(1) and stay referentially stable for memo
  const nodeById = useMemo(() => new Map(flow.nodes.map(n => [n.id, n])), [flow.nodes]);
  const stepsById = useMemo(() => new Map((trial.steps || []).map(s => [s.step_id, s])), [trial.steps]);
  const filteredIds = useMemo(() => searchQuery ? new Set(filteredNodes.map(n => n.id)) : null, [searchQuery, filteredNodes]);

  // Referentially stable node-card callbacks (keep NodeCard memo effective)
  const handleNodeDoubleClick = useCallback((e, node) => { e.stopPropagation(); openPreview(node); }, [openPreview]);
  const handleNodeContextMenu = useCallback((e, node) => { e.stopPropagation(); setSelectedNodeIds(new Set([node.id])); setSelectedEdgeId(null); }, []);
  const handleNodeInputClick = useCallback((e, node) => { e.stopPropagation(); finishConnection(node.id); }, [finishConnection]);
  const handleNodePreview = useCallback((e, node) => { e.stopPropagation(); openPreview(node); }, [openPreview]);
  const handleNodeDuplicate = useCallback((e, node) => { e.stopPropagation(); duplicateNode(node); }, [duplicateNode]);
  const handleNodeDelete = useCallback((e, node) => { e.stopPropagation(); removeNode(node.id); }, [removeNode]);

  return <div className="studio">
    {!paletteCollapsed && <PalettePanel
      search={paletteSearch}
      onSearchChange={setPaletteSearch}
      onCloseSearch={() => setPaletteSearch('')}
      disabled={disabled}
      paletteSize={flow.nodes.length}
      addPreset={addPreset}
      addEvent={addEvent}
      addLogic={addLogic}
      addNote={addNote}
      addJunction={addJunction}
      onPalettePresetDragStart={onPalettePresetDragStart}
      onPaletteDragStart={onPaletteDragStart}
      t={t}
      NodeGlyph={NodeGlyph}
      nodeBadgeStyle={nodeBadgeStyle}
    />}
    <button
      className="panel-toggle palette-toggle"
      onClick={() => { setPaletteCollapsed(v => { const nv = !v; try { localStorage.setItem('physioflow.paletteCollapsed', nv ? '1' : '0'); } catch {} return nv; }); }}
      title={paletteCollapsed ? 'Show palette' : 'Hide palette'}
      aria-label={paletteCollapsed ? 'Show palette' : 'Hide palette'}
    >{paletteCollapsed ? '▸' : '◂'}</button>

    <section className="studio-center">
      <div className="canvas-bar">
        <div className="view-toggle" role="tablist" aria-label="Editor view">
          <button type="button" role="tab" aria-selected={viewMode === 'canvas'} className={viewMode === 'canvas' ? 'active' : ''} onClick={() => setViewMode('canvas')}>Canvas</button>
          <button type="button" role="tab" aria-selected={viewMode === 'code'} className={viewMode === 'code' ? 'active' : ''} onClick={() => setViewMode('code')}>Code</button>
        </div>
        <div><b>{trial.name}</b><span>{flow.nodes.length} nodes · {flow.edges.length} connections</span></div>
        <div className={`connection-hint ${focusMessage ? 'focus-warning' : ''}`}>
          {focusMessage ? <span>{focusMessage} {focusHighlightStepId && <button onClick={() => { setFocusHighlightStepId(null); setFocusMessage(''); }} style={{ fontSize: '.7rem', padding: '.15rem .5rem', marginLeft: '.5rem' }}>知道了</button>}</span> : dragConnection ? <>Connect <strong>{dragConnection.branch}</strong> → <button onClick={() => setDragConnection(null)}>Cancel</button></> : null}
        </div>
        <label className="check-row">
          <input type="checkbox" checked={snapEnabled} onChange={e => { setSnapEnabled(e.target.checked); try { localStorage.setItem('physioflow.snap', e.target.checked ? '1' : '0'); } catch {} }} /> Snap
        </label>
        <button className="icon-btn" onClick={performUndo} title={t('Undo (⌘Z)')}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 4L3 9l6 5" /><path d="M3 9h11a6 6 0 0 1 0 12h-3" /></svg></button>
        <button className="icon-btn" onClick={performRedo} title={t('Redo (⌘⇧Z)')}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 4l6 5-6 5" /><path d="M21 9H10a6 6 0 0 0 0 12h3" /></svg></button>
        <button onClick={autoLayout}>Auto layout</button>
        <button className="icon-btn" onClick={fitView} title={t('Fit view')}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9V4h5" /><path d="M15 4h5v5" /><path d="M20 15v5h-5" /><path d="M9 20H4v-5" /></svg></button>
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
      {viewMode === 'code' && <FlowJsonEditor trial={trial} onChange={onChange} disabled={disabled} />}
      {viewMode === 'canvas' && searchQuery !== '' && (
        <div className="node-search-bar">
          <input autoFocus value={searchQuery} placeholder="Find node by name..." onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setSearchQuery(''); if (e.key === 'Enter' && filteredNodes.length > 0) { const node = filteredNodes[0]; setSelectedNodeIds(new Set([node.id])); setPan({ x: 120 - node.x, y: 160 - node.y }); setZoom(1); } }} />
          <span>{searchQuery ? `${filteredNodes.length} match${filteredNodes.length !== 1 ? 'es' : ''}` : ''}</span>
        </div>
      )}
      {viewMode === 'canvas' && unplacedSteps.length > 0 && !disabled && (
        <div className={`unplaced-step-panel${focusHighlightStepId ? ' focus-active' : ''}`} role="status">
          <b>Steps outside flow · {unplacedSteps.length}</b>
          <span>{focusHighlightStepId ? '已定位到以下步骤，请点击 Insert 放入流程图' : 'These steps exist in the Trial but will not run until placed in the graph.'}</span>
          <div>
            {unplacedSteps.map(step => (
              <article key={step.step_id} className={focusHighlightStepId === step.step_id ? 'focus-highlight' : ''}>
                <i>{step.type}</i>
                <strong>{step.name || step.type}</strong>
                <button onClick={() => { placeExistingStep(step); setFocusHighlightStepId(null); setFocusMessage(''); }}>Insert</button>
                <button className="danger" onClick={() => removeUnplacedStep(step.step_id)}>Remove unused</button>
              </article>
            ))}
          </div>
        </div>
      )}
      {viewMode === 'canvas' && <div className="clean-canvas" ref={canvasRef}
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
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
        onDrop={onCanvasDrop}
        style={{ cursor: panDragRef.current ? 'grabbing' : spaceHeld.current ? 'grab' : '' }}
      >
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
              return <g key={edge.id}
                onContextMenu={e => edgeContextMenu(e, edge.id)}
                style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                onClick={e => { e.stopPropagation(); setSelectedEdgeId(edge.id); setSelectedNodeIds(new Set()); setContextMenu(null); }}
              >
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
          // Convert canvas-space to viewport-space using zoom + pan + canvas offset
          const sx = (srcNode.x + nodeW) * zoom + pan.x + cr.left;
          const sy = (srcNode.y + portY) * zoom + pan.y + cr.top;
          // Target is already in viewport-space (clientX/clientY)
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
              <div key={group.id} className={`clean-group${group.collapsed ? ' collapsed' : ''}`}
                style={{ left: group.x, top: group.y, width: group.width, height: group.height, borderColor: group.color }}>
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
              key={node.id}
              node={node}
              step={stepsById.get(node.step_id) || null}
              isSelected={selectedNodeIds.has(node.id)}
              isDimmed={searchQuery && !filteredIds.has(node.id)}
              isDragging={draggingId === node.id}
              isDisabled={node.enabled === false}
              disabled={disabled}
              stimuli={stimuli}
              questionnaires={questionnaires}
              isAwaitingConnection={Boolean(dragConnection)}
              activeBranch={dragConnection?.source === node.id ? dragConnection.branch : null}
              onPointerDown={beginDrag}
              onClick={handleNodeClick}
              onDoubleClick={handleNodeDoubleClick}
              onContextMenu={handleNodeContextMenu}
              onPortPointerDown={beginConnDrag}
              onInputClick={handleNodeInputClick}
              onPreview={handleNodePreview}
              onDuplicate={handleNodeDuplicate}
              onDelete={handleNodeDelete}
            />;
          })}
        </div>

        {flow.nodes.filter(n => n.type === 'event').length === 0 && (
          <div className="canvas-empty-guide">
            <div className="canvas-empty-arrow">⇐</div>
            <b>Start building your flow</b>
            <p>Drag a step or preset from the palette to place your first node.</p>
          </div>
        )}

        <Minimap nodes={flow.nodes} bounds={bounds} worldW={worldW} worldH={worldH} pan={pan} zoom={zoom} setPan={setPan} canvasRef={canvasRef} />

        <div className="zoom-controls">
          <button onClick={() => setZoom(z => Math.min(2, z + 0.15))} title="Zoom in">+</button>
          <button onClick={() => setZoom(z => Math.max(0.3, z - 0.15))} title="Zoom out">−</button>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} title="Reset zoom" style={{ fontSize: '.65rem' }}>1:1</button>
          <span style={{ fontSize: '.65rem', padding: '.35rem .5rem', color: '#7b867f' }}>{Math.round(zoom * 100)}%</span>
        </div>
      </div>}

      <CanvasContextMenu
        contextMenu={contextMenu}
        setContextMenu={setContextMenu}
        setSelectedNodeIds={setSelectedNodeIds}
        deleteEdge={deleteEdge}
        addEvent={addEvent}
        addLogic={addLogic}
        addNote={addNote}
        addJunction={addJunction}
        pasteNode={pasteNode}
        clipboardNode={clipboardNode}
        selectedNodeIds={selectedNodeIds}
        t={t}
        groupSelected={groupSelected}
        flow={flow}
        autoLayout={autoLayout}
      />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </section>

    {!inspectorCollapsed && <Inspector
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
      onPreview={selectedNode?.type === 'event' && trial.steps.find(s => s.step_id === selectedNode.step_id) ? () => openPreview(selectedNode) : null}
      onOpenQuestionnaireWorkspace={openQuestionnaireWorkspace}
    />}
    <button
      className="panel-toggle inspector-toggle"
      onClick={() => { setInspectorCollapsed(v => { const nv = !v; try { localStorage.setItem('physioflow.inspectorCollapsed', nv ? '1' : '0'); } catch {} return nv; }); }}
      title={inspectorCollapsed ? 'Show inspector' : 'Hide inspector'}
      aria-label={inspectorCollapsed ? 'Show inspector' : 'Hide inspector'}
    >{inspectorCollapsed ? '◂' : '▸'}</button>

    {/* ── Full-screen step preview modal ── */}
    {previewNode && <NodePreviewModal step={previewNode.step} trialLayout={previewNode.trialLayout} onClose={closePreview}
      onUpdate={values => previewNode.node.step_id && updateStep(previewNode.node.step_id, values)}
      onOpenQuestionnaireWorkspace={openQuestionnaireWorkspace} />}

    {/* ── Full-screen questionnaire workspace ── */}
    {questionnaireWorkspace && (
      <QuestionnaireWorkspace
        value={questionnaireWorkspace.data}
        onChange={(q) => setQuestionnaireWorkspace(prev => prev ? { ...prev, data: q } : null)}
        onClose={() => {
          if (questionnaireWorkspace.onSave && questionnaireWorkspace.data) {
            questionnaireWorkspace.onSave(questionnaireWorkspace.data);
          }
          setQuestionnaireWorkspace(null);
        }}
        disabled={disabled}
      />
    )}
  </div>;
}
