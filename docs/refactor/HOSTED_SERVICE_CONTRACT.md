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
