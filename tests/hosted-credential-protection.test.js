import assert from 'node:assert/strict';
import test from 'node:test';
import { createHostedStateCredentialProtector } from '../server/hostedStateCredentialProtector.mjs';
import { createPersistentHostedExecutionService, HOSTED_STATE_SCHEMA_VERSION, MemoryHostedStateStore, validateHostedState } from '../src/hosted/index.js';

const oldKey = { keyId: 'old-key', secret: 'old-hosted-credential-secret-at-least-32-characters' };
const newKey = { keyId: 'new-key', secret: 'new-hosted-credential-secret-at-least-32-characters' };

function rawState() {
  return {
    schemaVersion: HOSTED_STATE_SCHEMA_VERSION,
    deployments: [{ deploymentId: 'deployment_1', tenantId: 'tenant-a', assetNamespaceVersion: 2 }],
    sessions: [{
      sessionId: 'session_1', deploymentId: 'deployment_1', tenantId: 'tenant-a', participantId: 'P-1',
      participantAccessToken: 'participant-plaintext-token', events: [], eventCount: 0, runtimeSnapshot: null,
      idempotency: [['completion:one', { result: { participantAccessToken: 'participant-plaintext-token' } }]],
    }],
    participantTokens: [['participant-plaintext-token', { sessionId: 'session_1', participantId: 'P-1', tenantId: 'tenant-a', active: true }]],
    launchLinks: [{ launchLinkId: 'link_1', deploymentId: 'deployment_1', tenantId: 'tenant-a' }],
    launchTokens: [['launch-plaintext-token', 'link_1']],
    idempotency: [['key', { result: { launchToken: 'launch-plaintext-token', session: { participantAccessToken: 'participant-plaintext-token' } } }]],
    auditEntries: [
      { auditId: 'audit_1', sequence: 1, tenantId: 'tenant-a', action: 'deployment.published', detail: { value: 1 } },
      { auditId: 'audit_2', sequence: 2, tenantId: 'tenant-a', action: 'session.created', detail: { value: 2 } },
    ],
  };
}

test('hosted credential protection hashes lookup keys and seals every recoverable token', () => {
  const protector = createHostedStateCredentialProtector({ keys: [oldKey] });
  const raw = rawState();
  const protectedState = protector.protectState(raw);
  const serialized = JSON.stringify(protectedState);
  assert.equal(serialized.includes('participant-plaintext-token'), false);
  assert.equal(serialized.includes('launch-plaintext-token'), false);
  assert.match(protectedState.participantTokens[0][0], /^hmac-sha256:old-key:[a-f0-9]{64}$/);
  assert.match(protectedState.launchTokens[0][0], /^hmac-sha256:old-key:[a-f0-9]{64}$/);
  assert.equal(protectedState.credentialProtection.mode, 'hmac-sha256+aes-256-gcm');
  assert.equal(protectedState.credentialProtection.auditIntegrity.mode, 'hmac-sha256-chain');
  assert.equal(protectedState.credentialProtection.auditIntegrity.entryCount, 2);
  assert.equal(protectedState.credentialProtection.auditIntegrity.headDigest, protectedState.auditEntries[1].auditDigest);
  assert.deepEqual(validateHostedState(protectedState), { valid: true, errors: [] });
  assert.deepEqual(protector.unprotectState(protectedState), raw);
  assert.deepEqual(protector.unprotectState(raw), raw);
  const invalidDigest = structuredClone(protectedState);
  invalidDigest.participantTokens[0][0] = 'participant-plaintext-token';
  assert.equal(validateHostedState(invalidDigest).valid, false);
  const purged = rawState();
  Object.assign(purged.sessions[0], {
    participantId: null, participantAccessToken: null, dataPurgedAt: '2026-08-23T00:00:00.000Z',
    events: [], eventCount: 0, runtimeSnapshot: null, idempotency: [], purgedEventCount: 0,
  });
  purged.participantTokens = [];
  assert.deepEqual(validateHostedState(protector.protectState(purged)), { valid: true, errors: [] });
});

test('hosted credential keys rotate by reading old ciphertext and rewriting with the new primary', () => {
  const oldProtector = createHostedStateCredentialProtector({ keys: [oldKey] });
  const oldState = oldProtector.protectState(rawState());
  const rotating = createHostedStateCredentialProtector({ keys: [newKey, oldKey], primaryKeyId: 'new-key' });
  const rotated = rotating.protectState(rotating.unprotectState(oldState));
  assert.equal(rotated.credentialProtection.primaryKeyId, 'new-key');
  assert.match(rotated.participantTokens[0][0], /^hmac-sha256:new-key:/);
  assert.equal(rotated.credentialProtection.auditIntegrity.keyId, 'new-key');
  assert.match(rotated.auditEntries[0].auditDigest, /^hmac-sha256:new-key:/);
  assert.deepEqual(createHostedStateCredentialProtector({ keys: [newKey] }).unprotectState(rotated), rawState());
  assert.throws(() => createHostedStateCredentialProtector({ keys: [newKey] }).unprotectState(oldState), /old-key is required/);
});

