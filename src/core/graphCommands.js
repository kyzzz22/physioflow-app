import { createEdge, createNode } from './protocolGraph.js';

function cloneProtocol(protocol) {
  return structuredClone(protocol);
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
  const next = cloneProtocol(protocol);
  const index = next.graph.nodes.findIndex(node => node.id === nodeId);
  if (index < 0) throw new Error(`Node ${nodeId} does not exist`);
  const original = next.graph.nodes[index];
  const patch = typeof changes === 'function' ? changes(structuredClone(original)) : changes;
  if (patch?.id && patch.id !== nodeId) throw new Error('Graph commands cannot change a node ID');
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
  const next = cloneProtocol(protocol);
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
