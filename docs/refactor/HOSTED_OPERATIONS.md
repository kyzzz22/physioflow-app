# Hosted Operations and Abuse Controls

The single-node adapter includes process-local request limiting and privacy-minimized operational metrics. These controls make a small trusted lab deployment safer and diagnosable without changing Hosted Service Contract 1.0.

## Request limiting

Rate limits use fixed per-source windows with separate scopes:

| Scope | Default per 60 seconds |
| --- | ---: |
| Public launch redemption | 60 |
| Authenticated Hosted API and metrics | 600 |
| Workspace asset upload | 30 |
| Signed asset download | 600 |

The limiter partitions authenticated windows by the server-resolved tenant and stores only a process-random salted hash of that partition plus source address. One tenant therefore cannot consume another tenant's window when they share a proxy address. Public traffic uses a separate partition. The key table is capped at 10,000 entries and expired/old entries are removed, preventing unbounded memory growth. Rejected requests return HTTP 429 with stable `rate_limited` JSON, `Retry-After`, and remaining/reset headers. Health/readiness, CORS preflight, and static application delivery are exempt.

Override all values with `PHYSIOFLOW_RATE_LIMITS_JSON`, for example:

```bash
PHYSIOFLOW_RATE_LIMITS_JSON='{"windowMs":60000,"maxEntries":20000,"publicRedemption":120,"api":1200,"assetUpload":60,"assetDownload":1200}'
```

Set the JSON value to `false` only when an upstream gateway provides an equivalent tested policy. The limiter is per process: a multi-process or multi-host service requires a shared gateway/store limiter.

## Proxy source identity

By default the adapter uses the TCP peer address and ignores `X-Forwarded-For`. When it is directly behind a controlled reverse proxy, set `PHYSIOFLOW_TRUSTED_PROXY_HOPS` to the exact number of trusted hops. A value of `1` trusts the rightmost address supplied by one proxy. Incorrectly trusting more hops can let clients choose their apparent address, so do not enable this for a server directly reachable from the internet.

## Metrics

`GET /metrics` requires a Bearer actor with `audit.read` (owner in the reference roles). It returns Hosted Metrics 1.0 JSON with:

- uptime and tenant-scoped total/error/status response counts;
- tenant-scoped rate-limit rejections and non-identifying limiter configuration;
- aggregate deployment/session counts by status;
- aggregate stored event count.

Resource and request aggregates are filtered to the authenticated actor's tenant. The response contains no deployment ID, session ID, participant ID, event payload, actor ID, token, source address, global request total, or other tenant's limiter utilization. It uses `Cache-Control: no-store`. Scrape it through the same TLS/authentication boundary as the research application.

These are baseline process metrics, not full observability. Production operations still need external logs with redaction, alert rules, durable time-series storage, distributed traces where appropriate, and monitoring of the reverse proxy, database, object store and backup jobs.
