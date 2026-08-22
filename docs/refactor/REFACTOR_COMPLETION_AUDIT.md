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
| Progressive editing | Quick, Design, and Advanced views operate on the same protocol object |
| Typed variables and conditions | Variable catalog, scope/type/default/source/export policy, safe rename/delete, condition variable picker, missing/type checks |
| Graph-native randomization | Seeded Random split, explicit A/B ports, deterministic state, decision event and replay-equivalent test |
| Participant UI composition | Screen/Layout/Text/Media/Input/Button/Progress tree, bindings, actions, templates, preview and shared runtime renderer |
| Deterministic execution | Injected IDs/clocks, sequence, conditions, bounded loops, pause/resume, retry/skip, snapshots and restore |
| Reproducible formal versions | Pre-freeze validation, migration review gate, config hash, immutable frozen record, new-version editing |
| Complete session data | Raw events/responses, normalized CSV, snapshots, manifest, dictionary, quality report and independent validator |
| Legacy migration | Copy-and-convert workflow, original payload preservation, report/review gate, CLI/in-app paths, representative coverage tests |

## Remaining full-roadmap work

| Item | Status | Acceptance evidence still required |
| --- | --- | --- |
| Parameterized subflows | Not implemented | Entry/exit contract, parameter mapping, reusable instance semantics, migration and tests |
| Fully declarative component runtime registry | Partial | Adding a standard component without editing central runner/runtime type branches |
| Component SDK and project component library | Stage 7 | Versioned SDK contract, sandbox/permissions, example external component |
| Runtime variable debugger and replay UI | Stage 7 | Event-driven replay reaches the same state/branch and is usable from session review |
| External device connectors | Stage 7 | Storage/I/O ports, permission model, failure/recovery and provenance events |
| Automated browser E2E in release gate | Partial | Repeatable CI command covering create → preview → freeze → run → restore → export |
| Performance gates | Not implemented | 500-node editing and 10,000-event export benchmarks with thresholds |
| Formal usability study | Requires human participants | Timed novice/expert tasks and sign-off against the plan metrics |
| Remote upload | Locally blocked | GitHub HTTPS/SSH authentication and remote branch verification |

The next implementation order is: graph-native randomization, grouping/subflows, registry-driven runtime handlers, automated E2E/performance gates, then Stage 7 SDK/debugger/connectors. Human usability evidence and authenticated remote upload require external state beyond source changes.
