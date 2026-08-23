import { hashProtocolGraph } from '../core/freezeProtocolGraph.js';

export const DEPLOYMENT_BUNDLE_SCHEMA_VERSION = '1.0.0';
export const EXECUTION_PROVIDER_CONTRACT_VERSION = '1.0.0';

const PROVIDER_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

async function sha256(value) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable');
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(item => item.toString(16).padStart(2, '0')).join('');
}

function unsignedBundle(bundle) {
  const next = structuredClone(bundle);
  delete next.bundleHash;
  return next;
}

function dependencyManifest(protocol) {
  return {
    assets: (protocol.assets || []).map(asset => ({
      id: asset.id || asset.assetId,
      name: asset.name || asset.fileName || '',
      mediaType: asset.mediaType || asset.type || null,
      checksum: asset.checksum || asset.hash || null,
      source: asset.sourceUrl ? 'remote' : 'workspace',
    })),
    componentPackages: (protocol.componentPackages || []).map(item => ({ packageId: item.packageId, version: item.version, approvedPermissions: [...(item.approvedPermissions || [])] })),
    deviceConnectors: (protocol.deviceConnectors || []).map(item => ({ connectorId: item.connectorId, version: item.version, transport: item.transport, approvedPermissions: [...(item.approvedPermissions || [])] })),
  };
}

export async function createDeploymentBundle(protocol, options = {}) {
  if (protocol?.version?.status !== 'frozen' || !protocol.freeze?.configHash) throw new Error('Deployment requires a frozen Protocol Graph');
  const actualHash = await hashProtocolGraph(protocol);
  if (actualHash !== protocol.freeze.configHash) throw new Error('Frozen protocol configuration no longer matches its hash');
  const providerId = options.providerId || 'org.physioflow.portable';
  if (!PROVIDER_ID.test(providerId)) throw new Error('Deployment provider ID must use lowercase dot/dash notation');
  if (options.maximumSessions !== undefined && options.maximumSessions !== null && (!Number.isInteger(options.maximumSessions) || options.maximumSessions < 1)) throw new Error('Deployment maximum sessions must be a positive integer');
  if (options.expiresAt && !Number.isFinite(Date.parse(options.expiresAt))) throw new Error('Deployment expiry must be a valid timestamp');
  const bundle = {
    schemaVersion: DEPLOYMENT_BUNDLE_SCHEMA_VERSION,
    bundleId: options.bundleId || `deployment_${globalThis.crypto.randomUUID()}`,
    createdAt: options.createdAt || new Date().toISOString(),
    createdBy: options.createdBy || 'local-operator',
    target: {
      providerId,
      environment: options.environment || 'portable',
      region: options.region || null,
    },
    protocol: {
      projectId: protocol.projectId,
      protocolId: protocol.protocolId,
      version: protocol.version.number,
      configHash: protocol.freeze.configHash,
      dataContractVersion: protocol.freeze.dataContractVersion,
      snapshot: structuredClone(protocol),
    },
    dependencies: dependencyManifest(protocol),
    executionPolicy: {
      mode: options.mode || 'participant-browser',
      maximumSessions: options.maximumSessions ?? null,
      expiresAt: options.expiresAt || null,
    },
  };
  bundle.bundleHash = await sha256(bundle);
  return bundle;
}

