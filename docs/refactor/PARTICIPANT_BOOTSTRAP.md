# Participant Bootstrap Contract 1.0

A redeemed launch token creates a scoped participant session. The participant then authenticates with that session token and downloads a bootstrap document before Runtime V2 starts.

The bootstrap contains:

- session, deployment, protocol-version and configuration-hash identity;
- the exact frozen Protocol Graph snapshot consumed by Runtime V2;
- bundle and dependency provenance;
- a normalized resource-delivery manifest;
- the latest fully synchronized runtime checkpoint and its contiguous events, when a resumable checkpoint exists;
- an integrity hash covering the complete bootstrap response.

Participant access tokens are never included in the bootstrap body. The service re-hashes the frozen protocol before issuing the document, and the client validates both the protocol configuration hash and outer bootstrap hash before running it.

## Resource delivery

Protocol assets and node-level external media become explicit resource entries. Direct HTTPS URLs and HTTP loopback URLs are accepted. Unsafe, malformed, or unsupported URLs are marked `unavailable` rather than passed to the renderer.

Workspace-only assets require an injected provider resolver. A resolver can return a short-lived signed HTTPS URL, delivery mode, checksum, and expiry. Resolver exceptions and internal provider details are not exposed to participants. The reference sandbox therefore distinguishes runnable resources from assets that still need a real hosting adapter.

Hosted Runtime V2 resolves media nodes through this verified manifest. Ready assets receive the delivered URL; unavailable or unsafe entries resolve to an empty source and cannot fall back to the original protocol URL. Local previews without a hosted manifest retain their existing direct-source behavior.

## Permissions and lifecycle

- A scoped participant can fetch only its own session bootstrap.
- Owners and operators can fetch bootstrap documents for diagnosis.
- Viewer and analyst metadata access does not grant protocol bootstrap access.
- Terminal or revoked participant sessions cannot request a new bootstrap.
- Bootstrap delivery never bypasses deployment/session quota, expiry, revocation, or deactivation checks performed during session creation.

## Current integration

`GET /v1/sessions/:id/bootstrap` is implemented by both local and persistent hosted services and consumed by `HostedHttpClient.bootstrap`. Composer's hosted sandbox validates the returned bootstrap and starts Runtime V2 with the server-delivered protocol snapshot, not its in-memory editor object.

The standalone `/participant` application accepts opaque launch credentials in the URL fragment, exchanges them through the HTTP client with a deterministic idempotency key, validates the bootstrap, and enters Runtime V2 without loading the researcher workspace. Refresh recovery chooses the newest matching local or hosted checkpoint, re-fetches current session revisions, and preserves event monotonicity across page navigation. The launch token remains in the fragment and is therefore not sent in HTTP request paths or referrer headers.

Internet deployment still requires HTTPS hosting, a production identity/token service, durable storage, a signed asset resolver/CDN, monitoring, and abuse controls.
