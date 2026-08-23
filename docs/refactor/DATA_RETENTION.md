# Hosted Data Retention and Pseudonymization

Hosted retention is explicit, deployment-scoped, and disabled by default. A frozen deployment bundle may declare `executionPolicy.dataRetentionDays` from 1 through 36,500. A `null` value means that PhysioFlow will not select or delete records automatically.

## Governed workflow

Only an owner with `data.purge` may perform either step:

1. Request `GET /v1/deployments/:id/retention-plan?asOf=<timestamp>` and review its cutoff, terminal sessions, event totals, and snapshot flags.
2. Send the unchanged `asOf`, exact returned `confirmationCode`, and a unique `Idempotency-Key` to `POST /v1/deployments/:id/purge-data`.

The service recomputes the plan at execution time. A changed confirmation, missing policy, empty eligible set, or reused idempotency key with different content is rejected. Only `completed`, `failed`, or `cancelled` sessions whose completion time is on or before the cutoff are eligible. There is no background scheduler and active sessions are never selected.

## Removed and retained data

For each selected session, the live state removes:

- participant identity and scoped bearer-token mapping;
- raw Runtime V2 events and their payloads;
- the latest runtime snapshot;
- event, state, and completion idempotency payloads;
- participant identity or returned bearer credentials held in service-level idempotency results.

The remaining pseudonymized tombstone retains the session/deployment/protocol relationship, terminal status, timestamps, revision, removal time/operator, retention policy, removed event count, and whether a snapshot existed. Deployment export reports both currently stored and previously purged counts.

Audit ordering, action names, resource IDs, and non-participant operator provenance remain intact. Existing audit actor/detail participant identifiers are replaced with `null` and an identity-purged marker, followed by a `session.data_purged` entry. This is a deliberate compliance redaction exception to the otherwise immutable audit payload; sequence numbers are never rewritten.

## Operational boundary

Export records that must be retained before purging. Purging affects the current hosted state only: it cannot erase earlier downloads, downstream research datasets, logs produced by an external adapter, or existing offline backups. Operators must align backup expiry and verified destruction with the study consent and institutional policy. A production scheduler may call this two-step API, but must preserve owner authorization, review evidence, exact confirmation, and idempotency rather than bypassing them.
