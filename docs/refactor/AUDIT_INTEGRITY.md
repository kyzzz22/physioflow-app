# Hosted Audit Integrity

The Node hosted adapter authenticates every persisted audit record with a key-backed HMAC-SHA-256 chain. This closes the gap where an offline editor could previously change structurally valid audit JSON without detection.

## Chain format

Each protected audit entry contains:

- `previousAuditDigest`, which is `null` for the first entry and the exact prior digest thereafter;
- `auditDigest`, an HMAC over the canonical full entry, its one-based position, and the previous digest.

Credential-protection metadata additionally contains an authenticated audit anchor with the chain mode, key ID, entry count, head digest, and an HMAC over the count/head pair. The separate anchor prevents an attacker from truncating the tail and simply copying the last remaining entry digest into metadata.

The HMAC input is domain-separated from participant-token indexes, launch-token indexes, and encryption keys. Structural validation rejects broken sequence/link/key metadata before restore; startup then performs constant-time cryptographic verification before exposing any service endpoint. `/readyz` repeats verification against the current file and reports the state check unavailable if an offline edit occurs while the process is running.

## Detected changes

Verification fails closed for:

- changed action, actor, resource, detail, timestamp, tenant, ID, or sequence content;
- inserted, removed, duplicated, or reordered entries;
- broken previous-digest linkage;
- tail truncation, including edits to the visible count and head fields;
- missing audit keys and chains copied under a different key ID.

Old plaintext states and earlier protected states without audit metadata remain readable once. Startup immediately writes the current authenticated representation. Normal credential-key rotation verifies the old audit chain with the retained old key and rewrites the complete chain under the new primary key.

## Trust boundary

The chain detects state-file changes made without a configured key. It does not prevent a compromised running process or an operator holding the active key from producing a new valid chain. It also cannot independently detect replacement of the entire state file with an older, internally valid snapshot. Production installations needing rollback detection should periodically anchor the backup inventory or audit head in an external append-only/WORM system with an independent identity and key boundary.

Retention pseudonymization intentionally redacts participant identity from affected historical entries and then writes a newly authenticated chain plus a `session.data_purged` tombstone. Backup structure can be inventoried without keys, but usable restore and cryptographic audit verification require the referenced credential key.
