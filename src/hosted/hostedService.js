import { validateDeploymentBundle } from '../deployment/index.js';
import { createParticipantBootstrap } from './participantBootstrap.js';

export const HOSTED_SERVICE_CONTRACT_VERSION = '1.0.0';
export const HOSTED_STATE_SCHEMA_VERSION = '1.2.0';
export const HOSTED_DATA_EXPORT_SCHEMA_VERSION = '1.0.0';
export const DEFAULT_HOSTED_TENANT_ID = 'default';
const LEGACY_HOSTED_STATE_SCHEMA_VERSIONS = new Set(['1.0.0', '1.1.0']);
const TENANT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const ROLE_PERMISSIONS = Object.freeze({
  owner: ['deployment.publish', 'deployment.read', 'deployment.manage', 'deployment.asset.write', 'session.start', 'session.read', 'session.bootstrap', 'session.manage', 'data.ingest', 'data.read', 'data.purge', 'audit.read'],
  editor: ['deployment.publish', 'deployment.read', 'deployment.asset.write', 'session.read'],
  operator: ['deployment.read', 'deployment.manage', 'deployment.asset.write', 'session.start', 'session.read', 'session.bootstrap', 'session.manage', 'data.ingest', 'data.read'],
  analyst: ['deployment.read', 'session.read', 'data.read'],
  viewer: ['deployment.read', 'session.read'],
});

const TERMINAL_SESSION_STATES = new Set(['completed', 'failed', 'cancelled']);

function clone(value) { return value === undefined ? undefined : structuredClone(value); }

function tenantIdOf(record) { return record?.tenantId || DEFAULT_HOSTED_TENANT_ID; }

function publicDeployment(record) {
  const next = clone(record);
  delete next.bundle;
  return next;
}

function publicSession(record) {
  const next = clone(record);
  delete next.participantAccessToken;
  delete next.idempotency;
  delete next.events;
  return next;
}

function publicLaunchLink(record) {
  const next = clone(record);
  delete next.launchToken;
  return next;
}

function expired(expiresAt, now) {
  return Boolean(expiresAt && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) <= Date.parse(now));
}

function sessionExportIntegrity(session) {
  const issues = [];
  if (session.eventCount !== session.events.length) issues.push(`Session ${session.sessionId} event count does not match stored events`);
  const eventIds = new Set();
  session.events.forEach((event, index) => {
    if (event.sequence !== index + 1) issues.push(`Session ${session.sessionId} event sequence is not contiguous at ${index + 1}`);
    if (!event.eventId || eventIds.has(event.eventId)) issues.push(`Session ${session.sessionId} has a duplicate or missing event ID at ${index + 1}`);
    eventIds.add(event.eventId);
  });
  if (session.runtimeSnapshot && session.runtimeSnapshot.eventSequence !== session.events.length) issues.push(`Session ${session.sessionId} snapshot sequence does not match stored events`);
  return issues;
}

function retentionTimestamp(value, label) {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new Error(`${label} must be a valid timestamp`);
  return epoch;
}

function redactAuditForSession(entries, sessionId) {
  return entries.map(entry => {
    if (entry.resource?.sessionId !== sessionId) return entry;
    const participantActor = entry.actor?.kind === 'participant' && entry.actor.id !== null;
    const participantDetail = Object.prototype.hasOwnProperty.call(entry.detail || {}, 'participantId') && entry.detail.participantId !== null;
    if (!participantActor && !participantDetail) return entry;
    return Object.freeze({
      ...entry,
      actor: participantActor ? { ...entry.actor, id: null, identityPurged: true } : entry.actor,
      detail: participantDetail ? { ...entry.detail, participantId: null, identityPurged: true } : entry.detail,
    });
  });
}

function redactIdempotencyResult(value, sessionId, purgedAt) {
  const result = value?.result;
  const direct = result?.sessionId === sessionId;
  const nested = result?.session?.sessionId === sessionId;
  if (!direct && !nested) return value;
  const sanitizedSession = session => ({ ...session, participantId: null, participantAccessToken: null, dataPurgedAt: purgedAt });
  return {
    ...value,
    fingerprint: '[purged]',
    purged: true,
    result: direct ? sanitizedSession(result) : { ...result, session: sanitizedSession(result.session) },
  };
}

function validateActor(actor) {
  if (!actor?.actorId?.trim()) throw new Error('Hosted actor ID is required');
  if (!ROLE_PERMISSIONS[actor.role]) throw new Error(`Unsupported hosted role ${actor.role}`);
  if (!actor.accessToken?.trim()) throw new Error('Hosted actor access token is required');
  if (actor.tenantId !== undefined && (!TENANT_ID.test(actor.tenantId) || actor.tenantId !== actor.tenantId.trim())) throw new Error('Hosted actor tenant ID is invalid');
}

