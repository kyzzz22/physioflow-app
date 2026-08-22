# Legacy Protocol Migration Guide

Legacy `1.0.0` protocols remain readable in the existing editor. Migration creates a separate Protocol Graph draft; it never overwrites the source.

## In the app

Open the project card and choose **Migrate to Composer V2**. PhysioFlow opens the migrated draft and reports native component coverage plus review items.

## Command line

```bash
npm run migrate:v1 -- source.protocol.json migrated.protocol-graph.json
```

The command writes the migrated protocol and a neighboring `.migration-report.json` file.

## Safety rules

- Every legacy step payload is retained in `node.config.legacyStep`.
- Source IDs and the complete ID map are retained in `protocol.legacy` and the report.
- Linear steps become native Screen, Media, Wait, Rating, or Questionnaire components.
- Unmapped types use `legacy.step` and remain visible for manual replacement.
- Random order, repeats, custom code, and non-linear flow produce review warnings. The migration deliberately does not guess their semantics.
- Migrated protocols always remain drafts and cannot be treated as formal collection versions until reviewed and piloted.

The emotion, Stroop, and Go/No-Go representative protocols are continuously tested. Each must preserve every step payload, produce a valid graph, and maintain at least 90% native component coverage.