test('persistent hosted startup eagerly replaces a legacy plaintext state', async () => {
  const legacy = rawState();
  legacy.schemaVersion = '1.2.0';
  const store = new MemoryHostedStateStore(legacy);
  await createPersistentHostedExecutionService({ store, stateProtector: createHostedStateCredentialProtector({ keys: [newKey] }) });
  const upgraded = await store.load();
  assert.equal(upgraded.schemaVersion, HOSTED_STATE_SCHEMA_VERSION);
  assert.equal(upgraded.credentialProtection.primaryKeyId, 'new-key');
  assert.equal(upgraded.credentialProtection.auditIntegrity.keyId, 'new-key');
  assert.equal(JSON.stringify(upgraded).includes('participant-plaintext-token'), false);
  assert.equal(JSON.stringify(upgraded).includes('launch-plaintext-token'), false);
  const protector = createHostedStateCredentialProtector({ keys: [newKey] });
  const legacyProtected = protector.protectState(rawState());
  delete legacyProtected.credentialProtection.auditIntegrity;
  legacyProtected.auditEntries = legacyProtected.auditEntries.map(({ auditDigest, previousAuditDigest, ...entry }) => entry);
  const protectedStore = new MemoryHostedStateStore(legacyProtected);
  await createPersistentHostedExecutionService({ store: protectedStore, stateProtector: protector });
  assert.equal((await protectedStore.load()).credentialProtection.auditIntegrity.keyId, 'new-key');
});

test('hosted audit integrity detects content changes, reordering, and anchored truncation', () => {
  const protector = createHostedStateCredentialProtector({ keys: [oldKey] });
  const protectedState = protector.protectState(rawState());
  const contentTamper = structuredClone(protectedState);
  contentTamper.auditEntries[0].detail.value = 9;
  assert.throws(() => protector.unprotectState(contentTamper), /digest does not match/);
  const reordered = structuredClone(protectedState);
  reordered.auditEntries.reverse();
  assert.throws(() => protector.unprotectState(reordered), /chain linkage does not match/);
  const truncated = structuredClone(protectedState);
  truncated.auditEntries.pop();
  truncated.credentialProtection.auditIntegrity.entryCount = 1;
  truncated.credentialProtection.auditIntegrity.headDigest = truncated.auditEntries[0].auditDigest;
  assert.throws(() => protector.unprotectState(truncated), /digest does not match/);
  const legacyProtected = structuredClone(protectedState);
  delete legacyProtected.credentialProtection.auditIntegrity;
  legacyProtected.auditEntries = legacyProtected.auditEntries.map(entry => {
    const next = { ...entry };
    delete next.previousAuditDigest;
    delete next.auditDigest;
    return next;
  });
  assert.deepEqual(protector.unprotectState(legacyProtected), rawState());
  assert.equal(protector.requiresRewrite(legacyProtected), true);
});

test('hosted credential protection rejects ciphertext tampering and unsafe key configuration', () => {
  const protector = createHostedStateCredentialProtector({ keys: [oldKey] });
  const protectedState = protector.protectState(rawState());
  const parts = protectedState.participantTokens[0][1].credentialCiphertext.split(':');
  parts[4] = `${parts[4][0] === 'A' ? 'B' : 'A'}${parts[4].slice(1)}`;
  protectedState.participantTokens[0][1].credentialCiphertext = parts.join(':');
  assert.throws(() => protector.unprotectState(protectedState), /cannot be decrypted/);
  const digestTamper = protector.protectState(rawState());
  digestTamper.participantTokens[0][0] = digestTamper.participantTokens[0][0].replace(/.$/, value => value === '0' ? '1' : '0');
  assert.throws(() => protector.unprotectState(digestTamper), /digest does not match/);
  assert.throws(() => createHostedStateCredentialProtector({ keys: [] }), /at least one key/);
  assert.throws(() => createHostedStateCredentialProtector({ keys: [{ keyId: '../bad', secret: oldKey.secret }] }), /key ID is invalid/);
  assert.throws(() => createHostedStateCredentialProtector({ keys: [{ keyId: 'short', secret: 'too-short' }] }), /at least 32 characters/);
});
