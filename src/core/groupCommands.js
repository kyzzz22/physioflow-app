import { createId } from './ids.js';

function touch(protocol, now = new Date().toISOString()) {
  protocol.audit = { ...(protocol.audit || {}), updatedAt: now };
  return protocol;
}

export function createNodeGroup(protocol, nodeIds = [], options = {}) {
  const next = structuredClone(protocol);
  const uniqueNodeIds = [...new Set(nodeIds)];
  const known = new Set((next.graph?.nodes || []).map(node => node.id));
  if (!uniqueNodeIds.length) throw new Error('A group needs at least one node');
  if (uniqueNodeIds.some(nodeId => !known.has(nodeId))) throw new Error('A group cannot contain an unknown node');
  const alreadyGrouped = new Set((next.graph.groups || []).flatMap(group => group.nodeIds || []));
  if (uniqueNodeIds.some(nodeId => alreadyGrouped.has(nodeId))) throw new Error('A node can belong to only one group');
  const idFactory = options.idFactory || createId;
  const group = {
    id: options.id || idFactory('group'),
    name: String(options.name || 'New group').trim() || 'New group',
    kind: options.kind || 'container',
    nodeIds: uniqueNodeIds,
    entryNodeId: options.entryNodeId || null,
    exitNodeIds: [...(options.exitNodeIds || [])],
    parameters: structuredClone(options.parameters || []),
    metadata: structuredClone(options.metadata || {}),
  };
  next.graph.groups = [...(next.graph.groups || []), group];
  return { protocol: touch(next, options.now), group };
}

export function updateNodeGroup(protocol, groupId, changes, options = {}) {
  const next = structuredClone(protocol);
  const index = (next.graph.groups || []).findIndex(group => group.id === groupId);
  if (index < 0) throw new Error(`Group ${groupId} does not exist`);
  const original = next.graph.groups[index];
  const patch = typeof changes === 'function' ? changes(structuredClone(original)) : structuredClone(changes || {});
  if (patch.id && patch.id !== groupId) throw new Error('Group IDs cannot be changed');
  if (patch.nodeIds) {
    const known = new Set(next.graph.nodes.map(node => node.id));
    patch.nodeIds = [...new Set(patch.nodeIds)];
    if (patch.nodeIds.some(nodeId => !known.has(nodeId))) throw new Error('A group cannot contain an unknown node');
    const usedElsewhere = new Set(next.graph.groups.filter(group => group.id !== groupId).flatMap(group => group.nodeIds || []));
    if (patch.nodeIds.some(nodeId => usedElsewhere.has(nodeId))) throw new Error('A node can belong to only one group');
  }
  next.graph.groups[index] = { ...original, ...patch, id: groupId };
  return touch(next, options.now);
}

export function assignNodeToGroup(protocol, nodeId, groupId, options = {}) {
  if (!protocol.graph.nodes.some(node => node.id === nodeId)) throw new Error(`Node ${nodeId} does not exist`);
  const next = structuredClone(protocol);
  if (groupId && !(next.graph.groups || []).some(group => group.id === groupId)) throw new Error(`Group ${groupId} does not exist`);
  next.graph.groups = (next.graph.groups || []).map(group => ({
    ...group,
    nodeIds: group.id === groupId ? [...new Set([...group.nodeIds, nodeId])] : group.nodeIds.filter(id => id !== nodeId),
  }));
  return touch(next, options.now);
}

export function removeNodeGroup(protocol, groupId, options = {}) {
  if (!(protocol.graph.groups || []).some(group => group.id === groupId)) return protocol;
  const next = structuredClone(protocol);
  next.graph.groups = next.graph.groups.filter(group => group.id !== groupId);
  return touch(next, options.now);
}