export async function validateDeploymentBundle(bundle) {
  const errors = [];
  if (!bundle || typeof bundle !== 'object') return { valid: false, errors: ['Deployment bundle must be an object'] };
  if (bundle.schemaVersion !== DEPLOYMENT_BUNDLE_SCHEMA_VERSION) errors.push(`Unsupported deployment bundle version ${bundle.schemaVersion || '(missing)'}`);
  if (!bundle.bundleId?.trim()) errors.push('Deployment bundle ID is required');
  if (!PROVIDER_ID.test(bundle.target?.providerId || '')) errors.push('Deployment provider ID is invalid');
  if (!bundle.protocol?.projectId || !bundle.protocol?.protocolId || !Number.isInteger(bundle.protocol?.version)) errors.push('Deployment protocol identity is incomplete');
  if (!bundle.protocol?.configHash?.match(/^[a-f0-9]{64}$/)) errors.push('Deployment protocol hash is invalid');
  if (!bundle.protocol?.snapshot || bundle.protocol.snapshot.version?.status !== 'frozen') errors.push('Deployment protocol snapshot must be frozen');
  if (bundle.protocol?.snapshot) {
    if (bundle.protocol.snapshot.projectId !== bundle.protocol.projectId || bundle.protocol.snapshot.protocolId !== bundle.protocol.protocolId || bundle.protocol.snapshot.version?.number !== bundle.protocol.version) errors.push('Deployment protocol identity does not match the snapshot');
    const actualProtocolHash = await hashProtocolGraph(bundle.protocol.snapshot);
    if (actualProtocolHash !== bundle.protocol.configHash || bundle.protocol.snapshot.freeze?.configHash !== bundle.protocol.configHash) errors.push('Deployment protocol snapshot hash does not match the manifest');
    if (JSON.stringify(canonical(bundle.dependencies || {})) !== JSON.stringify(canonical(dependencyManifest(bundle.protocol.snapshot)))) errors.push('Deployment dependency manifest does not match the protocol snapshot');
  }
  if (!bundle.bundleHash?.match(/^[a-f0-9]{64}$/)) errors.push('Deployment bundle hash is invalid');
  else if (await sha256(unsignedBundle(bundle)) !== bundle.bundleHash) errors.push('Deployment bundle content does not match its hash');
  if (bundle.executionPolicy?.maximumSessions !== null && bundle.executionPolicy?.maximumSessions !== undefined && (!Number.isInteger(bundle.executionPolicy.maximumSessions) || bundle.executionPolicy.maximumSessions < 1)) errors.push('Deployment maximum sessions must be a positive integer');
  if (bundle.executionPolicy?.expiresAt && !Number.isFinite(Date.parse(bundle.executionPolicy.expiresAt))) errors.push('Deployment expiry must be a valid timestamp');
  return { valid: errors.length === 0, errors };
}

export function validateExecutionProvider(provider) {
  const errors = [];
  if (!provider || typeof provider !== 'object') return { valid: false, errors: ['Execution provider must be an object'] };
  if (provider.contractVersion !== EXECUTION_PROVIDER_CONTRACT_VERSION) errors.push(`Unsupported execution provider contract ${provider.contractVersion || '(missing)'}`);
  if (!PROVIDER_ID.test(provider.providerId || '')) errors.push('Execution provider ID is invalid');
  if (!SEMVER.test(provider.version || '')) errors.push('Execution provider version must use semantic versioning');
  if (!provider.name?.trim()) errors.push('Execution provider name is required');
  if (typeof provider.submit !== 'function' || typeof provider.status !== 'function' || typeof provider.cancel !== 'function') errors.push('Execution provider must implement submit, status and cancel');
  return { valid: errors.length === 0, errors };
}

export class ExecutionProviderRegistry {
  constructor() { this.providers = new Map(); }

  register(provider) {
    const check = validateExecutionProvider(provider);
    if (!check.valid) throw new Error(`Invalid execution provider:\n${check.errors.join('\n')}`);
    const key = `${provider.providerId}@${provider.version}`;
    if (this.providers.has(key)) throw new Error(`Execution provider ${key} is already registered`);
    this.providers.set(key, provider);
    return this;
  }

  get(providerId, version) { return this.providers.get(`${providerId}@${version}`) || null; }

  list() { return [...this.providers.values()].map(item => ({ providerId: item.providerId, version: item.version, name: item.name })); }
}

export function createInMemoryExecutionProvider(options = {}) {
  const jobs = new Map();
  let sequence = 0;
  const now = options.now || (() => new Date().toISOString());
  return {
    contractVersion: EXECUTION_PROVIDER_CONTRACT_VERSION,
    providerId: 'org.physioflow.local-memory',
    version: '1.0.0',
    name: 'Local in-memory execution provider',
    async submit(bundle, request = {}) {
      const check = await validateDeploymentBundle(bundle);
      if (!check.valid) throw new Error(`Invalid deployment bundle:\n${check.errors.join('\n')}`);
      const jobId = request.jobId || `execution_job_${++sequence}`;
      const job = { jobId, status: 'queued', submittedAt: now(), updatedAt: now(), bundleId: bundle.bundleId, protocolId: bundle.protocol.protocolId, participantId: request.participantId || null };
      jobs.set(jobId, job);
      return structuredClone(job);
    },
    async status(jobId) {
      const job = jobs.get(jobId);
      if (!job) throw new Error(`Unknown execution job ${jobId}`);
      return structuredClone(job);
    },
    async cancel(jobId) {
      const job = jobs.get(jobId);
      if (!job) throw new Error(`Unknown execution job ${jobId}`);
      if (['completed', 'failed', 'cancelled'].includes(job.status)) return structuredClone(job);
      const cancelled = { ...job, status: 'cancelled', updatedAt: now() };
      jobs.set(jobId, cancelled);
      return structuredClone(cancelled);
    },
  };
}
