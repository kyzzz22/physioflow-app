# Refactor Implementation Status

The planned MVP refactor phases 0–6 are implemented on the `demo` branch.

| Phase | Delivered |
| --- | --- |
| 0 — Baseline | Glossary, representative experiments, legacy inventory, and architecture decisions |
| 1 — Core | Protocol Graph, component registry, ports, variables, immutable commands, validation, canonical serialization, and migration skeleton |
| 2 — Runtime | Deterministic Runtime V2, conditions, bounded loops, injected clocks/IDs, pause/resume, retry/skip, snapshots, and event envelopes |
| 3 — Composer | Component palette, graph canvas, port wiring, schema-driven Inspector, validation, undo/redo, inline node duplication, Quick/Design/Advanced modes, storage and Dashboard compatibility |
| 4 — Participant UI | Screen/Layout/Text/Media/Input/Button/Progress schema, reusable templates, tree builder, authorable bindings/actions, renderer, session setup, and Runtime V2 runner |
| 5 — Data | Raw JSONL, normalized CSV, snapshots, manifests, data dictionary, quality report, full package download, participant/media lifecycle events, reaction times, and independently tested validator |
| 6 — Migration/Pilot | In-app and CLI migration, migration reports, native Questionnaire adapter, review gate, freeze hashes, three representative migration tests, operator guide, and release gate |

Current automated gate: 95 tests pass, production build passes, and lint reports no errors. Twenty warnings remain in legacy editor/runner files and are tracked as transition debt; no new V2 file adds a warning.

Composer V2 now includes a typed variable catalog with scope, source, default value, and export policy, plus a variable picker for condition inputs. Variable renames update node and participant-UI bindings atomically; referenced variables cannot be removed accidentally.

Runtime V2 includes a graph-native Random split component. Its deterministic state stores the injected seed and draw count; every decision records the seed, draw index, random value, configured probability, and selected branch so that a run can be reproduced and audited.

The final hardening pass makes frozen protocols immutable: editing always creates a new draft protocol version with a distinct ID. Formal validation now checks participant UI completion paths, media sources, durations, rating ranges, migration review, and every required condition/loop control exit before preview or freeze.

The legacy editor and runner remain available during transition. New blank protocols use Protocol Graph and Composer V2. Advanced extension work—third-party component SDK, external-device plugins, collaboration, and cloud execution—remains intentionally outside this MVP and belongs to the continuous Stage 7 roadmap.