export class LocalHostedExecutionService {
  constructor(options = {}) {
    this.clock = options.clock || (() => new Date().toISOString());
    this.idFactory = options.idFactory || (prefix => `${prefix}_${globalThis.crypto.randomUUID()}`);
    this.assetResolver = options.assetResolver || null;
    this.actors = new Map();
    this.participantTokens = new Map();
    this.deployments = new Map();
    this.sessions = new Map();
    this.launchLinks = new Map();
    this.launchTokens = new Map();
    this.idempotency = new Map();
    this.auditEntries = [];
    for (const actor of options.actors || []) {
      validateActor(actor);
      if (this.actors.has(actor.accessToken)) throw new Error('Hosted actor access tokens must be unique');
      this.actors.set(actor.accessToken, { actorId: actor.actorId, role: actor.role, tenantId: actor.tenantId || DEFAULT_HOSTED_TENANT_ID });
    }
    if (options.state) this.restoreState(options.state);
  }

  restoreState(state) {
    if (state?.schemaVersion !== HOSTED_STATE_SCHEMA_VERSION && !LEGACY_HOSTED_STATE_SCHEMA_VERSIONS.has(state?.schemaVersion)) throw new Error(`Unsupported hosted state version ${state?.schemaVersion || '(missing)'}`);
    const legacy = LEGACY_HOSTED_STATE_SCHEMA_VERSIONS.has(state.schemaVersion);
    this.deployments = new Map((state.deployments || []).map(record => [record.deploymentId, { ...clone(record), tenantId: tenantIdOf(record), assetNamespaceVersion: record.assetNamespaceVersion || (legacy ? 1 : 2) }]));
    this.sessions = new Map((state.sessions || []).map(record => {
      const session = { ...clone(record), tenantId: tenantIdOf(record) };
      session.idempotency = new Map(record.idempotency || []);
      return [session.sessionId, session];
    }));
    this.participantTokens = new Map((state.participantTokens || []).map(([token, record]) => [token, { ...clone(record), tenantId: tenantIdOf(record) }]));
    this.launchLinks = new Map((state.launchLinks || []).map(record => [record.launchLinkId, { ...clone(record), tenantId: tenantIdOf(record) }]));
    this.launchTokens = new Map(clone(state.launchTokens || []));
    this.idempotency = new Map((state.idempotency || []).map(([key, value]) => [legacy ? `${DEFAULT_HOSTED_TENANT_ID}:${key}` : key, clone(value)]));
    this.auditEntries = (state.auditEntries || []).map(entry => ({ ...clone(entry), tenantId: tenantIdOf(entry) }));
  }

  exportState() {
    return {
      schemaVersion: HOSTED_STATE_SCHEMA_VERSION,
      deployments: [...this.deployments.values()].map(clone),
      sessions: [...this.sessions.values()].map(record => ({ ...clone(record), idempotency: [...record.idempotency.entries()].map(clone) })),
      participantTokens: [...this.participantTokens.entries()].map(clone),
      launchLinks: [...this.launchLinks.values()].map(clone),
      launchTokens: [...this.launchTokens.entries()].map(clone),
      idempotency: [...this.idempotency.entries()].map(clone),
      auditEntries: this.auditEntries.map(clone),
    };
  }

  authorize(context, permission, sessionId = null) {
    const actor = this.actors.get(context?.accessToken);
    if (actor && ROLE_PERMISSIONS[actor.role].includes(permission)) return { kind: 'actor', ...actor };
    const participant = this.participantTokens.get(context?.accessToken);
    if (participant?.active !== false && participant?.sessionId === sessionId && ['session.read', 'session.bootstrap', 'session.manage', 'data.ingest'].includes(permission)) return { kind: 'participant', actorId: participant.participantId, role: 'participant', tenantId: tenantIdOf(participant) };
    throw new Error(`Hosted permission ${permission} is required`);
  }

  authorizeDeployment(context, permission, deploymentId) {
    const actor = this.authorize(context, permission);
    const deployment = this.deployments.get(deploymentId);
    if (!deployment || actor.kind !== 'actor' || actor.tenantId !== tenantIdOf(deployment)) throw new Error(`Unknown hosted deployment ${deploymentId}`);
    return { actor, deployment };
  }

  authorizeSession(context, permission, sessionId) {
    const actor = this.authorize(context, permission, sessionId);
    const session = this.sessions.get(sessionId);
    if (!session || (actor.kind === 'actor' && actor.tenantId !== tenantIdOf(session))) throw new Error(`Unknown hosted session ${sessionId}`);
    return { actor, session };
  }

  tenantForContext(context = {}) {
    return this.actors.get(context.accessToken)?.tenantId || this.participantTokens.get(context.accessToken)?.tenantId || null;
  }

