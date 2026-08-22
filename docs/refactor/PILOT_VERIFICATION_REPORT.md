# Pilot Verification Report

Date: 2026-08-23  
Target: `demo` branch, Protocol Graph / Composer V2 / Runtime V2

## Verified flows

- Created a blank Protocol Graph and inserted a participant Screen on the control edge.
- Edited the Screen heading through the participant UI tree builder and confirmed the rendered preview.
- Started Runtime V2, completed the participant step, saved the session locally, and reached the complete export state.
- Inserted a Rating component, confirmed its editable participant UI tree, selected a value, and submitted it. Runtime V2 completed with 7 contiguous events, 1 response, and 13 export files.
- Switched between Quick, Design, and Advanced Composer modes; created a typed session variable; bound it to a Condition through the variable picker; and confirmed the unconnected false branch remained a blocking issue.
- Duplicated a Screen inline and confirmed the graph rewired from 3 nodes / 2 connections to 4 nodes / 3 connections while preserving a valid participant UI configuration.
- Promoted a persisted node group to a subflow, selected its entry and exit boundaries, added a typed input parameter, and confirmed the controls survived the live Composer update.
- Opened the saved Rating session in Session Review, moved backward from the terminal event, and confirmed the replay changed from completed/End to running/component-completed/Rating with reconstructed variables and outputs.
- Built a Condition + Rating subflow in Composer, selected concrete input/output data-port endpoints, published it as a reusable template, mapped both parameters to a typed session variable, and generated an isolated two-node instance with remapped boundaries and provenance.
- Confirmed the first-run tour stays inside a 1280px viewport after clamping side-positioned cards to the visible area.
- Installed the declarative Reaction Button SDK example from Composer Advanced mode, confirmed its package/version/permission record, found the component in the normal interaction palette, and inserted it into the same Protocol Graph with schema-driven participant UI.
- Installed the simulated physiology connector from Composer Advanced mode and confirmed its versioned manifest, simulated transport, signal/marker channel types and approved connect/read/write capabilities.
- Migrated the representative Emotion protocol from the Dashboard into Composer V2. The migration produced 22 nodes and 21 edges, preserved all 20 steps, reported 100% native mapping, and kept formal collection behind the explicit migration-review gate.
- Re-ran the automated release gate after immutable-version, required-port, participant binding/action, lifecycle-event, response-time, and independent export-validator hardening.

## Acceptance evidence

- Automated tests: 115 passing.
- Production build: passing.
- Lint: zero errors; 19 warnings remain only in legacy transition files.
- Representative migration tests: Emotion, Stroop, and Go/No-Go each meet the native coverage threshold.
- Frozen graph behavior: a frozen protocol retains its hash and status; editing creates a distinct next-version draft.
- Data behavior: Runtime V2 records contiguous event sequences, value changes, UI actions, response submission, media lifecycle events, response reaction time, snapshots, raw records, normalized tables, manifests, a dictionary, and a quality report.
- Randomization behavior: Composer exposes both required branches and probability/seed-salt settings; Runtime V2 records a deterministic decision and reproduces it with the same seed.
- Grouping behavior: created a group from the selected Random split node, confirmed the typed group selector, and verified the canvas container displayed the group name and live node count.
- Subflow contract behavior: Composer exposes member-only entry/exit selection and typed input/output parameters; validation rejects missing boundaries and malformed parameter contracts.
- Registry-dispatch regression: after moving participant execution metadata into the component registry, ran a fresh Rating session to completion with 7 events, 1 response, and 13 export files.
- Automated end-to-end gate: composed a Screen and Rating graph, validated and froze it, ran through snapshot/restore, and verified the completed export and quality report.
- Performance gate: the 500-node validation/edit fixture and 10,000-event export fixture both pass their enforced thresholds.
- Replay behavior: deterministic tests compare replayed variables, outputs, completed nodes and terminal status with the live Runtime V2 state; sequence gaps are rejected.
- Reusable-subflow behavior: template instances receive isolated node/edge IDs, remapped parameter endpoints and variable mappings; Runtime V2 tests prove mapped input reads and output write-through.
- Component SDK behavior: tests cover package/schema validation, explicit permission approval, rejection of executable control kinds, uninstall dependency protection, project registry dispatch, runtime execution, and variable-read enforcement.
- Device connector behavior: tests cover permission-gated installation and I/O, immutable provenance events, typed sample/marker channels, failed connection attempts, successful recovery, and device-event export tables.

## Known transition scope

The legacy editor and runner remain available for existing protocols. Third-party component SDKs, external-device plugins, real-time collaboration, and cloud execution are Stage 7 extension work and are not part of the refactor MVP release gate.
