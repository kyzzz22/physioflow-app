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
- Migrated the representative Emotion protocol from the Dashboard into Composer V2. The migration produced 22 nodes and 21 edges, preserved all 20 steps, reported 100% native mapping, and kept formal collection behind the explicit migration-review gate.
- Re-ran the automated release gate after immutable-version, required-port, participant binding/action, lifecycle-event, response-time, and independent export-validator hardening.

## Acceptance evidence

- Automated tests: 95 passing.
- Production build: passing.
- Lint: zero errors; 20 warnings remain only in legacy transition files.
- Representative migration tests: Emotion, Stroop, and Go/No-Go each meet the native coverage threshold.
- Frozen graph behavior: a frozen protocol retains its hash and status; editing creates a distinct next-version draft.
- Data behavior: Runtime V2 records contiguous event sequences, value changes, UI actions, response submission, media lifecycle events, response reaction time, snapshots, raw records, normalized tables, manifests, a dictionary, and a quality report.
- Randomization behavior: Composer exposes both required branches and probability/seed-salt settings; Runtime V2 records a deterministic decision and reproduces it with the same seed.

## Known transition scope

The legacy editor and runner remain available for existing protocols. Third-party component SDKs, external-device plugins, real-time collaboration, and cloud execution are Stage 7 extension work and are not part of the refactor MVP release gate.