  audit(action, actor, resource = {}, detail = {}) {
    const entry = Object.freeze({
      auditId: this.idFactory('audit'),
      sequence: this.auditEntries.length + 1,
      occurredAt: this.clock(),
      tenantId: actor.tenantId || DEFAULT_HOSTED_TENANT_ID,
      action,
      actor: { id: actor.actorId, role: actor.role, kind: actor.kind },
      resource: clone(resource),
      detail: clone(detail),
    });
    this.auditEntries.push(entry);
    return entry;
  }

  idempotent(actor, scope, key, fingerprint, create) {
    if (!key?.trim()) throw new Error(`${scope} requires an idempotency key`);
    const tenantId = actor.tenantId || DEFAULT_HOSTED_TENANT_ID;
    const idempotencyKey = JSON.stringify([tenantId, actor.actorId, scope, key]);
    const legacyKey = `${tenantId}:${actor.actorId}:${scope}:${key}`;
    const storedKey = this.idempotency.has(idempotencyKey) ? idempotencyKey : this.idempotency.has(legacyKey) ? legacyKey : null;
    if (storedKey) {
      const previous = this.idempotency.get(storedKey);
      if (previous.purged) return clone(previous.result);
      if (previous.fingerprint !== fingerprint) throw new Error(`${scope} idempotency key was already used with different content`);
      return clone(previous.result);
    }
    const result = create();
    this.idempotency.set(idempotencyKey, { fingerprint, result: clone(result) });
    return result;
  }

  deploymentView(record) {
    const view = publicDeployment(record);
    if (view.status === 'ready' && expired(view.expiresAt, this.clock())) view.status = 'expired';
    return view;
  }

  requireAcceptingSessions(deployment) {
    const status = this.deploymentView(deployment).status;
    if (status !== 'ready') throw new Error(`Hosted deployment ${deployment.deploymentId} is ${status}`);
    if (deployment.maximumSessions !== null && deployment.maximumSessions !== undefined && deployment.sessionCount >= deployment.maximumSessions) throw new Error(`Hosted deployment ${deployment.deploymentId} session quota is exhausted`);
  }

  createSessionRecord(deployment, request, actor) {
    this.requireAcceptingSessions(deployment);
    const now = this.clock();
    const sessionId = this.idFactory('hosted_session');
    const participantId = request.participantId || this.idFactory('participant');
    const participantAccessToken = this.idFactory('participant_token');
    const record = {
      contractVersion: HOSTED_SERVICE_CONTRACT_VERSION,
      sessionId,
      deploymentId: deployment.deploymentId,
      tenantId: tenantIdOf(deployment),
      projectId: deployment.projectId,
      protocolId: deployment.protocolId,
      protocolVersion: deployment.protocolVersion,
      configHash: deployment.configHash,
      participantId,
      participantAccessToken,
      launchLinkId: request.launchLinkId || null,
      status: 'ready',
      revision: 1,
      nextEventSequence: 1,
      eventCount: 0,
      runtimeSnapshot: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.actorId,
      events: [],
      idempotency: new Map(),
    };
    this.sessions.set(sessionId, record);
    this.participantTokens.set(participantAccessToken, { sessionId, participantId, active: true, tenantId: tenantIdOf(deployment) });
    this.deployments.set(deployment.deploymentId, { ...deployment, sessionCount: deployment.sessionCount + 1, updatedAt: now });
    this.audit('session.created', actor, { deploymentId: deployment.deploymentId, sessionId }, { participantId, launchLinkId: request.launchLinkId || null });
    return { ...publicSession(record), participantAccessToken };
  }

  async publishDeployment(bundle, options = {}, context = {}) {
    const actor = this.authorize(context, 'deployment.publish');
    const check = await validateDeploymentBundle(bundle);
    if (!check.valid) throw new Error(`Invalid deployment bundle:\n${check.errors.join('\n')}`);
    return this.idempotent(actor, 'deployment.publish', options.idempotencyKey, bundle.bundleHash, () => {
      const now = this.clock();
      const deploymentId = this.idFactory('hosted_deployment');
      const record = {
        contractVersion: HOSTED_SERVICE_CONTRACT_VERSION,
        deploymentId,
        tenantId: actor.tenantId,
        assetNamespaceVersion: 2,
        bundleId: bundle.bundleId,
        bundleHash: bundle.bundleHash,
        projectId: bundle.protocol.projectId,
        protocolId: bundle.protocol.protocolId,
        protocolVersion: bundle.protocol.version,
        configHash: bundle.protocol.configHash,
        providerId: bundle.target.providerId,
        environment: bundle.target.environment,
        status: 'queued',
        revision: 1,
        queuedAt: now,
        updatedAt: now,
        publishedBy: actor.actorId,
        sessionCount: 0,
        maximumSessions: bundle.executionPolicy?.maximumSessions ?? null,
        expiresAt: bundle.executionPolicy?.expiresAt || null,
        dataRetentionDays: bundle.executionPolicy?.dataRetentionDays ?? null,
        bundle: clone(bundle),
      };
      this.deployments.set(deploymentId, record);
      this.audit('deployment.published', actor, { deploymentId }, { bundleId: bundle.bundleId, bundleHash: bundle.bundleHash });
      return publicDeployment(record);
    });
  }

