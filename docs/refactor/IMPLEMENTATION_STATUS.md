# Refactor Implementation Status

The planned MVP refactor phases 0–6 are implemented on the `demo` branch.

| Phase | Delivered |
| --- | --- |
| 0 — Baseline | Glossary, representative experiments, legacy inventory, and architecture decisions |
| 1 — Core | Protocol Graph, component registry, ports, variables, immutable commands, validation, canonical serialization, and migration skeleton |
| 2 — Runtime | Deterministic Runtime V2, conditions, bounded loops, injected clocks/IDs, pause/resume, retry/skip, snapshots, event envelopes, and event-driven replay |
| 3 — Composer | Component palette, graph canvas, port wiring, schema-driven Inspector, validation, undo/redo, inline node duplication, validated node groups and subflow boundary contracts, Quick/Design/Advanced modes, storage and Dashboard compatibility |
| 4 — Participant UI | Screen/Layout/Text/Media/Input/Button/Progress schema, reusable templates, tree builder, authorable bindings/actions, renderer, session setup, and Runtime V2 runner |
| 5 — Data | Raw JSONL, normalized CSV, snapshots, manifests, data dictionary, quality report, full package download, participant/media lifecycle events, reaction times, and independently tested validator |
| 6 — Migration/Pilot | In-app and CLI migration, migration reports, native Questionnaire adapter, review gate, freeze hashes, three representative migration tests, operator guide, and release gate |

Current automated gate: 104 tests pass, production build passes, and lint reports no errors. Twenty warnings remain in legacy editor/runner files and are tracked as transition debt; no new V2 file adds a warning.

Composer V2 now includes a typed variable catalog with scope, source, default value, and export policy, plus a variable picker for condition inputs. Variable renames update node and participant-UI bindings atomically; referenced variables cannot be removed accidentally.

Runtime V2 includes a graph-native Random split component. Its deterministic state stores the injected seed and draw count; every decision records the seed, draw index, random value, configured probability, and selected branch so that a run can be reproduced and audited.

Node groups are persisted inside the Protocol Graph, validated for referential integrity and single membership, included in serialization/freeze hashes, and rendered as live canvas containers. Removing a node updates its group safely; duplication preserves membership.

A node group can now define a subflow boundary with one member entry, one or more member exits, and typed input/output parameters. Composer V2 exposes these contracts and validation blocks malformed boundaries. Reusable subflow instances and parameter-to-variable mappings remain follow-up work rather than being counted as complete.

Component definitions now declare their runtime kind, participant UI adapter, and completion strategy. Runtime V2 dispatches by the registry contract instead of component type; a newly registered standard participant component enters and completes without adding a central runtime type branch.

Session Review now includes an event-sequence replay panel. A pure reducer rebuilds runtime status, active node, variables, outputs, attempts, loop counts and recorded branch decisions at each immutable event; discontinuous or cross-session logs are rejected instead of being silently approximated.

The release gate includes a deterministic refactor E2E test (compose → validate → freeze → run → snapshot/restore → export) and explicit performance gates. Current local measurements validate/edit a 500-node graph in about 36 ms and export 10,000 events in about 39 ms, well below the enforced 2 s / 3 s limits.

The final hardening pass makes frozen protocols immutable: editing always creates a new draft protocol version with a distinct ID. Formal validation now checks participant UI completion paths, media sources, durations, rating ranges, migration review, and every required condition/loop control exit before preview or freeze.

The legacy editor and runner remain available during transition. New blank protocols use Protocol Graph and Composer V2. Advanced extension work—third-party component SDK, external-device plugins, collaboration, and cloud execution—remains intentionally outside this MVP and belongs to the continuous Stage 7 roadmap.
