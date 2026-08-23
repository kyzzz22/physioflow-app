# Refactor Completion Audit

Date: 2026-08-23  
Authority: `docs/SYSTEM_REFACTOR_PLAN.md`

This audit distinguishes the accepted end-to-end refactor MVP from work that remains in the full roadmap. A passing build alone is not treated as proof of product completion.

## Proven MVP capabilities

| Plan requirement | Current evidence |
| --- | --- |
| Protocol Graph is the executable source of truth | Versioned graph schema, immutable graph commands, canonical serialization, graph validation, Runtime V2 consumption |
| Visual composition | Palette, node canvas, control/data ports, connection validation, move, delete, inline duplicate, undo/redo |
| Node grouping | Protocol-level group schema/commands, single-membership validation, safe node removal/duplication and live canvas containers |
| Reusable parameterized subflows | Member entry/multi-exit contracts, typed input/output port endpoints, reusable template publication, isolated graph expansion, variable mappings, provenance, validation and Runtime V2 read/write semantics |
| Progressive editing | Quick, Design, and Advanced views operate on the same protocol object |
| Typed variables and conditions | Variable catalog, scope/type/default/source/export policy, safe rename/delete, condition variable picker, missing/type checks |
| Graph-native randomization | Seeded Random split, explicit A/B ports, deterministic state, decision event and replay-equivalent test |
| Registry-driven participant runtime | Runtime kind, UI adapter and completion strategy are component metadata; a custom registered participant component executes without a central type branch |
| Deterministic E2E release path | Automated compose, validate, freeze, run, snapshot/restore, response and export quality test |
| Performance targets | Enforced 500-node validation/edit (<2 s) and 10,000-event export (<3 s) tests |
| Participant UI composition | Screen/Layout/Text/Media/Input/Button/Progress tree, bindings, actions, templates, preview and shared runtime renderer |
| Deterministic execution | Injected IDs/clocks, sequence, conditions, bounded loops, pause/resume, retry/skip, snapshots and restore |
| Runtime replay and state debugger | Pure event reducer reconstructs variables, outputs, attempts, loops, branches and terminal status; Session Review provides a sequence timeline and state/payload inspection |
| Declarative component SDK and project library | SDK 1.0 package contract, semantic versions, permission approval, no-code sandbox, dynamic project registry, JSON import, uninstall protection and runnable Reaction Button example |
| External device connector framework | Versioned manifests, typed input/output channels, approved connect/read/write permissions, injected host adapters, failure/recovery lifecycle, full provenance and raw/normalized export tables |
| Extensible custom control handlers | Versioned trusted-handler registry, frozen cloned inputs, synchronous execution, declared-branch enforcement, event allow-lists, registry-driven runtime dispatch and a working Value switch example |
| Local-first collaboration foundation | Versioned change-set envelope, base/result hashes, stable entity and field operations, deterministic three-way conflict detection, explicit resolution, Composer import/export and protocol audit history |
| Portable deployment foundation | Frozen protocol snapshot, dependency manifest, execution policy, provider target, nested integrity hashes, Composer export/inspection and versioned provider registry with submit/status/cancel reference implementation |
| Hosted service application layer | Role permissions, idempotent publication/session creation, deployment queue, scoped participant tokens, optimistic revisions, append-only event batches, completion revocation, data separation, audit log and Composer local sandbox |
| Hosted Runtime V2 synchronization | Serialized incremental event upload, snapshot sequence matching, deterministic idempotency keys, lost-acknowledgement recovery, exactly-once terminal transition and visible runner retry/completion gate |
| Hosted network and persistence boundary | Framework-neutral HTTP v1 handler, fetch client, Bearer transport, bounded bodies, stable errors, versioned service snapshots, serialized store writes and validated restart recovery |
| Governed participant launch | Opaque public launch tokens, idempotent redemption, per-link expiry/use limits, deployment expiry/session quotas, revocation, deactivation, persistence and audit provenance |
| Participant bootstrap and resource delivery | Scoped bootstrap permission, exact frozen snapshot, nested integrity checks, bundle/dependency provenance, safe URL filtering, signed asset-resolver boundary, HTTP endpoint and Composer consumption |
| Standalone public participant application | Dedicated `/participant` entry, fragment launch credentials, deterministic redemption, bootstrap verification, explicit CORS allow-list, current-revision synchronization, local/server checkpoint selection and full browser refresh-recovery gate |
| Single-node self-hosting adapter | Native Node HTTP/static server, health endpoint, validated atomic mode-`0600` file state, restart recovery, pre-provisioned asset convention, checksum verification, expiring HMAC delivery and real-network test |
| Self-hosted browser release gates | Scripts launch Vite and isolated headless Chrome themselves, exercise legacy and Composer workflows plus a real cross-origin public participant server with server-only refresh recovery, and run in the demo push/PR GitHub Actions job |
| Reproducible formal versions | Pre-freeze validation, migration review gate, config hash, immutable frozen record, new-version editing |
| Complete session data | Raw events/responses, normalized CSV, snapshots, manifest, dictionary, quality report and independent validator |
| Legacy migration | Copy-and-convert workflow, original payload preservation, report/review gate, CLI/in-app paths, representative coverage tests |
| Remote demo synchronization | The completed MVP commit series was pushed to `origin/demo`; subsequent Stage 7 work remains local at the user's request |

## Remaining full-roadmap work

| Item | Status | Acceptance evidence still required |
| --- | --- | --- |
| Formal usability study | Requires human participants | Run `USABILITY_STUDY_PROTOCOL.md`; the checked-in verifier must report complete evidence and `passed: true` |

Hardware-specific adapters can now be added behind the connector port without changing protocol/runtime semantics. Human usability evidence requires external participation beyond source changes.

Managed identity, live cursors, durable multi-tenant hosting and remote database/object storage remain outside the single-node boundary. Collaboration, portable deployment and hosted-service contracts provide transport-neutral application boundaries for those services.
