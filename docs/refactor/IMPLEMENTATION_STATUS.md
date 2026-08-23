# Refactor Implementation Status

The planned MVP refactor phases 0–6 are implemented on the `demo` branch.

| Phase | Delivered |
| --- | --- |
| 0 — Baseline | Glossary, representative experiments, legacy inventory, and architecture decisions |
| 1 — Core | Protocol Graph, component registry, ports, variables, immutable commands, validation, canonical serialization, and migration skeleton |
| 2 — Runtime | Deterministic Runtime V2, conditions, bounded loops, injected clocks/IDs, pause/resume, retry/skip, snapshots, event envelopes, and event-driven replay |
| 3 — Composer | Component palette, graph canvas, port wiring, schema-driven Inspector, validation, undo/redo, inline node duplication, validated node groups, reusable parameterized subflows, Quick/Design/Advanced modes, storage and Dashboard compatibility |
| 4 — Participant UI | Screen/Layout/Text/Media/Input/Button/Progress schema, reusable templates, tree builder, authorable bindings/actions, renderer, session setup, and Runtime V2 runner |
| 5 — Data | Raw JSONL, normalized CSV, snapshots, manifests, data dictionary, quality report, full package download, participant/media/device lifecycle events, reaction times, device provenance, and independently tested validator |
| 6 — Migration/Pilot | In-app and CLI migration, migration reports, native Questionnaire adapter, review gate, freeze hashes, three representative migration tests, operator guide, and release gate |

Current automated gate: `npm run quality:release` passes as one authoritative local/CI command: 163 tests, a production build without bundle warnings, strict zero-warning lint, and three isolated browser flows.

Composer V2 now includes a typed variable catalog with scope, source, default value, and export policy, plus a variable picker for condition inputs. Variable renames update node and participant-UI bindings atomically; referenced variables cannot be removed accidentally.

Runtime V2 includes a graph-native Random split component. Its deterministic state stores the injected seed and draw count; every decision records the seed, draw index, random value, configured probability, and selected branch so that a run can be reproduced and audited.

Node groups are persisted inside the Protocol Graph, validated for referential integrity and single membership, included in serialization/freeze hashes, and rendered as live canvas containers. Removing a node updates its group safely; duplication preserves membership.

A node group can define a subflow boundary with one member entry, one or more member exits, and typed input/output parameters bound to concrete component data ports. Composer V2 can publish that definition as a reusable template and create isolated expanded instances with explicit variable mappings. Runtime V2 reads mapped input variables and writes mapped component outputs back to protocol variables while retaining template/version/instance provenance.

Component definitions now declare their runtime kind, participant UI adapter, and completion strategy. Runtime V2 dispatches by the registry contract instead of component type; a newly registered standard participant component enters and completes without adding a central runtime type branch.

Session Review now includes an event-sequence replay panel. A pure reducer rebuilds runtime status, active node, variables, outputs, attempts, loop counts and recorded branch decisions at each immutable event; discontinuous or cross-session logs are rejected instead of being silently approximated.

The declarative Component SDK 1.0 and project component library support versioned JSON packages without executable code injection. Composer Advanced mode imports packages, requires explicit capability approval, registers components in the normal palette, and prevents uninstall while nodes still depend on them. Runtime and validation enforce variable, asset, network-media and event permissions. A runnable Reaction Button package is included as the reference example; see `COMPONENT_SDK.md`.

The External Device Connector Contract 1.0 stores versioned, permission-approved typed channel manifests in the protocol while injecting trusted hardware adapters at runtime. The connector session records connection, samples, markers, failure, retry, recovery and disconnection with connector/device provenance. Raw and normalized device event tables are included in every graph export; see `DEVICE_CONNECTORS.md`.

Trusted Control Handler Contract 1.0 lets host-installed, versioned handlers add deterministic routing without accepting executable code from protocol JSON. Runtime gives handlers cloned, deeply frozen inputs and accepts only synchronous results targeting declared control outputs; custom events are allow-listed. The built-in Value switch is the reference implementation; see `CONTROL_HANDLERS.md`.

