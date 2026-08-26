// Node & group creation operations for FlowCanvas: adding steps/logic/notes,
// palette drag-and-drop, composite presets and visual group management.
import { GRID_SIZE } from './layout.js';
import { FLOW_PRESETS } from '../constants.js';

export function useCanvasNodes({ disabled, pushUndo, updateFlow, onChange, trialRef, flowRef, setSelectedNodeIds, setSelectedEdgeId, setContextMenu, pan, zoom, snapEnabled, canvasRef, createStep, nodeWidth, nodeHeight, flow, selectedNodeIds }) {
  const addEventAt = (type, x, y) => {
    if (disabled) return;
    pushUndo();
    const item = createStep(type, { name: type[0].toUpperCase() + type.slice(1).replace('_', ' ') });
    const node = { id: `node_${item.step_id}`, type: 'event', step_id: item.step_id, label: item.name, x, y };
    onChange({ ...trialRef.current, steps: [...trialRef.current.steps, item], flow: { ...flowRef.current, nodes: [...flowRef.current.nodes, node] } });
    setSelectedNodeIds(new Set([node.id]));
  };
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
  const groupSelected = () => {
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
  };

  const ungroupNode = groupId => {
    if (disabled) return;
    pushUndo();
    updateFlow({
      ...flowRef.current,
      nodes: flowRef.current.nodes.filter(n => n.id !== groupId).map(n => n.group_id === groupId ? { ...n, group_id: undefined } : n),
    });
  };

  const toggleGroupCollapse = groupId => {
    if (disabled) return;
    updateFlow({ ...flowRef.current, nodes: flowRef.current.nodes.map(n => n.id === groupId ? { ...n, collapsed: !n.collapsed } : n) });
  };

  const renameGroup = groupId => {
    if (disabled) return;
    const group = flowRef.current.nodes.find(n => n.id === groupId);
    if (!group) return;
    const name = window.prompt('Group name:', group.label);
    if (name) updateFlow({ ...flowRef.current, nodes: flowRef.current.nodes.map(n => n.id === groupId ? { ...n, label: name } : n) });
  };

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

  return { addEvent, addPreset, onPaletteDragStart, onPalettePresetDragStart, onCanvasDrop, groupSelected, ungroupNode, toggleGroupCollapse, renameGroup, beginGroupDrag };
}
