import { createEdge, createNode } from './protocolGraph.js';

function cloneProtocol(protocol) {
  return structuredClone(protocol);
}

/**
 * Copy a protocol for a node-level edit, sharing everything the edit does not touch.
 *
 * A full structuredClone costs ~6 ms on a 500-node protocol, which dominated
 * drag-move frames and label edits (both re-run per keystroke or per frame).
 * Immutability only requires that the previous snapshot is never mutated — not
 * that every subtree be copied — so this copies the path to `graph.nodes` and
 * shares edges, groups, variables, assets and every node the edit does not
 * replace.
 *
 * Only safe for commands that REPLACE entries (`nodes[i] = {...}`) rather than
 * mutate them in place. Commands that push into a shared array (duplicateNode
 * mutates a group's nodeIds) must keep using cloneProtocol.
 */
function cloneProtocolForNodeEdit(protocol) {
  const next = { ...protocol };
  next.graph = { ...protocol.graph, nodes: [...protocol.graph.nodes] };
  return next;
}

function touch(protocol, now = new Date().toISOString()) {
  protocol.audit = { ...(protocol.audit || {}), updatedAt: now };
  return protocol;
}

export function addNode(protocol, componentType, options = {}) {
  const next = cloneProtocol(protocol);
  const node = createNode(componentType, options);
  if (next.graph.nodes.some(existing => existing.id === node.id)) throw new Error(`Node ${node.id} already exists`);
  next.graph.nodes.push(node);
  return { protocol: touch(next, options.now), node };
}

export function updateNode(protocol, nodeId, changes, options = {}) {
  // Replaces one node, so sharing the untouched subtrees is safe.
  const next = cloneProtocolForNodeEdit(protocol);
  const index = next.graph.nodes.findIndex(node => node.id === nodeId);
  if (index < 0) throw new Error(`Node ${nodeId} does not exist`);
  const original = next.graph.nodes[index];
  const patch = typeof changes === 'function' ? changes(structuredClone(original)) : changes;
  if (patch?.id && patch.id !== nodeId) throw new Error('Graph commands cannot change a node ID');
  // The patch is still cloned: callers may keep mutating the object they passed
  // in, and that must not reach into the stored protocol.
  next.graph.nodes[index] = { ...original, ...structuredClone(patch || {}), id: nodeId };
  return touch(next, options.now);
}

export function removeNode(protocol, nodeId, options = {}) {
  const node = protocol.graph.nodes.find(item => item.id === nodeId);
  if (!node) return protocol;
  if (node.component?.type === 'core.start') throw new Error('Start node cannot be removed');
  const next = cloneProtocol(protocol);
  next.graph.nodes = next.graph.nodes.filter(item => item.id !== nodeId);
  next.graph.edges = next.graph.edges.filter(edge => edge.source.nodeId !== nodeId && edge.target.nodeId !== nodeId);
  next.graph.groups = (next.graph.groups || []).map(group => ({
    ...group,
    nodeIds: group.nodeIds.filter(id => id !== nodeId),
    entryNodeId: group.entryNodeId === nodeId ? null : group.entryNodeId,
    exitNodeIds: (group.exitNodeIds || []).filter(id => id !== nodeId),
    parameters: (group.parameters || []).map(parameter => ({
      ...parameter,
      target: parameter.target?.nodeId === nodeId ? null : parameter.target,
      source: parameter.source?.nodeId === nodeId ? null : parameter.source,
    })),
  }));
  return touch(next, options.now);
}

export function connect(protocol, kind, source, target, options = {}) {
  const next = cloneProtocol(protocol);
  if (!next.graph.nodes.some(node => node.id === source.nodeId)) throw new Error(`Source node ${source.nodeId} does not exist`);
  if (!next.graph.nodes.some(node => node.id === target.nodeId)) throw new Error(`Target node ${target.nodeId} does not exist`);
  const duplicate = next.graph.edges.some(edge => edge.kind === kind && edge.source.nodeId === source.nodeId && edge.source.portId === source.portId && edge.target.nodeId === target.nodeId && edge.target.portId === target.portId);
  if (duplicate) throw new Error('The same connection already exists');
  const edge = createEdge(kind, source, target, options);
  if (next.graph.edges.some(existing => existing.id === edge.id)) throw new Error(`Edge ${edge.id} already exists`);
  next.graph.edges.push(edge);
  return { protocol: touch(next, options.now), edge };
}

