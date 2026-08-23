# Hosted Deployment Data Export

Hosted Data Export 1.0 provides one permission-checked package for every record associated with a published deployment. It closes the gap between per-session inspection and a reproducible study-level handoff.

`GET /v1/deployments/:id/data` requires `data.read` and returns:

- the public deployment record and exact frozen deployment bundle;
- all associated session metadata, raw Runtime V2 events, and latest runtime snapshots;
- launch-link metadata without opaque launch tokens;
- the audit entries associated with the deployment or any exported session;
- session/event/status totals and an integrity result.

The integrity pass checks deployment/session count agreement, each session's stored event count, contiguous event sequences, unique event IDs, and snapshot-to-event sequence agreement. It reports issues instead of silently dropping a damaged record.

Actor credentials, participant access tokens, launch tokens, internal idempotency state, and unrelated deployment audit entries are not exported. Participant IDs remain present because they are part of the experiment record; downstream storage and sharing must therefore follow the study's consent, pseudonymization, retention, and access-control policy.

The single-node JSON response is intended for a lab-sized deployment. Large or multi-tenant installations should preserve this schema while using a streaming archive/job adapter and encrypted durable storage.
