# Single-Node Backup and Recovery

The hosted Node adapter includes a dependency-free offline backup format for its validated service state and workspace assets. A backup is a private directory containing `state.json`, optional `assets/`, and `manifest.json` with the size and SHA-256 checksum of every file.

## Create and verify

Stop the hosted server before taking a backup so no publication, upload, or participant event can race the snapshot. Then run:

```bash
PHYSIOFLOW_STATE_FILE='./var/hosted-state.json' \
PHYSIOFLOW_ASSET_DIR='./var/assets' \
npm run hosted:backup -- './var/backups/2026-08-23'

npm run hosted:backup:verify -- './var/backups/2026-08-23'
```

Creation validates the hosted state schema, rejects symbolic links and unsupported filesystem entries, copies files with mode `0600`, writes the manifest last, verifies the completed temporary directory, and atomically renames it to the requested destination. It refuses an existing destination.

The manifest detects accidental truncation, replacement, missing files, and unexpected files. It is not a cryptographic signature: keep the backup in encrypted, access-controlled storage and use storage-level immutability or signing when authenticity against an attacker is required.

## Restore rehearsal

Restore always targets new paths and refuses to overwrite a state file or asset directory:

```bash
npm run hosted:restore -- \
  './var/backups/2026-08-23' \
  './var/recovery/hosted-state.json' \
  './var/recovery/assets'
```

The tool verifies the complete backup before creating a target, restores assets through a temporary directory and atomic rename, then writes the validated state through `FileHostedStateStore`. If the backup contains assets, an asset target is mandatory.

After restoration, start a server against the recovery paths, confirm `/readyz` returns HTTP 200, redeem a disposable test launch link if policy permits, and verify an exported Deployment package before promoting the recovery copy. Maintain multiple dated backups and rehearse restoration on a separate machine; backup creation alone is not recovery evidence.