export function disconnect(protocol, edgeId, options = {}) {
  if (!protocol.graph.edges.some(edge => edge.id === edgeId)) return protocol;
  const next = cloneProtocol(protocol);
  next.graph.edges = next.graph.edges.filter(edge => edge.id !== edgeId);
  return touch(next, options.now);
}

export function replaceConnection(protocol, target, source, options = {}) {
  const next = cloneProtocol(protocol);
  next.graph.edges = next.graph.edges.filter(edge => !(edge.target.nodeId === target.nodeId && edge.target.portId === target.portId));
  return connect(next, options.kind || 'control', source, target, options).protocol;
}

export function moveNodes(protocol, positions, options = {}) {
  // Replaces node entries, so sharing the untouched subtrees is safe.
  const next = cloneProtocolForNodeEdit(protocol);
  const positionMap = positions instanceof Map ? positions : new Map(Object.entries(positions || {}));
  next.graph.nodes = next.graph.nodes.map(node => {
    const position = positionMap.get(node.id);
    return position ? { ...node, layout: { ...node.layout, x: Number(position.x), y: Number(position.y) } } : node;
  });
  return touch(next, options.now);
}

export function insertNodeOnControlEdge(protocol, edgeId, componentType, options = {}) {
  const existing = protocol.graph.edges.find(edge => edge.id === edgeId);
  if (!existing || existing.kind !== 'control') throw new Error(`Control edge ${edgeId} does not exist`);
  const added = addNode(protocol, componentType, options);
  let next = disconnect(added.protocol, edgeId, options);
  next = connect(next, 'control', existing.source, { nodeId: added.node.id, portId: options.inputPortId || 'in' }, options).protocol;
  next = connect(next, 'control', { nodeId: added.node.id, portId: options.outputPortId || 'next' }, existing.target, options).protocol;
  return { protocol: next, node: added.node };
}

export function duplicateNode(protocol, nodeId, options = {}) {
  const source = protocol.graph.nodes.find(node => node.id === nodeId);
  if (!source) throw new Error(`Node ${nodeId} does not exist`);
  if (source.component?.type === 'core.start' || source.component?.type === 'core.end') throw new Error('Start and End nodes cannot be duplicated');
  const idFactory = options.idFactory;
  const added = addNode(protocol, source.component.type, {
    id: options.id,
    idFactory,
    componentVersion: source.component.version,
    label: options.label || `${source.label} copy`,
    config: source.config,
    bindings: source.bindings,
    metadata: source.metadata,
    layout: options.layout || { ...source.layout, x: source.layout.x + 220, y: source.layout.y + 28 },
    now: options.now,
  });
  const sourceGroup = (protocol.graph.groups || []).find(group => group.nodeIds.includes(nodeId));
  if (sourceGroup) {
    const group = added.protocol.graph.groups.find(item => item.id === sourceGroup.id);
    group.nodeIds.push(added.node.id);
  }
  if (!options.insertAfter) return added;
  const outputPortId = options.outputPortId || 'next';
  const inputPortId = options.inputPortId || 'in';
  const outgoing = protocol.graph.edges.filter(edge => edge.kind === 'control' && edge.source.nodeId === nodeId && edge.source.portId === outputPortId);
  if (outgoing.length !== 1) throw new Error(`Inline duplication requires exactly one ${outputPortId} connection`);
  const originalEdge = outgoing[0];
  const edgeOptions = { idFactory: options.idFactory, now: options.now };
  let next = disconnect(added.protocol, originalEdge.id, edgeOptions);
  next = connect(next, 'control', { nodeId, portId: outputPortId }, { nodeId: added.node.id, portId: inputPortId }, edgeOptions).protocol;
  next = connect(next, 'control', { nodeId: added.node.id, portId: outputPortId }, originalEdge.target, edgeOptions).protocol;
  return { protocol: next, node: added.node };
}
