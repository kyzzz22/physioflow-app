# Public Participant Application

The participant application is a dedicated execution surface at `/participant`. It does not initialize the project dashboard, protocol editor, operator controls, or analyst views.

## Launch URL

Launch credentials belong in the URL fragment:

```text
https://experiments.example/participant#launch=<opaque-token>&api=https%3A%2F%2Fapi.example
```

Fragments are not sent in HTTP request paths or referrer headers. `createParticipantLaunchUrl` creates this form. The application accepts an optional `participantId`; production deployments should omit personally identifying values from URLs.

## Startup sequence

1. Parse the fragment and require HTTPS for the API, except for loopback development hosts.
2. Hash the opaque launch token into a deterministic idempotency key.
3. Redeem the token anonymously for a session-scoped access token.
4. Fetch current session metadata so Runtime synchronization starts from the latest revision and event sequence.
5. Download and validate Participant Bootstrap, including its exact frozen protocol, resources, and optional recovery checkpoint.
6. Choose the newest matching local or hosted checkpoint and start Runtime V2.
7. Upload events, snapshots, and the terminal outcome through `HostedRuntimeSync`.

Refreshing or reopening the same launch link repeats redemption safely without consuming a second link use. A fully synchronized server checkpoint permits recovery even when browser-local recovery data is absent. Terminal sessions reject new Bootstrap requests.

## Hosting requirements

For cross-origin deployment, configure `createHostedHttpHandler(..., { allowedOrigins })` with the exact participant application origins. The default exposes no CORS permission. Production hosting must additionally supply durable state, HTTPS, rate limiting, monitoring, managed secrets/identity, retention enforcement, and a signed asset resolver or CDN.

## Verification

`npm run test:e2e:participant-public` starts a real HTTP adapter on a separate origin, opens an isolated Chrome profile on `/participant`, redeems a one-use token, removes local recovery state, reloads, restores from the hosted checkpoint, and completes the session. It is part of `npm run quality:release`.
