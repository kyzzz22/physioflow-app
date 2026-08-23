import { validateDeploymentBundle } from '../deployment/index.js';

export const HOSTED_SERVICE_CONTRACT_VERSION = '1.0.0';

const ROLE_PERMISSIONS = Object.freeze({
  owner: ['deployment.publish', 'deployment.read', 'deployment.manage', 'session.start', 'session.read', 'session.manage', 'data.ingest', 'data.read', 'audit.read'],
  editor: ['deployment.publish', 'deployment.read', 'session.read'],
  operator: ['deployment.read', 'deployment.manage', 'session.start', 'session.read', 'session.manage', 'data.ingest', 'data.read'],
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

function validateActor(actor) {
  if (!actor?.actorId?.trim()) throw new Error('Hosted actor ID is required');
  if (!ROLE_PERMISSIONS[actor.role]) throw new Error(`Unsupported hosted role ${actor.role}`);
  if (!actor.accessToken?.trim()) throw new Error('Hosted actor access token is required');
}

export class LocalHostedExecutionService {
  constructor(options = {}) {
    this.clock = options.clock || (() => new Date().toISOString());
    this.idFactory = options.idFactory || (prefix => `${prefix}_${globalThis.crypto.randomUUID()}`);
    this.actors = new Map();
    this.participantTokens = new Map();
    this.deployments = new Map();
    this.sessions = new Map();
    this.idempotency = new Map();
    this.auditEntries = [];
    for (const actor of options.actors || []) {
      validateActor(actor);
      if (this.actors.has(actor.accessToken)) throw new Error('Hosted actor access tokens must be unique');
      this.actors.set(actor.accessToken, { actorId: actor.actorId, role: actor.role });
    }
  }

  authorize(context, permission, sessionId = null) {
    const actor = this.actors.get(context?.accessToken);
    if (actor && ROLE_PERMISSIONS[actor.role].includes(permission)) return { kind: 'actor', ...actor };
    const participant = this.participantTokens.get(context?.accessToken);
    if (participant?.active !== false && participant?.sessionId === sessionId && ['session.read', 'session.manage', 'data.ingest'].includes(permission)) return { kind: 'participant', actorId: participant.participantId, role: 'participant' };
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
    return publicDeployment(record);
  }

  processNextDeployment(context = {}) {
    const actor = this.authorize(context, 'deployment.manage');
    const record = [...this.deployments.values()].find(item => item.status === 'queued');
    if (!record) return null;
    const next = { ...record, status: 'ready', revision: record.revision + 1, updatedAt: this.clock(), readyAt: this.clock() };
    this.deployments.set(record.deploymentId, next);
    this.audit('deployment.ready', actor, { deploymentId: record.deploymentId }, { revision: next.revision });
    return publicDeployment(next);
  }

  async createSession(deploymentId, request = {}, context = {}) {
    const actor = this.authorize(context, 'session.start');
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) throw new Error(`Unknown hosted deployment ${deploymentId}`);
    if (deployment.status !== 'ready') throw new Error(`Hosted deployment ${deploymentId} is not ready`);
    return this.idempotent(actor, `session.start:${deploymentId}`, request.idempotencyKey, JSON.stringify({ participantId: request.participantId || null }), () => {
      const now = this.clock();
      const sessionId = this.idFactory('hosted_session');
      const participantId = request.participantId || this.idFactory('participant');
      const participantAccessToken = this.idFactory('participant_token');
      const record = {
        contractVersion: HOSTED_SERVICE_CONTRACT_VERSION,
        sessionId,
        deploymentId,
        projectId: deployment.projectId,
        protocolId: deployment.protocolId,
        protocolVersion: deployment.protocolVersion,
        configHash: deployment.configHash,
        participantId,
        participantAccessToken,
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
      this.deployments.set(deploymentId, { ...deployment, sessionCount: deployment.sessionCount + 1, updatedAt: now });
      this.audit('session.created', actor, { deploymentId, sessionId }, { participantId });
      return { ...publicSession(record), participantAccessToken };
    });
  }

  getSession(sessionId, context = {}) {
    this.authorize(context, 'session.read', sessionId);
    const record = this.sessions.get(sessionId);
    if (!record) throw new Error(`Unknown hosted session ${sessionId}`);
    return publicSession(record);
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
  session(id) { return this.service.getSession(id, this.context); }
  appendEvents(id, events, options) { return this.service.appendEvents(id, events, options, this.context); }
  syncState(id, state, options) { return this.service.syncSessionState(id, state, options, this.context); }
  completeSession(id, options) { return this.service.completeSession(id, options, this.context); }
  sessionData(id) { return this.service.readSessionData(id, this.context); }
  audit() { return this.service.readAudit(this.context); }
}