  getDeployment(deploymentId, context = {}) {
    const { deployment: record } = this.authorizeDeployment(context, 'deployment.read', deploymentId);
    return this.deploymentView(record);
  }

  recordDeploymentAsset(deploymentId, asset, context = {}) {
    const { actor, deployment } = this.authorizeDeployment(context, 'deployment.asset.write', deploymentId);
    if (deployment.status !== 'queued') throw new Error(`Hosted deployment ${deploymentId} is ${deployment.status}`);
    const declared = deployment.bundle.dependencies?.assets?.find(item => item.id === asset?.assetId && item.source === 'workspace');
    if (!declared) throw new Error(`Hosted deployment asset ${asset?.assetId || '(missing)'} is not a declared workspace asset`);
    if (declared.checksum && asset.checksum !== declared.checksum) throw new Error(`Hosted deployment asset ${asset.assetId} checksum does not match its manifest`);
    this.audit('deployment.asset_uploaded', actor, { deploymentId, assetId: asset.assetId }, { checksum: asset.checksum || null, size: asset.size, mediaType: asset.mediaType || null });
    return clone(asset);
  }

  processNextDeployment(context = {}) {
    const actor = this.authorize(context, 'deployment.manage');
    const record = [...this.deployments.values()].find(item => tenantIdOf(item) === actor.tenantId && item.status === 'queued');
    if (!record) return null;
    const next = { ...record, status: 'ready', revision: record.revision + 1, updatedAt: this.clock(), readyAt: this.clock() };
    this.deployments.set(record.deploymentId, next);
    this.audit('deployment.ready', actor, { deploymentId: record.deploymentId }, { revision: next.revision });
    return this.deploymentView(next);
  }

  nextQueuedDeployment(context = {}) {
    const actor = this.authorize(context, 'deployment.manage');
    const record = [...this.deployments.values()].find(item => tenantIdOf(item) === actor.tenantId && item.status === 'queued');
    return record ? clone(record) : null;
  }

  async createSession(deploymentId, request = {}, context = {}) {
    const { actor, deployment } = this.authorizeDeployment(context, 'session.start', deploymentId);
    return this.idempotent(actor, `session.start:${deploymentId}`, request.idempotencyKey, JSON.stringify({ participantId: request.participantId || null }), () => {
      return this.createSessionRecord(deployment, request, actor);
    });
  }

  deactivateDeployment(deploymentId, request = {}, context = {}) {
    const { actor, deployment } = this.authorizeDeployment(context, 'deployment.manage', deploymentId);
    return this.idempotent(actor, `deployment.deactivate:${deploymentId}`, request.idempotencyKey, String(request.expectedRevision), () => {
      if (deployment.status === 'deactivated') return this.deploymentView(deployment);
      if (request.expectedRevision !== deployment.revision) throw new Error(`Hosted deployment revision conflict: expected ${request.expectedRevision}, current ${deployment.revision}`);
      const next = { ...deployment, status: 'deactivated', revision: deployment.revision + 1, deactivatedAt: this.clock(), updatedAt: this.clock() };
      this.deployments.set(deploymentId, next);
      this.audit('deployment.deactivated', actor, { deploymentId }, { revision: next.revision });
      return this.deploymentView(next);
    });
  }

  createLaunchLink(deploymentId, request = {}, context = {}) {
    const { actor, deployment } = this.authorizeDeployment(context, 'session.start', deploymentId);
    const maximumUses = request.maximumUses ?? 1;
    if (!Number.isInteger(maximumUses) || maximumUses < 1) throw new Error('Hosted launch link maximum uses must be a positive integer');
    if (request.expiresAt && !Number.isFinite(Date.parse(request.expiresAt))) throw new Error('Hosted launch link expiry must be a valid timestamp');
    return this.idempotent(actor, `launch-link.create:${deploymentId}`, request.idempotencyKey, JSON.stringify({ maximumUses, expiresAt: request.expiresAt || null }), () => {
      this.requireAcceptingSessions(deployment);
      if (request.expiresAt && expired(request.expiresAt, this.clock())) throw new Error('Hosted launch link expiry must be in the future');
      const launchLinkId = this.idFactory('launch_link');
      const launchToken = this.idFactory('launch_token');
      const now = this.clock();
      const record = {
        contractVersion: HOSTED_SERVICE_CONTRACT_VERSION,
        launchLinkId,
        deploymentId,
        tenantId: tenantIdOf(deployment),
        status: 'active',
        maximumUses,
        useCount: 0,
        expiresAt: request.expiresAt || deployment.expiresAt || null,
        createdAt: now,
        updatedAt: now,
        createdBy: actor.actorId,
        revision: 1,
      };
      this.launchLinks.set(launchLinkId, record);
      this.launchTokens.set(launchToken, launchLinkId);
      this.audit('launch_link.created', actor, { deploymentId, launchLinkId }, { maximumUses, expiresAt: record.expiresAt });
      return { ...publicLaunchLink(record), launchToken };
    });
  }

