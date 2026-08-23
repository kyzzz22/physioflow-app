# Single-Node Self-Hosting

PhysioFlow includes a dependency-free Node server for a small trusted deployment. It serves the built web application and `/participant`, mounts Hosted HTTP API v1, persists service state atomically, exposes `/healthz`, and can deliver pre-provisioned workspace assets through expiring HMAC-signed URLs.

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
| `PHYSIOFLOW_ASSET_DIR` | Optional pre-provisioned asset root |
| `PHYSIOFLOW_ASSET_SECRET` | Required with asset delivery; at least 32 characters |
| `HOST`, `PORT` | Listen address and port |

The state writer validates every snapshot, writes a mode-`0600` temporary file, and atomically renames it into place. The file contains active bearer and launch credentials and must be protected like a secret. Back it up only through encrypted storage and never commit it.

## Workspace assets

Binary assets are provisioned using this path convention:

```text
<PHYSIOFLOW_ASSET_DIR>/<deployment bundle ID>/<asset ID>
```

When Bootstrap is requested, the resolver verifies that the file is inside the configured root, checks the protocol's SHA-256 checksum, and returns a 15-minute signed URL. Asset delivery validates expiry, media type, path identifiers, and the constant-time HMAC signature. It responds only to `GET` and `HEAD`.

This adapter deliberately does not accept anonymous file uploads. An operator or deployment pipeline must provision files before participants launch. This avoids turning the reference server into an unaudited general-purpose upload surface.

## Scope

The adapter is appropriate for one trusted process or a small lab server. It is not a multi-process database and does not provide tenant isolation, managed identity, key rotation, distributed locking, rate limiting, automated backups, or observability. Production multi-tenant deployments should retain the same service/store/asset boundaries while replacing the filesystem adapters with transactional storage and managed object delivery.

`tests/hosted-node-server.test.js` exercises real network publication, process-level service reconstruction from disk, public redemption, Bootstrap validation, participant static delivery, checksum validation, signed asset download, and signature rejection.
