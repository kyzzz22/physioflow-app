import { createId } from '../core/ids.js';
import { hashProtocolGraph } from '../core/freezeProtocolGraph.js';
import { serializeProtocolGraph } from '../core/serialization.js';

export const CHANGE_SET_SCHEMA_VERSION = '1.0.0';

const COLLECTIONS = [
  { target: 'graph.nodes', path: ['graph', 'nodes'], key: item => item.id },
  { target: 'graph.edges', path: ['graph', 'edges'], key: item => item.id },
  { target: 'graph.groups', path: ['graph', 'groups'], key: item => item.id },
  { target: 'variables', path: ['variables'], key: item => item.name },
  { target: 'assets', path: ['assets'], key: item => item.assetId || item.id },
  { target: 'templates', path: ['templates'], key: item => item.templateId || item.id },
  { target: 'subflowTemplates', path: ['subflowTemplates'], key: item => item.id },
  { target: 'componentPackages', path: ['componentPackages'], key: item => `${item.packageId}@${item.version}` },
  { target: 'deviceConnectors', path: ['deviceConnectors'], key: item => `${item.connectorId}@${item.version}` },
];
const COLLECTION_BY_TARGET = new Map(COLLECTIONS.map(item => [item.target, item]));
const SINGLETON_PATHS = [['metadata'], ['graph', 'entryNodeId'], ['participantUi'], ['dataPolicy'], ['legacy']];
const FORBIDDEN_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);
const IMMUTABLE_ENTITY_FIELDS = {
  'graph.nodes': new Set(['id']),
  'graph.edges': new Set(['id']),
  'graph.groups': new Set(['id']),
  variables: new Set(['name']),
  assets: new Set(['id', 'assetId']),
  templates: new Set(['id', 'templateId']),
  subflowTemplates: new Set(['id']),
  componentPackages: new Set(['packageId', 'version']),
  deviceConnectors: new Set(['connectorId', 'version']),
};
const HASH_PATTERN = /^[a-f0-9]{64}$/;

