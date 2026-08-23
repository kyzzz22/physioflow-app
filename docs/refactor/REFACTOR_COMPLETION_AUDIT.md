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
| Self-hosted Composer browser release gate | Script launches Vite and isolated headless Chrome itself, exercises V2 variable/subflow/SDK/device workflows, and runs in the demo push/PR GitHub Actions job |
| Reproducible formal versions | Pre-freeze validation, migration review gate, config hash, immutable frozen record, new-version editing |
| Complete session data | Raw events/responses, normalized CSV, snapshots, manifest, dictionary, quality report and independent validator |
| Legacy migration | Copy-and-convert workflow, original payload preservation, report/review gate, CLI/in-app paths, representative coverage tests |
| Remote demo synchronization | The completed MVP commit series was pushed to `origin/demo`; subsequent Stage 7 work remains local at the user's request |

## Remaining full-roadmap work

| Item | Status | Acceptance evidence still required |
| --- | --- | --- |
| Formal usability study | Requires human participants | Run `USABILITY_STUDY_PROTOCOL.md`; the checked-in verifier must report complete evidence and `passed: true` |

Hardware-specific adapters can now be added behind the connector port without changing protocol/runtime semantics. Human usability evidence requires external participation beyond source changes.

Online presence, authentication, live cursors and cloud synchronization remain outside the local-first MVP boundary; the collaboration change-set contract is designed as their transport-neutral protocol foundation.
