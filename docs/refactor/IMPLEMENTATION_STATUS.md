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

Current automated gate: `npm run quality:release` passes as one authoritative local/CI command: 121 tests, a production build without bundle warnings, strict zero-warning lint, and both isolated browser flows.

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

The release gate includes two self-hosted browser tests. The legacy compatibility flow verifies the formal-storage gate and completes, saves, and reloads a preview session. The Composer V2 flow creates a typed variable, publishes and instantiates a reusable subflow, installs an SDK component, and installs a typed device connector. Both launch isolated Vite and headless Chrome processes, and GitHub Actions runs them after the complete quality gate for `demo` pushes and pull requests.

The production bundle now loads Composer V2, the legacy visual workspace, Session Review, Guide, Analytics, and both runtime runners as view-level chunks while keeping the first-screen Dashboard synchronous. This removes the ineffective dynamic-import warning and reduces the initial JavaScript chunk from roughly 749 kB to 489 kB without changing local-first behavior.

Returning from either runtime runner now reloads the saved session index before showing Dashboard. A completed local session is therefore visible immediately instead of appearing only after a full application reload.

Formal usability evidence has a checked-in JSON template and verifier. It enforces two cohorts of at least five participants, all five representative tasks per participant, the 600-second/8-operation/80%-without-help thresholds, resolved critical defects, and designer/operator/data-analyst sign-off. The release remains explicitly incomplete until real participant results pass this verifier.

The final hardening pass makes frozen protocols immutable: editing always creates a new draft protocol version with a distinct ID. Formal validation now checks participant UI completion paths, media sources, durations, rating ranges, migration review, and every required condition/loop control exit before preview or freeze.

The legacy editor and runner remain available during transition. New blank protocols use Protocol Graph and Composer V2. Real-time collaboration and cloud execution remain intentionally outside this MVP and belong to the continuous Stage 7 roadmap.
