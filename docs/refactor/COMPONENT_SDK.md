# PhysioFlow Declarative Component SDK 1.0

The project component SDK extends Composer V2 without allowing arbitrary JavaScript inside Runtime V2. A package is JSON data stored in the protocol snapshot, included in the freeze hash, and registered only after validation and explicit permission approval.

## Package contract

```json
{
  "sdkVersion": "1.0.0",
  "packageId": "org.example.my-component",
  "version": "1.0.0",
  "name": "My component package",
  "publisher": "Example Lab",
  "permissions": ["events.emit"],
  "components": []
}
```

Each component uses the same registry definition as built-ins: stable `type` and semantic `version`, control/data ports, schema-driven editor defaults, participant UI schema, lifecycle events, and exported data fields. SDK components must use `runtime.kind: "participant"` and `runtime.uiAdapter: "schema"`. Executable control handlers and code strings are rejected.

## Permissions

Supported capabilities are:

- `session.variables.read`: expose protocol variables to UI bindings.
- `session.variables.write`: accept submitted variable changes.
- `events.emit`: record custom UI action events.
- `assets.read`: use project asset IDs in participant UI.
- `network.media`: load remote media URLs.

Importing a package does not grant capabilities automatically. Composer lists every requested capability and enables installation only after all are explicitly approved. The approved set is persisted with the installed package. Graph validation blocks unapproved variable, asset, and network-media access, while the runner restricts variable context, variable writes, and custom UI action emission.

## Lifecycle

1. Author and validate a JSON package against SDK `1.0.0`.
2. Import it from Composer V2 Advanced mode.
3. Review and approve requested permissions.
4. Install it into the project component library.
5. Add its components from the normal palette and configure their participant UI.
6. Freeze the protocol; package definitions and approvals become part of the reproducible snapshot.
7. Uninstall only when no graph node uses the package, unless an explicit destructive migration removes those nodes first.

`src/sdk/exampleReactionButtonPackage.js` is the reference implementation. It declares one participant component with control input/output, a boolean data output, schema UI, lifecycle events, and no executable extension code.
