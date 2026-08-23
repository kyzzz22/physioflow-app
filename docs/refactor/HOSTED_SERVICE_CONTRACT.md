# Hosted Service Contract 1.0

The hosted service layer turns a portable deployment bundle into a controlled experiment publication and remote-session lifecycle. It is deliberately independent from React and from any specific HTTP, database, queue, or identity vendor.

## Capabilities

- Role-based access for owner, editor, operator, analyst, viewer, and scoped participant sessions.
- Idempotent deployment publication and session creation.
- Explicit `queued` to `ready` deployment processing.
- Permission-checked, checksum-locked workspace-asset upload with a readiness gate before processing.
- Opaque, single-session participant access tokens.
- Optimistic revision checks for runtime-state synchronization.
- Append-only event ingestion with strict session/protocol/version identity and contiguous sequences.
- Idempotent event batches that reject reuse with different content.
- Participant-token revocation when a session completes.
- Separate metadata and raw-data permissions.
- Immutable, sequential audit entries for publication, processing, session creation, ingestion, synchronization, and completion.
- Deployment-level session quotas, optional expiry and explicit deactivation.
- Opaque participant launch tokens with independent expiry, use quotas, idempotent redemption and immediate revocation.

Composer Advanced includes a local hosted sandbox. A frozen version can be published, processed to ready, and used to create a participant session without a network service. This proves the application workflow while keeping development and offline use possible.

The sandbox also exercises the public-entry lifecycle: create a one-use launch token, redeem it without an actor credential, run the resulting scoped session, revoke unused tokens, or deactivate the deployment. Deactivation blocks new sessions while already-issued participant sessions remain usable so active experiments are not destroyed.

`HostedRuntimeSync` connects that session to Runtime V2. It uploads only unacknowledged event sequences, synchronizes the matching runtime snapshot under optimistic revision control, and finalizes a completed or failed hosted session only after both are accepted. Event, state, and terminal operations use deterministic idempotency identifiers, so a lost acknowledgement can be retried without duplicating remote records. The runner exposes sync progress and retry, and does not enable return-to-projects until required hosted finalization succeeds.

Before the runtime starts, the scoped participant downloads and validates Participant Bootstrap 1.0: the exact frozen graph, bundle provenance, dependency metadata and safe resource delivery entries under an outer hash. See `PARTICIPANT_BOOTSTRAP.md`.

The standalone participant surface consumes this contract at `/participant`, with fragment credentials, idempotent redemption, explicit cross-origin policy, and local/server checkpoint recovery. See `PUBLIC_PARTICIPANT_APP.md`.

## Integration boundary

`HostedExecutionClient` is the application-facing interface. A production adapter can map its operations to authenticated HTTP or RPC endpoints while retaining the same semantics:

- publish/get/process deployment and inspect/upload its workspace assets;
- create/get session;
- append event batch;
- synchronize runtime state;
- complete session;
- read session data and audit history.

## Security boundary

The local hosted service is a deterministic reference and test sandbox, not a production identity provider. Its injected opaque tokens and in-memory records must be replaced by durable storage, encrypted transport, managed secrets, rate limiting, tenant isolation, retention enforcement, and an audited authentication system before internet exposure.

The framework-neutral HTTP v1 handler/client and versioned persistent-state store boundary are implemented; see `HOSTED_HTTP_API.md`. They make network deployment and durable adapters possible without changing Runtime V2, but do not themselves supply managed infrastructure or production identity.
