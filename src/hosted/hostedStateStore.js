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
  'purgeExpiredSessionData',
]);

function clone(value) { return value === undefined ? undefined : structuredClone(value); }
const TENANT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CREDENTIAL_KEY_ID = '[A-Za-z0-9][A-Za-z0-9._-]{0,63}';
const credentialDigest = new RegExp(`^hmac-sha256:(${CREDENTIAL_KEY_ID}):[a-f0-9]{64}$`);
const sealedCredential = new RegExp(`^sealed:v1:(${CREDENTIAL_KEY_ID}):[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$`);

function validTenant(value) { return typeof value === 'string' && TENANT_ID.test(value) && value === value.trim(); }

function validateProtectedCredentialFields(value, primaryKeyId, errors, location) {
  if (Array.isArray(value)) return value.forEach((item, index) => validateProtectedCredentialFields(item, primaryKeyId, errors, `${location}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (['participantAccessToken', 'launchToken'].includes(key) && typeof item === 'string') {
      const match = item.match(sealedCredential);
      if (!match || match[1] !== primaryKeyId) errors.push(`Hosted protected credential ${location}.${key} is invalid`);
    } else validateProtectedCredentialFields(item, primaryKeyId, errors, `${location}.${key}`);
  }
}

export function validateHostedState(state) {
  const errors = [];
  if (!state || typeof state !== 'object') return { valid: false, errors: ['Hosted state must be an object'] };
  if (![HOSTED_STATE_SCHEMA_VERSION, '1.2.0', '1.1.0', '1.0.0'].includes(state.schemaVersion)) errors.push(`Unsupported hosted state version ${state.schemaVersion || '(missing)'}`);
  const requiresTenant = state.schemaVersion === HOSTED_STATE_SCHEMA_VERSION;
  const requiredArrays = ['deployments', 'sessions', 'participantTokens', 'idempotency', 'auditEntries'];
  if (state.schemaVersion !== '1.0.0') requiredArrays.push('launchLinks', 'launchTokens');
  for (const key of requiredArrays) {
    if (!Array.isArray(state[key])) errors.push(`Hosted state ${key} must be an array`);
  }
  const deploymentIds = new Set();
  const deploymentTenants = new Map();
  for (const deployment of state.deployments || []) {
    if (!deployment.deploymentId || deploymentIds.has(deployment.deploymentId)) errors.push('Hosted deployment IDs must be present and unique');
    deploymentIds.add(deployment.deploymentId);
    if (requiresTenant && !validTenant(deployment.tenantId)) errors.push(`Hosted deployment ${deployment.deploymentId || '(missing)'} must declare a valid tenant`);
    if (requiresTenant && ![1, 2].includes(deployment.assetNamespaceVersion)) errors.push(`Hosted deployment ${deployment.deploymentId || '(missing)'} must declare a valid asset namespace version`);
    deploymentTenants.set(deployment.deploymentId, deployment.tenantId || 'default');
  }
  const sessionIds = new Set();
  const sessionTenants = new Map();
  const purgedSessionIds = new Set();
  for (const session of state.sessions || []) {
    if (!session.sessionId || sessionIds.has(session.sessionId)) errors.push('Hosted session IDs must be present and unique');
    sessionIds.add(session.sessionId);
    if (!deploymentIds.has(session.deploymentId)) errors.push(`Hosted session ${session.sessionId || '(missing)'} references an unknown deployment`);
    if (requiresTenant && !validTenant(session.tenantId)) errors.push(`Hosted session ${session.sessionId || '(missing)'} must declare a valid tenant`);
    sessionTenants.set(session.sessionId, session.tenantId || 'default');
    if (deploymentTenants.has(session.deploymentId) && (session.tenantId || 'default') !== deploymentTenants.get(session.deploymentId)) errors.push(`Hosted session ${session.sessionId || '(missing)'} tenant does not match its deployment`);
    if (!Array.isArray(session.idempotency)) errors.push(`Hosted session ${session.sessionId || '(missing)'} idempotency state must be an array`);
    if (session.dataPurgedAt) {
      purgedSessionIds.add(session.sessionId);
      if (session.participantId !== null || session.participantAccessToken !== null) errors.push(`Purged hosted session ${session.sessionId} must not retain participant identity or access token`);
      if (!Array.isArray(session.events) || session.events.length !== 0 || session.eventCount !== 0) errors.push(`Purged hosted session ${session.sessionId} must not retain events`);
      if (session.runtimeSnapshot !== null) errors.push(`Purged hosted session ${session.sessionId} must not retain a runtime snapshot`);
      if (!Array.isArray(session.idempotency) || session.idempotency.length !== 0) errors.push(`Purged hosted session ${session.sessionId} must not retain session idempotency results`);
      if (!Number.isInteger(session.purgedEventCount) || session.purgedEventCount < 0) errors.push(`Purged hosted session ${session.sessionId} must record its removed event count`);
    }
  }
  for (const entry of state.participantTokens || []) {
    if (!Array.isArray(entry) || entry.length !== 2 || !sessionIds.has(entry[1]?.sessionId)) errors.push('Hosted participant tokens must reference a known session');
    else if (purgedSessionIds.has(entry[1].sessionId)) errors.push(`Purged hosted session ${entry[1].sessionId} must not retain a participant token`);
    else {
      if (requiresTenant && !validTenant(entry[1].tenantId)) errors.push(`Hosted participant token for session ${entry[1].sessionId} must declare a valid tenant`);
      if ((entry[1].tenantId || 'default') !== sessionTenants.get(entry[1].sessionId)) errors.push(`Hosted participant token for session ${entry[1].sessionId} tenant does not match its session`);
    }
  }
  const launchLinkIds = new Set();
  for (const link of state.launchLinks || []) {
    if (!link.launchLinkId || launchLinkIds.has(link.launchLinkId)) errors.push('Hosted launch link IDs must be present and unique');
    launchLinkIds.add(link.launchLinkId);
    if (!deploymentIds.has(link.deploymentId)) errors.push(`Hosted launch link ${link.launchLinkId || '(missing)'} references an unknown deployment`);
    if (requiresTenant && !validTenant(link.tenantId)) errors.push(`Hosted launch link ${link.launchLinkId || '(missing)'} must declare a valid tenant`);
    if (deploymentTenants.has(link.deploymentId) && (link.tenantId || 'default') !== deploymentTenants.get(link.deploymentId)) errors.push(`Hosted launch link ${link.launchLinkId || '(missing)'} tenant does not match its deployment`);
  }
  for (const entry of state.launchTokens || []) {
    if (!Array.isArray(entry) || entry.length !== 2 || !launchLinkIds.has(entry[1])) errors.push('Hosted launch tokens must reference a known launch link');
  }
  if (requiresTenant) {
    for (const entry of state.auditEntries || []) if (!validTenant(entry.tenantId)) errors.push(`Hosted audit entry ${entry.auditId || '(missing)'} must declare a valid tenant`);
  }
  if (state.credentialProtection) {
    const protection = state.credentialProtection;
    const primaryKeyId = protection.primaryKeyId;
    if (protection.schemaVersion !== '1.0.0' || protection.mode !== 'hmac-sha256+aes-256-gcm' || !new RegExp(`^${CREDENTIAL_KEY_ID}$`).test(primaryKeyId || '')) errors.push('Hosted credential protection metadata is invalid');
    const auditIntegrity = protection.auditIntegrity;
    if (auditIntegrity) {
      const anchorMatch = String(auditIntegrity.anchorDigest || '').match(credentialDigest);
      const headMatch = auditIntegrity.headDigest === null ? null : String(auditIntegrity.headDigest || '').match(credentialDigest);
      if (auditIntegrity.mode !== 'hmac-sha256-chain' || auditIntegrity.keyId !== primaryKeyId || !Number.isSafeInteger(auditIntegrity.entryCount) || auditIntegrity.entryCount < 0 || auditIntegrity.entryCount !== (state.auditEntries || []).length || anchorMatch?.[1] !== primaryKeyId || (auditIntegrity.entryCount === 0 ? auditIntegrity.headDigest !== null : headMatch?.[1] !== primaryKeyId)) errors.push('Hosted audit integrity metadata is invalid');
      let previousAuditDigest = null;
      for (const [index, entry] of (state.auditEntries || []).entries()) {
        const digestMatch = String(entry.auditDigest || '').match(credentialDigest);
        if (entry.sequence !== index + 1 || entry.previousAuditDigest !== previousAuditDigest || digestMatch?.[1] !== primaryKeyId) errors.push(`Hosted protected audit entry ${entry.auditId || index + 1} chain metadata is invalid`);
        previousAuditDigest = entry.auditDigest;
      }
      if (auditIntegrity.headDigest !== previousAuditDigest) errors.push('Hosted audit integrity head does not match its entries');
    } else if ((state.auditEntries || []).some(entry => Object.prototype.hasOwnProperty.call(entry, 'auditDigest') || Object.prototype.hasOwnProperty.call(entry, 'previousAuditDigest'))) errors.push('Hosted audit entries contain integrity fields without metadata');
    for (const session of state.sessions || []) {
      if (typeof session.participantAccessToken === 'string') errors.push(`Protected hosted session ${session.sessionId || '(missing)'} retains a plaintext credential field`);
      if (!session.dataPurgedAt) {
        const digestMatch = String(session.participantCredentialDigest || '').match(credentialDigest);
        const sealedMatch = String(session.participantCredentialCiphertext || '').match(sealedCredential);
        if (!digestMatch || !sealedMatch || digestMatch[1] !== primaryKeyId || sealedMatch[1] !== primaryKeyId) errors.push(`Protected hosted session ${session.sessionId || '(missing)'} credential metadata is invalid`);
      }
      validateProtectedCredentialFields(session.idempotency || [], primaryKeyId, errors, `session ${session.sessionId || '(missing)'} idempotency`);
    }
    for (const entry of state.participantTokens || []) {
      const digestMatch = String(entry?.[0] || '').match(credentialDigest);
      const sealedMatch = String(entry?.[1]?.credentialCiphertext || '').match(sealedCredential);
      if (!digestMatch || !sealedMatch || digestMatch[1] !== primaryKeyId || sealedMatch[1] !== primaryKeyId) errors.push('Hosted protected participant-token entry is invalid');
    }
    const links = new Map((state.launchLinks || []).map(link => [link.launchLinkId, link]));
    for (const entry of state.launchTokens || []) {
      const link = links.get(entry?.[1]);
      const digestMatch = String(entry?.[0] || '').match(credentialDigest);
      const linkDigest = String(link?.launchCredentialDigest || '').match(credentialDigest);
      const sealedMatch = String(link?.launchCredentialCiphertext || '').match(sealedCredential);
      if (!digestMatch || !linkDigest || !sealedMatch || digestMatch[1] !== primaryKeyId || linkDigest[1] !== primaryKeyId || sealedMatch[1] !== primaryKeyId || entry[0] !== link.launchCredentialDigest) errors.push('Hosted protected launch-token entry is invalid');
    }
    validateProtectedCredentialFields(state.idempotency || [], primaryKeyId, errors, 'service idempotency');
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
  const stored = await options.store.load();
  const restored = stored && options.stateProtector ? await options.stateProtector.unprotectState(stored) : stored;
  if (restored) {
    const check = validateHostedState(restored);
    if (!check.valid) throw new Error(`Invalid hosted state:\n${check.errors.join('\n')}`);
  }
  const service = new LocalHostedExecutionService({ ...options, state: restored || undefined });
  if (stored && options.stateProtector && (options.stateProtector.requiresRewrite?.(stored) ?? stored.credentialProtection?.primaryKeyId !== options.stateProtector.primaryKeyId)) {
    await options.store.save(await options.stateProtector.protectState(service.exportState()));
  }
  let tail = Promise.resolve();
  return new Proxy(service, {
    get(target, property) {
      const value = target[property];
      if (typeof value !== 'function') return value;
      if (property === 'exportState') return value.bind(target);
      if (MUTATIONS.has(property)) return (...args) => {
        const operation = tail.catch(() => undefined).then(async () => {
          const result = await value.apply(target, args);
          const exported = target.exportState();
          await options.store.save(options.stateProtector ? await options.stateProtector.protectState(exported) : exported);
          return result;
        });
        tail = operation;
        return operation;
      };
      return (...args) => tail.catch(() => undefined).then(() => value.apply(target, args));
    },
  });
}
