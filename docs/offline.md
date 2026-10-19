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
| Changes | Committed edits save locally, survive ordinary termination/reopen while offline, and sync while the app is running and connected. Local-save failure remains visible. |
| Entry points | Stable item links support direct launch; in-app pins, offline downloads and home-screen shortcuts remain distinct actions. |

The catalog is Spinel metadata, not the server's physical filesystem. Preserve
personal filing and source permissions: never copy inaccessible owner ancestors,
another person's tags, or unrelated documents. Owners and signed-in Collaborators
can download permitted items; viewer downloads remain read-only. Metadata and
selected documents refresh when connected without discarding pending local edits.
Content search, offline new-item/image creation, folder/sharing administration and
Slides are outside this first outcome. Existing embedded images are required.

## Implementation sequence and evidence

1. **Prove public SDK cold start.** On the pinned version, prepare one Sheet and
   one Doc with an image, close the app, reopen without network, edit, terminate
   and reopen offline again, then reconnect. Record versions, exact public calls,
   failed steps/errors and a reproducible fixture. The current
   `enableOfflineEditing` setting and recovery cache prove neither offline app
   launch nor this restart sequence: `web/App.tsx` checks the server session and
   both editors await `prepareCollaboration()` before their collaborative loader.
2. **Build local launch/catalog and complete downloads.** Reuse local theme and
   stable `/?item=<uuid>` links. Cache allowlisted public assets; use a deliberate
   instance/account-scoped data store for the catalog, documents and pending work.
   A previously prepared device can enter local mode on network failure without
   treating cached identity as fresh server authorization. Preserve authentication
   errors as distinct from network outages.
3. **Make edits durable and integrate reconnect.** Extend the existing public
   collaboration boundary and recovery mechanism, rather than introduce an
   independent whole-document upload path. Verify both document types across
   restarts and concurrent online edits before declaring this outcome complete.
4. **Complete home-screen flows and device evidence.** Use each browser's supported
   user-mediated link/install flow and test the document opened and storage used.

Time-box the first probe to one focused implementation session with a concrete
result. A failed probe is an integration problem to resolve: document supported
adapters or alternatives, implement the viable public-API path, or register
specific implementation dependencies before moving to another ticket. Preserve
the remaining acceptance on open tickets when splitting per process.md. A probe,
read-only offline viewer, or a brief open-tab disconnect is not completion of
SPN-039. Do not inspect or patch Pro internals, bypass licenses, buy a service or
replace the collaboration engine under this ticket; the existing decision gates
still apply to an alternative that needs those changes.

## Local saving and synchronization

Distinguish **Saving on this device**, **Saved on this device — waiting to sync**,
**Synced**, and **Needs attention**. Only successful local persistence earns a
local-save claim; server acknowledgement and completed recovery bookkeeping earn
the synced state. Preserve active, uncommitted cell/text input warnings and
document when that input becomes a committed edit. A mobile termination callback
is not the durability mechanism.

Keep the stable item identity together with the SDK unit/generation, revision
state and pending operation identities. Use the existing collaboration protocol;
never PUT an offline whole snapshot over a live collaborative document. Repeated
reconnects or a lost acknowledgement must not duplicate a non-idempotent edit.
Test independent edits and same-cell/same-text changes against the SDK's actual
merge semantics, and document the visible resolution of conflicting edits.

Revalidate the account/session, document access and live generation before remote
reads or synchronization. History restore preserves the item URL but changes its
SDK generation; old edits must not replay into the replacement. Trash, deletion,
revocation, expired authentication and server validation failures stop forbidden
sync while preserving pending work for explicit recovery. A conflict must never
be resolved by silently dropping pending edits or replacing the server copy.
Follow the existing [history](history.md) and [collaboration](collaboration.md)
contracts.

Attempt synchronization on startup, foregrounding and connection recovery while
running; show pending work until it actually succeeds. Background Sync may be an
optional enhancement, not a requirement for Firefox/Android or Safari/iOS and
not a promise that the Univer client runs while the app is closed.

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
reconnect while another editor has made changes, then compare both views and
server state. Include existing images, uncached/removed items, lost acknowledgements,
history restore, account switching and revoked/read-only shares. Deterministic
CI also exercises failed writes, partial downloads, eviction, removal with pending
work, repeated replay and interrupted application/storage updates.

