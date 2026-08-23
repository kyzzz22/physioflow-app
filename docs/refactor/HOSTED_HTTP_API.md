# Hosted HTTP API v1

The HTTP adapter exposes Hosted Service Contract 1.0 without coupling the core service to a web framework. `createHostedHttpHandler(service)` accepts a standard Web `Request` and returns a standard `Response`, so the same handler can be mounted in a Node server, serverless function, edge runtime, or test transport. `HostedHttpClient` implements the interface consumed by `HostedRuntimeSync`.

## Authentication and request rules

- Every endpoint requires `Authorization: Bearer <token>`.
- Publication and session creation send `Idempotency-Key`.
- JSON requests use `Content-Type: application/json`.
- The default maximum request body is 10 MiB and can be reduced by the host.
- Responses use `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and identify the hosted contract version.
- Stable JSON errors contain `error.code` and `error.message`; authorization, missing resources, conflicts, invalid requests, oversized payloads, timeouts, and internal failures remain distinguishable.

## Routes

| Method | Route | Permission | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/deployments` | `deployment.publish` | Validate and enqueue a frozen deployment bundle |
| POST | `/v1/deployments/process-next` | `deployment.manage` | Advance the next queued deployment to ready |
| GET | `/v1/deployments/:id` | `deployment.read` | Read deployment metadata |
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
- `WebStorageHostedStateStore` for a durable single-browser sandbox.

A production store can implement the same interface with transactional SQL, an append-only event database, object storage, or another durable backend. Encryption, tenant isolation, secret hashing, backups, retention enforcement, rate limiting, and operational monitoring remain responsibilities of that adapter and its hosting environment.
