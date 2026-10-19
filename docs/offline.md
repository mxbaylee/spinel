# Offline-first documents

This is the acceptance contract for Spinel's offline experience. The Owner
supplied it in chat on 2026-10-18; [decision #83](https://github.com/mxbaylee/spinel/issues/83)
records its scope. It is not marked must-ship for production. The [mobile installation slice](mobile.md) (SPN-028) supplies installation and
touch support. Its network-only fallback and [decision #82](https://github.com/mxbaylee/spinel/issues/82)
describe the initial slice; this explicit signed-in feature supersedes the earlier
PRD/grooming ban. Guests and unprepared devices keep a generic offline screen.
Configured test HTTPS is enough for development; public deployment and Slides are
separate work.

**What is implemented.** SPN-040 added Sheet-image support, SPN-041 the
authorized [download bundle](#download-bundle), and SPN-039 offline launch,
browsing and read-only viewing of downloaded documents ([below](#offline-launch-and-read-only-viewing)).
The rest of this contract is open, split by the Owner in chat on 2026-10-19 so
every unmet requirement stays on a ticket:

- [SPN-053](todo/SPN-053.md): offline editing, the outbox, **Saved on this
  device**, restart, replay with `flush()` and **Synced**.
- [SPN-054](todo/SPN-054.md): the conflicted copy, **Needs attention** and the
  export fallback.
- [SPN-055](todo/SPN-055.md): the storage lifecycle, home-screen links and the
  real-device runs.

[Decision #91](https://github.com/mxbaylee/spinel/issues/91) keeps every
acceptance requirement below.

**Design, Owner, chat 2026-10-19.** Spinel owns offline durability itself: a
downloaded snapshot plus an app-owned outbox of edits, the pattern used by
Replicache, Linear and PowerSync. It does not depend on Univer Pro's internal
offline cache. Draft PR #86 tried to prove that cache survives an offline restart,
but Univer documents neither cold-start recovery nor a recovery-complete signal,
and its documented conflict handling clears that cache without guaranteeing that
unsent edits synced. When the live document has moved on, Spinel saves the offline
work as a conflicted copy instead of merging. This supersedes the probe-first
sequence and #90's recovery-coordinator choice.

## Persona requirements

- **Owner:** find previously synchronized files, choose complete downloads, and
  trust that a claimed local save survives an ordinary app restart.
- **Collaborator:** receive the same durability within existing viewer/editor
  rights; reconnect without silently overwriting another person's work.
- **Operator:** keep storage bounded and failures diagnosable without granting
  the admin access to documents or requiring a new paid service. Device recovery
  guidance must distinguish local pending work from the server's backups.
- **Link guest:** retain document-only online access, with no private offline
  catalog, guest-token persistence or offline download privilege.

## What the person can rely on

After an initial online setup in the app context they will use:

| Layer | Local contents and behavior |
| --- | --- |
| Application | Shell, theme preference, icons and the code/assets needed by selected editors load without a server dependency. |
| Catalog | Last-synchronized authorized folder/file metadata, personal tags/pins and visible paths remain browsable; freshness and offline availability are clear. A failed refresh never becomes an apparently empty workspace. |
| Selected items | An explicit **Available offline on this device** action stores a complete existing Sheet/Doc and its required assets/images. Known undownloaded items remain identifiable but need a connection to open. |
| Changes | Committed edits save locally, survive ordinary termination/reopen while offline, and sync while the app is running and connected. If the live document changed meanwhile, they become a conflicted copy rather than a merge. Local-save failure remains visible. |
| Entry points | Stable item links support direct launch; in-app pins, offline downloads and home-screen shortcuts remain distinct actions. |

The catalog is Spinel metadata, not the server's physical filesystem. Preserve
personal filing and source permissions: never copy inaccessible owner ancestors,
another person's tags, or unrelated documents. Owners and signed-in Collaborators
can download permitted items; viewer downloads remain read-only. Metadata and
selected documents refresh when connected without discarding pending local edits.
Content search, offline new-item/image creation, folder/sharing administration and
Slides are outside this first outcome. Existing embedded images are required.

## Download bundle

`GET /api/items/:id/offline-bundle` returns one `OfflineBundle`
(`src/shared/offlineBundle.ts`) for a Sheet or Doc. It contains the live snapshot,
its revision, generation (`unitId`, `revisionOffset`), the account and access it
was issued for, `readOnly`, the pinned `@univerjs/core` version, and an image
manifest. The manifest lists each image once by same-item source, SHA-256, MIME
type and byte length. The device fetches those bytes from the existing image route.
SPN-041, 2026-10-19.

- The snapshot and revision come from one `CollaborationStore.load` read. The
  device never replays server changesets, so draft #86's exact-revision replay
  endpoint and changeset codec are not used. Owner, chat 2026-10-19; this
  supersedes #88's replay-base scope.
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
  access to retry. #91, 2026-10-19.
- The route shares export's one-transfer admission (429 while another transfer
  runs) and `no-store` caching, and returns 400 for anything but a Sheet or Doc.
  Only signed-in, non-admin accounts with access can reach it: no account
  session is 401 (link guests included) and an operator is 403. The store itself
  refuses link-guest identities with 404, because a guest's access ends with the
  link and an offline copy would outlive it. #91, 2026-10-19.
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

SPN-039, 2026-10-19. This is what a device does today.

**Download.** Signed-in, non-admin accounts see **Available offline on this
device** on each Sheet and Doc they can open (`web/offline/download.ts`). It:

1. Prepares the app shell (below).
2. Fetches the [download bundle](#download-bundle) with `no-store` and checks it
   is version 1, for this account and item, from the pinned SDK version, and
   read-only for a viewer. Its image list must name only this item's own image
   routes, within the 5 MB per-image and 50 MB per-document budgets, before any
   image is fetched.
3. Fetches every listed image and checks each one's size and SHA-256.
4. Writes the bundle and image bytes in one IndexedDB transaction.

Until that transaction commits nothing counts as downloaded. A failed refresh
keeps the last complete copy. Transfers run one at a time, because the server
admits one transfer at a time (429). **Remove from device** deletes the local copy
only. A full device shows "This device is out of space for offline documents."

**Local data.** Each account has its own IndexedDB database,
`spinel-offline-<account id>` (`web/offline/offlineStore.ts`), holding the user's
ID and name, the last-synced catalog (folders, shared items, pins and each folder
view opened online), downloaded bundles and image bytes. No credential, session,
setup/invite token or guest token is stored. `localStorage['spinel.offline.account']`
names the one account this device is prepared for. It is set by the first
download and kept only after an online sign-in to that same non-admin account
with downloads (`claimDevice`). Signing out clears it, so another account never
opens this data. While prepared and online, the dashboard saves the catalog after
each load and refreshes every download in the background. A document the account
can no longer open (404) is removed: SPN-039's copies hold no edits.

**App shell.** Nothing is cached until the first download (`web/service-worker.ts`).
The production build writes a manifest of every built `/assets/` file, without
source maps, into the service worker with a content version (`vite.config.ts`).
Preparing caches those files (19 files, about 21 MB at SPN-039) and then the page
HTML under `/`, fetched from the public `/sign-in` page without credentials. The
page is written last, so its presence marks a complete shell. A new service worker
on a prepared device prepares its own shell, and activation deletes older ones. No
`/api` response is ever cached. Development builds have no manifest, so a download
there says "Offline downloads need a production build of Spinel."

**Launch.** Navigations are network-first. When the network fails, the service
worker serves the cached shell, except for pages that need the server (`/share/`,
`/setup`, `/invite`), which get the generic offline page. An unprepared device
also gets the generic page. In the app (`web/App.tsx`), only a network failure
(`TypeError`) on the session check enters local mode; a 401 still goes to sign-in.
Local mode reads the prepared account's catalog and downloads, never a cached
session as fresh authorization.

**Local mode.** A banner says **Offline** and when the files were last synced.
SPN-042's connection indicator should take that line over. Folders opened online
are browsable, rows show **Available offline** or **Needs a connection**, and
anything that would reach the server (New, Import, Search, Trash, sharing, tags,
pins changes, settings for passkeys, version history) is hidden or says it needs a
connection. A downloaded Sheet or Doc opens in an open-source Univer viewer with no
collaboration client, autosave or remote image fallback, behind the same
permission fences as version previews (`web/snapshotViewer.ts`). Images come only
from the verified local bytes, as object URLs: `PreparedImages` rewrites every
verified source in the snapshot in memory, including inside resource JSON, and
replaces the drawing plugin's `IURLImageService`. Signing out offline ends the
local session at once and revokes the server session the next time Spinel opens
online.
Another tab signing out locks any open copy.

**Not yet.** `OfflineAccess` was ported from #86 without its remote gate.
`ScopedHTTP` and `scopedSocket`, which scope requests and the collaboration
socket to an account and epoch, move to SPN-053, which first needs them.

Verified by:

- `e2e/offline.spec.ts` (production build): download a Sheet with floating,
  in-cell and background images and a Doc, check CacheStorage holds only the
  shell, go offline and reload, then check the catalog, the badges, read-only
  Sheet and Doc views with every image from local bytes and no `/api/items`
  request, a not-downloaded item, and the generic page for `/share/`.
- `e2e/pwa.spec.ts`: an unprepared device keeps CacheStorage empty.
- `src/ui/preparedImages.test.ts`, `src/ui/offlineAccess.test.ts` and
  `src/shared/offlineShell.test.ts`.

## How offline editing works

Download and launch work as [described above](#offline-launch-and-read-only-viewing).
The rest of this section is SPN-053 and SPN-054's design.

**Edit offline.** A downloaded item opens in an open-source Univer editor created
from the stored snapshot, with no collaboration plugins. Images come from the
stored bytes and never fall back to a network URL. Each local mutation is captured
through the public `ICommandService.onMutationExecutedForCollab` hook
(`@univerjs/core`) and written to the item's outbox as
`{entryId, account, item, unitId, baseRevision, seq, mutationId, params}`.
**Saved on this device** appears only once that IndexedDB transaction has
committed. Reopening applies the outbox, in order, on top of the stored snapshot,
without capturing those replays again. A mobile termination callback is not the
durability mechanism. Warnings for active, uncommitted cell or text input stay.

**Reconnect, unchanged live document.** Spinel revalidates the session and
access, then reads the live revision and generation. If both still equal the
outbox's base, it marks the outbox `replaying` in IndexedDB and opens the normal
collaboration editor. It re-executes the outbox mutations as local edits, so the
collaboration client sends them through the existing protocol. It waits for the
Pro facade's public `flush(unitId)`, which resolves at `SYNCED`. Then it deletes
the entries and replaces the stored snapshot with a fresh bundle. Edits that
arrive from others during this short replay are merged by the collaboration
protocol, as they are online. Spinel never PUTs a whole snapshot over the live
document.

**Reconnect, live document moved on.** If the revision or generation has
advanced, Spinel never replays. History restore, trash, deletion and revoked
access count as moved on. Spinel rebuilds the offline version from the snapshot
plus the outbox, inlines its images from the stored bytes, and creates a new item
through the existing import path. The copy goes in the person's own files, named
`<title> (offline copy, <local date and time>)`. Only then does it clear the
outbox and refresh or remove the stale download. **Needs attention** links both
documents. If the copy cannot be created (no permission, disabled account, size
or image budget), the outbox stays on the device with **Export as Univer file**
and an explicit discard. Nothing is written into a forbidden, trashed or replaced
document. Automatic merging of divergent offline edits is out of scope.

**Crash between replay and clearing.** On restart, an outbox still marked
`replaying` may or may not have reached the server. Every accepted change
advances the revision. So if the revision still equals the base, nothing landed
and replay is safe to repeat; if it has advanced, Spinel makes a conflicted copy.
That never duplicates an edit, though it can make an unneeded copy. Record how
often that happens. If it is common, a follow-up can record a Spinel batch ID on
the server at submit time.

**One queue owner.** For downloaded items Spinel sets Pro's
`enableOfflineEditing` to false, so Pro never holds edits that Spinel's outbox
lacks. The outbox also captures while online. Each `flush()` that reaches
`SYNCED` clears the synced entries and re-bases on the current revision, so a
dropped connection leaves only a short window that may produce a copy. Items that
are not downloaded keep today's online behavior and make no on-device durability
claim.

**Public APIs only.** The design needs no Pro internals, license workaround,
paid service or engine replacement. Reusable work from draft #86: SPN-039 ported
`web/offline/OfflineAccess` and the verified local image adapter
(`PreparedImages`), SPN-040 landed the Sheet-image work, and SPN-053 ports the
account- and epoch-scoped `ScopedHTTP` and `scopedSocket` adapters. Retire the
recovery probe, `ProbeLocalCache`, the recovery ledger, the compression observer
and the replay-snapshot server adapter.

## Save states

Distinguish **Saving on this device**, **Saved on this device — waiting to sync**,
**Synced**, and **Needs attention**. Only successful local persistence earns a
local-save claim. Only a `SYNCED` flush followed by cleared outbox entries earns
**Synced**. A local-save failure stays visible until resolved.

Sync is attempted on startup, on returning to the foreground and when the
connection returns, while the app is running. Pending work stays visible until it
actually succeeds. Background Sync may be an optional enhancement. It is not a
requirement for Firefox/Android or Safari/iOS, and not a promise that the Univer
client runs while the app is closed. Follow the existing [history](history.md)
and [collaboration](collaboration.md) contracts.

## Device data and storage lifecycle

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
- **Remove from device** frees local content without deleting the server document
  or its personal pin. Pending changes require explicit recovery/deletion first.
  Use bounded storage and report per-item usage; application/storage schema updates
  must preserve pending edits and a compatible offline editor, including interrupted
  migrations. Reloading for a new service worker must respect pending input/work.

The current HTTP `no-store` rules in authentication, sharing and image routes do
not authorize a catch-all response cache. Explicitly downloaded private application
data is a separate policy. SPN-039 caches only the public shell on a prepared
device; an unprepared one keeps SPN-028's empty CacheStorage. As editing lands,
update docs/mobile.md, authentication, sharing, spreadsheets and documents to
describe verified behavior, and keep account-isolation and guest/token-exclusion
checks beside the authorization tests.

## Home-screen links and completion checks

Use the stable application item URL, not the internal SDK generation or a guest
token. Rename/move must preserve the destination. The browser/user controls icon
creation; a manifest shortcut menu is not a universal per-document pinning API.
When independent item icons are unsupported, provide the stable link and a clear
in-app pin/offline collection fallback, recording that limitation. A shortcut
never implicitly claims the document has been downloaded.

Test installed-context startup as well as a browser tab. On iOS, do not assume
browser storage is copied into or shared with an installed app: prepare offline
content in the context that will launch. Verify Android Chrome, Android Firefox
and iPhone Safari Home Screen on actual devices, recording OS/browser versions,
supported actions and observed launch behavior. CI's mobile viewport alone cannot
establish installation, storage-context or native home-screen behavior.

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

## Platform references

- [Offline assets and structured data](https://web.dev/learn/pwa/offline-data)
  and [storage quotas/persistence](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
- [Background Sync](https://developer.mozilla.org/en-US/docs/Web/API/SyncManager)
  and [manifest shortcut menus](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/shortcuts).
- [Firefox Android home-screen links](https://support.mozilla.org/en-US/kb/add-website-shortcut-your-home-screen-android)
  and [Safari iPhone web apps](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios).
- [WebKit installed-app storage separation](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/#web-apps).
