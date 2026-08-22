# Trusted Control Handler Contract 1.0

Control handlers extend Runtime V2 with deterministic routing behavior while keeping executable code outside protocol and component package data. A protocol references a stable handler ID and semantic version; the host application decides which trusted implementations are registered.

## Safety boundary

- Handler implementations are host-installed JavaScript, never imported from Composer JSON or the declarative Component SDK.
- Runtime passes a structured clone of node configuration and resolved data inputs, then deeply freezes it before execution.
- Handlers are synchronous and return only a declared control-output port plus an optional allow-listed event and payload.
- Runtime rejects unknown handler versions, asynchronous results, undeclared output ports, and event types outside the handler allow-list.
- The normal graph validator still enforces required ports and data bindings before a protocol can be frozen or run.

## Registration

Register `{ id, version, allowedEvents, execute }` in `ControlHandlerRegistry`. IDs use lowercase dot/dash notation and versions use semantic versioning. `execute(context)` returns:

```js
{
  selectedPort: 'match',
  eventType: 'control_handler_evaluated',
  payload: { matched: true },
}
```

The built-in `core.value-switch@1.0.0` demonstrates the contract. Its `logic.value-switch` component compares the resolved `value` data input with the configured `match` value and follows either the `match` or `default` control branch.

This is a trust boundary, not a general-purpose script sandbox. Deployments should review, test, version, and explicitly register handler implementations alongside application code.
