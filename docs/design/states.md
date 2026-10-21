# Empty, loading, error and offline states

## SPN-047 composed redesign proposal

Approved by the owner, 2026-10-21, [decision #126](https://github.com/mxbaylee/spinel/issues/126). Production implementation remains separate.
See the [review, sources and screenshot inventory](redesign.md).
Stories: `Redesign/Screens` — EmptyFolder, LoadingFiles, FileError, OfflineEditor, OfflineLaunch, MissingFile, RevokedLink.

| Current friction                                                                                                   | Public reference pattern                                                                                                                               | Adopted proposal                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| States use paragraphs and card stacks with inconsistent placement, moving nearby controls or hiding the next step. | Google separates unavailable access from inline editing; Dropbox keeps file organization predictable; Numbers emphasizes recoverable document choices. | One local message and relevant next step; fixed status geometry in the editor; a full-page state only when the whole view is blocked. |

Preserve all offline meanings in docs/offline.md. Do not report Online from browser connectivity alone, hide an unconfirmed write, or claim a browser download is permanent. No matches, an empty folder, a request still loading and an access failure are different states. Guest errors contain no document identity.

The approved proposal above governs placement during implementation. Existing behavioral and
permission rules below still apply; production migrations remain separate tickets.

## How others do it

All four show an empty folder as an illustration, one sentence and the create
action. Errors that block the whole page ("File not found", "You need access")
are a full page with one message and one main action (go to your files, request
access). Inline failures are a short message near the control with Retry.
Offline is the least settled pattern: Google has a per-file "Available offline"
toggle with a check badge, Numbers resolves conflicts by letting you pick and
preview a version then Keep it, and the others mostly say "You're offline".

## Adopted pattern

### Empty

The gem at 52 px, one sentence saying what goes here, and the view's one primary
action if the person can take it. "This folder is empty. Choose New to add a
folder or document." A viewer sees the sentence without the second half. Search
with no results: "No matches for “q3”." plus **Clear filters** when any filter
is on.

### Loading

Use one visible, specific status label in the region being loaded, such as
"Loading your files…" or "Opening document…". Keep that region's dimensions
stable as content replaces it. Loading is not an empty result, error, offline
state or save confirmation.

**Runner proposal, owner direction 2026-10-21:** `LoadingReview` adds a decorative
vector running silhouette to the same single status label. The light silhouette
has heart-shaped pigtails and round boots; the dark silhouette has sharper hair
and boot shapes. Both use the same proportions, stride and run-cycle timing;
theme changes alter the silhouette, not the meaning or pace of loading.

- **Compact:** a small runner beside the label within the waiting row or region.
  It must not displace unrelated controls or duplicate an adjacent loading label.
- **Page:** a larger runner above the label when the whole content region is
  waiting. It is contained in that region, not an overlay hiding available
  navigation or a second page heading.
- **Accessibility:** the wrapper is one `role="status"`; the SVG is decorative,
  hidden from assistive technology and not focusable. Announce the label, not
  each animation frame. Motion communicates neither elapsed time nor progress.
- **Reduced motion:** show a still running pose with the same visible label when
  the system requests reduced motion. A still specimen also exists for review;
  the system preference always takes precedence over requested animation.
- **Scope:** this is a Storybook proposal, not a claim that every production
  loading state has changed. Do not add a runner beside every pending button or
  native Univer loader. Screen migrations choose one appropriate indicator for
  the affected region and preserve existing loading/error/retry behavior.

Review `Redesign/Loading` Page, Compact, ReducedMotion, BothThemes and
LoadingContext in light, dark and phone widths. Verify the moving cycle as well
as static screenshots, legible labels, bounded artwork, no layout jump and a
still pose under the real reduced-motion preference before accepting it.

### Inline errors

`role="alert"`, one sentence with the next step, next to the control that
failed, with **Try again** when retrying is safe. The control keeps its
position. Used for: a failed fill, a failed share change, search and tags.

### Full-page states

The gem, a heading, one sentence, and at most one action:

| Case                             | Heading                     | Action             |
| -------------------------------- | --------------------------- | ------------------ |
| Item missing or no access        | "This item isn't available" | **Go to My files** |
| Guest link revoked               | "This link no longer works" | none               |
| Network down at launch (SPN-028) | "You're offline"            | **Try again**      |
| Signed out                       | (redirect to Sign in)       |                    |

Missing and no-access are the same page on purpose: a different message would
confirm that a private item exists.

### Disabled

A disabled control stays visible and says why, as its title or the line beside
it ("Wait for the spreadsheet to load."), unless the person can never use it, in
which case it isn't shown (a viewer never sees Share).

### Offline

The words and their meaning come from [docs/offline.md](../offline.md); this
section places them.

- **Connection** (SPN-042): the connection slot shows Online, Offline or
  Reconnecting with an icon. It never says Online from `navigator.onLine` alone.
- **Local save** (SPN-053): the same slot extends to Saving on this device,
  Saved on this device — waiting to sync, Synced and Needs attention. Needs
  attention stays until resolved and its popover holds the action (open both
  documents, Export as Univer file, discard).
- **Conflicts:** Spinel never asks the person to merge. It makes the offline
  copy and says so in the slot's popover: "Your offline changes were saved as
  <title> (offline copy, <date>)." with **Open copy** and **Open original**.
  Numbers' pick-preview-Keep flow is not adopted because there is nothing to
  merge.
- **Persistent storage** (SPN-052): when a download finishes and the browser
  hasn't granted persistent storage, the download's confirmation says so in
  place: "Downloaded. This browser may clear offline documents when space runs
  low." with a **How to keep them** link to the guide. Your profile → This
  device repeats the current state and per-item usage, with **Remove from
  device** per item.
- **Downloads that were cleared** (SPN-052): the row loses its "Available
  offline" badge and, offline, says "Needs a connection"; a missing store is
  never shown as still available.
- **Created offline** (SPN-051): "Not synced yet" badge until accepted. If the
  folder was deleted or access was lost meanwhile, the row says "Needs
  attention" and offers **Choose another folder…**; nothing is written where the
  person lacks access.
- Guests always get the generic offline page; nothing about the document.

## Stories

Empty, loading and error states are stories of each component:
`Dashboard/Dashboard`, `Dashboard/SearchPanel`, `Dashboard/Trash`,
`Sharing/Sharing`, `Sharing/ShareLink`, `Admin/*`,
`Guest/GuestApp`, `Editor/FillPresets`. Offline states get stories with the
SPN-042 indicator.

### Modal title icons

Owner follow-up, 2026-10-21, decision #126: every product modal gets an appropriate
icon beside its textual title through the shared proposal Modal heading. SPN-089 carries the same pattern into production. Use
consistent size/alignment, hide decorative icons from assistive technology, and
preserve the title as the accessible name. Tooltips are not modals. Do not patch
SDK-owned dialogs through unsupported hooks. The proposal uses a 20 px decorative semantic icon, a wrapping title and a separate close target; accessible text and dismissal behavior are unchanged.
