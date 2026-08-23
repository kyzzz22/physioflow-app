# Refactor Release Checklist

- [x] `npm run quality:release` passes as the single automated release gate.
- [x] Lint completes with zero errors and zero warnings.
- [x] Composer V2 can create, edit, connect, validate, save, reopen, duplicate, version, archive, import, and export a graph protocol.
- [x] Instruction, Media, and Form participant interfaces render without custom code.
- [x] Runtime V2 executes deterministic linear, branch, and bounded-loop fixtures.
- [x] Pause, resume, retry, skip, snapshot, and recovery tests pass.
- [x] Self-hosted legacy and Composer V2 browser gates pass from clean profiles.
- [x] Collaboration change sets export, merge independent edits, require conflict resolution, reject unsafe input and retain audit provenance.
- [x] Portable deployment bundles reject drafts and detect protocol or manifest tampering.
- [x] Hosted service enforces roles, idempotency, deployment queues, session revisions, contiguous event ingestion and audit provenance.
- [x] Runtime V2 retries hosted event/snapshot acknowledgements without duplication and completes the remote session exactly once.
- [x] Hosted HTTP transport and persistent-state recovery preserve authentication boundaries, idempotency, session data and audit history.
- [x] Participant launch tokens enforce expiry, quotas, revocation and deployment deactivation without interrupting active sessions.
- [x] Complete session package includes all raw, normalized, metadata, dictionary, manifest, and quality files.
- [x] Emotion, Stroop, and Go/No-Go migrations exceed 90% native mapping and retain every source payload.
- [ ] A human pilot follows `OPERATOR_PILOT_GUIDE.md` and `USABILITY_STUDY_PROTOCOL.md`; `npm run verify:usability-study -- <results.json>` returns `passed: true`.
- [x] Legacy protocols remain untouched and readable during the transition period.
