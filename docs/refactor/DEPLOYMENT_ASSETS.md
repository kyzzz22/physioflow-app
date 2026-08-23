# Deployment Asset Pipeline

Frozen workspace media is part of deployment integrity even though the binary payload is stored separately from the JSON bundle. The deployment manifest normalizes modern and legacy asset fields into an ID, name, media type, SHA-256 checksum, and `workspace` or `remote` source.

Every workspace asset must have a safe unique ID and SHA-256 checksum before a bundle can be created or accepted. Remote resources remain governed by Participant Bootstrap URL policy.

## Flow

1. Publish the integrity-checked deployment bundle. It remains `queued`.
2. Read `GET /v1/deployments/:id/assets` to inspect required workspace assets.
3. Upload each binary with `PUT /v1/deployments/:id/assets/:assetId` and its declared media type.
4. The server checks actor permission, deployment lifecycle, size, media type, manifest declaration, and SHA-256 content.
5. The binary is written through a mode-`0600` temporary file and atomic rename. A persistent audit event records the accepted upload. Repeating the same checksum-locked PUT is idempotent: it returns `unchanged` and does not append a duplicate audit entry.
6. Process the deployment. A deployment with any missing or invalid workspace asset remains `queued` with an `assets_incomplete` conflict.
7. After the deployment is `ready`, its assets are immutable through the upload API.

`uploadDeploymentAssets` coordinates this flow in browser or desktop code using an injected local asset loader. It stops before transport when a local file is missing or its stored checksum contradicts the frozen manifest, uploads only workspace dependencies, reports progress, and verifies final server readiness.

## Authorization

Owners, editors, and operators have `deployment.asset.write`; analysts and viewers do not. Asset-status reads follow `deployment.read`. Upload endpoints require Bearer authentication and participate in the configured explicit CORS policy.

## Self-hosted storage

The single-node server writes accepted files under:

```text
<PHYSIOFLOW_ASSET_DIR>/<deployment bundle ID>/<asset ID>
```

The same store later verifies the checksum again before signing Bootstrap delivery and on every download. Upload bodies default to a maximum of 250 MiB and can be limited with `PHYSIOFLOW_MAX_ASSET_BYTES`.

The real-network test proves that processing is blocked before upload, unauthorized and incorrect uploads are rejected, valid upload is audited and survives restart, post-ready replacement is rejected, and signed delivery refuses both URL tampering and file replacement.
