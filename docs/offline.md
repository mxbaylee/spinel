# Offline-first documents

This is the acceptance contract for Spinel's offline experience. The Owner
supplied it in chat on 2026-10-18; [decision #83](implementation/SPN-039.md#legacy-decision-83-complete-opted-in-offline-product)
records its scope. It starts after Spinel's own sync replaces Univer collaboration (SPN-059; owner, chat 2026-10-19). The [mobile installation slice](mobile.md) (SPN-028) supplies installation and
touch support. Its network-only fallback and [decision #82](implementation/SPN-028.md#legacy-decision-82-initial-mobile-and-installable-shell)
describe the initial slice; this explicit signed-in feature supersedes the earlier
PRD/grooming ban. Guests and unprepared devices keep a generic offline screen.
Configured test HTTPS is enough for development; public deployment is
separate work.

**What is implemented.** SPN-040 added Sheet-image support, SPN-041 the
authorized [download bundle](#download-bundle), and SPN-039 offline launch,
browsing and read-only viewing of downloaded documents ([below](#offline-launch-and-read-only-viewing)).
SPN-053 adds native Sheet/Doc editing, durable local checkpoints and conservative
replay through Spinel's own sync client, including prepared Space children.
SPN-054 adds account-owned recovery copies, retry-safe publication, local Univer
export and explicit discard when replay cannot safely continue.
SPN-055 adds verified device inventory, explicit storage protection/removal,
immediate local account locking and compatible public runtimes across updates
([implementation decisions](implementation/SPN-055.md)).
SPN-051 adds creation of ordinary Sheets and Docs in the prepared account's own
folders, with durable stable IDs, exactly-once server admission and explicit
destination recovery ([implementation decisions](implementation/SPN-051.md)).
SPN-069 extends that flow to prepared editable shared folders, preserving the
folder owner's ownership and account-only creator attribution
([implementation decisions](implementation/SPN-069.md)).
[SPN-092](implementation/SPN-092.md) extends preparation and local opening to
one account-authorized Space child at a time, with its verified images.
The remaining parts of this contract are open, split by the Owner in chat on 2026-10-19 so
every unmet requirement stays on a ticket:

- [SPN-090](todo/SPN-090.md): actual Android/iPhone installed launches, stable
  home-screen links and the recorded device/browser verification matrix.
- [SPN-052](todo/SPN-052.md): desktop browser-tab compatibility using SPN-055's
  shared lifecycle; it does not wait for SPN-090's physical-phone runs.

[Decision #91](implementation/SPN-039.md#legacy-decision-91-offline-prerequisites-without-partial-completion) keeps every
acceptance requirement below.

**Design, Owner, chat 2026-10-19.** Spinel owns offline durability itself: a
downloaded snapshot plus an app-owned outbox of edits, the pattern used by
Replicache, Linear and PowerSync. It does not depend on Univer Pro's internal
offline cache. Draft PR #86 tried to prove that cache survives an offline restart,
but Univer documents neither cold-start recovery nor a recovery-complete signal,
and its documented conflict handling clears that cache without guaranteeing that
unsent edits synced. When the live document has moved on, Spinel saves the offline
work as a conflicted copy instead of merging. This supersedes the probe-first
sequence and [#90](implementation/SPN-039.md#legacy-decision-90-public-pro-recovery-coordinator-proposal)'s recovery-coordinator choice.

## Persona requirements

- **Owner:** find previously synchronized files, choose complete downloads, and
  trust that a claimed local save survives an ordinary app restart.
- **Collaborator:** receive the same durability within existing viewer/editor
  rights; reconnect without silently overwriting another person's work.
- **Operator:** keep storage bounded and failures diagnosable without granting
  the admin access to documents or requiring a new paid service. Device recovery
  guidance must distinguish local pending work from the server's backups.
- **Link guest:** retain online access to the supplied document or Space, with no
  private offline catalog, guest-token persistence or offline download privilege.

## What the person can rely on

After an initial online setup in the app context they will use:

| Layer          | Local contents and behavior                                                                                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application    | Shell, theme preference, icons and the code/assets needed by selected editors load without a server dependency.                                                                                                                                                  |
| Catalog        | Last-synchronized authorized folder/file metadata, personal tags and visible paths remain browsable; freshness and offline availability are clear. A failed refresh never becomes an apparently empty workspace.                                                 |
| Selected items | An explicit **Available offline on this device** action stores a complete existing Sheet/Doc and its required assets/images. Known undownloaded items remain identifiable but need a connection to open.                                                         |
| Changes        | Committed edits save locally, survive ordinary termination/reopen while offline, and sync while their document is open and connected. Reopen a retained file to resume its upload. If the live document changed meanwhile, edits become a conflicted copy rather than a merge. Local-save failure remains visible. |
| Entry points   | Stable item links support direct launch; offline downloads and home-screen shortcuts remain distinct actions.                                                                                                                                                    |

The catalog is Spinel metadata, not the server's physical filesystem. Preserve
personal filing and source permissions: never copy inaccessible owner ancestors,
another person's tags, or unrelated documents. Owners and signed-in Collaborators
can download permitted items; viewer downloads remain read-only. Metadata and
selected documents refresh when connected without discarding pending local edits.
Content search, offline image creation, and folder/sharing
administration are outside this first outcome. Existing embedded images are required.

## Creating a new document offline

After preparing the account online, **New → Sheet / Doc** works without a
connection in My files and ordinary folders from the cached catalog where the
account has Owner, File admin or Editor access.
The complete local record commits before the editor opens. The same native
editor saves edits on this device and restores them after an offline reload.
Unprepared devices, Operators and link guests receive no offline creation.
In a shared folder, the folder owner owns the published document and the creating
account is shown as its creator. Local pending rows preserve that access and
ownership distinction. Offline folders, Space trees, images and sharing
administration are outside this flow.

The row says **Not synced yet** while its stable creation request is awaiting
server acknowledgement. Open the document to upload when connected: startup,
foreground return and reconnect use the existing native editor's single writer.
There is no background-writer or closed-app upload guarantee. The server accepts
the immutable empty base exactly once, then the existing native queue delivers
the edits. **Synced** still requires every durable edit acknowledgement and
successful local cleanup; creation acceptance alone is insufficient.

If the chosen folder was removed or the account no longer has permission to
create there before publication, the row says **Needs attention** and offers
**Choose another folder…**.
Only that definitive rejection permits changing the saved destination. A lost
response retries the original request, so it cannot create a second document or
silently move an already accepted one. The receipt binds the original creator,
folder owner, item and generation. A later conflicting/deleted accepted
document retains local work for explicit export or discard. No creation writes
where the current account lacks permission.

Even an unedited new document counts as pending work for removal, sign-out,
refresh and application updates. Older compatible runtimes conservatively retain
its unfamiliar queue marker. The separate local metadata survives catalog refresh
and is fenced to the original account. See [the creation record](implementation/SPN-051.md)
for receipt, storage and persona decisions; SPN-090 retains physical-phone checks.

## Download bundle

`GET /api/items/:id/offline-bundle` returns one `OfflineBundle`
(`src/shared/offlineBundle.ts`) for a Sheet or Doc. It contains the live snapshot,
its revision, generation (`unitId`, `revisionOffset`), the account and access it
was issued for, `readOnly`, the pinned `@univerjs/core` version, and an image
manifest. The manifest lists each image once by same-item source, SHA-256, MIME
type and byte length. The device fetches those bytes from the existing image route.
SPN-041, 2026-10-19.

For a Space child, the account route is
`GET /api/spaces/:spaceId/items/:itemId/offline-bundle`. Its optional `spaceId`
field binds this one native child to the exact requested root. The same root,
current account, child, role and live generation are checked through preparation
and materialization. Guests, MCP credentials and the private history capability
cannot prepare an offline bundle. [Spaces are enabled by default](sharing.md#space-sharing);
an explicitly disabled Space runtime refuses this route. Preparation is per child;
there is no bulk Space download. SPN-053 edits that exact prepared child.

Stored image sources remain `/api/items/:itemId/images/:hash`. A Space download
fetches those bytes through `/api/spaces/:spaceId/items/:itemId/images/:hash`, then
stores and verifies them under their original canonical source keys. The client
rejects a bundle from another root or one whose native snapshot ID differs from
its stable item ID before fetching images or replacing a local copy. The live
generation stays separate in `unitId` and `revisionOffset`, including after restore.

- The snapshot and revision come from one `CollaborationStore.load` read. The
  device never replays server changesets, so draft #86's exact-revision replay
  endpoint and changeset codec are not used. Owner, chat 2026-10-19; this
  supersedes [#88](implementation/SPN-039.md#legacy-decision-88-complete-public-replay-evidence)'s replay-base scope.
- Image sources pass the same validation as every load: a source that is not a
  stored image of this item fails with 400, so cross-item and remote images are
  never fetched. The bundle also checks each source's same-item prefix itself;
  that guard is defence in depth, unreachable while load validation holds, and
  not tested on its own. Stored bytes are rehashed, so a damaged image fails the
  bundle with 500 instead of reaching a device as verified, and the server logs
  only the item ID and image ID. Grooming, 2026-10-19.
- The bundle prepares the document, checks the session, then reads. A restore
  that is staging when the bundle starts, or still staging when the read
  finishes, fails it with 409. After the read the session, access level and
  generation are checked again. Any change fails the whole request with nothing
  partial: 401 for a sign-out; 404 when access is gone, including a revoke while
  the document is being prepared; 409 when access remains but its level or the
  live generation changed, including when the collaboration service refuses a
  read because a restore replaced the unit. A revoked account learns no more
  than one that never had access, and a 409 tells a device that still has
  access to retry. [#91](implementation/SPN-039.md#legacy-decision-91-offline-prerequisites-without-partial-completion), 2026-10-19.
- The route shares export's one-transfer admission (429 while another transfer
  runs) and `no-store` caching, and returns 400 for anything but a Sheet or Doc.
  Only signed-in, non-admin accounts with access can reach it: no account
  session is 401 (link guests included) and an operator is 403. The store itself
  refuses link-guest identities with 404, because a guest's access ends with the
  link and an offline copy would outlive it. [#91](implementation/SPN-039.md#legacy-decision-91-offline-prerequisites-without-partial-completion), 2026-10-19.
- A viewer's bundle has `readOnly: true`, and the device must open it read-only.
  A bundle alone does not mean downloaded, durable or synced; see
  [what a device does with it](#offline-launch-and-read-only-viewing). Grooming,
  2026-10-19.

Verified by `src/server/collaboration/offline-bundle.test.ts`:

- Multi-sheet and Doc content. Every image location has its own bytes and is
  checked by location: a Sheet's floating image (`SHEET_DRAWING_PLUGIN`), sheet
  background, cell rich-text drawing and an image in a preserved resource; a
  Doc's body, header and footer drawings.
- A preserved opaque resource.
- Restored generations.
- Owner, editor and viewer success, with each image's bytes reproduced through
  the route.
- Rejection of anonymous, guest, operator, unrelated-account and folder requests,
  and of link-guest identities in the store.
- Sign-out, revoke, downgrade and restore during the read, both in the store and
  over HTTP; a revoke while the document is being prepared; a restore still
  staging when the read finishes; and a collaboration-service refusal after a
  restore versus after a revoke.
- Damaged stored bytes, with the logged IDs, and foreign sources rejected by
  load validation.

## Offline launch and read-only viewing

SPN-039, 2026-10-19, extended to Space children by SPN-092, 2026-10-22.
SPN-053 extends the same downloaded copies to native editing and replay. Viewer
downloads still use the same read-only permission fence.

**Download.** Signed-in, non-admin accounts see **Available offline on this
device** on each Sheet and Doc they can open (`web/offline/download.ts`). It:

1. Fetches the [download bundle](#download-bundle) with `no-store` and checks it
   is version 1, for this account and item, from the pinned SDK version, and
   read-only for a viewer. Its image list must name only this item's own image
   routes, within the 5 MB per-image and 50 MB per-document budgets, before any
   image is fetched.
2. Fetches every listed image and checks each one's size and SHA-256.
3. Reserves a complete compatible public runtime (below) under the account's
   catalog lock, after checking the retained private format.
4. Writes the bundle and image bytes in one IndexedDB transaction.
5. Saves the account's catalog before marking that account prepared for local launch.

Until the bundle transaction commits nothing counts as downloaded; local launch
also requires the saved catalog. A failed refresh keeps the last complete copy.
Transfers run one at a time, because the server
admits one transfer at a time (429). **Remove from device** deletes the local copy
only. Close an editable downloaded document in every tab before removing its
copy: the removal transaction must acquire its writer Web Lock, so uncaptured
cell input or a not-yet-committed checkpoint cannot be erased. Pending or uncertain
retained data hands off to recovery/This device without mutation. Explicit discard
requires a separate confirmation and the same writer and account checks. A browser
without Web Locks cannot edit or safely remove a copy through the application.
A full device shows "This device is out of space for offline documents."
Explicit preparation requests browser storage protection and reports the actual
result separately from download success. A denied/unsupported request does not
mean a complete download failed, and a granted request is not a backup guarantee.

**Local data.** Each account has its own IndexedDB database,
`spinel-offline-<account id>` (`web/offline/offlineStore.ts`), holding the user's
ID and name, the last-synced catalog (folders, shared items and each folder
view opened online), downloaded bundles and image bytes. No credential, session,
setup/invite token or guest token is stored. `localStorage['spinel.offline.account']`
names the one account this device is prepared for. It is set after the first
complete download and catalog save, and kept only after an online sign-in to that
same non-admin account with downloads (`claimDevice`). Signing out, a 401 from the server (the session
ended or was revoked) and removing the last download clear it, so another account
never opens this data and a revoked session doesn't open it offline. While prepared and online, the dashboard saves the catalog after
each load and refreshes every download in the background. A document the account
can no longer open (404) is removed only if it has no pending checkpoint or
retained failure. Every refresh carries the expected downloading account; a
different signed-in cookie fails before document access is checked, so its 404
cannot delete the prior account's copy.
Background refresh acquires the item's writer lock and preserves pending,
unknown-format, damaged-queue and orphan-recovery data. Observation opens only an
existing database and aborts attempted first creation, including browsers without
`indexedDB.databases()`. An absent or unreadable store is never inferred to be a
complete download or permission to replace retained bytes.
The last observed online account is separate from the prepared-download marker:
opening another tab for the same account does not cancel ordinary pending live
edits when there are no downloads. A real account switch still cancels them.
Download insertion and final empty-catalog marker removal share an account Web
Lock so a different tab's new download cannot be hidden by an older removal.
Delayed preparation after sign-out, an account switch or an unmounted view cannot
reclaim the prepared-account marker or clear another account's marker.

Space download summaries preserve `spaceId`, so a later refresh uses the original
scoped child route. Local opening matches the requested root and child as well as
the prepared account. The outer catalog accepts Space root metadata but never
turns internal pages into ordinary files. A first download from a Space can merge
its root into the saved catalog even when Dashboard has never opened; its actual
outer parent is preserved. Prepared-child navigation uses the separate download
summaries, and an explicit unavailable child does not silently open another page.
The live Space offers **Make available offline** for the selected, saved Doc or
Sheet and **On this device** for that root's prepared children. Offline Space
links open only matching prepared copies with their saved permissions; a root-only link
can choose one of its own copies. The Spaces index, full live tree and Trash need
a connection. The offline list makes no claim that the whole Space is downloaded.
A tree refresh that removes an open child with saved device edits keeps that
editor visible for its access check and **Needs attention** status. Local save
still permits deliberate navigation; a missing explicit child never substitutes
another page.

**App shell.** Nothing is cached until the first download has fetched and
verified its bundle and images (`web/service-worker.ts`). The production build
emits a public manifest containing its content-derived ID, compatibility pair,
application entry, CSS and built `/assets/` files without source maps. A small
bootstrap selects a compatible runtime before importing React/native editors.
Preparation fetches allowlisted assets and public `/sign-in` HTML without
credentials, verifies response types and the matching descriptor, then writes
HTML last. Redirects, missing assets and HTML masquerading as code fail the whole
candidate; a failed refresh preserves previous complete builds.

SPN-055 bounds retention to two complete published builds plus one candidate.
Account compatibility holds survive sign-out, and actual browser client IDs pin
the exact lazy assets needed by live tabs. Uncertain legacy accounts retain a
conservative compatibility requirement. When protected builds consume the slots,
preparation refuses rather than deleting a needed editor. Activation neither
deletes old caches nor reloads active input. The public control database contains
only runtime metadata, never documents, names, credentials or entry tokens. No
`/api` response is cached. Private storage remains version 1 and SDK 1.1.0.
Development builds have no manifest, so a download there says "Offline downloads
need a production build of Spinel."

**Launch.** Navigations are network-first. When the network fails, the service
worker serves the cached shell, except for pages that need the server (`/share/`,
`/setup`, `/invite`), which get the generic offline page. An unprepared device
also gets the generic page. In the app (`web/App.tsx`), only a network failure
(`TypeError`) on the session check enters local mode; a 401 still goes to sign-in.
Local mode reads the prepared account's catalog and downloads, never a cached
session as fresh authorization.

**Local mode.** The shared network icon beside the gem reports **Offline**,
**Reconnecting** or verified **Online**, independently of local durability.
Its hover/focus/tap detail preserves **Files as of** and explains saved document
permissions and the separate save status. A health response does not prove that
an edit reached the server. SPN-042 removes the old banner; see [connection behavior](connection.md)
and [decision #132](implementation/SPN-042.md#legacy-decision-132-verified-connection-proof-and-stable-presentation). Folders opened online
are browsable, rows show **Available offline** or **Needs a connection**, and
anything that would reach the server (Import, Search, Trash, sharing, tags,
settings for passkeys, version history) is hidden or says it needs a
connection. **New → Sheet / Doc** follows the prepared-account flow
[above](#creating-a-new-document-offline); other creation still needs a connection.
A downloaded Sheet or Doc opens in the same open-source native editor
as its live counterpart, with the durable native sync checkpoint installed before
new input is captured. Owner/editor downloads are editable; viewer copies remain
read-only. A Web Lock allows only one writer for each account/item on a device;
a second tab or a browser without that lock opens read-only with an explanation.
Images come from verified local bytes as object URLs. `PreparedImages` rewrites
only native image slots, including known drawing resources, and reverses those
URLs before hashing, persistence or transport. Authored text and opaque resource
bytes stay intact. New image insertion needs a connection. Sheet formula
definitions survive; initial local loading does not recalculate, and derived
`IMAGE()` output is cancelled while offline because the OSS plugin loads it
directly. Doc Formula results are unavailable offline, are never stored with the
document, and require live source authorization after reconnect. Once an account
departure is accepted, signing out locks private access immediately and shows a
separate choice to keep or explicitly delete the original account's device data.
A durable noncredential intent blocks new authentication until remote logout
returns an actual 204, including normal, setup and invitation startup. Offline
sign-out does not claim the remote session has already ended.
Another tab signing out or switching account closes local mode and locks any
open copy.

**Account fence.** `OfflineAccess` and `ScopedHTTP` bind remote requests to the
downloading account, exact document/Space path and current cancellation epoch.
Socket tickets use that adapter; every socket callback also checks its connection
generation and mounted account. Same-tab cancellation and other-tab storage
events close the old editor. Removing the final clean download clears only the
prepared marker, not the sign-out nonce; unrelated live editors retain their
memory-only queues.

Verified by:

- `e2e/offline.spec.ts` (production build): download a Sheet with floating,
  in-cell and background images and a Doc, check CacheStorage holds only the
  shell, keep both copies through a failed refresh, go offline and reload, then
  check the catalog, the badges, permission-correct
  Sheet and Doc views with every image from local bytes, no `/api/items`
  request and no request for an `IMAGE()` URL, a not-downloaded item, the generic
  page for `/share/`, another tab releasing the device, the next online sign-in
  claiming it back, and that a 401 stops the next offline launch from opening
  local data. The failed refresh leaves the stored copy's revision and download
  time unchanged.
- `e2e/pwa.spec.ts`: an unprepared device keeps CacheStorage empty.
- `src/ui/preparedImages.test.ts`, `src/ui/offlineAccess.test.ts`,
  `src/ui/offlineDownload.test.ts` and `src/shared/offlineShell.test.ts`.
- `src/server/collaboration/space-native.test.ts` covers exact Space bundles,
  images, restored generations and late authorization changes.
  `src/ui/offlineSpace.test.ts`, `src/ui/offlineCatalog.test.ts` and
  `src/ui/offlinePreparation.test.ts` cover scoped selection, root metadata and
  delayed completion across account/sign-out changes. Final-head acceptance is
  recorded in [SPN-092's implementation record](implementation/SPN-092.md).

## How offline editing works

Download and launch work as [described above](#offline-launch-and-read-only-viewing).
SPN-053 implements this section through Spinel's own sync server/client contracts
([SPN-057](implementation/SPN-057.md), [SPN-058](implementation/SPN-058.md) and
[SPN-059](implementation/SPN-059.md)). SPN-054 implements the separate
conflicted-copy/export outcome. See the [editing decisions](implementation/SPN-053.md)
and [recovery decisions](implementation/SPN-054.md).

**Edit offline.** A downloaded item opens in an open-source Univer editor created
from the stored snapshot, with no collaboration plugins. Images come from the
stored bytes and never fall back to a network URL. Each local mutation is captured
through the public `ICommandService.onMutationExecutedForCollab` hook
(`@univerjs/core`). The one authoritative outbox is a native `ClientCheckpoint`,
wrapped in `{version, account, item, spaceId?, unitId, revisionOffset}` and stored
atomically with the download's image manifest/bytes. It contains the confirmed
snapshot/revision, exact original `sent` envelope, transformed inflight mutations,
and ordered buffered mutation groups. The original design's entry fields map to
this existing queue instead of a second independently updated log:

| Required identity/order           | Native checkpoint representation                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Account, item, optional Space     | Outbox wrapper; checked against the download and mounted account                                                |
| Live generation and original base | `unitId`, `revisionOffset`, confirmed `revision`; `sent.baseRevision` is immutable                              |
| Local mutation ID and parameters  | Each ordered mutation's `id` and `params`                                                                       |
| Sequence                          | Inflight order followed by buffered group order and each group's mutation order                                 |
| Stable delivery identity          | `sent.mutationId`, allocated and durably saved before its first send; retries reuse the exact original envelope |

Unsent groups have no server delivery identity yet. Reconstruction does not
invent another delivery or duplicate the native queue.
**Saved locally** appears only once that IndexedDB transaction has
committed. Reopening applies the outbox, in order, on top of the stored snapshot,
without capturing those replays again. A mobile termination callback is not the
durability mechanism. Warnings for active, uncommitted cell or text input stay.

**Reconnect, unchanged live document.** Spinel revalidates the session and
access, then reads the live revision and generation. If both still equal the
outbox's base, the existing native editor sends its pending queue through the
normal socket. SPN-058 sends the pending mutations through SPN-057's normal
authorized sync path, retaining stable retry identities so repeat delivery does
not apply an edit twice. An acknowledgement must mean the server durably stored
that edit, not just received it in memory or kept a socket connected. Only
acknowledged entries can be cleared, with a matching snapshot/revision recorded
in local storage so restart can reconstruct all remaining work. Edits that arrive
from others after the first successful acknowledgement use the ordinary
collaboration protocol. Before that first send, a newer peer revision stops
replay. An admission-only `expectedRevision` guard is checked atomically by the
server after asynchronous preparation and before receipt lookup or commit; it
does not change the durable retry identity. Spinel never PUTs a whole snapshot
over the live document.

**Reconnect, live document moved on.** If the revision or generation has
advanced, Spinel never replays. History restore, trash, deletion and revoked
access count as moved on. SPN-053 freezes the editor, retains its outbox and shows
**Needs attention**. It never refreshes/removes that pending work. SPN-054
rebuilds the offline version from the snapshot plus the outbox, inlines its images
from the stored bytes, and creates a new item
through the existing import path. The copy goes in the person's own files, named
`<title> (offline copy, <local date and time>)`. Only then does it clear the
outbox, images and stale download in one local transaction. **Needs attention**
links both documents. If the copy cannot be created (no permission, disabled account, size
or image budget), the outbox stays on the device with **Export as Univer file**
and an explicit discard. Nothing is written into a forbidden, trashed or replaced
document. Automatic merging of divergent offline edits is out of scope.

The copy name uses the device's local clock (`YYYY-MM-DD HH:mm`), with the title
shortened to keep the full name within 120 characters. Before publication, the
device saves one immutable recovery ID, name and payload. The account-only
`POST /api/items/offline-recovery` endpoint uses existing import admission and
budgets, and atomically saves the new item and its account-scoped receipt. A lost
response or failed local cleanup retries that exact request and returns the same
copy. A changed request or a subsequently removed/transferred copy does not
silently create another. The original document is never written.

**Offline changes on this device** in My files lists retained work, including
prepared Space children whose original is no longer accessible. Its
`/?offlineRecovery=<item id>` link opens only the current account's exact stored
bundle, without requiring original-item or Space-tree access. The stored Space
identity still governs replay and the **Open original** link. The entry checks
the native checkpoint and verified image bytes independently of any saved retry
payload; a mismatched retry is refused, while a valid checkpoint can still be
exported. Export never clears the outbox. Explicit discard confirms removal of
the device copy and leaves any original or already-created server copy intact.

Recovery reconstructs transformed inflight edits followed by buffered groups,
never applies the immutable sent envelope twice, and uses a complete retained
visible recovery snapshot when present. Every native image location is inlined
from same-item bytes whose hash and size pass verification. Formula definitions
travel without cached results; source access is checked again when the copy opens
or the Univer file is imported. The local export remains available for documents
larger than the server import limit. See the [recovery decision record](implementation/SPN-054.md).

**Crash between replay and clearing.** On restart, a checkpoint with a `sent`
envelope may contain edits whose acknowledgements were lost or whose local
cleanup did not commit. Retain the outbox and original retry identities until
durable acknowledgement and the corresponding local cleanup/rebase complete.
Repeated delivery through SPN-057 must be idempotent. SPN-053's conservative
reconnect rule still applies: after revalidating access, retry pending replay
only if the live revision/generation equals its base; an advanced
base goes to SPN-054's conflicted-copy path without changing the live document.
This can create an unneeded copy after a lost acknowledgement. The recovery receipt
counts `possible_replay_crash` once when the checkpoint had an unacknowledged sent
request; this is a possibility, not proof that the copy was unnecessary. Operators
can aggregate these content-free counts as documented in the [implementation
record](implementation/SPN-054.md#possible-unnecessary-copies-after-replay-crashes).
It must never lose or double-apply an edit; use the existing SPN-057/
SPN-058 acknowledgement and retry contracts.

**One queue owner.** SPN-058's pending queue is authoritative; SPN-053 persists it
as the downloaded item's outbox, including while online. A mutation must commit
locally before **Saved locally** is claimed. Server acknowledgements
identify the durably accepted edits; local cleanup and rebasing preserve every
unacknowledged entry across failure or restart. Do not add a separate Pro queue
or treat a connection/status transition as proof of durability. Items that are
not downloaded keep the online behavior and make no on-device durability claim.

**Expired sign-in.** A verified 401 stops replay and clears preparation for new
offline launches. Downloaded documents and their queues remain on the device.
The current editor freezes input and attempts to finish its local save. A clean
editor can then open sign-in; retained work stays visible with local export,
explicit discard and **Continue to sign-in**. If storage fails or takes too long,
or cell/IME/Formula input has not finished, Spinel keeps that frozen tab open with the navigation warning
and local-save retry. This exception permits only finishing local recovery; it
cannot contact the server or prepare another download, and a later sign-out or
account change cancels it. Repeated 401s for the same expired session do not close
the held tab. A failed local save takes priority over Needs attention in the save
status so unsaved visible work is never described as safely retained.
For an unfinished Sheet cell, expiry blocks confirmation and keeps its text
available to copy. The native cross-sheet formula flow hides its input before
the cell actually commits, so Spinel does not treat hiding as proof of a safe
save. The notice asks the person to copy the text before signing in again;
Escape explicitly discards only that unfinished input.
For a Doc composition interrupted by a conflict or ended sign-in, save details
retains the final unfinished text in a read-only field. Native composition-end
can clear its own field before a refused mutation finishes, so closing the IME
does not mean the text was saved. Copy that field, then explicitly **Discard
unfinished text** before recovery/export or sign-in can continue. This action
discards only the held text; the durable checkpoint remains protected by its
separate recovery flow.
Save details then offers **Continue to sign-in** even when the retained queue is
already durable. The action rechecks local saving and unfinished host input
before navigation; the queue is not falsely marked unsaved just to expose it.

**Refused visible edits.** A supported native mutation can change the canvas
before exceeding the transport budget. Such a local refusal retains a bounded,
validated canonical `recoverySnapshot` alongside the failure and the original
queue. Reopening creates the visible document from that snapshot without applying
the queue a second time. It is local recovery data, never a server overwrite or
replay source. If capturing that state fails, `recoveryMissing` keeps the save
failure and navigation warning: the latest visible edits are not claimed saved.
Failures while applying a remote frame retain the coherent pre-frame checkpoint,
not a partially applied remote snapshot.

**Clean replay expiry.** A downloaded copy with no local work can be older than
the server's retained replay window. Before handling that initial stale response,
Spinel first checks for unfinished cell input, IME composition or image insertion,
then freezes input, commits prior local writes, verifies the client is still
clean, downloads a fresh authorized bundle and reloads it. Pending/recovery work
never takes this path. Incoming socket messages are bounded before any image
download wait, and disconnect cancels that wait and releases queued frames.

**Public APIs only.** The design needs no Pro internals, license workaround,
paid service or engine replacement. Reusable work from draft #86: SPN-039 ported
`web/offline/OfflineAccess` and the verified local image adapter
(`PreparedImages`), SPN-040 landed the Sheet-image work, and SPN-053 ports the
account- and epoch-scoped HTTP/socket boundaries to the native transport. Retire the
recovery probe, `ProbeLocalCache`, the recovery ledger, the compression observer
and the replay-snapshot server adapter.

### Space-child editing and recovery handoff

SPN-053 preserves the landed per-child
preparation boundary through local persistence, refresh, replay and recovery.
Retain the original Space root and native-child identity; reconnect revalidates
the downloading account, current root/child access, live ancestry and generation.
Use the exact scoped Space route and credential, without an ordinary-item
fallback. Preparation remains per child and does not download an entire Space.
An unavailable explicit child link never substitutes another prepared page.

SPN-054's recovery copy is deliberately a new item in the account's own files;
the original link retains its exact root/child destination. Include root
revocation/downgrade, child trash and history restore-generation changes in the
existing standalone Doc/Sheet replay and recovery verification. Account recovery
remains separate from SPN-084's anonymous-guest immediate-hiding policy: guests
gain no offline store or outbox. These are compatibility requirements for the
already-prepared Space children, preserved by SPN-054 recovery.
Grooming, 2026-10-25; implemented by SPN-053 and SPN-054.

## Save states

The compact save control distinguishes **Saving locally**, **Saved locally**,
**Synced**, and **Needs attention** on one line. Save details and the live
announcement retain the full messages, including **Saving on this device** and
**Saved on this device — waiting to sync**. Only successful local persistence earns a
local-save claim. **Synced** requires durable server acknowledgements for every
pending edit and successful local outbox cleanup/rebasing. These are SPN-057/
SPN-058 semantics, independent of the server database; neither an open connection
nor a UI status alone proves them. A local-save failure stays visible until resolved.

Sync is attempted on startup, on returning to the foreground and when the
connection returns, while the app is running. Pending work stays visible until it
actually succeeds. Background Sync may be an optional enhancement. It is not a
requirement for Firefox/Android or Safari/iOS, and not a promise that the sync
client runs while the app is closed. Follow the existing [history](history.md)
and [collaboration](collaboration.md) contracts.

## Device data and storage lifecycle

**Implemented by SPN-055.** Profile → This device shows the current everyday
account's documents, stable original links, pending/read-only/attention states and
logical stored bytes. UTF-8 snapshot/metadata/queue/recovery data and stored image
bytes are included; unknown sizes stay unknown. Browser-wide usage/quota is a
separate estimate that also includes other accounts and public app files. A row
claims offline availability only after its private identity, image references,
verified image bytes and complete compatible runtime pass inspection. Foreground
and manual refreshes detect external eviction; committed pending transitions
update known rows without rehashing all images on each keystroke. The active
editor is retained for recovery even if its inventory row becomes incomplete.

The explicit protection action reports granted, denied, unsupported or failed.
Inventory observation never requests persistence. A false initial `persisted()`
result is **not requested**, not a claimed denial. Missing/unreadable stores and
damaged data are visible; they never trigger automatic deletion of pending work.
See [the implementation record](implementation/SPN-055.md) for transaction,
runtime retention and account-exit decisions and verification boundaries.

- Offline setup/download is explicit and scoped to the instance, account and
  device/browser context. The Operator gains no document access; Link guests get
  no offline private catalog or documents. Never persist authentication responses,
  passkey/session credentials, setup/invite credentials or guest-link tokens in
  the offline application-data/cache stores. Normal browser-managed login cookies
  remain governed by the existing authentication contract.
- A disconnected device cannot immediately learn revocation or be remotely erased.
  Once revocation/deletion is observed, stop access and synchronization, remove
  clean cached copies and isolate pending work for an explicit recovery/deletion
  flow under its original account. Never expose that work to another account.
- Local sign-out locks access to the account's private store immediately; switching
  accounts cannot reuse it. With unsynced changes, offer explicit preservation or
  deletion and do not silently discard them. If sign-out occurs offline, do not
  claim the server session was revoked; finish remote logout when connected.
- Download readiness requires complete document data, lazy editor modules,
  renderer/language assets and all required existing images. Interrupted downloads
  remain incomplete and retryable; incomplete refreshes retain the last complete
  copy. Readiness and displayed storage usage reflect successful writes.
- Request persistent storage where supported and report whether it was granted.
  Handle quota failures and browser eviction without claiming guaranteed retention;
  a missing local store cannot be shown as still available offline. Re-download
  clean content when online. Never evict unsynced work through app cache cleanup.
  Browser/user deletion or device loss can destroy the only pending copy; server
  backups and a server database swap cannot recover edits that never durably
  reached that server. SPN-055 protects against app-controlled deletion and makes
  these limits visible rather than promising survival of all eviction.
- **Remove from device** frees local content without deleting the server document
  or changing its filing. Pending changes require explicit recovery/deletion first.
  Use bounded storage and report per-item usage; application/storage schema updates
  must preserve pending edits and a compatible offline editor, including interrupted
  migrations. Reloading for a new service worker must respect pending input/work.

The current HTTP `no-store` rules in authentication, sharing and image routes do
not authorize a catch-all response cache. Explicitly downloaded private application
data is a separate policy. SPN-039 caches only the public shell on a prepared
device; a never-prepared one keeps SPN-028's empty CacheStorage. Signing out may
retain bounded public app assets for kept private work, without granting private
access. Account-isolation and guest/token-exclusion checks remain beside the
authorization tests.

## Home-screen links and completion checks

Use the stable application item URL, not the internal SDK generation or a guest
token. Rename/move must preserve the destination. The browser/user controls icon
creation; a manifest shortcut menu is not a universal per-document icon API.
When independent item icons are unsupported, provide the stable link and a clear
in-app offline collection fallback, recording that limitation. A shortcut
never implicitly claims the document has been downloaded.

Test installed-context startup as well as a browser tab. On iOS, do not assume
browser storage is copied into or shared with an installed app: prepare offline
content in the context that will launch. Verify Android Chrome, Android Firefox
and iPhone Safari Home Screen on actual devices, recording OS/browser versions,
supported actions and observed launch behavior. CI's mobile viewport alone cannot
establish installation, storage-context or native home-screen behavior. SPN-090
owns these recorded physical-device runs, including install icons and the offline
manifest; SPN-055 owns the shared lifecycle, and SPN-052 separately verifies
ordinary macOS Chrome, Firefox and Safari tabs with browser versions and
persistence results recorded here.

SPN-090's [BrowserStack CI plan](implementation/SPN-090.md#browserstack-ci-plan)
uses Automate real mobile browsers and Local from GitHub Actions, with repository
secrets `BS_USERNAME` and `BS_ACCESS_KEY`. The bounded HTTP infrastructure smoke
verifies credentials, mobile allocation and runner reachability. Installed-context
HTTPS/service-worker, Home Screen restart and offline acceptance remain separate,
uncompleted work; do not infer those passes from a successful tunnel session.

The decisive scenario is: download online, terminate, enable airplane mode, launch
from the home screen, open/edit each document type, close and reopen offline,
then reconnect twice: once with the live document unchanged (the edits sync
exactly once), and once after another editor changed it (the live document is
untouched and one conflicted copy holds the offline version). Compare both views
and server state. Include existing images, uncached/removed items, lost
acknowledgements, a crash between replay and outbox clearing, history restore,
account switching and revoked/read-only shares. Deterministic CI also exercises
failed writes, partial downloads, eviction, removal with pending work, repeated
replay and interrupted application/storage updates.

## Ordinary desktop browser tabs

Use a regular Chrome, Firefox or Safari window and keep using the same browser
profile. Download each document while connected, wait for the completed download
message, and check **Profile → This device** before leaving the network. A plain
tab does not require installing Spinel. Private Browsing/Incognito and another
profile have different storage lifetimes and do not inherit the prepared copies.

Spinel requests `navigator.storage.persist()` during an explicit download and
reports its actual result. A denied, unsupported or failed request does not mean
the download failed; it means browser protection was not established. The result's
**How to keep them** action opens the same **About device storage** guide used in
Profile, without navigating away from the editor. Pending work remains mounted.

| Browser | Persistence and eviction rules |
| --- | --- |
| Chrome | Chromium grants persistence using browser heuristics rather than a permission prompt. Best-effort origin storage can be evicted under storage pressure. A request can be denied; returning to Spinel and checking the actual protection state is more useful than assuming a grant. [Chrome storage guidance](https://web.dev/articles/persistent-storage). |
| Firefox | A persistence request can show a permission prompt. The person may allow persistent storage; browsing-data and session-only cleanup settings still matter. Check the site's storage exception and avoid clearing pending work. [Mozilla storage controls](https://support.mozilla.org/en-US/kb/storage). |
| Safari | WebKit supports the Storage API and decides persistence using heuristics. Origin data may be evicted under quota/storage pressure or inactivity. Its tracking-prevention policy can remove script-writable storage after seven days of Safari use without interaction with the site; this is not seven elapsed calendar days. Do not promise an ordinary tab the exemption documented for Home Screen apps. [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/), [tracking prevention](https://webkit.org/tracking-prevention/), and [Safari-use timing](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/). |

These policies are platform documentation, not a measured retention timer or a
guarantee against user deletion. Keep free disk space and avoid cleanup settings
that clear this site's data. Before intentionally clearing storage, reconnect and
open pending documents until they say **Synced**, or export recoverable work.
Server backups cannot restore edits that never reached the server. If the whole
origin is cleared, an offline browser may have no Spinel shell or catalog to show;
after reconnection the server catalog returns without claiming lost downloads.

### Native desktop verification

SPN-052's native matrix is in progress. Its maintained
[implementation record](implementation/SPN-052.md) distinguishes capability probes
from full application acceptance. The matrix uses actual installed macOS browsers,
retains their original profiles, witnesses process termination and new process
IDs, and blocks the application transport before relaunch. It never reconstructs
IndexedDB or CacheStorage from exported state. Linux WebKit and fresh isolated
Safari WebDriver sessions cannot establish this ordinary-tab restart behavior.

The test cases cover image-backed Sheets and Docs for normal and divergent
reconnect, actual persistence outcomes, locally committed edits through another
process restart, and deliberate deletion of private downloads, local markers and
cached app assets followed by online catalog recovery. Browser deletion APIs
exercise loss handling; they do not reproduce a browser's long-term eviction
heuristic. Final exact browser/OS versions and observed outcomes must replace
this in-progress checkpoint before SPN-052 is considered complete.

## Platform references

- [Offline assets and structured data](https://web.dev/learn/pwa/offline-data)
  and [storage quotas/persistence](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
- [Background Sync](https://developer.mozilla.org/en-US/docs/Web/API/SyncManager)
  and [manifest shortcut menus](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/shortcuts).
- [Firefox Android home-screen links](https://support.mozilla.org/en-US/kb/add-website-shortcut-your-home-screen-android)
  and [Safari iPhone web apps](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios).
- [WebKit installed-app storage separation](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/#web-apps).

## Live Doc formulas

Offline copies retain [Formula definitions](formulas.md), never calculated
source values. They show unavailable results and make no formula requests.
Reconnect must verify source access before rendering results; queued offline
edits and recovery copies must preserve definitions without baking in values.


Offline creation also saves the chosen icon or emoji and icon color through reload and upload, using the same creation controls and validation as online creation. An automatic icon remains name-derived when no choice is made. The identity belongs to the immutable creation request; existing receipt retries and account/destination checks still apply. See [SPN-086 integration](implementation/SPN-086.md#appearance-on-offline-creation).