## Platform references

- [Offline assets and structured data](https://web.dev/learn/pwa/offline-data)
  and [storage quotas/persistence](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
- [Background Sync](https://developer.mozilla.org/en-US/docs/Web/API/SyncManager)
  and [manifest shortcut menus](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/shortcuts).
- [Firefox Android home-screen links](https://support.mozilla.org/en-US/kb/add-website-shortcut-your-home-screen-android)
  and [Safari iPhone web apps](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios).
- [WebKit installed-app storage separation](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/#web-apps).

## Replay-base integration in progress

[Decision #88](https://github.com/mxbaylee/spinel/issues/88) selects the public
server `getUnitLoadDataWithBlocks` boundary for complete replay-base acquisition.
The account-only `POST /api/items/:id/offline-replay` accepts the expected SDK
unit ID and revision (`0` selects latest, with an explicit target revision in the
result). It retains the closest snapshot, required changesets, all Sheet blocks,
generation offset and application-preserved opaque resources. Declared binary
fields use lossless base64 JSON transport; metadata strings remain literal.
The response also names the item-scoped images required by the base and every tail
state, with SHA-256, MIME and byte length for separate authenticated acquisition.
An image removed by a later mutation remains in this manifest if earlier replay
needs it. No image bytes or successful-download claim are implicit in the list.
Access, live generation and the authenticated session are checked after the read.

This endpoint is groundwork, not an available offline download. The Owner and
Collaborator need a complete base for pending edits, the Operator needs a public
integration without a new service, and Link guests remain excluded. The caller
still must acquire and verify image/assets, scope storage to the account, retain
permission and pending-operation state, and satisfy every lifecycle and device
requirement above before showing availability or local durability.

## Bounded recovery probe result

On pinned Univer 1.1.0, [CI run 39208226532](https://github.com/mxbaylee/spinel/actions/runs/39208226532)
at `0bb61c8` passed both isolated cold-start probes and the existing HTTPS PWA
check. The fixture recorded selected synthetic reads, terminated/reopened a real
persistent Chromium browser twice offline, and verified exact contents after
reconnect through an independent server client. The Doc included an existing
image and a subsequent lost-acknowledgement restart: its original awaiting
operation survived, a matching real server confirmation preceded cache clearing,
and content/revision remained unchanged after another reload. This run's Sheet
probe covered text; expanded Sheet-image and third-idle-restart cases are pending.
The full browser suite did not pass: an independent Sheet read-only image drag
check exposed visual movement and remains a required repair.

The unadapted Doc loader replayed a cached mutation without an execution flag,
causing the public Doc state stream to recapture it as new local input. The probe
uses a host `ILocalCacheService` and the public root `CommandService` override:
exact returned parameter objects receive execution-only `fromChangeset` metadata.
No mutation bytes or request identities are rewritten. Identity matching is an
observed property of this pinned SDK, not a vendor guarantee. The flag bypasses
Doc permission checks as well as changing state emission; this synthetic owner
fixture is not a production authorization boundary.

Production integration still needs immutable account/item/generation scopes,
validated replay accounting with preserved original pending records, complete
local snapshot/authz/image adapters, and a revalidation barrier before any remote
read or synchronization. Unmatched or rejected recovery must preserve pending
work and stop opening/syncing. No content-based deduplication is permitted. These
requirements supplement, rather than replace, the full contract above.
[Decision #90](https://github.com/mxbaylee/spinel/issues/90) selects this host
coordinator/public-adapter path, with the same access and durability requirements
for the Owner and Collaborator, bounded operations for the Operator, and no
private offline capability for Link guests.

The in-progress `RecoveryLedger` accounts for entries in one retained,
account-scoped pending-record version. Repeated cache reads register fresh
parameter objects against those original entries; identical adjacent edits remain
distinct, and a consumed entry cannot replay again through another read copy.
Only exact registered Doc text parameters receive execution-only replay flags.
Malformed records, changed parameters, rejected execution and access changes stop
recovery without changing the caller's original record. This component is not yet
wired into the SDK cache or command service. Its completion assertion does not
unlock access: the coordinator still must prove loader/queue completion and an
atomic, durable staged-store commit. Document-only cache buckets require a
separately scoped adapter path; they must never be normalized into another account.
