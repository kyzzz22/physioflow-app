# External Device Connector Contract 1.0

PhysioFlow device connectors separate reproducible protocol configuration from host-specific hardware code. The protocol stores a versioned manifest, permissions, typed channels, units, and sampling metadata. A trusted host adapter implements `connect`, `read`, `write`, and `disconnect`; adapter code is never embedded in the protocol.

## Manifest

A connector declares:

- `sdkVersion`, stable `connectorId`, semantic `version`, name, and transport;
- requested `device.connect`, `device.read`, and/or `device.write` permissions;
- typed input/output channels with optional units and sample rates.

Composer Advanced mode can import a JSON manifest or install the simulated reference connector. Every requested permission must be approved before installation. Graph validation checks manifests, duplicate versions, approvals, and node references. A connector cannot be uninstalled while graph nodes reference it.

## Runtime adapter port

`DeviceConnectorSession` receives an injected adapter, clock, ID factory, session ID, and event sink. It never reaches browser or operating-system APIs directly. This keeps Web Serial, Web Bluetooth, USB, network, and vendor SDK integration behind a replaceable host boundary.

The session exposes:

- `connect(config)` with requested/connected/failed events;
- `read(channelId)` with typed sample and device timestamp provenance;
- `write(channelId, value)` with marker acknowledgement events;
- `disconnect(reason)`;
- `recover(config, { maxAttempts })` with explicit attempt/failure/recovered events;
- `provenance()` for connector, transport, device identity, firmware, status, and sequence state.

Every event records connector ID/version/transport, device descriptor, wall and monotonic time, immutable sequence, session ID, and complete payload. Graph exports include raw `device_events.jsonl` and normalized `device_events.csv`; the manifest and data dictionary describe their counts and columns.

`exampleSimulatedConnector` and `createSimulatedDeviceAdapter` provide a deterministic reference with a numeric signal input and string marker output. Hardware-specific adapters can be implemented without changing the Protocol Graph or Runtime V2 state machine.
