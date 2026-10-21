# @spinel/presence-ui

Private Sheet presence renderer using Univer's public APIs. Spinel supplies a
validated cursor selection, color and React label; this package has no account,
network or storage dependencies. `drawPresence` returns a disposable for the
transient range highlight and popup. `setLocalSelectionColor` styles normal local
selections without changing document formatting or formula-reference styles.

Both functions optionally accept explicit `{ stroke, fill }` canvas colors. A
host with an adaptive palette can supply public theme tokens without the renderer
appending alpha suffixes to them. Keep the base `color` argument a literal color:
the SDK uses it to derive the normal local selection theme. These overrides apply
only to transient canvas controls; labels and profile storage remain host-owned.

Sheet popups use canvas containment and disappear when their cell is offscreen.
The host owns membership cleanup, theme/resize redraw and cursor events.

The SPN-036 prototype established that disabling document collaboration UI is not
safe for Docs in Univer 1.1.0: it causes missing-dependency errors. Docs retain the
native UI; custom Doc canvas colors belong to SPN-058 (owner, 2026-10-20).

The existing cursor transport sends cell addresses, not transformed operations.
A selection may lag while reconnecting; SPN-058 owns transport replacement.
