# Portable Deployment Contract 1.0

PhysioFlow deployment bundles separate experiment design from the system that hosts or executes it. A bundle contains one immutable Protocol Graph version, the exact frozen configuration hash, component/device/asset dependency manifests, target-provider metadata, an execution policy, and a second hash covering the complete bundle.

## Workflow

1. Validate and freeze the protocol version in Composer V2.
2. Open Advanced mode and choose the execution-provider ID and environment.
3. Export the portable deployment JSON.
4. Validate the bundle before handing it to a provider.
5. Upload every checksum-locked workspace asset and confirm deployment readiness.
6. A provider implementing `submit`, `status`, and `cancel` can accept the same bundle without changing the runtime or protocol model.

The execution policy can bound the total number of participant sessions, set an expiry timestamp, and optionally declare a 1–36,500 day data-retention period. Retention is `null` by default and never implies hidden deletion. Hosted services enforce immutable session/expiry limits and expose the separate reviewed cleanup workflow in `DATA_RETENTION.md`.

Composer can also inspect an imported deployment bundle and reports protocol or manifest tampering before any execution request is made.

## Safety and reproducibility

- Draft protocols cannot be deployed.
- The frozen snapshot is re-hashed during export and import.
- The outer bundle hash covers target metadata, dependency manifests, execution policy, and the protocol snapshot.
- Provider manifests are versioned and registered explicitly.
- Component permissions and device permissions travel with their dependency manifests.
- Workspace assets require safe unique IDs and SHA-256 checksums; their binary payloads are transported separately from the immutable JSON bundle.
- Execution-provider methods receive validated portable data rather than React state.

## Current boundary

The contract, bundle exporter/validator, provider registry, deterministic reference provider, hosted service boundary, governed single-node asset pipeline, and standalone public participant application are implemented. Production infrastructure still needs managed identity, multi-tenant access control, durable remote/object storage, and operations.