  revokeLaunchLink(launchLinkId, request = {}, context = {}) {
    const actor = this.authorize(context, 'deployment.manage');
    const link = this.launchLinks.get(launchLinkId);
    if (!link || actor.tenantId !== tenantIdOf(link)) throw new Error(`Unknown hosted launch link ${launchLinkId}`);
    return this.idempotent(actor, `launch-link.revoke:${launchLinkId}`, request.idempotencyKey, String(request.expectedRevision), () => {
      if (link.status === 'revoked') return publicLaunchLink(link);
      if (request.expectedRevision !== link.revision) throw new Error(`Hosted launch link revision conflict: expected ${request.expectedRevision}, current ${link.revision}`);
      const next = { ...link, status: 'revoked', revision: link.revision + 1, revokedAt: this.clock(), updatedAt: this.clock() };
      this.launchLinks.set(launchLinkId, next);
      this.audit('launch_link.revoked', actor, { deploymentId: link.deploymentId, launchLinkId }, { revision: next.revision });
      return publicLaunchLink(next);
    });
  }

  redeemLaunchLink(launchToken, request = {}) {
    const launchLinkId = this.launchTokens.get(launchToken);
    if (!launchLinkId) throw new Error('Unknown hosted launch token');
    const linkRecord = this.launchLinks.get(launchLinkId);
    const actor = { kind: 'launch_link', actorId: launchLinkId, role: 'participant', tenantId: tenantIdOf(linkRecord) };
    return this.idempotent(actor, `launch-link.redeem:${launchLinkId}`, request.idempotencyKey, JSON.stringify({ participantId: request.participantId || null }), () => {
      const link = this.launchLinks.get(launchLinkId);
      if (!link || link.status !== 'active') throw new Error(`Hosted launch link ${launchLinkId} is ${link?.status || 'unavailable'}`);
      if (expired(link.expiresAt, this.clock())) throw new Error(`Hosted launch link ${launchLinkId} is expired`);
      if (link.useCount >= link.maximumUses) throw new Error(`Hosted launch link ${launchLinkId} use quota is exhausted`);
      const deployment = this.deployments.get(link.deploymentId);
      if (!deployment) throw new Error(`Unknown hosted deployment ${link.deploymentId}`);
      const session = this.createSessionRecord(deployment, { ...request, launchLinkId }, actor);
      const next = { ...link, useCount: link.useCount + 1, revision: link.revision + 1, updatedAt: this.clock() };
      this.launchLinks.set(launchLinkId, next);
      this.audit('launch_link.redeemed', actor, { deploymentId: link.deploymentId, launchLinkId, sessionId: session.sessionId }, { useCount: next.useCount, maximumUses: next.maximumUses });
      return { session, launchLink: publicLaunchLink(next) };
    });
  }

  getSession(sessionId, context = {}) {
    const { session: record } = this.authorizeSession(context, 'session.read', sessionId);
    return publicSession(record);
  }

  async getParticipantBootstrap(sessionId, context = {}) {
    const { session } = this.authorizeSession(context, 'session.bootstrap', sessionId);
    if (TERMINAL_SESSION_STATES.has(session.status)) throw new Error(`Hosted session ${sessionId} is ${session.status}`);
    const deployment = this.deployments.get(session.deploymentId);
    if (!deployment) throw new Error(`Unknown hosted deployment ${session.deploymentId}`);
    return createParticipantBootstrap({ deployment, session, assetResolver: this.assetResolver, issuedAt: this.clock(), bootstrapId: this.idFactory('participant_bootstrap') });
  }

