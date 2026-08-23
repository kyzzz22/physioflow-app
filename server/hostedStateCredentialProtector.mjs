import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const HOSTED_CREDENTIAL_PROTECTION_VERSION = '1.0.0';
const MODE = 'hmac-sha256+aes-256-gcm';
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DIGEST = /^hmac-sha256:([A-Za-z0-9][A-Za-z0-9._-]{0,63}):[a-f0-9]{64}$/;
const SEALED = /^sealed:v1:([A-Za-z0-9][A-Za-z0-9._-]{0,63}):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)$/;
const TOKEN_FIELDS = new Set(['participantAccessToken', 'launchToken']);
const AUDIT_INTEGRITY_MODE = 'hmac-sha256-chain';

function clone(value) { return value === undefined ? undefined : globalThis.structuredClone(value); }

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function withoutAuditIntegrity(entry) {
  const next = clone(entry);
  delete next.previousAuditDigest;
  delete next.auditDigest;
  return next;
}

function normalizedKeys(keys) {
  if (!Array.isArray(keys) || !keys.length) throw new Error('Hosted credential protection requires at least one key');
  const seen = new Set();
  return keys.map(item => {
    if (!KEY_ID.test(item?.keyId || '')) throw new Error('Hosted credential key ID is invalid');
    if (seen.has(item.keyId)) throw new Error(`Hosted credential key ID ${item.keyId} is duplicated`);
    if (typeof item.secret !== 'string' || item.secret.length < 32) throw new Error(`Hosted credential key ${item.keyId} secret must be at least 32 characters`);
    seen.add(item.keyId);
    const material = Buffer.from(item.secret, 'utf8');
    return {
      keyId: item.keyId,
      encryptionKey: createHash('sha256').update('physioflow:credential:encryption\0').update(material).digest(),
      digestKey: createHash('sha256').update('physioflow:credential:digest\0').update(material).digest(),
    };
  });
}

function credentialFields(value, transform) {
  if (Array.isArray(value)) return value.map(item => credentialFields(item, transform));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, TOKEN_FIELDS.has(key) && typeof item === 'string' ? transform(item, key) : credentialFields(item, transform)]));
}

