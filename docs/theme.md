# Spinel appearance

Spinel defaults to the browser's system colour scheme. Settings → Appearance
lets a person choose Vintage (light), Modern (dark), or Follow system. The
preference is stored on that browser, with cross-tab updates. Storage failures
keep the choice for the current visit and show an explanation. It is not an
account setting and never changes another person's view.

The original gem-rail reference now lives in `src/ui/`: palette tokens,
faceted-heart artwork, shell CSS and editor integration. Light uses warm rose,
coral and magenta; dark uses cosmic purple, charcoal and cyber-magenta. The gem
points down in light and flips in dark, wiggles on hover/focus, respects reduced
motion, and links to Your docs. Rail controls reveal their labels on hover and
keyboard focus. All artwork is original; no character art or external fonts are
loaded. The reference files and preview script have been retired.

Sheets and Docs update the public Univer ThemeService in place. A theme switch
must not recreate an editor or submit a document revision. The eventual Slides
editor must use this same integration and supply light/dark screenshots; that
requirement remains in SPN-009. Admin access remains separate from documents.

## Sheet fills

Cell fill presets provide soft and strong variants of primary, secondary,
success, warning, error, info, neutral and highlight. Applying a preset writes
its canonical light background/text pair through the normal collaborative
command path. A style-only display interceptor maps that exact pair to the
current browser's palette, without modifying saved data, formulas or unrelated
formatting. Rich-text runs adapt on a cloned display model; the public before-edit
interceptor restores canonical colours before typing so display colours cannot
leak into stored edits. Viewers see the result but cannot apply presets.

Changing either colour to a different pair makes it fixed custom formatting.
An imported or manually chosen pair identical to a preset has the same preset
semantics. Exports see the stored canonical colours. These explicit semantics
avoid undocumented metadata or patching Univer internals; decision
[#66](https://github.com/mxbaylee/spinel/issues/66), 2026-10-18.

## Verification

`src/ui/presetStyles.test.ts` checks WCAG AA text contrast (at least 4.5:1) for
shell text pairs and all sixteen fills in both modes, and verifies that display
mapping preserves source styles. `e2e/appearance.spec.ts` checks preferences, real
rendered fill pixels, values/formulas/formatting, unchanged revisions and editor
identity across theme changes. CI captures dashboard, Sheets and Docs in both
themes under the `theme-screenshots` artifact for visual review. Screenshots
contain synthetic fixture data only and expire after seven days.
