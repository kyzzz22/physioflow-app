# Local-first Collaboration Change Sets 1.0

Collaboration change sets let researchers exchange and review Protocol Graph edits without making a network service a prerequisite for experiment design or execution. They are the transport-neutral foundation for later real-time or cloud collaboration.

## Workflow

1. Open a draft in Composer Advanced and select **Use current as baseline** before editing.
2. Make protocol changes normally. Graph commands remain the only mutation path used by Composer.
3. Enter an author ID and summary, then export the change set as JSON.
4. Another editor imports the file into the same protocol ID, project ID and version.
5. Independent field changes merge automatically. If both sides changed the same field from the baseline, the editor must explicitly keep the local value or use the incoming value.
6. Apply only after every conflict is resolved. The protocol records the change-set ID, author, hashes, operation counts, resolution count and application time in `collaboration.history`.

## Contract and safety

- Schema: `physioflow collaboration change set 1.0.0` via `CHANGE_SET_SCHEMA_VERSION`.
- Scope: one Protocol Graph identity and one version. Change sets never cross project, protocol or version boundaries.
- Granularity: stable graph/entity IDs plus nested field paths. Independent fields on the same node can merge without conflict.
- Supported entities: nodes, edges, groups, variables, assets, UI templates, subflow templates, component packages and device connectors, plus selected protocol-level configuration.
- Frozen protocols reject incoming changes; create an editable version first.
- Imported files are declarative data. Validation rejects unknown targets, duplicate operation IDs, protected protocol/entity identity edits, array-index/prototype paths, malformed hashes and more than 10,000 operations.
- Applying the same change-set ID more than once is idempotent and does not duplicate protocol history.
- The `before` snapshot on every operation provides the common ancestor needed for deterministic three-way comparison. No last-writer-wins fallback silently overwrites a conflict.
- Base and result configuration hashes make the exported origin auditable. Local independent edits are retained in the merged protocol.

## Deliberate boundary

This contract does not claim online presence, live cursors, user authentication or server synchronization. A future WebSocket/cloud transport can deliver the same change-set envelope, but identity, authorization, retention and real-time ordering require a separate deployment design.
