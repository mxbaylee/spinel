# Empty, error and offline states

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

A `role="status"` line in place ("Loading your files…"), sized like one row so
the content replaces it without a jump.

### Inline errors

`role="alert"`, one sentence with the next step, next to the control that
failed, with **Try again** when retrying is safe. The control keeps its
position. Used for: a failed fill, a failed share change, search, tags, pins.

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
- **Local save** (SPN-039): the same slot extends to Saving on this device,
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
`Dashboard/PinnedSidebar`, `Sharing/Sharing`, `Sharing/ShareLink`, `Admin/*`,
`Guest/GuestApp`, `Editor/FillPresets`. Offline states get stories with the
SPN-042 indicator.
