# Single-Node Self-Hosting

PhysioFlow includes a dependency-free Node server for a small trusted deployment. It serves the built web application and `/participant`, mounts Hosted HTTP API v1, persists service state atomically, exposes liveness and readiness checks, accepts checksum-locked workspace assets, and delivers them through expiring HMAC-signed URLs.

## Start

Build the application, provide actor credentials, and start the server:

```bash
npm run build
PHYSIOFLOW_ACTORS_JSON='[{"actorId":"owner","role":"owner","accessToken":"replace-with-a-long-random-secret"}]' \
PHYSIOFLOW_STATE_FILE='./var/hosted-state.json' \
HOST='127.0.0.1' PORT='8787' \
npm run hosted:serve
```

The default static directory is `./dist`. Put the service behind an HTTPS reverse proxy before exposing it outside a trusted machine. Set `PHYSIOFLOW_PUBLIC_BASE_URL` to the external HTTPS origin when proxying.

## Configuration

| Variable | Purpose |
| --- | --- |
| `PHYSIOFLOW_ACTORS_JSON` | Required JSON array of owner/editor/operator/analyst/viewer credentials |
| `PHYSIOFLOW_STATE_FILE` | Atomic JSON state file; defaults to `./var/hosted-state.json` |
| `PHYSIOFLOW_STATIC_DIR` | Built application directory; defaults to `./dist` |
| `PHYSIOFLOW_PUBLIC_BASE_URL` | External origin used in signed links |
| `PHYSIOFLOW_ALLOWED_ORIGINS_JSON` | Exact CORS origin array when the participant app is hosted separately |
| `PHYSIOFLOW_ASSET_DIR` | Optional root for uploaded workspace assets |
| `PHYSIOFLOW_ASSET_SECRET` | Required with asset delivery; at least 32 characters |
| `PHYSIOFLOW_MAX_ASSET_BYTES` | Per-asset upload limit; defaults to 250 MiB |
| `PHYSIOFLOW_RATE_LIMITS_JSON` | Optional fixed-window limits; use `false` only behind an equivalent gateway |
| `PHYSIOFLOW_TRUSTED_PROXY_HOPS` | Exact trusted reverse-proxy hop count; defaults to `0` |
| `HOST`, `PORT` | Listen address and port |

The state writer validates every snapshot, writes a mode-`0600` temporary file, and atomically renames it into place. The file contains active bearer and launch credentials and must be protected like a secret. Back it up only through encrypted storage and never commit it.

## Health and recovery

`GET /healthz` is a lightweight process-liveness check. `GET /readyz` verifies that the state store can be read and written and that every processed deployment still has valid workspace assets. It returns HTTP 503 when either check fails; queued deployments may legitimately have missing assets and do not make the server unavailable.

The server applies bounded per-source limits to public redemption, API calls, asset upload and signed download. `GET /metrics` requires `audit.read` and exposes only aggregate process/resource counts. Forwarded addresses are ignored unless an exact trusted-proxy hop count is configured. See `HOSTED_OPERATIONS.md`.

Use the offline `hosted:backup`, `hosted:backup:verify`, and `hosted:restore` commands for checksum-inventoried state and asset backups. Restore refuses existing targets. Stop the server before creating a backup and rehearse recovery separately; see `BACKUP_AND_RECOVERY.md`.

## Workspace assets

Authenticated deployment uploads are stored using this path convention:

```text
<PHYSIOFLOW_ASSET_DIR>/<deployment bundle ID>/<asset ID>
```

Use the deployment asset API or `uploadDeploymentAssets` coordinator after publication. Only declared workspace assets can be uploaded, and only while the deployment is queued. The service validates permission, size, media type, and SHA-256 content before an atomic write and persistent audit entry. Deployment processing remains blocked until every required asset is valid.

When Bootstrap is requested, the resolver verifies that the file is inside the configured root, checks the protocol's SHA-256 checksum, and returns a 15-minute signed URL. Asset delivery validates expiry, media type, checksum, path identifiers, and the constant-time HMAC signature. It responds only to `GET` and `HEAD`. See `DEPLOYMENT_ASSETS.md`.

## Scope

The adapter is appropriate for one trusted process or a small lab server. It is not a multi-process database and does not provide tenant isolation, managed identity, key rotation, distributed locking, shared/distributed rate limiting, scheduled/remote backups, or full observability. Production multi-tenant deployments should retain the same service/store/asset boundaries while replacing the filesystem adapters with transactional storage and managed object delivery.

`tests/hosted-node-server.test.js` exercises real network publication, asset readiness blocking, authenticated upload, process-level service reconstruction from disk, public redemption, Bootstrap validation, participant static delivery, checksum validation, signed asset download, readiness degradation, and signature/file-replacement rejection. `tests/hosted-backup.test.js` proves private atomic backup creation, full inventory verification, safe restore, overwrite refusal, tamper detection, and symbolic-link rejection.
