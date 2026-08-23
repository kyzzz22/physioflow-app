import { hashProtocolGraph } from '../core/index.js';

export const PARTICIPANT_BOOTSTRAP_SCHEMA_VERSION = '1.0.0';

function clone(value) { return value === undefined ? undefined : structuredClone(value); }

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(item => item.toString(16).padStart(2, '0')).join('');
}

function unsigned(bootstrap) {
  const next = clone(bootstrap);
  delete next.bootstrapHash;
  return next;
}

function safeDeliveryUrl(value) {
  if (!value) return null;
  try {
    const url = new globalThis.URL(value);
    if (url.protocol === 'https:') return url.toString();
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return url.toString();
  } catch { /* invalid URL */ }
  return null;
}

export function resolveParticipantResourceUrl(resources, { assetId = null, nodeId = null, fallbackUrl = '' } = {}) {
  if (!Array.isArray(resources)) return fallbackUrl;
  const resource = assetId
    ? resources.find(item => item.assetId === assetId)
    : resources.find(item => item.nodeId === nodeId);
  if (!resource || resource.status !== 'ready') return '';
  return safeDeliveryUrl(resource.delivery?.url) || '';
}

function protocolResources(protocol) {
  const resources = (protocol.assets || []).map(asset => ({
    resourceId: `asset:${asset.id || asset.assetId}`,
    kind: 'asset',
    assetId: asset.id || asset.assetId,
    nodeId: null,
    name: asset.name || asset.fileName || '',
    mediaType: asset.mediaType || asset.type || null,
    checksum: asset.checksum || asset.hash || null,
    sourceUrl: asset.sourceUrl || asset.url || null,
    asset: clone(asset),
  }));
  for (const node of protocol.graph?.nodes || []) {
    const sourceUrl = node.config?.sourceUrl;
    if (!sourceUrl || node.config?.assetId) continue;
    resources.push({ resourceId: `node:${node.id}:source`, kind: 'external-media', assetId: null, nodeId: node.id, name: node.label || node.id, mediaType: node.config?.mediaType || null, checksum: null, sourceUrl, asset: null });
  }
  return resources;
}

async function resolveResource(resource, deployment, assetResolver) {
  const directUrl = safeDeliveryUrl(resource.sourceUrl);
  if (directUrl) return { resourceId: resource.resourceId, kind: resource.kind, assetId: resource.assetId, nodeId: resource.nodeId, name: resource.name, mediaType: resource.mediaType, checksum: resource.checksum, status: 'ready', delivery: { mode: 'external', url: directUrl, expiresAt: null } };
  if (resource.sourceUrl) return { resourceId: resource.resourceId, kind: resource.kind, assetId: resource.assetId, nodeId: resource.nodeId, name: resource.name, mediaType: resource.mediaType, checksum: resource.checksum, status: 'unavailable', reason: 'unsafe_or_unsupported_url', delivery: null };
  if (resource.asset && assetResolver) {
    try {
      const resolved = await assetResolver(clone(resource.asset), { deploymentId: deployment.deploymentId, bundleId: deployment.bundleId, protocolId: deployment.protocolId });
      const url = safeDeliveryUrl(resolved?.url);
      if (url) return { resourceId: resource.resourceId, kind: resource.kind, assetId: resource.assetId, nodeId: resource.nodeId, name: resource.name, mediaType: resource.mediaType, checksum: resolved.checksum || resource.checksum, status: 'ready', delivery: { mode: resolved.mode || 'signed', url, expiresAt: resolved.expiresAt || null } };
    } catch { /* expose availability, not provider internals */ }
  }
  return { resourceId: resource.resourceId, kind: resource.kind, assetId: resource.assetId, nodeId: resource.nodeId, name: resource.name, mediaType: resource.mediaType, checksum: resource.checksum, status: 'unavailable', reason: 'asset_delivery_unavailable', delivery: null };
}

