import { validateDeploymentBundle } from '../deployment/index.js';
import { createParticipantBootstrap } from './participantBootstrap.js';

export const HOSTED_SERVICE_CONTRACT_VERSION = '1.0.0';
export const HOSTED_STATE_SCHEMA_VERSION = '1.1.0';
const LEGACY_HOSTED_STATE_SCHEMA_VERSION = '1.0.0';

const ROLE_PERMISSIONS = Object.freeze({
  owner: ['deployment.publish', 'deployment.read', 'deployment.manage', 'session.start', 'session.read', 'session.bootstrap', 'session.manage', 'data.ingest', 'data.read', 'audit.read'],
  editor: ['deployment.publish', 'deployment.read', 'session.read'],
  operator: ['deployment.read', 'deployment.manage', 'session.start', 'session.read', 'session.bootstrap', 'session.manage', 'data.ingest', 'data.read'],
  analyst: ['deployment.read', 'session.read', 'data.read'],
  viewer: ['deployment.read', 'session.read'],
});

const TERMINAL_SESSION_STATES = new Set(['completed', 'failed', 'cancelled']);

function clone(value) { return value === undefined ? undefined : structuredClone(value); }

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

function validateActor(actor) {
  if (!actor?.actorId?.trim()) throw new Error('Hosted actor ID is required');
  if (!ROLE_PERMISSIONS[actor.role]) throw new Error(`Unsupported hosted role ${actor.role}`);
  if (!actor.accessToken?.trim()) throw new Error('Hosted actor access token is required');
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
      this.actors.set(actor.accessToken, { actorId: actor.actorId, role: actor.role });
    }
    if (options.state) this.restoreState(options.state);
  }

  restoreState(state) {
    if (![HOSTED_STATE_SCHEMA_VERSION, LEGACY_HOSTED_STATE_SCHEMA_VERSION].includes(state?.schemaVersion)) throw new Error(`Unsupported hosted state version ${state?.schemaVersion || '(missing)'}`);
    this.deployments = new Map((state.deployments || []).map(record => [record.deploymentId, clone(record)]));
    this.sessions = new Map((state.sessions || []).map(record => {
      const session = clone(record);
      session.idempotency = new Map(record.idempotency || []);
      return [session.sessionId, session];
    }));
    this.participantTokens = new Map(clone(state.participantTokens || []));
    this.launchLinks = new Map((state.launchLinks || []).map(record => [record.launchLinkId, clone(record)]));
    this.launchTokens = new Map(clone(state.launchTokens || []));
    this.idempotency = new Map(clone(state.idempotency || []));
    this.auditEntries = clone(state.auditEntries || []);
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
    if (participant?.active !== false && participant?.sessionId === sessionId && ['session.read', 'session.bootstrap', 'session.manage', 'data.ingest'].includes(permission)) return { kind: 'participant', actorId: participant.participantId, role: 'participant' };
    throw new Error(`Hosted permission ${permission} is required`);
  }

  audit(action, actor, resource = {}, detail = {}) {
    const entry = Object.freeze({
      auditId: this.idFactory('audit'),
      sequence: this.auditEntries.length + 1,
      occurredAt: this.clock(),
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
    const idempotencyKey = `${actor.actorId}:${scope}:${key}`;
    if (this.idempotency.has(idempotencyKey)) {
      const previous = this.idempotency.get(idempotencyKey);
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
    this.participantTokens.set(participantAccessToken, { sessionId, participantId, active: true });
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
        bundle: clone(bundle),
      };
      this.deployments.set(deploymentId, record);
      this.audit('deployment.published', actor, { deploymentId }, { bundleId: bundle.bundleId, bundleHash: bundle.bundleHash });
      return publicDeployment(record);
    });
  }

  getDeployment(deploymentId, context = {}) {
    this.authorize(context, 'deployment.read');
    const record = this.deployments.get(deploymentId);
    if (!record) throw new Error(`Unknown hosted deployment ${deploymentId}`);
    return this.deploymentView(record);
  }

  processNextDeployment(context = {}) {
    const actor = this.authorize(context, 'deployment.manage');
    const record = [...this.deployments.values()].find(item => item.status === 'queued');
    if (!record) return null;
    const next = { ...record, status: 'ready', revision: record.revision + 1, updatedAt: this.clock(), readyAt: this.clock() };
    this.deployments.set(record.deploymentId, next);
    this.audit('deployment.ready', actor, { deploymentId: record.deploymentId }, { revision: next.revision });
    return this.deploymentView(next);
  }

  async createSession(deploymentId, request = {}, context = {}) {
    const actor = this.authorize(context, 'session.start');
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) throw new Error(`Unknown hosted deployment ${deploymentId}`);
    return this.idempotent(actor, `session.start:${deploymentId}`, request.idempotencyKey, JSON.stringify({ participantId: request.participantId || null }), () => {
      return this.createSessionRecord(deployment, request, actor);
    });
  }

  deactivateDeployment(deploymentId, request = {}, context = {}) {
    const actor = this.authorize(context, 'deployment.manage');
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) throw new Error(`Unknown hosted deployment ${deploymentId}`);
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
    const actor = this.authorize(context, 'session.start');
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) throw new Error(`Unknown hosted deployment ${deploymentId}`);
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
    if (!link) throw new Error(`Unknown hosted launch link ${launchLinkId}`);
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
    const actor = { kind: 'launch_link', actorId: launchLinkId, role: 'participant' };
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
    this.authorize(context, 'session.read', sessionId);
    const record = this.sessions.get(sessionId);
    if (!record) throw new Error(`Unknown hosted session ${sessionId}`);
    return publicSession(record);
  }

  async getParticipantBootstrap(sessionId, context = {}) {
    this.authorize(context, 'session.bootstrap', sessionId);
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown hosted session ${sessionId}`);
    if (TERMINAL_SESSION_STATES.has(session.status)) throw new Error(`Hosted session ${sessionId} is ${session.status}`);
    const deployment = this.deployments.get(session.deploymentId);
    if (!deployment) throw new Error(`Unknown hosted deployment ${session.deploymentId}`);
    return createParticipantBootstrap({ deployment, session, assetResolver: this.assetResolver, issuedAt: this.clock(), bootstrapId: this.idFactory('participant_bootstrap') });
  }

  appendEvents(sessionId, events, options = {}, context = {}) {
    const actor = this.authorize(context, 'data.ingest', sessionId);
    const record = this.sessions.get(sessionId);
    if (!record) throw new Error(`Unknown hosted session ${sessionId}`);
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
    const actor = this.authorize(context, 'session.manage', sessionId);
    const record = this.sessions.get(sessionId);
    if (!record) throw new Error(`Unknown hosted session ${sessionId}`);
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
    if (!options.completionId?.trim()) throw new Error('Session completion requires a completion ID');
    const outcome = options.outcome || 'completed';
    if (!['completed', 'failed'].includes(outcome)) throw new Error(`Unsupported hosted session outcome ${outcome}`);
    const idempotencyKey = `completion:${options.completionId}`;
    if (record.idempotency.has(idempotencyKey)) {
      const actor = this.actors.get(context?.accessToken);
      const participant = this.participantTokens.get(context?.accessToken);
      if ((!actor || !ROLE_PERMISSIONS[actor.role].includes('session.manage')) && participant?.sessionId !== sessionId) throw new Error('Hosted permission session.manage is required');
      const previous = record.idempotency.get(idempotencyKey);
      if (previous.outcome !== outcome) throw new Error(`Session completion ${options.completionId} was already used with a different outcome`);
      return publicSession(previous.result);
    }
    const actor = this.authorize(context, 'session.manage', sessionId);
    if (options.expectedRevision !== record.revision) throw new Error(`Hosted session revision conflict: expected ${options.expectedRevision}, current ${record.revision}`);
    if (record.status === 'completed') return publicSession(record);
    if (TERMINAL_SESSION_STATES.has(record.status)) throw new Error(`Hosted session ${sessionId} is ${record.status}`);
    const next = { ...record, status: outcome, revision: record.revision + 1, completedAt: this.clock(), updatedAt: this.clock() };
    const result = publicSession(next);
    next.idempotency.set(idempotencyKey, { outcome, result });
    this.sessions.set(sessionId, next);
    this.participantTokens.set(record.participantAccessToken, { sessionId, participantId: record.participantId, active: false });
    this.audit(`session.${outcome}`, actor, { sessionId }, { eventCount: next.eventCount, revision: next.revision });
    return result;
  }

  readSessionData(sessionId, context = {}) {
    this.authorize(context, 'data.read');
    const record = this.sessions.get(sessionId);
    if (!record) throw new Error(`Unknown hosted session ${sessionId}`);
    return { session: publicSession(record), events: clone(record.events), runtimeSnapshot: clone(record.runtimeSnapshot) };
  }

  readAudit(context = {}) {
    this.authorize(context, 'audit.read');
    return this.auditEntries.map(clone);
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
  sessionData(id) { return this.service.readSessionData(id, this.context); }
  audit() { return this.service.readAudit(this.context); }
}