  appendEvents(sessionId, events, options = {}, context = {}) {
    const { actor, session: record } = this.authorizeSession(context, 'data.ingest', sessionId);
    if (!options.batchId?.trim()) throw new Error('Event ingestion requires a batch ID');
    const idempotencyKey = `events:${options.batchId}`;
    if (record.idempotency.has(idempotencyKey)) {
      const previous = record.idempotency.get(idempotencyKey);
      if (JSON.stringify(previous.events) !== JSON.stringify(events)) throw new Error(`Event batch ${options.batchId} was already used with different content`);
      return clone(previous.receipt);
    }
    if (TERMINAL_SESSION_STATES.has(record.status)) throw new Error(`Hosted session ${sessionId} is ${record.status}`);
    if (options.expectedRevision !== record.revision) throw new Error(`Hosted session revision conflict: expected ${options.expectedRevision}, current ${record.revision}`);
    if (!Array.isArray(events) || !events.length) throw new Error('Event ingestion requires a non-empty event batch');
    const eventIds = new Set(record.events.map(event => event.eventId));
    let expectedSequence = record.nextEventSequence;
    let previousElapsed = record.events.at(-1)?.elapsedMonotonicMs ?? -1;
    for (const event of events) {
      if (!event?.eventId || eventIds.has(event.eventId)) throw new Error(`Duplicate or missing event ID ${event?.eventId || '(missing)'}`);
      if (event.sessionId !== sessionId || event.protocolId !== record.protocolId || event.protocolVersion !== record.protocolVersion) throw new Error(`Event ${event.eventId} does not match the hosted session identity`);
      if (event.sequence !== expectedSequence) throw new Error(`Event sequence conflict: expected ${expectedSequence}, received ${event.sequence}`);
      if (event.schemaVersion !== '1.0.0' || !event.eventType || !Number.isFinite(event.timestampEpochMs) || !Number.isFinite(event.elapsedMonotonicMs)) throw new Error(`Event ${event.eventId} is incomplete`);
      if (event.elapsedMonotonicMs < previousElapsed) throw new Error(`Event ${event.eventId} moves backwards in monotonic time`);
      eventIds.add(event.eventId);
      previousElapsed = event.elapsedMonotonicMs;
      expectedSequence += 1;
    }
    const next = {
      ...record,
      status: record.status === 'ready' ? 'running' : record.status,
      revision: record.revision + 1,
      nextEventSequence: expectedSequence,
      eventCount: record.eventCount + events.length,
      events: [...record.events, ...clone(events)],
      updatedAt: this.clock(),
    };
    const receipt = { sessionId, batchId: options.batchId, accepted: events.length, firstSequence: events[0].sequence, lastSequence: events.at(-1).sequence, revision: next.revision };
    next.idempotency.set(idempotencyKey, { events: clone(events), receipt });
    this.sessions.set(sessionId, next);
    this.audit('session.events_appended', actor, { sessionId }, { batchId: options.batchId, accepted: events.length, lastSequence: receipt.lastSequence });
    return clone(receipt);
  }

  syncSessionState(sessionId, state, options = {}, context = {}) {
    const { actor, session: record } = this.authorizeSession(context, 'session.manage', sessionId);
    if (!options.syncId?.trim()) throw new Error('Runtime state synchronization requires a sync ID');
    const idempotencyKey = `state:${options.syncId}`;
    if (record.idempotency.has(idempotencyKey)) {
      const previous = record.idempotency.get(idempotencyKey);
      if (JSON.stringify(previous.state) !== JSON.stringify(state)) throw new Error(`Runtime state sync ${options.syncId} was already used with different content`);
      return publicSession(previous.result);
    }
    if (TERMINAL_SESSION_STATES.has(record.status)) throw new Error(`Hosted session ${sessionId} is ${record.status}`);
    if (options.expectedRevision !== record.revision) throw new Error(`Hosted session revision conflict: expected ${options.expectedRevision}, current ${record.revision}`);
    if (state?.sessionId !== sessionId || state?.protocolId !== record.protocolId || state?.protocolVersion !== record.protocolVersion) throw new Error('Runtime snapshot does not match the hosted session identity');
    if (state.eventSequence !== record.nextEventSequence - 1) throw new Error(`Runtime snapshot event sequence ${state.eventSequence} does not match ingested sequence ${record.nextEventSequence - 1}`);
    const nextStatus = state.status === 'paused' ? 'paused' : ['running', 'waiting'].includes(state.status) ? 'running' : record.status;
    const next = { ...record, status: nextStatus, revision: record.revision + 1, runtimeSnapshot: clone(state), updatedAt: this.clock() };
    const result = publicSession(next);
    next.idempotency.set(idempotencyKey, { state: clone(state), result });
    this.sessions.set(sessionId, next);
    this.audit('session.state_synced', actor, { sessionId }, { revision: next.revision, runtimeStatus: state.status });
    return result;
  }

