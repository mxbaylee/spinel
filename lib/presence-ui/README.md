# @spinel/presence-ui

Private Sheet presence renderer using Univer's public APIs. Spinel supplies a
validated cursor selection, colour and React label; this package has no account,
network or storage dependencies. `drawPresence` returns a disposable for the
transient range highlight and popup. `setLocalSelectionColor` styles normal local
selections without changing document formatting or formula-reference styles.

Sheet popups use canvas containment and disappear when their cell is offscreen.
The host owns membership cleanup, theme/resize redraw and cursor events.

The SPN-036 prototype established that disabling document collaboration UI is not
safe for Docs in Univer 1.1.0: it causes missing-dependency errors. Docs retain the
native UI; custom Doc canvas colours belong to SPN-058 (owner, 2026-10-20).

The existing cursor transport sends cell addresses, not transformed operations.
A selection may lag while reconnecting; SPN-058 owns transport replacement.