The release gate includes a deterministic refactor E2E test (compose → validate → freeze → run → snapshot/restore → export) and explicit performance gates. Current local measurements validate/edit a 500-node graph in about 36 ms and export 10,000 events in about 39 ms, well below the enforced 2 s / 3 s limits.

The release gate includes three self-hosted browser tests. The legacy compatibility flow verifies the formal-storage gate and completes, saves, and reloads a preview session. The Composer V2 flow freezes a minimal graph, publishes it through the hosted sandbox queue, creates and runs a participant session through successful hosted synchronization, creates a new editable version, then exercises typed variables, reusable subflows, SDK components and device connectors. The public-participant flow runs a real cross-origin hosted HTTP server, redeems a fragment launch token from `/participant`, validates Bootstrap, deletes local recovery data, restores from the hosted checkpoint after a full page reload, and completes synchronization. All launch isolated Vite and headless Chrome processes, and GitHub Actions runs them through the complete quality gate for `demo` pushes and pull requests.

The production bundle loads Composer V2, the legacy visual workspace, Session Review, Guide, Analytics, and both runtime runners as view-level chunks while keeping the first-screen Dashboard synchronous. React, React DOM, and Scheduler now occupy a stable vendor chunk, keeping the growing application entry well below the 500 kB warning threshold without changing local-first behavior.

Returning from either runtime runner now reloads the saved session index before showing Dashboard. A completed local session is therefore visible immediately instead of appearing only after a full application reload.

Formal usability evidence has a checked-in JSON template and verifier. It enforces two cohorts of at least five participants, all five representative tasks per participant, the 600-second/8-operation/80%-without-help thresholds, resolved critical defects, and designer/operator/data-analyst sign-off. The release remains explicitly incomplete until real participant results pass this verifier.

Local-first Collaboration Change Sets 1.0 add transport-neutral team editing without requiring a server. Composer Advanced establishes a baseline, exports field-level operations with base/result hashes, imports changes for the same protocol version, automatically merges independent edits, requires explicit same-field conflict resolution, and records application provenance. See `COLLABORATION_CHANGE_SETS.md`. Online presence and cloud synchronization remain separate deployment capabilities.

Portable Deployment Contract 1.0 packages a frozen Protocol Graph snapshot, exact configuration hash, dependency manifest, execution policy, and provider target under an outer integrity hash. Composer Advanced exports and verifies bundles; a versioned provider registry plus in-memory reference provider prove the transport boundary through submit/status/cancel operations. See `PORTABLE_DEPLOYMENT.md`. A hosted backend remains a separate infrastructure deliverable.

Hosted Service Contract 1.0 adds role-separated publication, an explicit deployment queue, idempotent requests, scoped participant sessions, optimistic state revisions, contiguous append-only event ingestion, completion-time token revocation, separate metadata/data access and sequential audit records. Composer Advanced exposes the complete publish-to-ready-to-session path through a local hosted sandbox. See `HOSTED_SERVICE_CONTRACT.md`; production identity, durable infrastructure and internet hosting remain deployment responsibilities.

Hosted Data Export 1.0 adds a `data.read`-protected deployment package containing the exact frozen bundle, every session's metadata/raw events/latest snapshot, public enrollment metadata, related audit provenance, summary counts, and explicit cross-record integrity diagnostics. Bearer and launch credentials and internal idempotency state are excluded. See `HOSTED_DATA_EXPORT.md`.

Governed hosted retention is opt-in through the integrity-protected deployment policy and disabled by default. An owner previews the exact eligible terminal sessions, then confirms that stable plan idempotently. Purge removes participant identifiers and tokens, events, snapshots, and cached response copies while retaining pseudonymized provenance, aggregate removal counts, and a validated audit tombstone across restart. See `DATA_RETENTION.md`.

Hosted tenant isolation assigns server-controlled ownership to every deployment-derived record and access path. Queue processing, idempotency, resource lookup, export, retention, audit, metrics and filesystem assets are tenant-scoped; cross-tenant IDs are indistinguishable from missing records. Legacy pre-tenant state migrates into `default` without losing idempotent retries or existing asset paths. See `TENANT_ISOLATION.md`.

