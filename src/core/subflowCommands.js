import { createId } from './ids.js';

function touch(protocol, now = new Date().toISOString()) {
  protocol.audit = { ...(protocol.audit || {}), updatedAt: now };
  return protocol;
}

function mapEndpoint(endpoint, nodeIds) {
  if (!endpoint) return null;
  return { ...endpoint, nodeId: nodeIds.get(endpoint.nodeId) };
}

function validateMappings(protocol, parameters, mappings) {
  const variables = new Map((protocol.variables || []).map(variable => [variable.name, variable]));
  const result = {};
  for (const parameter of parameters || []) {
    const variableName = mappings?.[parameter.name];
    if (!variableName) throw new Error(`Subflow parameter ${parameter.name} needs a variable mapping`);
    const variable = variables.get(variableName);
    if (!variable) throw new Error(`Subflow parameter ${parameter.name} references unknown variable ${variableName}`);
    if (parameter.type !== 'unknown' && variable.type !== 'unknown' && parameter.type !== variable.type) {
      throw new Error(`Subflow parameter ${parameter.name} (${parameter.type}) cannot map to ${variableName} (${variable.type})`);
    }
    result[parameter.name] = variableName;
  }
  return result;
}

export function createSubflowTemplate(protocol, groupId, options = {}) {
  const group = (protocol.graph?.groups || []).find(item => item.id === groupId);
  if (!group) throw new Error(`Group ${groupId} does not exist`);
  if (group.kind !== 'subflow') throw new Error('Only a subflow group can become a reusable template');
  const members = new Set(group.nodeIds || []);
  if (!group.entryNodeId || !members.has(group.entryNodeId) || !(group.exitNodeIds || []).length) throw new Error('Subflow boundaries must be complete before publishing');
  for (const parameter of group.parameters || []) {
    const endpoint = parameter.direction === 'output' ? parameter.source : parameter.target;
    if (!endpoint?.nodeId || !endpoint?.portId || !members.has(endpoint.nodeId)) throw new Error(`Subflow parameter ${parameter.name || '(unnamed)'} needs a member endpoint before publishing`);
  }
  const idFactory = options.idFactory || createId;
  const templateId = options.id || idFactory('subflow_template');
  if ((protocol.subflowTemplates || []).some(template => template.id === templateId)) throw new Error(`Subflow template ${templateId} already exists`);
  const template = {
    id: templateId,
    version: 1,
    name: String(options.name || group.name).trim() || group.name,
    description: String(options.description || ''),
    nodes: structuredClone(protocol.graph.nodes.filter(node => members.has(node.id))),
    edges: structuredClone(protocol.graph.edges.filter(edge => members.has(edge.source.nodeId) && members.has(edge.target.nodeId))),
    entryNodeId: group.entryNodeId,
    exitNodeIds: [...group.exitNodeIds],
    parameters: structuredClone(group.parameters || []),
    createdAt: options.now || new Date().toISOString(),
  };
  const next = structuredClone(protocol);
  next.subflowTemplates = [...(next.subflowTemplates || []), template];
  return { protocol: touch(next, options.now), template };
}

export function instantiateSubflowTemplate(protocol, templateId, options = {}) {
  const template = (protocol.subflowTemplates || []).find(item => item.id === templateId);
  if (!template) throw new Error(`Subflow template ${templateId} does not exist`);
  const parameterMappings = validateMappings(protocol, template.parameters, options.parameterMappings || {});
  const idFactory = options.idFactory || createId;
  const existingNodeIds = new Set(protocol.graph.nodes.map(node => node.id));
  const existingEdgeIds = new Set(protocol.graph.edges.map(edge => edge.id));
  const nodeIds = new Map();
  for (const node of template.nodes) {
    const id = idFactory('node');
    if (existingNodeIds.has(id) || nodeIds.has(id)) throw new Error(`Generated duplicate node ID ${id}`);
    nodeIds.set(node.id, id);
  }
  const groupId = options.groupId || idFactory('group');
  if ((protocol.graph.groups || []).some(group => group.id === groupId)) throw new Error(`Group ${groupId} already exists`);
  const minimumX = Math.min(...template.nodes.map(node => Number(node.layout?.x || 0)));
  const minimumY = Math.min(...template.nodes.map(node => Number(node.layout?.y || 0)));
  const origin = options.position || { x: minimumX + 80, y: minimumY + 80 };
  const nodes = template.nodes.map(node => ({
    ...structuredClone(node),
    id: nodeIds.get(node.id),
    label: options.labelPrefix ? `${options.labelPrefix} ${node.label}` : node.label,
    layout: { ...node.layout, x: Number(origin.x) + Number(node.layout?.x || 0) - minimumX, y: Number(origin.y) + Number(node.layout?.y || 0) - minimumY },
    metadata: { ...(node.metadata || {}), subflowTemplateId: template.id, subflowTemplateVersion: template.version, subflowInstanceId: groupId },
  }));
  const edges = template.edges.map(edge => {
    const id = idFactory('edge');
    if (existingEdgeIds.has(id)) throw new Error(`Generated duplicate edge ID ${id}`);
    existingEdgeIds.add(id);
    return { ...structuredClone(edge), id, source: { ...edge.source, nodeId: nodeIds.get(edge.source.nodeId) }, target: { ...edge.target, nodeId: nodeIds.get(edge.target.nodeId) } };
  });
  const parameters = template.parameters.map(parameter => ({
    ...structuredClone(parameter),
    target: mapEndpoint(parameter.target, nodeIds),
    source: mapEndpoint(parameter.source, nodeIds),
  }));
  const group = {
    id: groupId,
    name: options.name || `${template.name} instance`,
    kind: 'subflow',
    nodeIds: nodes.map(node => node.id),
    entryNodeId: nodeIds.get(template.entryNodeId),
    exitNodeIds: template.exitNodeIds.map(nodeId => nodeIds.get(nodeId)),
    parameters,
    parameterMappings,
    metadata: { templateId: template.id, templateVersion: template.version },
  };
  const next = structuredClone(protocol);
  next.graph.nodes.push(...nodes);
  next.graph.edges.push(...edges);
  next.graph.groups = [...(next.graph.groups || []), group];
  return { protocol: touch(next, options.now), group, nodes, edges };
}

export function removeSubflowTemplate(protocol, templateId, options = {}) {
  if (!(protocol.subflowTemplates || []).some(template => template.id === templateId)) return protocol;
  const instances = (protocol.graph.groups || []).filter(group => group.metadata?.templateId === templateId);
  if (instances.length && !options.force) throw new Error(`Subflow template ${templateId} has ${instances.length} instance(s)`);
  const next = structuredClone(protocol);
  next.subflowTemplates = next.subflowTemplates.filter(template => template.id !== templateId);
  return touch(next, options.now);
}
