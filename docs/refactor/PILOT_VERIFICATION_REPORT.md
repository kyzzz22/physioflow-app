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
- Inserted the registry-driven Value switch control component and confirmed its schema-driven match setting and explicit match/default branch ports.
- Ran the self-hosted Composer V2 browser gate from a clean profile. It froze and published a minimal graph through the local hosted queue, created and completed a scoped participant session with hosted event/snapshot/terminal synchronization, then produced a five-node editable graph with a reusable subflow instance and Value switch and verified both the Reaction Button SDK package and simulated sensor connector.
- Ran the standalone public-participant browser gate against a real cross-origin hosted HTTP server. It redeemed a fragment token, validated the server bootstrap, removed browser recovery data, restored from the hosted checkpoint after reload, and completed synchronization.
- Ran the self-hosted legacy compatibility gate from a clean profile. It blocked formal collection without a selected local folder, completed a draft preview with eight events, persisted a valid session, returned to Dashboard, and immediately displayed the saved participant record.
- Migrated the representative Emotion protocol from the Dashboard into Composer V2. The migration produced 22 nodes and 21 edges, preserved all 20 steps, reported 100% native mapping, and kept formal collection behind the explicit migration-review gate.
- Re-ran the automated release gate after immutable-version, required-port, participant binding/action, lifecycle-event, response-time, and independent export-validator hardening.

## Acceptance evidence

- Automated tests: 165 passing.
- Production build: passing.
- Lint: zero errors and zero warnings.
- Production bundle: no build warnings; view-level loading keeps the initial JavaScript chunk below the configured 500 kB warning threshold.
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
- Control handler behavior: tests cover trusted versioned registration, deterministic routing, deeply frozen cloned context, synchronous-only execution, event allow-lists and undeclared branch rejection.
- Usability evidence behavior: tests cover complete passing cohorts as well as insufficient participants, failed thresholds, unresolved data-integrity defects, and missing sign-offs.
- Collaboration behavior: tests cover portable field/entity operations, clean merging of independent edits, mandatory local/incoming resolution for same-field conflicts, audit history, frozen/cross-version rejection and prototype-path safety.
- Portable deployment behavior: tests prove frozen-snapshot and outer-manifest integrity, draft rejection, provider registration, job submission/status and cancellation.
- Hosted-service behavior: tests prove role separation, publication/session idempotency, queue transitions, participant-token scoping, revision conflicts, contiguous batch ingestion, token revocation, restricted data access and audit sequencing.
- Hosted-runtime behavior: a real Runtime V2 fixture survives simulated lost event and snapshot acknowledgements, then proves exactly one remote event batch, snapshot, completion and audit entry; pause/resume and terminal failure are also verified.
- Hosted HTTP/persistence behavior: tests send a complete Runtime V2 session through the fetch client and Web Request handler, verify Bearer and JSON errors, then serialize and restart the service while retaining deployment, session, token, idempotency and audit state.
- Public launch behavior: tests cover anonymous idempotent redemption, link expiry/use quotas/revocation, deployment-wide session quotas and deactivation, persistence across restart, and continued access for already-created sessions.
- Participant-bootstrap behavior: tests re-hash the frozen graph, validate the outer document, reject tampering and viewer access, omit session tokens, resolve signed workspace assets, reject unsafe URLs, and download the same contract through anonymous HTTP launch redemption.
- Browser release behavior: `npm run test:e2e`, `npm run test:e2e:refactor-browser`, and `npm run test:e2e:participant-public` pass locally and `.github/workflows/refactor-quality.yml` runs all three through the full quality gate on pushes and pull requests.
- Unified release behavior: `npm run quality:release` is the single entry point used locally and by GitHub Actions, so tests, build, strict lint and all browser gates cannot drift into different release definitions.
- Single-node hosting behavior: the real-network test blocks incomplete deployment processing, rejects unauthorized and incorrect uploads, audits a valid atomic upload, persists a deployment and launch link, reconstructs the service, redeems a participant, validates Bootstrap, downloads a checksum-verified signed asset, and rejects URL or file-content tampering.
- Hosted data-export behavior: the HTTP test exports the exact frozen bundle, every session event and snapshot, related audit provenance and aggregate counts, confirms integrity, rejects viewer access, and proves participant bearer credentials are absent.
- Backup/recovery behavior: tests create a private checksum-inventoried state/asset snapshot, verify and restore it, reject overwrite, tampering and symbolic links, and prove `/readyz` degrades when a processed asset changes.
- Operations behavior: unit and real-network tests prove independent bounded rate windows, 429/retry headers, default rejection of spoofed forwarded addresses, health exemption, owner-only metrics and aggregate-only metric content.
- Retention behavior: tests prove opt-in policy bounds, owner-only preview/confirmation, cutoff eligibility, confirmation conflicts, idempotent purge, credential/identity/event/snapshot/cache removal, audit continuity, pseudonymized export totals and durable restart recovery.
- Tenant-isolation behavior: two-tenant tests reuse actor IDs, bundle IDs and idempotency keys while proving separate queues, deployments, sessions, links, data, retention, audit, metrics and asset paths; cross-tenant resource probes return not-found and state 1.1 migrates safely.
- Credential-protection behavior: tests prove no participant/launch token plaintext survives serialization, lookup keys use HMAC digests, AES-GCM tampering and missing keys fail closed, old plaintext state upgrades eagerly, old-key state rotates to a new primary, and real Node restart preserves redemption/session access.
- Tenant-capacity behavior: tests prove isolated deployment/session/link/event admission, exact logical event-byte accounting, idempotent retries without double charging, owner-only HTTP visibility, invalid-policy rejection, and capacity release after governed retention purge.
- Audit-integrity behavior: tests prove authenticated entry linkage and count/head anchoring detect content edits, reordering and knowledgeable tail truncation; real Node startup rejects an edited audit file, old unchained protected state upgrades eagerly, and key rotation re-signs the chain.

## Known transition scope

The legacy editor and runner remain available for existing protocols. The public participant application and hosted execution contract are implemented; managed identity, production storage/CDN adapters, operational controls, and a managed cloud runtime remain deployment infrastructure work.
