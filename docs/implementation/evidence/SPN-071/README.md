# SPN-071 visual and browser evidence

Source captured: `799706b20222cce2fb551db243758c05ebd41816`.
The commit adding these files changes only evidence and documentation; the
production UI is identical to the captured source. Final exact-commit CI,
independent code grades and visual approval are maintained in
[PR #226](https://github.com/mxbaylee/spinel/pull/226). **Agent review only.**

The shipped Dashboard, AccessDetails, Space and SaveStatus stories were built
with Storybook's supported `--test` option to fit the local memory cap. This
omits catalog documentation/docgen, not the production components or play
functions. The ordinary hosted Storybook build and full review matrix remain
unchanged. All 85 combinations of 17 changed stories and five theme/viewport
variants passed, including every play function and the stale-response test.
The final run took 56.318 seconds for review; combined build/capture peak was
1,935 MiB. Full state identities and image hashes are in
[visual-checks.json](visual-checks.json).

The captures use Chromium 156.0.8078.4, Node 26.12.1 and the pinned Playwright
1.64.1. A temporary Noto Color Emoji font configuration supplies the ordinary
file-icon glyphs missing from this container; it does not change app or system
fonts. These are production component fixtures, not photographs of a physical
phone or a claim that the Space fixture body is a native editor. Browser tests
separately exercise real native Doc/Sheet input and current server authority.

## Retained images

Each image is unmodified, 900 px high. Widths and themes are explicit below.
The selected images cover the distinct compositions without retaining every
duplicate role-label or viewport variation.

| State | Theme | Width | Image |
| --- | --- | --- | --- |
| Hidden share included | Light | 1280 | [PNG](dashboard-hidden-shares--include-hidden-light.png) |
| Hidden share included | Dark | 1280 | [PNG](dashboard-hidden-shares--include-hidden-dark.png) |
| All shares hidden | Light | 390 | [PNG](dashboard-hidden-shares--all-shares-hidden-phone.png) |
| Failed hide retains the row | Dark | 390 | [PNG](dashboard-hidden-shares--failed-hide-phone-dark.png) |
| Pending hide retains content | Light | 1280 | [PNG](dashboard-hidden-shares--pending-hide-light.png) |
| Readable granting folder | Light | 1280 | [PNG](sharing-access-details--inherited-folder-light.png) |
| Direct account grant | Dark | 1280 | [PNG](sharing-access-details--direct-share-dark.png) |
| Outer folder and Space boundary | Light | 390 | [PNG](sharing-access-details--space-through-folder-phone.png) |
| Long names on a phone | Dark | 390 | [PNG](sharing-access-details--long-names-phone-dark.png) |
| Loading current access | Light | 1280 | [PNG](sharing-access-details--loading-light.png) |
| Unavailable access with retry | Dark | 1280 | [PNG](sharing-access-details--unavailable-dark.png) |

## Native browser observations

[browser-observations.json](browser-observations.json) records the measured
grant-to-editable times, navigation counts, browser errors, suite times and
memory scopes. The desktop tests preserve the current native canvas and focus:
the Doc's existing `Beta` selection is replaced with `Delta`, and the Sheet's
existing `D8` selection receives `7301`. Subsequent downgrade/revocation rejects
new input. Prepared viewers save new offline work and replay it once; phone
tests retain the Modern/Traditional layout distinction.

The cleanup fixture follows the existing sign-out contract: private access is
locked immediately, clean copies remain until explicit deletion, and reconnect
finishes remote logout. Initial memory-aborted runs and corrected test
assumptions are disclosed in [the implementation record](../../SPN-071.md).
