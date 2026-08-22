# Composer V2 Pilot Guide

1. Create a new protocol or migrate a legacy draft.
2. Build the control flow in Composer V2. Resolve every blocking graph validation issue.
3. Select each participant-facing node. Configure its interface tree and preview Instruction, Media, and Form variants.
4. Run a preview with a non-identifying participant code. Exercise pause, retry, skip, response submission, and recovery where applicable.
5. Finish the session and export the complete data package.
6. Inspect `quality_report.json`; it must not be `invalid`.
7. Confirm `events.jsonl`, `responses.jsonl`, normalized CSV files, the exact protocol/runtime snapshots, component and asset manifests, and the data dictionary are present.
8. Validate an unpacked package with `npm run validate:graph-export -- <directory>`.
9. For migrated work, review every migration warning and compare the V2 preview with the source protocol before formal collection.

Do not use a migrated or draft protocol for formal collection solely because graph validation passes. Formal readiness also requires operator review, one successful pilot, stable local storage, assets, and an accepted data quality report.
