# Hosted HTTP API v1

The HTTP adapter exposes Hosted Service Contract 1.0 without coupling the core service to a web framework. `createHostedHttpHandler(service)` accepts a standard Web `Request` and returns a standard `Response`, so the same handler can be mounted in a Node server, serverless function, edge runtime, or test transport. `HostedHttpClient` implements the interface consumed by `HostedRuntimeSync`.

The single-node adapter additionally exposes unauthenticated `GET /healthz` for liveness, `GET /readyz` for state-store and processed-asset readiness, and owner-protected `GET /metrics` for aggregate operational counters. These operational routes sit outside the versioned application contract. Its bounded request limiter returns HTTP 429 and stable `rate_limited` errors before reading rejected request bodies.

## Authentication and request rules

- Every endpoint requires `Authorization: Bearer <token>`.
- Publication and session creation send `Idempotency-Key`.
- JSON requests use `Content-Type: application/json`.
- The default maximum request body is 10 MiB and can be reduced by the host.
- Responses use `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and identify the hosted contract version.
- Stable JSON errors contain `error.code` and `error.message`; authorization, missing resources, conflicts, invalid requests, oversized payloads, timeouts, and internal failures remain distinguishable.
- Cross-origin participant applications must be explicitly allow-listed through `allowedOrigins`. The handler answers preflight requests and permits only the required methods and `Authorization`, `Content-Type`, and `Idempotency-Key` headers; CORS is disabled by default.

## Routes

| Method | Route | Permission | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/deployments` | `deployment.publish` | Validate and enqueue a frozen deployment bundle |
| POST | `/v1/deployments/process-next` | `deployment.manage` | Advance the next queued deployment to ready |
| GET | `/v1/deployments/:id` | `deployment.read` | Read deployment metadata |
| GET | `/v1/deployments/:id/data` | `data.read` | Export every session record, frozen provenance and related audit entry |
| GET | `/v1/deployments/:id/retention-plan?asOf=...` | `data.purge` | Preview terminal session data eligible under the frozen retention policy |
| POST | `/v1/deployments/:id/purge-data` | `data.purge` | Confirm and idempotently pseudonymize the exact previewed set |
| GET | `/v1/deployments/:id/assets` | `deployment.read` | Inspect workspace-asset readiness |
| PUT | `/v1/deployments/:id/assets/:assetId` | `deployment.asset.write` | Upload one checksum-locked workspace binary |
| POST | `/v1/deployments/:id/sessions` | `session.start` | Create a scoped participant session |
| POST | `/v1/deployments/:id/launch-links` | `session.start` | Create a limited, expiring participant launch token |
| POST | `/v1/deployments/:id/deactivate` | `deployment.manage` | Stop new sessions without interrupting existing ones |
| POST | `/v1/launch-links/redeem` | Public launch token | Idempotently exchange a launch token for one scoped session |
| POST | `/v1/launch-links/:id/revoke` | `deployment.manage` | Revoke an unexpired launch token |
| GET | `/v1/sessions/:id` | `session.read` | Read session metadata without raw events |
| GET | `/v1/sessions/:id/bootstrap` | `session.bootstrap` | Download the integrity-checked protocol and resource manifest |
| POST | `/v1/sessions/:id/events` | `data.ingest` | Append one contiguous idempotent event batch |
| PUT | `/v1/sessions/:id/state` | `session.manage` | Synchronize the snapshot matching ingested events |
| POST | `/v1/sessions/:id/complete` | `session.manage` | Finalize a completed or failed session |
| GET | `/v1/sessions/:id/data` | `data.read` | Read raw events and the latest runtime snapshot |
| GET | `/v1/audit` | `audit.read` | Read the sequential service audit trail |

## Persistence

Hosted state has its own versioned schema. It contains deployments, launch-link metadata/token mappings, sessions, scoped participant-token state, global and per-session idempotency records, raw events, snapshots, and audit entries. Actor credentials remain injected by the hosting environment rather than being embedded in the state snapshot. State 1.1 reads legacy 1.0 snapshots and writes the expanded launch-link schema.

`createPersistentHostedExecutionService` serializes mutations through a `load`/`save` store and validates restored relationships before accepting traffic. The included stores are:

- `MemoryHostedStateStore` for tests and embedded processes;
- `WebStorageHostedStateStore` for a durable single-browser sandbox;
- `FileHostedStateStore` in the Node adapter for validated, mode-`0600`, atomic single-process persistence.

A production store can implement the same interface with transactional SQL, an append-only event database, object storage, or another durable backend. The included Node server also serves the participant application and signed filesystem assets; see `SELF_HOSTING.md`. Deployment-level research export is documented in `HOSTED_DATA_EXPORT.md`; explicit live-state pseudonymization is documented in `DATA_RETENTION.md`. Encryption, tenant isolation, secret hashing, backup expiry, retention scheduling, rate limiting, and operational monitoring remain responsibilities of that adapter and its hosting environment.