  completeSession(sessionId, options = {}, context = {}) {
    const record = this.sessions.get(sessionId);
    if (!record) throw new Error(`Unknown hosted session ${sessionId}`);
    const credentialActor = this.actors.get(context?.accessToken);
    if (credentialActor && ROLE_PERMISSIONS[credentialActor.role].includes('session.manage') && credentialActor.tenantId !== tenantIdOf(record)) throw new Error(`Unknown hosted session ${sessionId}`);
    if (!options.completionId?.trim()) throw new Error('Session completion requires a completion ID');
    const outcome = options.outcome || 'completed';
    if (!['completed', 'failed'].includes(outcome)) throw new Error(`Unsupported hosted session outcome ${outcome}`);
    const idempotencyKey = `completion:${options.completionId}`;
    if (record.idempotency.has(idempotencyKey)) {
      const actor = this.actors.get(context?.accessToken);
      const participant = this.participantTokens.get(context?.accessToken);
      const actorAllowed = actor && ROLE_PERMISSIONS[actor.role].includes('session.manage') && actor.tenantId === tenantIdOf(record);
      if (!actorAllowed && participant?.sessionId !== sessionId) throw new Error('Hosted permission session.manage is required');
      const previous = record.idempotency.get(idempotencyKey);
      if (previous.outcome !== outcome) throw new Error(`Session completion ${options.completionId} was already used with a different outcome`);
      return publicSession(previous.result);
    }
    const { actor } = this.authorizeSession(context, 'session.manage', sessionId);
    if (options.expectedRevision !== record.revision) throw new Error(`Hosted session revision conflict: expected ${options.expectedRevision}, current ${record.revision}`);
    if (record.status === 'completed') return publicSession(record);
    if (TERMINAL_SESSION_STATES.has(record.status)) throw new Error(`Hosted session ${sessionId} is ${record.status}`);
    const next = { ...record, status: outcome, revision: record.revision + 1, completedAt: this.clock(), updatedAt: this.clock() };
    const result = publicSession(next);
    next.idempotency.set(idempotencyKey, { outcome, result });
    this.sessions.set(sessionId, next);
    this.participantTokens.set(record.participantAccessToken, { sessionId, participantId: record.participantId, active: false, tenantId: tenantIdOf(record) });
    this.audit(`session.${outcome}`, actor, { sessionId }, { eventCount: next.eventCount, revision: next.revision });
    return result;
  }

  retentionPlanFor(deployment, asOf) {
    const asOfEpoch = retentionTimestamp(asOf, 'Hosted retention plan as-of time');
    const days = deployment.dataRetentionDays;
    if (days === null || days === undefined) return { schemaVersion: '1.0.0', deploymentId: deployment.deploymentId, enabled: false, dataRetentionDays: null, asOf, cutoff: null, eligibleSessions: [], confirmationCode: null };
    const cutoffEpoch = asOfEpoch - days * 24 * 60 * 60 * 1000;
    const cutoff = new Date(cutoffEpoch).toISOString();
    const eligibleSessions = [...this.sessions.values()]
      .filter(session => session.deploymentId === deployment.deploymentId && TERMINAL_SESSION_STATES.has(session.status) && !session.dataPurgedAt && Number.isFinite(Date.parse(session.completedAt)) && Date.parse(session.completedAt) <= cutoffEpoch)
      .sort((a, b) => a.sessionId.localeCompare(b.sessionId))
      .map(session => ({ sessionId: session.sessionId, status: session.status, completedAt: session.completedAt, eventCount: session.eventCount, hasRuntimeSnapshot: Boolean(session.runtimeSnapshot) }));
    const confirmationCode = eligibleSessions.length ? `PURGE:${deployment.deploymentId}:${cutoff}:${eligibleSessions.map(session => session.sessionId).join(',')}` : null;
    return { schemaVersion: '1.0.0', deploymentId: deployment.deploymentId, enabled: true, dataRetentionDays: days, asOf, cutoff, eligibleSessions, confirmationCode };
  }

  planDataRetention(deploymentId, options = {}, context = {}) {
    const { deployment } = this.authorizeDeployment(context, 'data.purge', deploymentId);
    return this.retentionPlanFor(deployment, options.asOf || this.clock());
  }

  purgeExpiredSessionData(deploymentId, request = {}, context = {}) {
    const { actor, deployment } = this.authorizeDeployment(context, 'data.purge', deploymentId);
    if (!request.asOf) throw new Error('Hosted retention purge requires the plan as-of time');
    return this.idempotent(actor, `data.purge:${deploymentId}`, request.idempotencyKey, JSON.stringify({ asOf: request.asOf, confirmationCode: request.confirmationCode || null }), () => {
      const plan = this.retentionPlanFor(deployment, request.asOf);
      if (!plan.enabled) throw new Error(`Hosted deployment ${deploymentId} has no data retention policy`);
      if (!plan.eligibleSessions.length) throw new Error(`Hosted deployment ${deploymentId} has no session data eligible for retention purge`);
      if (request.confirmationCode !== plan.confirmationCode) throw new Error('Hosted retention purge confirmation conflict');
      const purgedAt = this.clock();
      let purgedEventCount = 0;
      for (const candidate of plan.eligibleSessions) {
        const record = this.sessions.get(candidate.sessionId);
        purgedEventCount += record.eventCount;
        if (record.participantAccessToken) this.participantTokens.delete(record.participantAccessToken);
        this.auditEntries = redactAuditForSession(this.auditEntries, record.sessionId);
        for (const [key, value] of this.idempotency) this.idempotency.set(key, redactIdempotencyResult(value, record.sessionId, purgedAt));
        const next = {
          ...record,
          participantId: null,
          participantAccessToken: null,
          events: [],
          runtimeSnapshot: null,
          idempotency: new Map(),
          eventCount: 0,
          purgedEventCount: record.eventCount,
          purgedRuntimeSnapshot: Boolean(record.runtimeSnapshot),
          dataPurgedAt: purgedAt,
          dataPurgedBy: actor.actorId,
          retentionPolicyDays: plan.dataRetentionDays,
          revision: record.revision + 1,
          updatedAt: purgedAt,
        };
        this.sessions.set(record.sessionId, next);
        this.audit('session.data_purged', actor, { deploymentId, sessionId: record.sessionId }, { eventCount: record.eventCount, runtimeSnapshot: Boolean(record.runtimeSnapshot), retentionDays: plan.dataRetentionDays });
      }
      return { deploymentId, purgedAt, purgedSessions: plan.eligibleSessions.map(session => session.sessionId), purgedEventCount };
    });
  }

