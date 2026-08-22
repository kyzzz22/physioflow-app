import { createId } from './ids.js';

export const PROTOCOL_GRAPH_SCHEMA_VERSION = '2.0.0-alpha.1';

export function createNode(componentType, options = {}) {
  const idFactory = options.idFactory || createId;
  return {
    id: options.id || idFactory('node'),
    component: {
      type: componentType,
      version: options.componentVersion || '1.0.0',
    },
    label: options.label || componentType,
    config: structuredClone(options.config || {}),
    bindings: structuredClone(options.bindings || {}),
    layout: {
      x: Number(options.layout?.x ?? 0),
      y: Number(options.layout?.y ?? 0),
      ...(options.layout || {}),
    },
    metadata: structuredClone(options.metadata || {}),
  };
}

export function createEdge(kind, source, target, options = {}) {
  const idFactory = options.idFactory || createId;
  return {
    id: options.id || idFactory('edge'),
    kind,
    source: { nodeId: source.nodeId, portId: source.portId },
    target: { nodeId: target.nodeId, portId: target.portId },
    metadata: structuredClone(options.metadata || {}),
  };
}

export function createProtocolGraph(options = {}) {
  const idFactory = options.idFactory || createId;
  const now = options.now || new Date().toISOString();
  const start = createNode('core.start', { idFactory, label: 'Start', layout: { x: 80, y: 180 } });
  const end = createNode('core.end', { idFactory, label: 'End', layout: { x: 560, y: 180 } });
  const initialEdge = createEdge(
    'control',
    { nodeId: start.id, portId: 'next' },
    { nodeId: end.id, portId: 'in' },
    { idFactory },
  );

  return {
    schemaVersion: PROTOCOL_GRAPH_SCHEMA_VERSION,
    protocolId: options.protocolId || idFactory('protocol'),
    projectId: options.projectId || idFactory('project'),
    metadata: {
      name: options.name || 'Untitled experiment',
      description: options.description || '',
      tags: [...(options.tags || [])],
    },
    version: {
      number: 1,
      label: 'Draft 1',
      status: 'draft',
    },
    audit: {
      createdAt: now,
      updatedAt: now,
      frozenAt: null,
    },
    graph: {
      entryNodeId: start.id,
      nodes: [start, end],
      edges: [initialEdge],
      groups: [],
    },
    variables: [],
    assets: [],
    templates: [],
    participantUi: { theme: {} },
    dataPolicy: { level: 'standard', retainRawEvents: true },
  };
}
