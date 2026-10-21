# SPN-042 application screenshot review

This index identifies **actual production application routes with synthetic test
data**, captured at `0d8c9230fda7ea323b4fdcbe56a8d9d4998c5024` in
[CI run 39683574003](https://github.com/mxbaylee/spinel/actions/runs/39683574003).
Both production browser shards passed without retries: 23 and 22 tests.
[Capture provenance](capture-sources.json) records every source filename, artifact,
viewport, actual image size and SHA-256. The 40 original PNGs were inspected and
matched byte-for-byte to these artifacts; this repository index contains no PNG
copies. Final current-head checks, independent review and owner approval are
recorded in [PR #133](https://github.com/mxbaylee/spinel/pull/133).

## Download the original screenshots

- **Archive 1:** [Production 1 screenshots](https://github.com/mxbaylee/spinel/actions/runs/39683574003/artifacts/12383879935) contains dashboard, signed-in Sheet/Doc and guest Sheet captures.
- **Archive 2:** [Production 2 screenshots](https://github.com/mxbaylee/spinel/actions/runs/39683574003/artifacts/12385397461) contains guest Doc captures.

GitHub currently expires both archives on **2026-10-28**. Download copies for
review; the committed index and checksums do not preserve the image bytes after
artifact expiry. Original images are also supplied privately with the PR review
in chat. Automatic approval review rejected additional public screenshot uploads;
the existing CI artifacts remain the source of the images.

Inside either ZIP, open `theme-screenshots/`. Every filename below has the form
`spn-042-{stem}-{variant}-production.png`. Desktop captures use a 1280 px viewport;
phone captures use 390 px and the light theme. These are full-page images and can
be wider than the viewport; the manifest records both dimensions without assigning
an overflow cause. The images are review evidence, not approved pixel baselines.

| Actual screen and state | Archive | Filename stem | Variants |
| --- | --- | --- | --- |
| Dashboard, verified Online | 1 | `dashboard-online` | `light`, `dark`, `phone` |
| Dashboard, Offline with timestamp | 1 | `dashboard-offline` | `light`, `dark`, `phone` |
| Sheet, Online | 1 | `sheet-online` | `light`, `dark`, `phone` |
| Sheet, Offline with pending edits | 1 | `sheet-offline` | `light`, `dark`, `phone` |
| Doc, Online | 1 | `doc-online` | `light`, `dark`, `phone` |
| Doc, Offline with pending edits | 1 | `doc-offline` | `light`, `dark`, `phone` |
| Guest Sheet, editing link | 1 | `guest-sheet-editor` | `light`, `dark`, `phone` |
| Guest Sheet, view-only link | 1 | `guest-sheet-viewer` | `light`, `dark`, `phone` |
| Guest Doc, editing link | 2 | `guest-doc-editor` | `light`, `dark`, `phone` |
| Guest Doc, view-only link | 2 | `guest-doc-viewer` | `light`, `dark`, `phone` |
| Sheet/Doc awaiting actual room JOIN response | 1 | `sheet-reconnecting`, `doc-reconnecting` | `light`, `phone` |
| Sheet/Doc Online while the real write is held | 1 | `sheet-online-unsaved`, `doc-online-unsaved` | `light`, `phone` |
| Guest Sheet with unfinished cell input during interruption | 1 | `guest-sheet-interrupted` | `light` |
| Guest Doc with entered content during metadata-only interruption | 2 | `guest-doc-interrupted` | `light` |

Guest interruption captures use a 1440 px viewport and preserve the active editor
and entered content. The Sheet also retains an unfinished cell edit; the Doc's
separate save status is already settled during its metadata-only interruption.
The tests verify recovery and authoritative revocation separately. Pending-save
phone images were captured after Retry scrolled the save row into view, so the
sticky rail appears at that scrolled viewport position in the full-page image.
That context is separate from the exact editor-bounds assertions.

## What to review

The 44 px connection control beside the gem answers whether Spinel is reachable.
Distinct icons, accessible names and hover/focus/tap detail distinguish Online,
Offline and Reconnecting. The detail holds the catalog timestamp and local-mode
explanation, replacing the separate offline banner. Save warnings remain explicit
because an open connection does not prove that a pending edit is saved.

Check readability in both themes and at phone width, popup dismissal without
losing the editing context, and the distinction between network state and save
status. The Sheet and Doc tests compare exact editor bounds through raw browser
offline/online and forced socket loss. They wait for a real delayed shared-file
poll failure: its announced alert and Refresh action appear below the active
editor. The catalog timestamp remains discoverable while the list is stale even
after the document room returns Online.

Owner and Collaborator get the same connection/save distinction without changed
edit permissions. Guests see only the linked document, a generic gem header and
their role, with no account identity or navigation. Operators gain no document
access or new monitoring service. See [connection behavior](../../../connection.md)
and [decision #132](https://github.com/mxbaylee/spinel/issues/132).

## Scope and comparison limits

The complete save component and header migrations remain in SPN-043 and SPN-049;
native editor theme/palette work remains in SPN-088. Existing Univer license marks
are retained without concealment or license workarounds; SPN-059/SPN-075 remove
the remaining Pro dependencies.

Historical before images are in the [SPN-047 gallery](../README.md), with
[per-image provenance](../capture-sources.json). The older dashboard baseline is a
component fixture; older Sheet, Doc and guest captures include application routes.
They predate this PR and use different sample data. Compare hierarchy and placement;
they are not an exact same-data pixel comparison. This PR's application images are
distinct from SPN-047's approved proposals.
