# Spinel appearance

Spinel defaults to the browser's system color scheme. Settings → Appearance
lets a person choose Vintage (light), Modern (dark), or Follow system. The
preference is stored on that browser, with cross-tab updates. Storage failures
keep the choice for the current visit and show an explanation. It is not an
account setting and never changes another person's view. Signing in does not
override it. Guests use the same browser-local choice; the redesign places it
in This device and compact navigation/guest controls, outside saved profile
identity (owner, chat 2026-10-20, decision #126).

The original gem-rail reference now lives in `src/ui/`: palette tokens,
faceted-heart artwork, shell CSS and editor integration. Light uses warm rose,
coral and magenta; dark uses cosmic purple, charcoal and cyber-magenta. The gem
points down in light and flips in dark, wiggles on hover/focus, respects reduced
motion, and links to Your docs. Rail controls reveal their labels on hover and
keyboard focus. All artwork is original; no character art or external fonts are
loaded. The reference files and preview script have been retired.

Sheets and Docs update the public Univer ThemeService in place. A theme switch
must not recreate an editor or submit a document revision. A public canvas-color
service delegates ordinary document colors and SDK tokens to Univer's public
`CanvasColorService`, so paper, text, formula input and chrome follow dark mode.
Our preset tokens resolve directly to their accessible palette, avoiding a
second inversion. These tokens exist only on cloned rendering models; the
saved document remains canonical. Ephemeral presence outlines and translucent fills
use the same token boundary so profile badges and canvas cursors keep matching
colors, including identity-free guest fallbacks. Sheet display
caches, including inactive tabs, are invalidated on a theme change. Admin access remains separate from documents.
Docs disables the SDK's 50%-opacity canvas placeholder through its public config
and shows the typing instruction as normal, contrast-checked shell text.

## Sheet fills

Cell fill presets provide soft and strong variants of primary, secondary,
success, warning, error, info, neutral and highlight. Applying a preset writes
its canonical light background/text pair through the normal collaborative
command path. A style-only display interceptor maps that exact pair to the
current browser's palette, without modifying saved data, formulas or unrelated
formatting. Rich-text runs adapt on a cloned display model; the public before-edit
interceptor restores canonical colors before typing so display colors cannot
leak into stored edits. Viewers see the result but cannot apply presets.

Changing either color to a different pair makes it custom formatting. Its stored
color stays fixed; like ordinary paper and text, its on-screen rendering follows
Univer's native dark-mode conversion.
An imported or manually chosen pair identical to a preset has the same preset
semantics. Snapshot-based exports see the stored canonical colors. Native print
and raster output use their own rendering paths; identical print colors across
themes have not been verified, so this is not a print-fidelity guarantee. These explicit semantics
avoid undocumented metadata or patching Univer internals; decision
[#66](https://github.com/mxbaylee/spinel/issues/66), 2026-10-18.

## Verification

`src/ui/presetStyles.test.ts` checks WCAG AA text contrast (at least 4.5:1) for
shell text pairs and all sixteen fills in both modes, and verifies that display
mapping preserves source styles. `src/ui/editorTheme.test.ts` verifies the installed
render service uses native dark conversion, resolves updated tokens, preserves
all sixteen preset display pairs, and leaves serialized styles/formulas intact.
`e2e/appearance.spec.ts` checks preferences, real
rendered fill pixels, values/formulas/formatting, unchanged revisions and editor
identity across theme changes, including dark paper and light text in actual
Sheet and Doc canvases. CI captures dashboard, Sheets and Docs in both
themes under the `theme-screenshots-*` artifacts, one per Playwright run, for visual review. Screenshots
contain synthetic fixture data only and expire after seven days.

## Approved follow-up

Owner, 2026-10-21, decision #126, corrected in chat: usable native dark canvas
ships in SPN-047, including the production editors, snapshot viewers and native
review examples. SPN-088 investigates eight logical colors with light/dark
display pairs in native pickers. Public picker replacement is not yet established; use supported APIs
and retain the native picker if necessary. Preserve stored styles, existing
preset/profile colors and exports, rather than treating a theme switch as an edit.