export async function createParticipantBootstrap({ deployment, session, assetResolver, issuedAt, bootstrapId }) {
  const protocol = deployment?.bundle?.protocol?.snapshot;
  if (!deployment || !session || !protocol) throw new Error('Participant bootstrap requires deployment, session and protocol snapshot');
  if (session.deploymentId !== deployment.deploymentId || session.protocolId !== deployment.protocolId || session.protocolVersion !== deployment.protocolVersion || session.configHash !== deployment.configHash) throw new Error('Participant session does not match its deployment');
  if (protocol.freeze?.configHash !== deployment.configHash || await hashProtocolGraph(protocol) !== deployment.configHash) throw new Error('Participant protocol snapshot integrity check failed');
  const resources = [];
  for (const resource of protocolResources(protocol)) resources.push(await resolveResource(resource, deployment, assetResolver));
  const bootstrap = {
    schemaVersion: PARTICIPANT_BOOTSTRAP_SCHEMA_VERSION,
    bootstrapId: bootstrapId || `participant_bootstrap_${globalThis.crypto.randomUUID()}`,
    issuedAt: issuedAt || new Date().toISOString(),
    session: {
      sessionId: session.sessionId,
      participantId: session.participantId,
      deploymentId: session.deploymentId,
      protocolId: session.protocolId,
      protocolVersion: session.protocolVersion,
      configHash: session.configHash,
    },
    deployment: {
      deploymentId: deployment.deploymentId,
      bundleId: deployment.bundleId,
      bundleHash: deployment.bundleHash,
      providerId: deployment.providerId,
      environment: deployment.environment,
    },
    protocol: clone(protocol),
    dependencies: clone(deployment.bundle.dependencies || {}),
    resources,
    recovery: session.runtimeSnapshot && session.runtimeSnapshot.eventSequence === session.nextEventSequence - 1
      ? { runtime: clone(session.runtimeSnapshot), events: clone(session.events || []) }
      : null,
  };
  bootstrap.bootstrapHash = await sha256(bootstrap);
  return bootstrap;
}

export async function validateParticipantBootstrap(bootstrap) {
  const errors = [];
  if (!bootstrap || typeof bootstrap !== 'object') return { valid: false, errors: ['Participant bootstrap must be an object'] };
  if (bootstrap.schemaVersion !== PARTICIPANT_BOOTSTRAP_SCHEMA_VERSION) errors.push(`Unsupported participant bootstrap version ${bootstrap.schemaVersion || '(missing)'}`);
  if (!bootstrap.bootstrapId || !bootstrap.issuedAt) errors.push('Participant bootstrap identity and issue time are required');
  if (!bootstrap.session?.sessionId || !bootstrap.session?.deploymentId || !bootstrap.session?.protocolId || !Number.isInteger(bootstrap.session?.protocolVersion)) errors.push('Participant session identity is incomplete');
  if (bootstrap.protocol?.protocolId !== bootstrap.session?.protocolId || bootstrap.protocol?.version?.number !== bootstrap.session?.protocolVersion) errors.push('Participant protocol identity does not match the session');
  if (bootstrap.protocol) {
    const protocolHash = await hashProtocolGraph(bootstrap.protocol);
    if (protocolHash !== bootstrap.session?.configHash || bootstrap.protocol.freeze?.configHash !== bootstrap.session?.configHash) errors.push('Participant protocol hash does not match the session');
  }
  const ids = new Set();
  for (const resource of bootstrap.resources || []) {
    if (!resource.resourceId || ids.has(resource.resourceId)) errors.push('Participant resource IDs must be present and unique');
    ids.add(resource.resourceId);
    if (!['ready', 'unavailable'].includes(resource.status)) errors.push(`Participant resource ${resource.resourceId || '(missing)'} has invalid status`);
    if (resource.status === 'ready' && !safeDeliveryUrl(resource.delivery?.url)) errors.push(`Participant resource ${resource.resourceId || '(missing)'} has an unsafe delivery URL`);
  }
  if (bootstrap.recovery) {
    const runtime = bootstrap.recovery.runtime;
    const events = bootstrap.recovery.events;
    if (runtime?.sessionId !== bootstrap.session?.sessionId || runtime?.protocolId !== bootstrap.session?.protocolId || runtime?.protocolVersion !== bootstrap.session?.protocolVersion) errors.push('Participant recovery snapshot does not match the session');
    if (!Array.isArray(events) || events.some((event, index) => event.sequence !== index + 1 || event.sessionId !== bootstrap.session?.sessionId) || (events.at(-1)?.sequence ?? 0) !== runtime?.eventSequence) errors.push('Participant recovery events do not match the runtime snapshot');
  }
  if (!bootstrap.bootstrapHash?.match(/^[a-f0-9]{64}$/) || await sha256(unsigned(bootstrap)) !== bootstrap.bootstrapHash) errors.push('Participant bootstrap content does not match its hash');
  return { valid: errors.length === 0, errors };
}
