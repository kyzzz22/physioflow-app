import { serializeProtocolGraph } from './serialization.js';
import { validateProtocolGraph } from './validateProtocolGraph.js';

function hashableProtocol(protocol) {
  const next = structuredClone(protocol);
  delete next.freeze;
  next.audit = { ...next.audit, createdAt: null, updatedAt: null, frozenAt: null, archivedAt: null };
  return next;
}

export async function hashProtocolGraph(protocol) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable');
  const bytes = new TextEncoder().encode(serializeProtocolGraph(hashableProtocol(protocol), 0));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function freezeProtocolGraph(protocol, registry, options = {}) {
  if (protocol?.legacy?.migrationReport?.formalRunAllowed === false) throw new Error('Review and acknowledge every migration warning before freezing this migrated protocol');
  const check = validateProtocolGraph(protocol, registry);
  if (!check.valid) throw new Error(`Protocol Graph cannot be frozen:\n${check.errors.map(error => error.message).join('\n')}`);
  const now = options.now || new Date().toISOString();
  const next = structuredClone(protocol);
  next.version = { ...next.version, status: 'frozen' };
  next.audit = { ...next.audit, updatedAt: now, frozenAt: now };
  next.freeze = { configHash: await hashProtocolGraph(next), frozenAt: now, dataContractVersion: '2.0.0-alpha.1' };
  return next;
}

export function unfreezeProtocolGraph(protocol, options = {}) {
  if (protocol?.version?.status !== 'frozen') return protocol;
  const now = options.now || new Date().toISOString();
  const next = structuredClone(protocol);
  next.version = { ...next.version, status: 'draft' };
  next.audit = { ...next.audit, updatedAt: now, frozenAt: null };
  delete next.freeze;
  return next;
}
