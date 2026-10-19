# Offline-first documents — planned contract

[SPN-039](todo/SPN-039.md) owns this required offline experience; this document is
its acceptance contract, not a claim that the feature is implemented. The Owner
supplied this proposal in chat on 2026-10-18; [decision #83](https://github.com/mxbaylee/spinel/issues/83)
records its scope. It is not marked must-ship for production. The [mobile installation slice](mobile.md) (SPN-028) supplies installation and
touch support. Its network-only fallback and [decision #82](https://github.com/mxbaylee/spinel/issues/82)
describe the initial slice; SPN-039 supersedes the earlier PRD/grooming ban for this
explicit signed-in feature when implemented. Guests and unprepared devices retain a generic
offline screen. Configured test HTTPS is sufficient for development; public
deployment and Slides are separate work.

Implementation is split into reviewable dependencies: SPN-040 added
Sheet-image support and SPN-041 owns the authorized download bundle.
[Decision #91](https://github.com/mxbaylee/spinel/issues/91) preserves SPN-039 and
every acceptance requirement below. A completed dependency does not mean offline
launch, downloads or durable local editing are available.

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

## How offline editing works

**Download.** **Available offline on this device** fetches the SPN-041 bundle:
the current snapshot, the revision and generation it represents, the account and
access it was issued for, the pinned SDK version and an image manifest. It then
fetches every listed image. Everything goes in an IndexedDB store scoped to the
instance, account and device. The item counts as downloaded only once every write
has succeeded and every image hash matches. A viewer's download opens read-only.

**Launch.** The service worker serves an allowlisted, versioned app shell. A
prepared device that cannot reach the server enters local mode, without treating
cached identity as fresh server authorization. Authentication errors stay
distinct from network outages. Today `web/App.tsx` checks the server session, and
both editors await `prepareCollaboration()` before loading, so local mode needs
its own start path. It reuses the local theme and stable `/?item=<uuid>` links.

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
paid service or engine replacement. Reusable work from draft #86 includes the
account- and epoch-scoped HTTP and socket adapters (`web/offline/OfflineAccess`,
`ScopedHTTP`, `scopedSocket`), the verified local image adapter
(`PreparedImages`) and the Sheet-image work that landed in SPN-040. Retire the
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
data is a separate policy. When implemented, update docs/mobile.md, authentication,
sharing, spreadsheets and documents to describe verified behavior. Replace the
SPN-028's blanket empty-CacheStorage assertion with allowlisted-public-asset,
account-isolation and guest/token-exclusion checks; preserve authorization tests.

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