  readSessionData(sessionId, context = {}) {
    const { session: record } = this.authorizeSession(context, 'data.read', sessionId);
    return { session: publicSession(record), events: clone(record.events), runtimeSnapshot: clone(record.runtimeSnapshot) };
  }

  readDeploymentData(deploymentId, context = {}) {
    const { deployment } = this.authorizeDeployment(context, 'data.read', deploymentId);
    const storedSessions = [...this.sessions.values()].filter(session => session.deploymentId === deploymentId);
    const sessionIds = new Set(storedSessions.map(session => session.sessionId));
    const sessions = storedSessions.map(record => ({ session: publicSession(record), events: clone(record.events), runtimeSnapshot: clone(record.runtimeSnapshot) }));
    const launchLinks = [...this.launchLinks.values()].filter(link => link.deploymentId === deploymentId).map(publicLaunchLink);
    const audit = this.auditEntries.filter(entry => entry.resource?.deploymentId === deploymentId || sessionIds.has(entry.resource?.sessionId)).map(clone);
    const issues = storedSessions.flatMap(sessionExportIntegrity);
    if (deployment.sessionCount !== sessions.length) issues.push(`Deployment ${deploymentId} session count does not match stored sessions`);
    const statusCounts = {};
    for (const { session } of sessions) statusCounts[session.status] = (statusCounts[session.status] || 0) + 1;
    return {
      schemaVersion: HOSTED_DATA_EXPORT_SCHEMA_VERSION,
      generatedAt: this.clock(),
      deployment: this.deploymentView(deployment),
      bundle: clone(deployment.bundle),
      launchLinks,
      sessions,
      audit,
      summary: {
        sessionCount: sessions.length,
        eventCount: sessions.reduce((total, item) => total + item.events.length, 0),
        purgedSessionCount: sessions.filter(item => item.session.dataPurgedAt).length,
        purgedEventCount: sessions.reduce((total, item) => total + (item.session.purgedEventCount || 0), 0),
        statusCounts,
      },
      integrity: { valid: issues.length === 0, issues },
    };
  }

  readAudit(context = {}) {
    const actor = this.authorize(context, 'audit.read');
    return this.auditEntries.filter(entry => tenantIdOf(entry) === actor.tenantId).map(clone);
  }
}

export class HostedExecutionClient {
  constructor(service, accessToken) {
    if (!service || !accessToken) throw new Error('Hosted client requires a service and access token');
    this.service = service;
    this.context = { accessToken };
  }

  publish(bundle, options) { return this.service.publishDeployment(bundle, options, this.context); }
  deployment(id) { return this.service.getDeployment(id, this.context); }
  processNextDeployment() { return this.service.processNextDeployment(this.context); }
  createSession(id, request) { return this.service.createSession(id, request, this.context); }
  deactivateDeployment(id, request) { return this.service.deactivateDeployment(id, request, this.context); }
  createLaunchLink(id, request) { return this.service.createLaunchLink(id, request, this.context); }
  revokeLaunchLink(id, request) { return this.service.revokeLaunchLink(id, request, this.context); }
  redeemLaunchLink(token, request) { return this.service.redeemLaunchLink(token, request); }
  session(id) { return this.service.getSession(id, this.context); }
  bootstrap(id) { return this.service.getParticipantBootstrap(id, this.context); }
  appendEvents(id, events, options) { return this.service.appendEvents(id, events, options, this.context); }
  syncState(id, state, options) { return this.service.syncSessionState(id, state, options, this.context); }
  completeSession(id, options) { return this.service.completeSession(id, options, this.context); }
  retentionPlan(id, options) { return this.service.planDataRetention(id, options, this.context); }
  purgeExpiredData(id, request) { return this.service.purgeExpiredSessionData(id, request, this.context); }
  sessionData(id) { return this.service.readSessionData(id, this.context); }
  deploymentData(id) { return this.service.readDeploymentData(id, this.context); }
  audit() { return this.service.readAudit(this.context); }
}