const clone = value => value === undefined ? undefined : structuredClone(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const equal = (left, right) => serializeProtocolGraph(left, 0) === serializeProtocolGraph(right, 0);
const snapshot = (exists, value) => ({ exists, ...(exists ? { value: clone(value) } : {}) });

function valueAt(root, path) {
  let current = root;
  for (const part of path) {
    if (!isPlainObject(current) || !own(current, part)) return snapshot(false);
    current = current[part];
  }
  return snapshot(true, current);
}

function collectionAt(protocol, descriptor) {
  let current = protocol;
  for (const part of descriptor.path) current = current?.[part];
  return Array.isArray(current) ? current : [];
}

function addOperation(operations, target, entityKey, path, before, after) {
  operations.push({
    id: `op_${String(operations.length + 1).padStart(4, '0')}`,
    target,
    entityKey,
    path,
    before,
    after,
  });
}

function diffValue(before, after, path, operations, target, entityKey) {
  if (before.exists === after.exists && (!before.exists || equal(before.value, after.value))) return;
  if (before.exists && after.exists && isPlainObject(before.value) && isPlainObject(after.value)) {
    const keys = [...new Set([...Object.keys(before.value), ...Object.keys(after.value)])].sort();
    for (const key of keys) {
      diffValue(
        snapshot(own(before.value, key), before.value[key]),
        snapshot(own(after.value, key), after.value[key]),
        [...path, key],
        operations,
        target,
        entityKey,
      );
    }
    return;
  }
  addOperation(operations, target, entityKey, path, before, after);
}

function diffCollection(base, edited, descriptor, operations) {
  const beforeMap = new Map(collectionAt(base, descriptor).map(item => [descriptor.key(item), item]));
  const afterMap = new Map(collectionAt(edited, descriptor).map(item => [descriptor.key(item), item]));
  const keys = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort();
  for (const key of keys) {
    const beforeExists = beforeMap.has(key);
    const afterExists = afterMap.has(key);
    diffValue(snapshot(beforeExists, beforeMap.get(key)), snapshot(afterExists, afterMap.get(key)), [], operations, descriptor.target, key);
  }
}

export function validateProtocolChangeSet(changeSet) {
  const errors = [];
  if (changeSet?.schemaVersion !== CHANGE_SET_SCHEMA_VERSION) errors.push(`Unsupported change-set schema ${changeSet?.schemaVersion || 'missing'}`);
  if (typeof changeSet?.id !== 'string' || !changeSet.id.trim()) errors.push('Change set ID is required');
  if (typeof changeSet?.protocolId !== 'string' || !changeSet.protocolId.trim()) errors.push('Protocol ID is required');
  if (typeof changeSet?.projectId !== 'string' || !changeSet.projectId.trim()) errors.push('Project ID is required');
  if (!Number.isInteger(changeSet?.baseVersion) || changeSet.baseVersion < 1) errors.push('Base version must be a positive integer');
  if (!HASH_PATTERN.test(changeSet?.baseHash || '')) errors.push('Base hash must be SHA-256');
  if (!HASH_PATTERN.test(changeSet?.resultHash || '')) errors.push('Result hash must be SHA-256');
  if (!Array.isArray(changeSet?.operations)) errors.push('Operations must be an array');
  if ((changeSet?.operations?.length || 0) > 10000) errors.push('Change set exceeds the 10,000-operation safety limit');
  const operationIds = new Set();
  for (const [index, operation] of (changeSet?.operations || []).entries()) {
    const label = `operations[${index}]`;
    if (typeof operation?.id !== 'string' || !operation.id.trim()) errors.push(`${label} needs an ID`);
    if (operationIds.has(operation?.id)) errors.push(`${label} has a duplicate ID`);
    operationIds.add(operation?.id);
    if (operation?.target !== '$protocol' && !COLLECTION_BY_TARGET.has(operation?.target)) errors.push(`${label} has an unsupported target`);
    if (operation?.target !== '$protocol' && (typeof operation?.entityKey !== 'string' || !operation.entityKey.trim())) errors.push(`${label} needs an entity key`);
    if (!Array.isArray(operation?.path) || operation.path.some(part => typeof part !== 'string' || !part || FORBIDDEN_PATH_PARTS.has(part) || /^\d+$/.test(part))) errors.push(`${label} has an unsafe path`);
    if (operation?.target === '$protocol' && operation?.path?.length === 0) errors.push(`${label} needs a protocol path`);
    if (operation?.target === '$protocol' && operation?.path?.length && !SINGLETON_PATHS.some(path => path.every((part, pathIndex) => operation.path[pathIndex] === part))) errors.push(`${label} targets protected protocol state`);
    if (operation?.target !== '$protocol' && IMMUTABLE_ENTITY_FIELDS[operation?.target]?.has(operation?.path?.[0])) errors.push(`${label} cannot change an entity identity field`);
    if (typeof operation?.before?.exists !== 'boolean' || typeof operation?.after?.exists !== 'boolean') errors.push(`${label} needs before/after snapshots`);
    if (operation?.target !== '$protocol' && operation?.path?.length === 0) {
      const descriptor = COLLECTION_BY_TARGET.get(operation.target);
      for (const [stateName, state] of [['before', operation.before], ['after', operation.after]]) {
        if (state?.exists && (!isPlainObject(state.value) || descriptor?.key(state.value) !== operation.entityKey)) errors.push(`${label} ${stateName} entity identity does not match its key`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export async function createProtocolChangeSet(base, edited, options = {}) {
  if (base?.protocolId !== edited?.protocolId || base?.projectId !== edited?.projectId) throw new Error('Change sets require the same protocol and project identity');
  if (base?.version?.number !== edited?.version?.number) throw new Error('Change sets cannot cross protocol versions');
  const operations = [];
  COLLECTIONS.forEach(descriptor => diffCollection(base, edited, descriptor, operations));
  SINGLETON_PATHS.forEach(path => diffValue(valueAt(base, path), valueAt(edited, path), path, operations, '$protocol', null));
  const now = options.now || new Date().toISOString();
  return {
    schemaVersion: CHANGE_SET_SCHEMA_VERSION,
    id: options.id || (options.idFactory || createId)('changeset'),
    protocolId: base.protocolId,
    projectId: base.projectId,
    baseVersion: base.version.number,
    baseHash: await hashProtocolGraph(base),
    resultHash: await hashProtocolGraph(edited),
    author: { id: options.authorId || 'local-author', name: options.authorName || options.authorId || 'Local author' },
    createdAt: now,
    summary: options.summary || '',
    operations,
  };
}

function readOperationState(protocol, operation) {
  if (operation.target === '$protocol') return valueAt(protocol, operation.path);
  const descriptor = COLLECTION_BY_TARGET.get(operation.target);
  const entity = collectionAt(protocol, descriptor).find(item => descriptor.key(item) === operation.entityKey);
  if (!entity) return snapshot(false);
  if (!operation.path.length) return snapshot(true, entity);
  return valueAt(entity, operation.path);
}

function writeNestedValue(root, path, state) {
  if (!path.length) throw new Error('A nested write requires a path');
  let cursor = root;
  for (const part of path.slice(0, -1)) {
    if (!isPlainObject(cursor[part])) cursor[part] = {};
    cursor = cursor[part];
  }
  const key = path.at(-1);
  if (state.exists) cursor[key] = clone(state.value);
  else delete cursor[key];
}

function writeOperationState(protocol, operation, state) {
  if (operation.target === '$protocol') {
    writeNestedValue(protocol, operation.path, state);
    return;
  }
  const descriptor = COLLECTION_BY_TARGET.get(operation.target);
  let collection = protocol;
  for (const part of descriptor.path.slice(0, -1)) {
    if (!isPlainObject(collection[part])) collection[part] = {};
    collection = collection[part];
  }
  const collectionKey = descriptor.path.at(-1);
  if (!Array.isArray(collection[collectionKey])) collection[collectionKey] = [];
  const items = collection[collectionKey];
  const index = items.findIndex(item => descriptor.key(item) === operation.entityKey);
  if (!operation.path.length) {
    if (!state.exists && index >= 0) items.splice(index, 1);
    if (state.exists && index >= 0) items[index] = clone(state.value);
    if (state.exists && index < 0) items.push(clone(state.value));
    return;
  }
  if (index < 0) throw new Error(`Cannot update missing ${operation.target} entity ${operation.entityKey}`);
  writeNestedValue(items[index], operation.path, state);
}

function sameSnapshot(left, right) {
  return left.exists === right.exists && (!left.exists || equal(left.value, right.value));
}

export function mergeProtocolChangeSet(localProtocol, changeSet, options = {}) {
  const check = validateProtocolChangeSet(changeSet);
  if (!check.valid) throw new Error(`Invalid change set:\n${check.errors.join('\n')}`);
  if (localProtocol?.version?.status === 'frozen') throw new Error('Create an editable protocol version before applying collaboration changes');
  if (localProtocol?.protocolId !== changeSet.protocolId || localProtocol?.projectId !== changeSet.projectId) throw new Error('Change set targets a different protocol or project');
  if (localProtocol?.version?.number !== changeSet.baseVersion) throw new Error(`Change set targets version ${changeSet.baseVersion}, not version ${localProtocol?.version?.number}`);
  if ((localProtocol.collaboration?.history || []).some(item => item.changeSetId === changeSet.id)) {
    return { protocol: structuredClone(localProtocol), conflicts: [], unresolved: 0, appliedOperations: 0, alreadyAppliedOperations: changeSet.operations.length, duplicate: true };
  }
  const next = structuredClone(localProtocol);
  const conflicts = [];
  let appliedOperations = 0;
  let alreadyAppliedOperations = 0;
  for (const operation of changeSet.operations) {
    const current = readOperationState(next, operation);
    if (sameSnapshot(current, operation.after)) { alreadyAppliedOperations += 1; continue; }
    if (sameSnapshot(current, operation.before)) {
      writeOperationState(next, operation, operation.after);
      appliedOperations += 1;
      continue;
    }
    const resolution = options.resolutions?.[operation.id];
    if (resolution === 'incoming') {
      writeOperationState(next, operation, operation.after);
      appliedOperations += 1;
      continue;
    }
    if (resolution === 'local') continue;
    conflicts.push({ operationId: operation.id, target: operation.target, entityKey: operation.entityKey, path: operation.path, base: operation.before, local: current, incoming: operation.after });
  }
  if (!conflicts.length) {
    const now = options.now || new Date().toISOString();
    next.audit = { ...(next.audit || {}), updatedAt: now };
    next.collaboration = {
      ...(next.collaboration || {}),
      history: [...(next.collaboration?.history || []), {
        changeSetId: changeSet.id,
        author: clone(changeSet.author),
        baseHash: changeSet.baseHash,
        resultHash: changeSet.resultHash,
        appliedAt: now,
        appliedOperations,
        alreadyAppliedOperations,
        resolvedConflicts: Object.keys(options.resolutions || {}).length,
      }],
    };
  }
  return { protocol: next, conflicts, unresolved: conflicts.length, appliedOperations, alreadyAppliedOperations };
}
