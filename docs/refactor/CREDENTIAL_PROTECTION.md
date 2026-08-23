# Hosted Credential Protection

The single-node adapter never writes participant bearer tokens or public launch tokens to disk as plaintext. Hosted state 1.3 protects credential lookup indexes with HMAC-SHA-256 and seals the exact recoverable tokens with authenticated AES-256-GCM encryption.

Exact recovery is required because an idempotent session/link request retried after a restart must return the same credential instead of creating another session. A one-way hash alone cannot satisfy that contract, so the persisted representation combines a non-reversible lookup digest with authenticated encryption for recovery fields and idempotency results.

## Configuration

Provide at least one independent random secret of 32 or more characters:

```bash
PHYSIOFLOW_CREDENTIAL_KEYS_JSON='[
  {"keyId":"2026-08","secret":"replace-with-a-random-secret-of-at-least-32-characters"}
]' \
PHYSIOFLOW_PRIMARY_CREDENTIAL_KEY_ID='2026-08'
```

The first configured key is primary when `PHYSIOFLOW_PRIMARY_CREDENTIAL_KEY_ID` is omitted. Key IDs may contain letters, numbers, dot, underscore, and dash. Keep credential keys outside the state file, asset tree, repository, logs, and backup archive. Losing every key referenced by a state snapshot makes its active participant and launch credentials intentionally unrecoverable.

## Rotation

1. Generate a new independent secret and add it to `PHYSIOFLOW_CREDENTIAL_KEYS_JSON` while retaining the old entry.
2. Set the new key ID as `PHYSIOFLOW_PRIMARY_CREDENTIAL_KEY_ID` and restart.
3. Startup decrypts with the referenced old key and immediately rewrites every credential under the new primary key using the atomic state store.
4. Verify readiness, redeem a disposable link, resume an active disposable session, and create a verified backup.
5. Remove the old key only after every live state copy and retained backup that may require restoration has been rewritten or expired.

The state records only the protection mode and primary key ID, never key material. Ciphertext includes a fresh 96-bit nonce and authentication tag on every write; the purpose and key ID are authenticated as additional data. Any ciphertext modification, missing key, malformed metadata, digest mismatch, or unsafe key configuration stops startup instead of silently dropping credentials.

## Migration and backups

When a 1.0–1.2 plaintext state is opened with credential protection configured, startup normalizes it to state 1.3 and atomically replaces the file before accepting traffic. Existing tokens remain valid. Backup verification can validate the protected structure without possessing decryption keys, while an actual recovery requires both the backup and a matching credential key.

This protects credentials at rest; it does not encrypt research event payloads, participant identifiers, or asset files. Protect the whole disk/backup separately, use HTTPS in transit, and follow `DATA_RETENTION.md` for removal of research data and expired credentials.
