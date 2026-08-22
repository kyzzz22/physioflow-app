import { createId } from './ids.js';
import { PROTOCOL_GRAPH_SCHEMA_VERSION } from './protocolGraph.js';

export function isGraphProtocol(protocol) {
  return protocol?.schemaVersion === PROTOCOL_GRAPH_SCHEMA_VERSION && Boolean(protocol.graph);
}

export function protocolIdOf(protocol) {
  return protocol?.protocolId || protocol?.protocol_id || '';
}

export function projectIdOf(protocol) {
  return protocol?.projectId || protocol?.project_id || '';
}

export function protocolNameOf(protocol) {
  return protocol?.metadata?.name || protocol?.name || 'Untitled experiment';
}

export function protocolStatusOf(protocol) {
  return protocol?.version?.status || protocol?.status || 'draft';
}

export function protocolVersionOf(protocol) {
  return Number(protocol?.version?.number ?? protocol?.version ?? 1);
}

export function protocolVersionLabelOf(protocol) {
  return protocol?.version?.label || protocol?.version_name || `Version ${protocolVersionOf(protocol)}`;
}

export function protocolArchivedAtOf(protocol) {
  return protocol?.audit?.archivedAt || protocol?.archived_at || null;
}

export function protocolCreatedAtOf(protocol) {
  return protocol?.audit?.createdAt || protocol?.created_at || '';
}

export function protocolConfigHashOf(protocol) {
  return protocol?.freeze?.configHash || protocol?.config_hash || '';
}

export function renameProtocol(protocol, name, now = new Date().toISOString()) {
  const next = structuredClone(protocol);
  if (isGraphProtocol(next)) {
    next.metadata = { ...next.metadata, name };
    next.audit = { ...next.audit, updatedAt: now };
  } else {
    next.name = name;
    next.updated_at = now;
  }
  return next;
}

export function archiveProtocol(protocol, archivedAt = new Date().toISOString()) {
  const next = structuredClone(protocol);
  if (isGraphProtocol(next)) next.audit = { ...next.audit, archivedAt, updatedAt: archivedAt };
  else next.archived_at = archivedAt;
  return next;
}

export function createNextGraphProtocolVersion(source, options = {}) {
  if (!isGraphProtocol(source)) throw new Error('Expected a Protocol Graph');
  const next = structuredClone(source);
  const idFactory = options.idFactory || createId;
  const now = options.now || new Date().toISOString();
  const versionNumber = protocolVersionOf(source) + 1;
  next.protocolId = idFactory('protocol');
  next.version = { number: versionNumber, label: `Version ${versionNumber}`, status: 'draft' };
  next.audit = { createdAt: now, updatedAt: now, frozenAt: null, archivedAt: null };
  delete next.freeze;
  return next;
}

export function duplicateGraphProtocolAsProject(source, options = {}) {
  const idFactory = options.idFactory || createId;
  const next = createNextGraphProtocolVersion(source, options);
  next.projectId = idFactory('project');
  next.version = { number: 1, label: 'Draft 1', status: 'draft' };
  next.metadata.name = `${protocolNameOf(source)} Copy`;
  return next;
}
