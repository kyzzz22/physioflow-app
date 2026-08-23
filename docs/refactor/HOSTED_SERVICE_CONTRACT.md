# Hosted Service Contract 1.0

The hosted service layer turns a portable deployment bundle into a controlled experiment publication and remote-session lifecycle. It is deliberately independent from React and from any specific HTTP, database, queue, or identity vendor.

## Capabilities

- Role-based access for owner, editor, operator, analyst, viewer, and scoped participant sessions.
- Idempotent deployment publication and session creation.
- Explicit `queued` to `ready` deployment processing.
- Opaque, single-session participant access tokens.
- Optimistic revision checks for runtime-state synchronization.
- Append-only event ingestion with strict session/protocol/version identity and contiguous sequences.
- Idempotent event batches that reject reuse with different content.
- Participant-token revocation when a session completes.
- Separate metadata and raw-data permissions.
- Immutable, sequential audit entries for publication, processing, session creation, ingestion, synchronization, and completion.

Composer Advanced includes a local hosted sandbox. A frozen version can be published, processed to ready, and used to create a participant session without a network service. This proves the application workflow while keeping development and offline use possible.

`HostedRuntimeSync` connects that session to Runtime V2. It uploads only unacknowledged event sequences, synchronizes the matching runtime snapshot under optimistic revision control, and finalizes a completed or failed hosted session only after both are accepted. Event, state, and terminal operations use deterministic idempotency identifiers, so a lost acknowledgement can be retried without duplicating remote records. The runner exposes sync progress and retry, and does not enable return-to-projects until required hosted finalization succeeds.

## Integration boundary

`HostedExecutionClient` is the application-facing interface. A production adapter can map its operations to authenticated HTTP or RPC endpoints while retaining the same semantics:

- publish/get/process deployment;
- create/get session;
- append event batch;
- synchronize runtime state;
- complete session;
- read session data and audit history.

## Security boundary

The local hosted service is a deterministic reference and test sandbox, not a production identity provider. Its injected opaque tokens and in-memory records must be replaced by durable storage, encrypted transport, managed secrets, rate limiting, tenant isolation, retention enforcement, and an audited authentication system before internet exposure.
