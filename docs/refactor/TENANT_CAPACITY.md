# Hosted Tenant Capacity

The hosted service can apply independent logical capacity policies to each server-assigned tenant. Limits are injected by the hosting environment and are never accepted from request headers, bodies, deployment bundles, or participant credentials.

## Configuration

`PHYSIOFLOW_TENANT_LIMITS_JSON` is an object keyed by exact tenant ID. Omitted tenants and omitted fields are unlimited.

```bash
PHYSIOFLOW_TENANT_LIMITS_JSON='{
  "lab-a": {
    "maximumDeployments": 25,
    "maximumSessions": 5000,
    "maximumLaunchLinks": 250,
    "maximumStoredEvents": 5000000,
    "maximumStoredEventBytes": 10737418240
  }
}'
```

Every configured value must be a non-negative safe integer or `null`. Zero disables that resource type. Unknown fields and malformed tenant IDs stop startup so a misspelled limit cannot silently become ineffective.

## Enforcement semantics

- Deployment, session, launch-link, and event capacity is checked inside the service mutation before any new record is committed.
- A rejected request returns the normal HTTP 409 `conflict` response with a quota-exhausted message.
- Idempotent retries return their original result and do not consume capacity again.
- Limits are tenant-local; one tenant's consumption cannot block another tenant.
- `maximumStoredEvents` counts currently retained raw events, and `maximumStoredEventBytes` counts their UTF-8 JSON representation. Snapshots, audit entries, assets, and exported copies are outside these two logical research-event limits.
- Governed retention purge removes raw events and immediately releases their event-count and event-byte capacity. Deployment, session, and launch-link counts remain lifecycle counts and are not released by data pseudonymization.

Owners can call `GET /v1/tenant-capacity` with `audit.read` permission. The response contains only their tenant ID, configured limits, current usage, remaining capacity, and measurement time. Unlimited values are `null`; no cross-tenant totals or record identifiers are exposed.

These application-layer limits protect a trusted single-node service from unbounded logical growth. They are not filesystem reservations or billing meters. Production deployments should also enforce database/object-storage quotas, alerting, admission control, and transactional counters in the durable infrastructure layer.
