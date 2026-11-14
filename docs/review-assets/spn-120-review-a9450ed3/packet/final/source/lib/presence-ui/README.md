# @spinel/presence-ui

Private Sheet and Doc presence renderer using Univer's public APIs. Spinel supplies a
validated cursor selection, color and React label; this package has no account,
network or storage dependencies. `drawPresence` returns a disposable for the
transient range highlight and popup. `setLocalSelectionColor` styles normal local Sheet
selections without changing document formatting or formula-reference styles.
`setLocalDocSelectionColor` styles a single local text selection through the public
render API, retaining offsets, direction and focus. It waits during pointer drags,
IME composition and pending layout, and leaves rectangle/multiple selections alone.

Both functions optionally accept explicit `{ stroke, fill }` canvas colors. A
host with an adaptive palette can supply public theme tokens without the renderer
appending alpha suffixes to them. Keep the base `color` argument a literal color:
the SDK uses it to derive the normal local selection theme. These overrides apply
only to transient canvas controls; labels and profile storage remain host-owned.

Sheet and Doc popups use canvas containment and disappear when their range is offscreen.
The host owns membership cleanup, theme/resize redraw and cursor events.
The final optional `popupOptions` argument accepts `{ zIndex }`, forwarded through
the public popup API so a host can place remote labels below its dialogs and
menus. Omission preserves the SDK default; the package defines no application
layer policy.

Doc remote ranges use the public `getTextRangeFromCharIndex`/`TextRange` renderer
against `DocSkeletonManagerService.getSkeleton()`. They are separate canvas objects:
they never replace local selections or execute mutations. Their labels register
with `ComponentManager` and attach through `DocCanvasPopManagerService`; cleanup
removes the popup, component and range. Passive labels set
`requiresStableLayout: false` so peers cannot hold asynchronous page layout.

`parseDocSelection` accepts body insertion offsets and rejects header/footer,
rectangle, out-of-bounds and terminal stream-marker positions. The host owns
membership, cursor transport, throttling, redraw on layout/theme/scroll/resize,
and explicit jump-to-range actions. A disconnect disposes ephemeral ranges; cursor
updates never become document edits or durable-save confirmations.

The default legacy collaboration path is unchanged. The SPN-058 flagged client
uses this Doc renderer with the native OSS Docs services enabled, avoiding the
SPN-036 experimental UI-disable switch that omitted required services.
