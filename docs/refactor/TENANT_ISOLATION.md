# Hosted Tenant Isolation

Hosted state 1.3 assigns every configured actor to one tenant and propagates that tenant to deployments, sessions, participant-token mappings, launch links, audit entries, idempotency scopes, metrics, and filesystem asset namespaces.

## Actor configuration

Set `tenantId` on every actor credential:

```json
[
  { "actorId": "owner", "role": "owner", "tenantId": "lab-a", "accessToken": "replace-with-a-long-random-secret" },
  { "actorId": "operator", "role": "operator", "tenantId": "lab-a", "accessToken": "replace-with-another-long-random-secret" }
]
```

Tenant IDs are 1–128 characters and may contain letters, numbers, dot, underscore, and dash. Actors without `tenantId` remain in the backwards-compatible `default` tenant. Actor IDs may repeat across different tenants; idempotency keys include an unambiguous tenant/actor tuple.

## Enforced boundaries

- A deployment inherits the publishing actor's tenant and cannot be reassigned.
- Deployment processing selects only the caller tenant's next queued deployment.
- Sessions, launch links, retention plans, exports, and asset operations require both role permission and matching tenant.
- Cross-tenant requests for a known resource ID return the same not-found result as an unknown ID, preventing existence disclosure.
- Participant tokens remain restricted to one session and inherit that session's tenant.
- Audit reads and resource metrics include only the authenticated actor's tenant.
- Request counters are recorded per authenticated tenant; unauthenticated launch and signed-delivery traffic is kept in a separate public bucket.
- Authenticated rate-limit windows are tenant-partitioned, so tenants sharing a proxy address do not consume each other's allowance.
- Optional capacity policies independently bound each tenant's deployments, sessions, launch links, retained events, and logical event bytes; owner-visible usage contains no other tenant totals.
- New filesystem assets use `<asset-root>/<tenantId>/<deploymentId>/<assetId>`, preventing deployments with the same portable bundle ID from sharing files.

Signed participant asset URLs remain usable without an actor credential because they contain an expiry, checksum, media type, and HMAC signature. The tenant/deployment path is covered by that signature.

## Upgrade behavior

State 1.3 reads state 1.0–1.2. Historical pre-tenant records are assigned to `default`, legacy idempotency keys remain replayable, and legacy assets continue to use `<asset-root>/<bundleId>/<assetId>`. Node startup immediately rewrites legacy plaintext credentials into the protected 1.3 representation. New publications always use the isolated asset namespace.

## Boundary of the guarantee

This is application-layer tenant isolation with validated persistent relationships and logical admission quotas. The single-node adapter still stores all tenants in one state file and one backup set; readiness is process-wide. Production installations needing contractual or regulatory separation should add managed identity, tenant-aware database row policies, encryption/key separation, per-tenant backup lifecycle, physical storage quotas, and independent audit export. Never treat a user-supplied tenant header as identity—the tenant comes only from the server-configured bearer credential or scoped participant/launch record. See `TENANT_CAPACITY.md`.