export function createHostedStateCredentialProtector(options = {}) {
  const keys = normalizedKeys(options.keys);
  const byId = new Map(keys.map(key => [key.keyId, key]));
  const primaryId = options.primaryKeyId || keys[0].keyId;
  const primary = byId.get(primaryId);
  if (!primary) throw new Error(`Hosted credential primary key ${primaryId} is not configured`);

  function digest(token, purpose, key = primary) {
    return `hmac-sha256:${key.keyId}:${createHmac('sha256', key.digestKey).update(purpose).update('\0').update(token).digest('hex')}`;
  }

  function seal(token, purpose, key = primary) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key.encryptionKey, iv);
    cipher.setAAD(Buffer.from(`physioflow:${purpose}:${key.keyId}`, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `sealed:v1:${key.keyId}:${iv.toString('base64url')}:${ciphertext.toString('base64url')}:${tag.toString('base64url')}`;
  }

  function unseal(value, purpose) {
    const match = String(value || '').match(SEALED);
    if (!match) throw new Error('Hosted credential state contains an invalid sealed value');
    const key = byId.get(match[1]);
    if (!key) throw new Error(`Hosted credential key ${match[1]} is required to open the state`);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key.encryptionKey, Buffer.from(match[2], 'base64url'));
      decipher.setAAD(Buffer.from(`physioflow:${purpose}:${key.keyId}`, 'utf8'));
      decipher.setAuthTag(Buffer.from(match[4], 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(match[3], 'base64url')), decipher.final()]).toString('utf8');
    } catch { throw new Error('Hosted credential state cannot be decrypted'); }
  }

  function verifyDigest(value, token, purpose) {
    const match = String(value || '').match(DIGEST);
    const key = match && byId.get(match[1]);
    if (!key) throw new Error('Hosted credential state contains an invalid digest');
    const expected = Buffer.from(digest(token, purpose, key), 'utf8');
    const supplied = Buffer.from(value, 'utf8');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error('Hosted credential state digest does not match its sealed value');
  }

  function auditPayload(entry, previousAuditDigest, index) {
    return JSON.stringify(canonical({ entry: withoutAuditIntegrity(entry), index, previousAuditDigest }));
  }

  function auditAnchorPayload(entryCount, headDigest) {
    return JSON.stringify(canonical({ entryCount, headDigest }));
  }

  function protectAudit(entries) {
    let previousAuditDigest = null;
    const protectedEntries = (entries || []).map((entry, index) => {
      if (Object.prototype.hasOwnProperty.call(entry, 'auditDigest') || Object.prototype.hasOwnProperty.call(entry, 'previousAuditDigest')) throw new Error('Hosted audit entry is already integrity protected');
      const auditDigest = digest(auditPayload(entry, previousAuditDigest, index + 1), 'audit-entry');
      const next = { ...entry, previousAuditDigest, auditDigest };
      previousAuditDigest = auditDigest;
      return next;
    });
    const entryCount = protectedEntries.length;
    const headDigest = previousAuditDigest;
    return {
      entries: protectedEntries,
      metadata: {
        mode: AUDIT_INTEGRITY_MODE,
        keyId: primary.keyId,
        entryCount,
        headDigest,
        anchorDigest: digest(auditAnchorPayload(entryCount, headDigest), 'audit-anchor'),
      },
    };
  }

  function unprotectAudit(entries, metadata) {
    if (!metadata) return clone(entries || []);
    const anchorMatch = String(metadata.anchorDigest || '').match(DIGEST);
    const headMatch = metadata.headDigest === null ? null : String(metadata.headDigest || '').match(DIGEST);
    if (metadata.mode !== AUDIT_INTEGRITY_MODE || !byId.has(metadata.keyId) || anchorMatch?.[1] !== metadata.keyId || (metadata.entryCount === 0 ? metadata.headDigest !== null : headMatch?.[1] !== metadata.keyId) || !Number.isSafeInteger(metadata.entryCount) || metadata.entryCount < 0 || metadata.entryCount !== (entries || []).length) throw new Error('Hosted audit integrity metadata is invalid');
    let previousAuditDigest = null;
    const unprotected = (entries || []).map((entry, index) => {
      if (entry.previousAuditDigest !== previousAuditDigest || String(entry.auditDigest || '').match(DIGEST)?.[1] !== metadata.keyId) throw new Error('Hosted audit chain linkage does not match');
      verifyDigest(entry.auditDigest, auditPayload(entry, previousAuditDigest, index + 1), 'audit-entry');
      previousAuditDigest = entry.auditDigest;
      return withoutAuditIntegrity(entry);
    });
    if (metadata.headDigest !== previousAuditDigest) throw new Error('Hosted audit chain head does not match');
    verifyDigest(metadata.anchorDigest, auditAnchorPayload(metadata.entryCount, metadata.headDigest), 'audit-anchor');
    return unprotected;
  }

  function protectState(input) {
    if (input?.credentialProtection) throw new Error('Hosted credential state is already protected');
    const state = clone(input);
    const launchLinks = new Map((state.launchLinks || []).map(link => [link.launchLinkId, link]));
    state.sessions = (state.sessions || []).map(session => {
      const next = { ...session, idempotency: credentialFields(session.idempotency || [], (token, field) => seal(token, `idempotency:${field}`)) };
      if (typeof next.participantAccessToken === 'string') {
        next.participantCredentialDigest = digest(next.participantAccessToken, 'participant');
        next.participantCredentialCiphertext = seal(next.participantAccessToken, 'participant');
        delete next.participantAccessToken;
      }
      return next;
    });
    state.participantTokens = (state.participantTokens || []).map(([token, record]) => [digest(token, 'participant'), { ...record, credentialCiphertext: seal(token, 'participant') }]);
    state.launchTokens = (state.launchTokens || []).map(([token, launchLinkId]) => {
      const link = launchLinks.get(launchLinkId);
      if (!link) throw new Error(`Hosted launch credential references unknown link ${launchLinkId}`);
      link.launchCredentialDigest = digest(token, 'launch');
      link.launchCredentialCiphertext = seal(token, 'launch');
      return [link.launchCredentialDigest, launchLinkId];
    });
    state.idempotency = (state.idempotency || []).map(([key, value]) => [key, credentialFields(value, (token, field) => seal(token, `idempotency:${field}`))]);
    const audit = protectAudit(state.auditEntries || []);
    state.auditEntries = audit.entries;
    state.credentialProtection = { schemaVersion: HOSTED_CREDENTIAL_PROTECTION_VERSION, mode: MODE, primaryKeyId: primary.keyId, auditIntegrity: audit.metadata };
    return state;
  }

  function unprotectState(input) {
    if (!input?.credentialProtection) return clone(input);
    if (input.credentialProtection.schemaVersion !== HOSTED_CREDENTIAL_PROTECTION_VERSION || input.credentialProtection.mode !== MODE) throw new Error('Unsupported hosted credential protection metadata');
    const state = clone(input);
    state.sessions = (state.sessions || []).map(session => {
      const next = { ...session, idempotency: credentialFields(session.idempotency || [], (token, field) => unseal(token, `idempotency:${field}`)) };
      if (next.participantCredentialCiphertext) {
        next.participantAccessToken = unseal(next.participantCredentialCiphertext, 'participant');
        verifyDigest(next.participantCredentialDigest, next.participantAccessToken, 'participant');
      }
      delete next.participantCredentialDigest;
      delete next.participantCredentialCiphertext;
      return next;
    });
    state.participantTokens = (state.participantTokens || []).map(([storedDigest, record]) => {
      const token = unseal(record?.credentialCiphertext, 'participant');
      verifyDigest(storedDigest, token, 'participant');
      const next = { ...record };
      delete next.credentialCiphertext;
      return [token, next];
    });
    const launchTokens = new Map();
    state.launchLinks = (state.launchLinks || []).map(link => {
      const next = { ...link };
      if (next.launchCredentialCiphertext) launchTokens.set(next.launchLinkId, unseal(next.launchCredentialCiphertext, 'launch'));
      delete next.launchCredentialDigest;
      delete next.launchCredentialCiphertext;
      return next;
    });
    state.launchTokens = (state.launchTokens || []).map(([storedDigest, launchLinkId]) => {
      const token = launchTokens.get(launchLinkId);
      if (!token) throw new Error(`Hosted launch link ${launchLinkId} is missing its sealed credential`);
      verifyDigest(storedDigest, token, 'launch');
      verifyDigest((input.launchLinks || []).find(link => link.launchLinkId === launchLinkId)?.launchCredentialDigest, token, 'launch');
      return [token, launchLinkId];
    });
    state.idempotency = (state.idempotency || []).map(([key, value]) => [key, credentialFields(value, (token, field) => unseal(token, `idempotency:${field}`))]);
    state.auditEntries = unprotectAudit(state.auditEntries || [], input.credentialProtection.auditIntegrity);
    delete state.credentialProtection;
    return state;
  }

  return {
    primaryKeyId: primary.keyId,
    protectState,
    unprotectState,
    verifyStateIntegrity: state => {
      if (state?.credentialProtection?.auditIntegrity) unprotectAudit(state.auditEntries || [], state.credentialProtection.auditIntegrity);
      return true;
    },
    requiresRewrite: state => !state?.credentialProtection || state.credentialProtection.primaryKeyId !== primary.keyId || state.credentialProtection.auditIntegrity?.keyId !== primary.keyId,
    isDigest: value => DIGEST.test(value || ''),
  };
}
