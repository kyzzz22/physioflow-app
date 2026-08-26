import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { step as createStep } from './domain';
import { normalizeFlow, validateFlow } from './flowEngine';
import { Inspector } from './Inspector';

import QuestionnaireWorkspace from './QuestionnaireWorkspace';
import FlowJsonEditor from './FlowJsonEditor.jsx';
import { NodeGlyph, nodeBadgeStyle, tint } from './flowIcons.jsx';
import { useT } from './i18n.jsx';
import { nodeHeight, nodeWidth } from './flowCanvas/layout.js';
import NodeCard from './flowCanvas/NodeCard.jsx';
import { NodePreviewModal } from './flowCanvas/NodePreviewModal.jsx';
import PalettePanel from './flowCanvas/PalettePanel.jsx';
import Minimap from './flowCanvas/Minimap.jsx';
import CanvasContextMenu from './flowCanvas/CanvasContextMenu.jsx';
import ShortcutsModal from './flowCanvas/ShortcutsModal.jsx';
import { useFlowSnapshots } from './flowCanvas/snapshots.js';
import {
  autoLayoutPositions, boundsOf,
  fitViewTransform,
} from './flowCanvas/interactions.js';
import { useNodeDrag } from './flowCanvas/useNodeDrag.js';
import { useWheelZoom } from './flowCanvas/useWheelZoom.js';
import { useCanvasPan } from './flowCanvas/useCanvasPan.js';
import { useCanvasShortcuts } from './flowCanvas/useCanvasShortcuts.js';
import CanvasLayers from './flowCanvas/CanvasLayers.jsx';
import CanvasToolbar from './flowCanvas/CanvasToolbar.jsx';
import CanvasOverlays from './flowCanvas/CanvasOverlays.jsx';
import { useCanvasNodes } from './flowCanvas/useCanvasNodes.js';

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

  const { addEvent, addPreset, onPaletteDragStart, onPalettePresetDragStart, onCanvasDrop, groupSelected, ungroupNode, toggleGroupCollapse, renameGroup, beginGroupDrag } = useCanvasNodes({
    disabled, pushUndo, updateFlow, onChange, trialRef, flowRef,
    setSelectedNodeIds, setSelectedEdgeId, setContextMenu,
    pan, zoom, snapEnabled, canvasRef, createStep, nodeWidth, nodeHeight, flow, selectedNodeIds,
  });

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

  useCanvasShortcuts({
    selectedNodeIds, selectedEdgeId, flow, copyNode, pasteNode, duplicateNode, deleteEdge,
    onChange, updateFlow, trialRef, flowRef, performUndo, performRedo, spaceHeld,
    setContextMenu, setDragConnection, setSearchQuery, setSelectedNodeIds, setSelectedEdgeId, setShortcutsOpen,
  });

  const autoLayout = useCallback(() => {
    if (!flow.nodes.some(n => n.type === 'start')) return;
    updateFlow({ ...flow, nodes: autoLayoutPositions(flow.nodes, flow.edges) });
  }, [flow, updateFlow]);

  useWheelZoom({ setZoom, setPan, canvasRef });

  const { draggingId, guides, beginDrag, beginConnDrag, snapVal, dragConnRef } = useNodeDrag({
    disabled, pushUndo, updateNode, updateFlow, snapEnabled,
    zoomRef, panRef, selectedIdsRef, flowRef, canvasRef,
    setSelectedNodeIds, setDragConnection, setPan,
  });

  // Stable node click handler (multi-select with shift)
  const handleNodeClick = useCallback((e, node) => {
    e.stopPropagation();
    if (e.shiftKey) { setSelectedNodeIds(prev => { const next = new Set(prev); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; }); }
    else { setSelectedNodeIds(new Set([node.id])); }
    setSelectedEdgeId(null); setContextMenu(null);
  }, []);

  const { beginPan, beginMarquee, panDragRef } = useCanvasPan({
    disabled, zoom, pan, setPan, setMarquee, setSelectedNodeIds, flowRef, canvasRef, spaceHeld,
  });

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
      <CanvasToolbar
        viewMode={viewMode} setViewMode={setViewMode}
        trial={trial} flow={flow}
        focusMessage={focusMessage} focusHighlightStepId={focusHighlightStepId}
        setFocusHighlightStepId={setFocusHighlightStepId} setFocusMessage={setFocusMessage}
        dragConnection={dragConnection} setDragConnection={setDragConnection}
        snapEnabled={snapEnabled} setSnapEnabled={setSnapEnabled}
        performUndo={performUndo} performRedo={performRedo}
        autoLayout={autoLayout} fitView={fitView}
        snapshots={snapshots} snapshotsOpen={snapshotsOpen} setSnapshotsOpen={setSnapshotsOpen}
        saveSnapshot={saveSnapshot} restoreSnapshot={restoreSnapshot}
        renameSnapshot={renameSnapshot} deleteSnapshot={deleteSnapshot}
        check={check} t={t}
      />
      {viewMode === 'code' && <FlowJsonEditor trial={trial} onChange={onChange} disabled={disabled} />}
      <CanvasOverlays
        searchQuery={searchQuery} setSearchQuery={setSearchQuery}
        filteredNodes={filteredNodes} setSelectedNodeIds={setSelectedNodeIds}
        setPan={setPan} setZoom={setZoom}
        unplacedSteps={unplacedSteps} disabled={disabled}
        focusHighlightStepId={focusHighlightStepId}
        placeExistingStep={placeExistingStep}
        setFocusHighlightStepId={setFocusHighlightStepId} setFocusMessage={setFocusMessage}
        removeUnplacedStep={removeUnplacedStep}
        viewMode={viewMode}
      />
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
        <CanvasLayers
          flow={flow}
          nodeById={nodeById}
          stepsById={stepsById}
          selectedNodeIds={selectedNodeIds}
          searchQuery={searchQuery}
          filteredIds={filteredIds}
          draggingId={draggingId}
          disabled={disabled}
          stimuli={stimuli}
          questionnaires={questionnaires}
          dragConnection={dragConnection}
          marquee={marquee}
          pan={pan}
          zoom={zoom}
          guides={guides}
          worldW={worldW}
          worldH={worldH}
          canvasRef={canvasRef}
          NodeCard={NodeCard}
          tint={tint}
          beginDrag={beginDrag}
          handleNodeClick={handleNodeClick}
          handleNodeDoubleClick={handleNodeDoubleClick}
          handleNodeContextMenu={handleNodeContextMenu}
          beginConnDrag={beginConnDrag}
          handleNodeInputClick={handleNodeInputClick}
          handleNodePreview={handleNodePreview}
          handleNodeDuplicate={handleNodeDuplicate}
          handleNodeDelete={handleNodeDelete}
          beginGroupDrag={beginGroupDrag}
          toggleGroupCollapse={toggleGroupCollapse}
          ungroupNode={ungroupNode}
          renameGroup={renameGroup}
          edgeContextMenu={edgeContextMenu}
          setSelectedEdgeId={setSelectedEdgeId}
          setSelectedNodeIds={setSelectedNodeIds}
          setContextMenu={setContextMenu}
          deleteEdge={deleteEdge}
          t={t}
        />

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