Hosted state 1.3 protects persisted participant and launch credentials without weakening restart idempotency: lookup indexes are HMAC-SHA-256 digests and recoverable response credentials are sealed with authenticated AES-256-GCM. Versioned key rings support eager rotation and old plaintext states are atomically upgraded at startup. See `CREDENTIAL_PROTECTION.md`.

Runtime V2 now attaches directly to a hosted participant session through a serialized synchronization controller. It sends incremental events before their matching snapshot, retries lost acknowledgements idempotently, records completed or failed terminal states exactly once, exposes sync errors/retry in the runner, and prevents leaving a terminal run until required hosted synchronization succeeds.

Hosted HTTP API v1 adds a framework-neutral Web Request/Response handler and a fetch-based client with Bearer authentication, bounded JSON bodies, stable status/error semantics, request timeouts and no-store security headers. A versioned hosted-state snapshot plus serialized `load`/`save` store boundary restores deployments, sessions, scoped tokens, idempotency, raw data and audit history after service restart. See `HOSTED_HTTP_API.md`.

Public participant entry is now controlled by opaque launch tokens rather than exposing operator credentials. Deployment session quotas and expiry are inherited from the integrity-protected bundle; each link adds its own expiry/use limit, redemption is idempotent, revocation is immediate, and deployment deactivation blocks new sessions without killing active ones. These controls persist across service restart and are available through the HTTP API and Composer sandbox.

Participant Bootstrap Contract 1.0 lets a scoped session retrieve the exact frozen graph and an explicit safe-resource manifest. Service and client independently verify protocol/bootstrap hashes; unsafe URLs become unavailable records, workspace assets route through an injected signed-URL resolver, tokens stay out of response bodies, and viewer access does not imply bootstrap access. Composer launches hosted Runtime V2 from this returned snapshot, and media components resolve only ready manifest entries instead of bypassing delivery policy. See `PARTICIPANT_BOOTSTRAP.md`.

The standalone participant application now provides the real public execution surface at `/participant`. Launch credentials remain in the URL fragment, HTTP redemption is deterministic and idempotent across refreshes, CORS origins are explicitly configured, current hosted revisions are fetched before synchronization, and the newest local or server checkpoint resumes Runtime V2 without opening any researcher interface. See `PUBLIC_PARTICIPANT_APP.md`.

The single-node Node adapter makes the hosted boundary directly runnable: it serves the built researcher/participant application, exposes health and API routes, restores validated state from an atomic mode-`0600` JSON store, accepts permission-checked workspace assets, gates deployment readiness on their SHA-256 integrity, and resolves them to expiring HMAC-signed URLs. Its real-network test uploads, processes, restarts, redeems, bootstraps, downloads an asset, and rejects a tampered signature. See `SELF_HOSTING.md`.

Single-node recovery tooling now creates an offline atomic directory backup with a validated state snapshot, private asset copies and a complete SHA-256 inventory; verification detects altered/missing/unexpected files, and restore validates first and refuses existing targets. `/readyz` separately checks state-store readability/writability and processed-asset integrity. See `BACKUP_AND_RECOVERY.md`.

Single-node abuse controls apply memory-bounded, process-local fixed-window limits to public redemption, API, asset upload and signed delivery. Proxy forwarding is ignored unless an exact trusted hop count is configured. An `audit.read`-protected metrics document exposes response/limit and aggregate deployment/session/event counts without record identities or payloads. See `HOSTED_OPERATIONS.md`.

The deployment asset pipeline replaces manual provisioning with authenticated, manifest-constrained upload. Workspace dependencies require safe IDs and SHA-256 checksums; owner/editor/operator uploads are size/type/content checked, atomically stored and audited; incomplete assets block readiness; ready deployments reject replacement. A browser-neutral coordinator loads local workspace binaries, uploads with progress, and verifies server readiness. See `DEPLOYMENT_ASSETS.md`.

The final hardening pass makes frozen protocols immutable: editing always creates a new draft protocol version with a distinct ID. Formal validation now checks participant UI completion paths, media sources, durations, rating ranges, migration review, and every required condition/loop control exit before preview or freeze.

The legacy editor and runner remain available during transition. New blank protocols use Protocol Graph and Composer V2. Real-time collaboration and cloud execution remain intentionally outside this MVP and belong to the continuous Stage 7 roadmap.
