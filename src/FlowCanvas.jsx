import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { step as createStep, stepContentIssues } from './domain';
import { normalizeFlow, validateFlow } from './flowEngine';
import { Inspector } from './Inspector';
import { CONTROL_NODE_GUIDE, PALETTE, STEP_GUIDE } from './constants.js';

const nodeIcons = { start: 'START', end: 'END', condition: 'IF', loop: 'LOOP', event: 'STEP' };
const branchesFor = node => node.type === 'condition' ? ['true', 'false'] : node.type === 'loop' ? ['body', 'exit'] : ['next'];

let clipboardNode = null;

export default function FlowCanvas({ trial, onChange, disabled, stimuli = [], questionnaires = [], focusTarget }) {
  const flow = useMemo(() => normalizeFlow(trial), [trial]);
  const trialRef = useRef(trial);
  const flowRef = useRef(flow);
  useEffect(() => { trialRef.current = trial; flowRef.current = flow; }, [trial, flow]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [connection, setConnection] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [contextMenu, setContextMenu] = useState(null);
  const [focusMessage, setFocusMessage] = useState('');
  const handledFocus = useRef(null);
  const canvasRef = useRef(null);
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
      setSelectedNodeId(targetNode.id);
      setZoom(1);
      setPan({ x: 120 - targetNode.x, y: 160 - targetNode.y });
      setFocusMessage('');
    } else if (targetStepId) {
      const targetStep = trial.steps.find(step => step.step_id === targetStepId);
      setSelectedNodeId(null);
      setFocusMessage(`${targetStep?.name || targetStep?.type || 'This step'} is not placed in the flow. Use the "Steps outside flow" panel to insert or remove it.`);
    } else {
      setSelectedNodeId(null);
      setFocusMessage('Open this Trial and review its flow connections.');
    }
  }, [focusTarget, flow.nodes, trial.steps, trial.trial_id]);

  const updateFlow = useCallback(next => onChange({ ...trialRef.current, flow: next }), [onChange]);
  const updateNode = (id, values) => updateFlow({ ...flowRef.current, nodes: flowRef.current.nodes.map(n => n.id === id ? { ...n, ...values } : n) });
  const updateStep = (stepId, values) => onChange({ ...trialRef.current, steps: trialRef.current.steps.map(s => s.step_id === stepId ? { ...s, ...values } : s), flow: flowRef.current });
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
    setSelectedNodeId(node.id);
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
    setSelectedNodeId(node.id);
  };
  const addLogic = type => {
    const node = { id: `${type}_${crypto.randomUUID()}`, type, label: type === 'condition' ? 'Condition' : 'Repeat', x: 480, y: 180, ...(type === 'condition' ? { rule: { variable: 'participant_language', operator: 'equals', value: 'zh' } } : { max_iterations: 3, rule: { variable: '', operator: 'equals', value: '' } }) };
    updateFlow({ ...flow, nodes: [...flow.nodes, node] });
    setSelectedNodeId(node.id);
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
      newNode = { ...original, id: `node_${newStepId}`, step_id: newStepId, label: newStep.name, x: original.x + 40, y: original.y + 40 };
      onChange({ ...trial, steps: [...trial.steps, newStep], flow: { ...flow, nodes: [...flow.nodes, newNode] } });
    } else {
      newNode = { ...original, id: `${original.type}_${crypto.randomUUID()}`, x: original.x + 40, y: original.y + 40 };
      updateFlow({ ...flow, nodes: [...flow.nodes, newNode] });
    }
    setSelectedNodeId(newNode.id);
  }, [trial, flow, onChange, updateFlow]);

  const finishConnection = target => {
    if (!connection || connection.source === target) { setConnection(null); return; }
    if (connection.source === target) return;
    const sourceNode = flow.nodes.find(n => n.id === connection.source);
    if (!sourceNode) return;
    const withoutSameBranch = flow.edges.filter(e => !(e.source === connection.source && e.branch === connection.branch));
    updateFlow({ ...flow, edges: [...withoutSameBranch, { id: `edge_${crypto.randomUUID()}`, source: connection.source, target, branch: connection.branch }] });
    setConnection(null);
  };
  const removeNode = useCallback(id => {
    if (!flow.nodes.find(n => n.id === id)) return;
    updateFlow({ nodes: flow.nodes.filter(n => n.id !== id), edges: flow.edges.filter(e => e.source !== id && e.target !== id) });
    setSelectedNodeId(null); setContextMenu(null);
  }, [flow, updateFlow]);

  const deleteEdge = useCallback((edgeId) => {
    if (!edgeId) return;
    updateFlow({ ...flow, edges: flow.edges.filter(e => e.id !== edgeId) });
    setSelectedEdgeId(null); setContextMenu(null);
  }, [flow, updateFlow]);

  useEffect(() => {
    const handler = e => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'c') { e.preventDefault(); const n = flow.nodes.find(nd => nd.id === selectedNodeId); if (n) copyNode(n); }
      if (mod && e.key === 'v') { e.preventDefault(); pasteNode(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !document.activeElement?.closest('.studio-inspector')) {
        if (selectedEdgeId) { e.preventDefault(); deleteEdge(selectedEdgeId); }
        else if (selectedNodeId) { const n = flow.nodes.find(nd => nd.id === selectedNodeId); if (n && !['start', 'end'].includes(n.type)) { e.preventDefault(); removeNode(selectedNodeId); } }
      }
      if (e.key === 'Escape') { setContextMenu(null); setConnection(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedNodeId, selectedEdgeId, flow, copyNode, pasteNode, deleteEdge, removeNode]);

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

  const handleWheel = e => { e.preventDefault(); setZoom(z => Math.min(2, Math.max(0.3, z + (e.deltaY > 0 ? -0.08 : 0.08)))); };

  const dragRef = useRef(null);
  const [draggingId, setDraggingId] = useState(null);

  const beginDrag = (e, node) => {
    if (disabled || e.target.closest('button,input,select')) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const dx = (e.clientX - rect.left) / zoom - node.x - pan.x / zoom;
    const dy = (e.clientY - rect.top) / zoom - node.y - pan.y / zoom;
    dragRef.current = { nodeId: node.id, dx, dy, startX: node.x, startY: node.y };
    setDraggingId(node.id);
    let raf = null;
    const move = ev => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        if (!dragRef.current) return;
        const nx = Math.max(20, (ev.clientX - rect.left) / zoom - dx - pan.x / zoom);
        const ny = Math.max(20, (ev.clientY - rect.top) / zoom - dy - pan.y / zoom);
        dragRef.current = { ...dragRef.current };
        updateNode(node.id, { x: nx, y: ny });
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      dragRef.current = null;
      setDraggingId(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const edgeContextMenu = (e, edgeId) => {
    e.preventDefault(); e.stopPropagation();
    setSelectedEdgeId(edgeId); setSelectedNodeId(null);
    setContextMenu({ x: e.clientX, y: e.clientY, type: 'edge', id: edgeId });
  };

  const bounds = useMemo(() => {
    if (!flow.nodes.length) return { minX: 0, minY: 0, maxX: 400, maxY: 300 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    flow.nodes.forEach(n => { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x + 200); maxY = Math.max(maxY, n.y + 80); });
    return { minX: minX - 40, minY: minY - 40, maxX: maxX + 40, maxY: maxY + 40 };
  }, [flow.nodes]);
  const worldW = bounds.maxX - bounds.minX;
  const worldH = bounds.maxY - bounds.minY;

  const selectedNode = flow.nodes.find(n => n.id === selectedNodeId);
  const selectedEdge = flow.edges.find(e => e.id === selectedEdgeId);

  return <div className="studio">
    <aside className="studio-palette">
      <div className="studio-brand"><span>＋</span><div><b>Add to flow</b><small>Drag nodes to arrange</small></div></div>
      <p className="palette-tip">Use event nodes for participant-facing steps. Use flow control nodes only when the path must branch or repeat.</p>
      {PALETTE.map(group => <section key={group.title}><h4>{group.title}</h4>{group.items.map(([type, icon, label]) => <button key={type} disabled={disabled} onClick={() => addEvent(type)} title={STEP_GUIDE[type]?.setup || `Add ${label}`}><i>{icon}</i><span>{label}</span><small>{STEP_GUIDE[type]?.summary}</small></button>)}</section>)}
      <section><h4>Flow control</h4><button disabled={disabled} onClick={() => addLogic('condition')} title={CONTROL_NODE_GUIDE.condition.setup}><i>◇</i><span>Condition</span><small>{CONTROL_NODE_GUIDE.condition.summary}</small></button><button disabled={disabled} onClick={() => addLogic('loop')} title={CONTROL_NODE_GUIDE.loop.setup}><i>↻</i><span>Loop</span><small>{CONTROL_NODE_GUIDE.loop.summary}</small></button></section>
    </aside>

    <section className="studio-center">
      <div className="canvas-bar">
        <div><b>{trial.name}</b><span>{flow.nodes.length} nodes · {flow.edges.length} connections</span></div>
        <div className={`connection-hint ${focusMessage ? 'focus-warning' : ''}`}>{focusMessage ? <span>{focusMessage}</span> : connection ? <>Select target for <strong>{connection.branch}</strong> <button onClick={() => setConnection(null)}>Cancel</button></> : <span>Select an output port, then choose the target node.</span>}</div>
        <button onClick={autoLayout}>Auto layout</button>
        <span className={check.valid ? 'flow-status valid' : 'flow-status invalid'} title={check.errors.concat(check.warnings).slice(0, 5).join('\n')}>{check.valid ? '✓ Ready' : `! ${check.errors.length} issues`}</span>
      </div>
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
        onClick={e => { if (e.target === canvasRef.current || e.target.classList.contains('flow-bg')) { setSelectedNodeId(null); setSelectedEdgeId(null); setContextMenu(null); } }}
        onContextMenu={e => { if (e.target === canvasRef.current || e.target.classList.contains('flow-bg')) { e.preventDefault(); setContextMenu(null); } }}
      >
        <svg className="flow-bg" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
          <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {flow.edges.map(edge => {
              const a = flow.nodes.find(n => n.id === edge.source), b = flow.nodes.find(n => n.id === edge.target);
              if (!a || !b) return null;
              const x1 = a.x + 184, y1 = a.y + 55, x2 = b.x, y2 = b.y + 55, m = x1 + (x2 - x1) / 2;
              const sel = selectedEdgeId === edge.id;
              return <g key={edge.id}
                onContextMenu={e => edgeContextMenu(e, edge.id)}
                style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                onClick={e => { e.stopPropagation(); setSelectedEdgeId(edge.id); setSelectedNodeId(null); setContextMenu(null); }}
              >
                <path d={`M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}`} className="edge-hit" />
                <path d={`M${x1},${y1} C${m},${y1} ${m},${y2} ${x2},${y2}`} stroke={sel ? 'var(--green)' : '#8f9d95'} strokeWidth={sel ? 2.5 : 1.5} fill="none" markerEnd="url(#arrow)" />
                <rect x={m - 25} y={(y1 + y2) / 2 - 13} width="50" height="20" rx="10" fill={sel ? 'var(--green)' : '#e8ebe6'} />
                <text x={m} y={(y1 + y2) / 2 + 1} fill={sel ? 'white' : 'var(--ink)'} textAnchor="middle" fontSize="11" fontWeight={sel ? 700 : 400}>{edge.branch}</text>
                {sel && <g transform={`translate(${m + 28},${(y1 + y2) / 2 - 10})`} onClick={e => { e.stopPropagation(); deleteEdge(edge.id); }}>
                  <circle r="10" fill="#a32e25" /><text y="1" fill="white" textAnchor="middle" fontSize="12" fontWeight="700">×</text>
                </g>}
              </g>;
            })}
          </g>
        </svg>
        <div style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', position: 'relative', width: worldW + 200, height: worldH + 200, pointerEvents: 'none' }}>
          {flow.nodes.map(node => {
            const step = node.type === 'event' ? trial.steps.find(s => s.step_id === node.step_id) : null;
            const nodeIssues = (step && !disabled) ? stepContentIssues(step, stimuli, questionnaires) : [];
            const nodeHasError = nodeIssues.some(i => i.kind === 'error');
            const nodeHasWarn = !nodeHasError && nodeIssues.some(i => i.kind === 'warn');
            return (
            <div className={`clean-node ${node.type} ${selectedNodeId === node.id ? 'selected' : ''} ${draggingId === node.id ? 'dragging' : ''}`}
              style={{ left: node.x, top: node.y, pointerEvents: 'auto' }} key={node.id}
              onPointerDown={e => beginDrag(e, node)}
              onClick={e => { e.stopPropagation(); setSelectedNodeId(node.id); setSelectedEdgeId(null); setContextMenu(null); }}
              onContextMenu={e => { e.stopPropagation(); setSelectedNodeId(node.id); setSelectedEdgeId(null); }}
            >
              <button className={`node-input ${connection ? 'awaiting' : ''}`} title="Connect a wire to here" onClick={e => { e.stopPropagation(); finishConnection(node.id); }} />
              <div className="node-title"><i>{nodeIcons[node.type]}</i><div><small>{node.type}</small><b>{node.label}</b></div></div>
              {node.type === 'event' && <span className="event-kind">{step?.type}
                {nodeHasError && <span className="node-issue-dot error" title={nodeIssues.filter(i => i.kind === 'error').map(i => i.message).join('; ')}>!</span>}
                {nodeHasWarn && <span className="node-issue-dot warn" title={nodeIssues.map(i => i.message).join('; ')}>△</span>}
              </span>}
              <div className="node-outputs">
                {branchesFor(node).map(branch => <button className={connection?.source === node.id && connection.branch === branch ? 'active' : ''} key={branch} onClick={e => { e.stopPropagation(); setConnection({ source: node.id, branch }); }}>{branch}<i /></button>)}
              </div>
            </div>
          )})}
        </div>

        {flow.nodes.length > 0 && (
          <div className="flow-minimap" onClick={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            const cr = canvasRef.current.getBoundingClientRect();
            if (!cr.width || !rect.width) return;
            setPan({ x: -((e.clientX - rect.left) / rect.width * worldW - cr.width / 2), y: -((e.clientY - rect.top) / rect.height * worldH - cr.height / 2) });
          }}>
            <svg viewBox={`${bounds.minX} ${bounds.minY} ${worldW} ${worldH}`}>
              <rect x={bounds.minX} y={bounds.minY} width={worldW} height={worldH} fill="#1a2e2420" rx="4" />
              {flow.nodes.map(n => <rect key={n.id} x={n.x} y={n.y} width="180" height="50" rx="6" fill={n.type === 'event' ? '#5ee0a660' : n.type === 'condition' ? '#f4d77e60' : n.type === 'loop' ? '#89c4f460' : '#bec8c160'} />)}
              <rect className="viewport" x={-(pan.x / zoom) + bounds.minX} y={-(pan.y / zoom) + bounds.minY} width={(canvasRef.current?.clientWidth || 800) / zoom} height={(canvasRef.current?.clientHeight || 600) / zoom} />
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
    </section>

    <Inspector
      node={selectedNode} edge={selectedEdge} trial={trial} stimuli={stimuli}
      questionnaires={questionnaires} disabled={disabled}
      updateNode={values => selectedNode && updateNode(selectedNode.id, values)}
      updateStep={values => selectedNode && selectedNode.step_id && updateStep(selectedNode.step_id, values)}
      removeNode={() => selectedNode && removeNode(selectedNode.id)}
      deleteEdgeFromInspector={() => selectedEdge && deleteEdge(selectedEdge.id)}
      onCopyNode={() => selectedNode && copyNode(selectedNode)}
      onPasteNode={pasteNode}
      hasClipboard={!!clipboardNode}
    />
  </div>;
}
