import { HOSTED_STATE_SCHEMA_VERSION, LocalHostedExecutionService } from './hostedService.js';

const MUTATIONS = new Set([
  'publishDeployment',
  'recordDeploymentAsset',
  'processNextDeployment',
  'createSession',
  'deactivateDeployment',
  'createLaunchLink',
  'revokeLaunchLink',
  'redeemLaunchLink',
  'appendEvents',
  'syncSessionState',
  'completeSession',
]);

function clone(value) { return value === undefined ? undefined : structuredClone(value); }

export function validateHostedState(state) {
  const errors = [];
  if (!state || typeof state !== 'object') return { valid: false, errors: ['Hosted state must be an object'] };
  if (![HOSTED_STATE_SCHEMA_VERSION, '1.0.0'].includes(state.schemaVersion)) errors.push(`Unsupported hosted state version ${state.schemaVersion || '(missing)'}`);
  const requiredArrays = ['deployments', 'sessions', 'participantTokens', 'idempotency', 'auditEntries'];
  if (state.schemaVersion === HOSTED_STATE_SCHEMA_VERSION) requiredArrays.push('launchLinks', 'launchTokens');
  for (const key of requiredArrays) {
    if (!Array.isArray(state[key])) errors.push(`Hosted state ${key} must be an array`);
  }
  const deploymentIds = new Set();
  for (const deployment of state.deployments || []) {
    if (!deployment.deploymentId || deploymentIds.has(deployment.deploymentId)) errors.push('Hosted deployment IDs must be present and unique');
    deploymentIds.add(deployment.deploymentId);
  }
  const sessionIds = new Set();
  for (const session of state.sessions || []) {
    if (!session.sessionId || sessionIds.has(session.sessionId)) errors.push('Hosted session IDs must be present and unique');
    sessionIds.add(session.sessionId);
    if (!deploymentIds.has(session.deploymentId)) errors.push(`Hosted session ${session.sessionId || '(missing)'} references an unknown deployment`);
    if (!Array.isArray(session.idempotency)) errors.push(`Hosted session ${session.sessionId || '(missing)'} idempotency state must be an array`);
  }
  const launchLinkIds = new Set();
  for (const link of state.launchLinks || []) {
    if (!link.launchLinkId || launchLinkIds.has(link.launchLinkId)) errors.push('Hosted launch link IDs must be present and unique');
    launchLinkIds.add(link.launchLinkId);
    if (!deploymentIds.has(link.deploymentId)) errors.push(`Hosted launch link ${link.launchLinkId || '(missing)'} references an unknown deployment`);
  }
  for (const entry of state.launchTokens || []) {
    if (!Array.isArray(entry) || entry.length !== 2 || !launchLinkIds.has(entry[1])) errors.push('Hosted launch tokens must reference a known launch link');
  }
  return { valid: errors.length === 0, errors };
}

export class MemoryHostedStateStore {
  constructor(initialState = null) { this.state = clone(initialState); }
  async load() { return clone(this.state); }
  async save(state) {
    const check = validateHostedState(state);
    if (!check.valid) throw new Error(`Invalid hosted state:\n${check.errors.join('\n')}`);
    this.state = clone(state);
  }
}

export class WebStorageHostedStateStore {
  constructor(key = 'physioflow.hosted-service.v1', storage = globalThis.localStorage) {
    if (!storage?.getItem || !storage?.setItem) throw new Error('Hosted web storage requires the Storage API');
    this.key = key;
    this.storage = storage;
  }
  async load() {
    const raw = this.storage.getItem(this.key);
    return raw ? JSON.parse(raw) : null;
  }
  async save(state) {
    const check = validateHostedState(state);
    if (!check.valid) throw new Error(`Invalid hosted state:\n${check.errors.join('\n')}`);
    this.storage.setItem(this.key, JSON.stringify(state));
  }
}

export async function createPersistentHostedExecutionService(options = {}) {
  if (!options.store?.load || !options.store?.save) throw new Error('Persistent hosted service requires a load/save state store');
  const restored = await options.store.load();
  if (restored) {
    const check = validateHostedState(restored);
    if (!check.valid) throw new Error(`Invalid hosted state:\n${check.errors.join('\n')}`);
  }
  const service = new LocalHostedExecutionService({ ...options, state: restored || undefined });
  let tail = Promise.resolve();
  return new Proxy(service, {
    get(target, property) {
      const value = target[property];
      if (typeof value !== 'function') return value;
      if (property === 'exportState') return value.bind(target);
      if (MUTATIONS.has(property)) return (...args) => {
        const operation = tail.catch(() => undefined).then(async () => {
          const result = await value.apply(target, args);
          await options.store.save(target.exportState());
          return result;
        });
        tail = operation;
        return operation;
      };
      return (...args) => tail.catch(() => undefined).then(() => value.apply(target, args));
    },
  });
}
