# Live collaboration

Sheets and Docs use Univer collaboration in the application server with SQLite
storage, authenticated access, presence and offline recovery. The integration
uses public SDK interfaces behind a TypeScript boundary. The owner chose this
approach on 2026-10-17 (decision [#31](implementation/SPN-012.md#legacy-decision-31-collaboration-independent-of-the-soak)), then on 2026-10-19 chose to replace it
with Spinel's own sync, originally scoped as SPN-056 through SPN-059. That
grooming retired the SPN-010 limits experiment and the SPN-013 queue.

The [staged landing](implementation/sync-staged-landing-2026-10-25.md#land-the-library-and-retain-spn-056-for-integrated-review)
now separates SPN-104 (the transform library), SPN-057 (the sync server),
SPN-058 (the client), the retained SPN-056 (independent integrated review), and
SPN-059 (cutover and removal of Univer collaboration). The
[integrated verification record](implementation/SPN-056.md#integrated-verification-2026-10-26)
contains the acceptance evidence and adopted conflict policies. The replacement
remains inactive until SPN-059 completes cutover.

## Spinel server integration flag

SPN-057 supplies `@spinel/sync-server` and the application SQLite adapter behind
`SPINEL_SYNC_SERVER=1` (`createApp({syncServer:true})` in tests). The flag defaults
off. SPN-058 connects the native browser client and ephemeral presence to that
same flag: preparation returns `syncVersion: 1` only for this backend. There is
no separate frontend flag. Retained-data conversion and Pro removal remain
SPN-059; SPN-056's integrated review does not activate the replacement.

With the flag enabled, newly prepared native documents use one durable revision
log. An incoming edit is transformed past each accepted edit using the cells at
their exact common base and `side: 'right'`. Sparse cell before-images reconstruct
those bases from the current snapshot; whole snapshots are not stored for every
revision. The working window is at most 128 revisions and 16 MiB per unit. Older
submissions resync. Accepted edits and immutable retry identities remain durable.
The server keeps at most eight headless OSS Univer units and evicts idle units
after 60 seconds.

Final credential, grant, exact Space scope, ancestry, root privacy epoch and
generation checks run inside the same SQLite transaction as the revision, receipt
and current snapshot write. Acknowledgements follow that commit. A failed
validation or write discards the candidate runtime. Stale assistant writes retain
exact-revision rejection and OAuth refresh retains the original connection's retry
identity. Each broadcast recipient proves current access immediately before send;
the 500 ms scan and precommit scan close revoked sockets.

Backend ownership survives restarting with a different flag. The new server
refuses existing legacy collaboration units; the legacy path refuses units owned
by the new log. Neither path falls back to an obsolete native snapshot. Purge
continues to remove owned generations even with the new serving flag disabled.
Conversion remains SPN-059.

The protocol uses these route prefixes followed by `/ticket`, `/snapshot` or
`/socket`, always with `?unitId=<active-generation>`:

| Credential       | Prefix                                          |
| ---------------- | ----------------------------------------------- |
| Ordinary account | `/sync-api/items/:itemId`                       |
| Ordinary guest   | `/sync-api/guest/:itemId`                       |
| Space account    | `/sync-api/spaces/:spaceId/items/:itemId`       |
| Space guest      | `/sync-api/guest-spaces/:spaceId/items/:itemId` |

`POST /ticket` requires the configured Origin and returns a single-use, 30-second
ticket. The socket URL supplies that ticket as `ticket`; upgrade requires the same
cookie, scope and privacy epoch. `GET /snapshot` returns the native snapshot and
current revision. A socket without `afterRevision` retains its initial snapshot
frame. The browser always supplies `afterRevision=<confirmed-revision>`, including
on its first connection, and receives a versioned `resume` containing every
ordered revision since that base. Replay and subscription are synchronous, so
edits cannot fall between loading the snapshot and joining the room. Socket submissions carry
`{type:'submit',mutationId,baseRevision,mutations}`. The server sends ordered `edit`
frames and a durable `ack`; the sender must account for its own revision appearing
in both. Retries return the original ack without rebroadcasting the edit. Frames
never contain internal before-images, actor identities or payload fingerprints.
Refusal sends `resync` with a fixed reason and a validated `mutationId` only when
it answers that submission. An expired replay window leaves the socket open for
an immutable retry to recover its original durable receipt before resync.

A client with no pending edits sends `{type:'verify',revision,hash}` for its latest
applied revision, using the shared touched-footprint hash contract. A mismatch
requests resync and emits `sync.divergence.detected`. Metrics and static log events
have strict allowlists; no document values or diagnostic replay shapes are
collected. Guest activity is excluded from the diagnostics collector. See the
[package contract](../lib/sync-server/README.md) and
[implementation decisions and evidence](implementation/SPN-057.md).

### Native client and save state

`@spinel/sync-client` owns an acknowledged native replica, one immutable sent
envelope, and an unsent optimistic buffer. It rebases against the exact confirmed
cells, using confirmed-plus-old-inflight cells for the buffer. Ordered broadcasts
can include the sender's edit before its acknowledgment; the receipt identifies
that revision without applying the optimistic edit twice. A reconnect retries the
same mutation ID, original base and original bytes. Opening a socket does not
clear pending state: the ordered resume must complete, and each pending write
needs its durable acknowledgment. The optional checkpoint persistence hook is
the boundary for SPN-053; this ticket does not provide an offline disk outbox.

The public native collaboration mutation event is the only outgoing capture
source. Capture ignores `onlyLocal`, `fromCollab` and `fromChangeset`, keeps
`syncOnly`, and excludes only the two exact renderer-control refresh IDs. Every
other mutation receives strict admission, including unknown operation-shaped IDs.
Sender normalization preserves triggers, inlines styles, records worksheet order,
marks inserted paragraph IDs and supplies shift context. Atomic transform groups,
cell claims and tails stay together under the wire bounds. Remote application
copies params and sets `onlyLocal` and `fromCollab`, preventing echo while retaining
native formula recalculation. Native undo services remain enabled; the legacy
Pro collaboration preset is not used to create this client. Every accepted peer
revision clears local undo/redo history, including one whose transformed edit
is empty, because Univer's local inverse mutations retain old positions.
Own acknowledgments preserve history. Normal local undo remains available until another editor's
change arrives; collaborative undo-history rebasing is not implemented. This
prevents an old inverse from changing the wrong cell or text offset.

An edit refusal freezes editing and waits for the answer to any already-sent
request before discarding rejected/later pending edits. Reloading the authoritative
snapshot displays a persistent explanation that those edits were discarded; it
does not report them saved or offer to retry a discarded queue. Pending-free
verification hashes the visible native model and fences obsolete async hash
results. Access changes, restoration, page switches and disposal fence callbacks,
timers, cursor state and sockets belonging to the previous editor.

See the [client contract](../lib/sync-client/README.md) and
[SPN-058 decisions](implementation/SPN-058.md), including the distinction between
actual Doc drawing UI behavior and the SDK's registered refresh handler.

### Native ephemeral presence

Each live connection has its own generated identity, including separate tabs for
the same account. The server supplies saved profile names and catalog avatars;
clients can submit only a cursor selection. An active anonymous link anonymizes
the entire root's rooms for all recipients: accounts appear as “Collaborator”,
guests as “Guest”, and avatars are empty. These labels are independent of which
child page of a Space is open.

Cursor frames use `{type:'cursor',selection}`, the existing Sheet/Doc selection
grammar, at most 160 characters and 512 wire bytes, and a 10/second token bucket
with burst 20. The UI coalesces updates at 150 ms. Invalid or flooded cursors close
that connection without resyncing document edits. Presence is never persisted or
included in diagnostics. Current sender, member and recipient access is checked
before publication; the 500 ms access scan, close/error cleanup and 15-second
heartbeat remove stale sessions. The 64-connection room cap includes sockets
still closing.

The shared header, Sheet canvas and new Doc canvas use saved profile colors and
icon/name labels. Doc remote ranges have independent public canvas objects and
never replace local selection. Following a supported body-text range moves the
local selection and focuses the editor only after the user chooses that action.
Unsupported cursor encodings remain in the people list without a jump action.
Disconnected and disposed editors clear membership and remote drawings.

The following sections describe the default legacy transport and shared access,
lifecycle and editor behavior until SPN-059 performs the cutover.

## Storage boundary

`src/server/collaboration/service.ts` is the TypeScript boundary around Univer's
public collaboration service and SQLite adapter. Versions are pinned to 1.1.0;
closed-source package implementations are not modified or inspected. Normal SDK
license and watermark behavior remains intact.

The adapter uses the exact application SQLite file. It owns its collaboration
tables; workspace ownership, grants, accounts and images retain their existing
stores. This keeps the online backup from SPN-030 consistent across all data,
without a second database archive or cross-database snapshot protocol. The
constructor refuses a different database path. This choice is recorded in
[decision #37](implementation/SPN-012.md#legacy-decision-37-one-database-for-collaboration-recovery): it simplifies
recovery for the Operator, preserves the Owner's documents, gives the Collaborator
durable shared state and keeps Link guests behind the same access rules.

Opening an existing Sheet or Doc will migrate its complete native snapshot once.
A persisted `preparing` marker fences old snapshot writes before asynchronous SDK
work starts. A retry uses an existing unit without replacing its edits; an
interrupted creation stays fenced and can be retried. The old snapshot remains
available as migration input. Old tabs must copy unsaved changes before reloading;
they cannot overwrite the new collaboration state. Native reads use the SDK's
public snapshot materializer/converters so confirmed changesets are included.

## Access and lifecycle

The transport authenticates every protocol HTTP request and WebSocket upgrade
against the current Spinel session. Mutation requests and upgrades require the
configured Origin. Tickets expire after 30 seconds, are single-use and are bound
to the same session cookie and one document. Ticket issuance and upgrade require
current read access to that Sheet or Doc; absent scope, missing/revoked grants,
Operator accounts and invalid sessions are refused before the HTTP 101 upgrade.
The browser supplies scope through the public socket URL extension point.
The SDK's connect hook compares ticket and upgrade cookie/scope after upgrade
but before HELLO or JOIN; a mismatch closes with no messages or document data.
Thus an account authorized for both scopes can receive HTTP 101 for a mismatched
ticket, but cannot enter either room with it. JOIN and presence recheck both scope and current access; no client-supplied user ID
can replace the authenticated session. Public links use the document-scoped guest identity described in [sharing](sharing.md);
they grant no account session or unrelated document access. Credentials do not
become a query-token authentication fallback.
HTTP payloads are capped at 10 MiB and socket frames at 64 KiB. At most 64 live
connections are tracked; connections without a room expire after 30 seconds.

[Decision #49](implementation/SPN-017.md#legacy-decision-49-document-bound-websocket-admission) records the scoped
connection and audit policy. Permission-denied edits emit a structured stderr
`collaboration.edit_denied` event with a timestamp, stage and UUID-shaped account
and document identifiers. Requests, mutation contents, names, cookie values,
session hashes and tickets are never included in this audit. Treat the event as
access-denial evidence, not as a copy of the rejected change. Transport-level
unauthenticated requests are refused before they can reach the edit service.

Service middleware checks current sessions and workspace grants on reads,
submissions, application and final commit. Viewers cannot submit; Operators and
unrelated accounts cannot read. Cross-unit mutation targets are rejected. A
separate public materializer validates the aligned candidate before persistence:
the native document must stay within 10 MiB, and Doc drawing sources must refer
to images uploaded into that same document. Invalid content is a permanent
validation error, never a retryable database failure.

A serialized access scan runs every 500 ms and before final commits. It closes
revoked sessions and invalidates their room memberships before the next change
can broadcast. The SDK's public invalidation API is scoped to a user and unit,
not an individual login: revoking one login can also disconnect that user's
other tabs in the document. Those tabs must reconnect; stale access is never
retained to avoid that inconvenience. Access changes make editors read-only and
ask users to copy unsaved work before reloading. Read-only presentation uses local
permission points, never commands that modify shared document permission rules.

Trash and inherited grants remain governed by workspace access. Permanent
workspace deletion atomically queues an application-owned purge record before
its metadata cascades away. A trusted service call hard-deletes SDK data and
acknowledges the queue only afterward. Startup and a minute timer retry pending
purges; interruption leaves the record for retry. Raw protocol lifecycle calls
cannot invoke this trusted path. Soft trash/restore retains the live state.
These boundaries and the retryable purge were recorded in
[decision #43](implementation/SPN-012.md#legacy-decision-43-authenticated-collaboration-boundary).

## Editor behavior

Sheets and Docs load through the public collaboration client. The public
synchronization status stream drives save messages and navigation warnings;
pending or disconnected changes never report saved. Offline editing is enabled
and a synchronized editor remains guarded until the public recovery-cache flush
finishes. A newer edit or access change invalidates an older flush completion;
pending recovery data is never cleared. Preparation warms the candidate validator
before opening the editor without dropping validation of subsequent changes
([decision #47](implementation/SPN-012.md#legacy-decision-47-truthful-saved-acknowledgement)). Reconnect retries every second. A public session-service override returns
forwarding handles that omit only ephemeral cursor sends while offline; durable
changes, joins and status streams retain SDK behavior. SDK instances and prototypes
are untouched ([decision #45](implementation/SPN-012.md#legacy-decision-45-offline-ephemeral-cursor-handling)). Renderer language dictionaries are bundled
with the renderer in development and production so first-time text layout never
needs a late network download ([decision #44](implementation/SPN-012.md#legacy-decision-44-cold-offline-layout-assets)). Image insertion retains its upload and
insertion guard until the drawing mutation has entered synchronization.

Docs also wait for their own page layout, viewport and attached text input before
initial selection and readiness. The global plugin Rendered stage is earlier
than that work; an unresolved selection can intentionally blur the input. The
wait is cancelled on navigation and fails visibly after 30 seconds.

Spinel renders Sheet presence with matching profile colours and icon/name labels;
header badges reveal the person's name on hover/focus without shifting layout.
Following a Sheet range reveals it without replacing the local selection. Docs
retain native canvas presence on the default legacy path; supported body-text selections can still be selected
from the header, while unsupported encodings remain presence without a jump.
See [profile behaviour](design/account.md#saved-profile-behaviour-spn-036) and
[decision #127](implementation/SPN-036.md#legacy-decision-127-profiles-and-public-sheet-following).

Each service/materializer runtime is capped at eight loaded units and evicts
idle units after a minute. This is a cache bound, not a measured capacity claim
for the production host. SDK licence checks and watermarks remain intact.

## Pinned open-source paragraph repair

`npm ci` runs `scripts/dependencies/patch-univer-core.ts` against Apache-2.0
`@univerjs/core` 1.1.0 only. The upstream paragraph composer merges attributes
when an operation requests replacement: leaving a bullet list can look correct
locally but restore a bullet or heading when saved. Its operation slicer also
loses explicit empty paragraph replacement arrays. The repair matches the tested
editor replacement semantics, preserves stable paragraph IDs, and leaves ordinary
COVER behavior unchanged ([decision #46](implementation/SPN-012.md#legacy-decision-46-guarded-open-source-paragraph-repair)).
It is not a general proof of operation-algebra equivalence: removing a paragraph
and then reintroducing it without an ID retains the old ID in composition while
sequential application leaves it absent. The tested editor operations preserve
their IDs; content and formatting matched in the independent replacement matrix.

The same patch fixes how a text style that replaces a run's style (REPLACE, as
the format painter sends) transforms past a concurrent style that merges
(COVER): stock 1.1.0 overrides the merged style's keys only where the
replacing style's value is truthy, so a concurrent bold survived a winning
`bl: 0` on one screen only. Any key the replacing style sets now wins.

The installer validates the version and whole-file SHA-256 of both ESM and CJS
builds before writing either, accepts an already repaired installation, and
rejects unfamiliar bytes. It does not read or modify Pro packages. Docker copies
the installer before `npm ci`; the dependency's license stays with its package,
and the patch's attribution is in `THIRD-PARTY-NOTICES.md`.

The patch is temporary: SPN-099 removes it when Spinel upgrades to a Univer
release with the fixes. The link fixes are upstream as
[dream-num/univer#7938](https://github.com/dream-num/univer/pull/7938). If
upstream fixes any of them another way, Spinel follows upstream rather than
re-patching. Never bypass the guard just to make an install pass.

## Pinned open-source drawing refresh repair

`npm ci` also runs `scripts/dependencies/patch-univer-drawing.ts` against the
Apache-2.0 `@univerjs/sheets-drawing` 1.1.0 ES and CJS builds. Its two internal
resize/refresh paths can encounter a retained image with finite zero or signed
extents after structural work. Applying new-placement validation there throws
and can stop later native edits. The repair preserves the image's identity,
anchors and exact finite extent through native coordinate conversion; it does
not clamp or delete content. Explicit new placement, invalid anchor coordinates
and nonfinite sizes keep strict validation.

Both full-file hashes and the pinned version are validated before either format
is written. Tests execute the actual upstream resize/refresh methods in both
formats, assert upstream rejection and repaired preservation, and exercise
native queued delivery plus raw snapshot reopen. The installer touches no Pro
package. SPN-099 independently reviews removal on upgrade; unfamiliar bytes
must be investigated instead of bypassing the guard. See the
[decision and evidence](implementation/SPN-056.md#retain-collapsed-drawing-geometry-through-native-refresh).

## Verification completed

`npm run e2e` builds once and runs the configured projects sequentially, with
only the matching app server alive and one browser worker. Development retains
Vite modules and HMR but omits Node’s server-file watcher: fixed-source tests do
not exercise autorestart, and watching adds import-tracking IPC, including worker
imports. The normal `npm run dev` command still watches server files. Each build retains
its own traces and disposable database. Tests that need a fresh setup/admin
instance launch and close a real server child rather than retaining a second
SDK/Vite module graph inside Playwright. These controls bound test resources;
both builds still enforce the first committed edit arriving within one second
([decision #48](implementation/SPN-012.md#legacy-decision-48-bounded-strict-browser-validation)).

For a focused run after building, use
`SPINEL_E2E_PROJECT=production npx playwright test e2e/collaboration.spec.ts --project production`;
substitute `development` in both places for the development server. The npm
wrapper deliberately rejects `--project` because it verifies both builds.
Traces are recorded on the first CI retry rather than every successful action,
following [Playwright's performance guidance](https://playwright.dev/docs/best-practices#debugging-on-ci).
A focused development first-edit test exceeded one second while recording every
action, then passed unchanged with tracing off. This is diagnostic evidence of
instrumentation overhead, not a relaxation of the limit: retries still enforce
the same assertions, and CI fails tests that pass only on a retry. Add `--trace on`
to a focused command when debugging locally.

The focused integration tests use the actual pinned service and SQLite adapter:

- Existing Sheet values/formulas and Doc text survive idempotent migration;
  stale snapshot writes are rejected.
- Interrupted migration retries preserve the existing unit and retain its fence.
- Viewer, unrelated-user, Operator, revoked-grant and direct lifecycle checks fail
  closed at the service boundary.
- A real Sheet mutation is committed, materialized as value 99, encrypted through
  SPN-030's archive, restored into a fresh database, reopened through the SDK and
  materialized as the same value. Native Doc data and grants survive as well.

Browser tests separately verify simultaneous Sheet and Doc edits through two
authenticated contexts, strictly within one second from committed input to both
peer views. They also verify name/colour/selection navigation, a full minute of
socket and HTTP disconnection, queued-edit merging in both open views, and
read-only/revocation behavior. The broader suite covers rich text and images,
formulas/formatting/tabs, reload persistence, sharing, trash and authentication.
Both development and production must pass; CI fails flaky-only successes.
Earlier local runs under additional instrumentation/resource pressure exceeded
the latency limit; retain those failures and the subsequent clean-run evidence
in the PR rather than treating the limit as a universal hardware guarantee.

The Sheet browser regression also loses both the HTTP submission response and
the corresponding socket acknowledgement after a real server commit. The client
stays offline and reports unsaved work until explicitly reconnected. Recovery
and a subsequent reload preserve the edit with exactly one durable revision
increment, so an idempotent cell value cannot conceal duplicate application.

## Merging concurrent edits

[`lib/sync-transform/`](../lib/sync-transform/README.md) (SPN-104, originally SPN-056) merges two
people's concurrent Sheet and Doc edits so both screens end with the same
document. It is the first implementation slice replacing Univer collaboration,
because the owner chose to rewrite it rather than keep the closed-source
transforms (owner, chat 2026-10-19). It is written from the open-source
mutation definitions only; `@univerjs-pro/collaboration` was never read.

- **Its own package** with Univer as peer dependencies and no server or DOM
  imports, so the sync server (SPN-057) and the client (SPN-058) share it
  (AGENTS.md).
- **Pure transforms read caller-supplied base cells.**
  `transform(a, b, side, { cells })` keeps no document store and performs no
  I/O. Its `cells(unitId, subUnitId, row, col)` callback returns the cell at
  the revision both sequences started from, with styles inline, or null or
  undefined for an absent cell. The transform reads cells where two writes
  meet and for every absolute write in either input, even without a conflict;
  it applies earlier mutations in each sequence to those cells itself.
  Omitting the callback when those reads are needed throws a `TypeError`.
  Wrong base cells can give a wrong merge the transform cannot detect (the
  replay merge, [SPN-056 decision 29](implementation/SPN-056.md#29-resolve-same-cell-writes-by-replaying-them-through-univers-own-merge-on-the-base-cells-the-replay-merge);
  [package contract](../lib/sync-transform/README.md#contract)).
- **The server supplies the incoming batch's base-revision cells.** A client
  keeps a confirmed snapshot of the server's state at the last revision it
  applied, before its own pending edits. It reads that snapshot when rebasing
  an incoming edit past its sent batch, and that snapshot with the sent batch
  applied when rebasing past its unsent edits. The confirmed snapshot must
  match the server's state at that revision exactly; the live document
  including all optimistic edits is not that base (SPN-057 and SPN-058).
- **Unsupported mutations are rejected, never guessed at.** A wrong guess makes
  two screens drift silently; a rejection is visible and SPN-059 hides the menus
  that produce one. The package README lists them.
- **Conflicts go to the side the server accepted first**, per cell, index or
  key, so the other person's unrelated changes to the same cell survive.
- **Senders inline styles, keep doc paragraph ids, send a removed sheet's
  index, mark a shift's MoveRange and give new docs their drawing
  containers**, because these facts differ per client or are missing from
  Univer's mutations and cannot be supplied by the base-cell lookup (package
  README, "What a sender must do").
- **The server checks whole-workbook invariants.** Two edits that each keep at
  least one sheet, or one visible sheet, can together remove them all; no
  transform of the pair can see that. Before persistence or broadcast, the
  final candidate must also have matching worksheet IDs, snapshot keys and
  order, with case-insensitively unique sheet names. The transform refuses
  concurrent name/restore collisions as `name-race`; the server additionally
  rejects malformed assignments against unchanged sheets. Reopening a native
  snapshot must not be relied on to repair names, since that can change formula
  targets ([decision 37](implementation/SPN-056.md#37-refuse-concurrent-worksheet-identity-collisions)).
- **Verified against Univer itself.** Each transform pair, and a seeded
  100,000-mutation run of two clients and a server, are checked with the real
  open-source handlers running headless.

## Related work and limits

This integration does not establish an unlimited editor count or a
more-than-a-day soak. Rather than measure Univer's limits (the retired SPN-010)
or queue editors past them (the retired SPN-013), the staged library, server,
client, integrated review and cutover tickets above replace it.
SPN-017's raw socket tests cover missing cookies, missing/foreign document scope,
stale sessions, hostile origins, single-use tickets, a second-document JOIN,
viewer edits with a forged owner ID, and downgrade/removal after JOIN. A positive
raw edit control commits the same mutation when authorized; denied writes leave
both the revision and native document unchanged. Mid-application revocation is
also tested before durable commit. Browser tests verify that the affected editor
becomes read-only and revoked sockets receive no later document changes. The SDK
submits durable changes over authenticated HTTP associated with the socket's
member ID; that ID is not an authorization credential. Public link access and history are implemented under [sharing](sharing.md) and
[history](history.md); profile customization is available in Settings. The one-second browser
acceptance checks do not replace fresh-host capacity/deployment verification.

Public references:
[storage](https://docs.univer.ai/server/collaboration/database-adapters),
[identity](https://docs.univer.ai/server/collaboration/identity-and-authorization),
[middleware](https://docs.univer.ai/server/collaboration/middleware-and-events),
[presence](https://docs.univer.ai/server/collaboration/presence).

### Profile appearance and following

SPN-036 uses server-issued catalog avatar URLs in account-only membership to carry
validated icons and palette choices. Active guest-link rooms still receive empty
avatars and generic names. The Sheet renderer uses public range highlights and
canvas-contained labels, and applies the same colour to normal local selection
controls. It only draws remote markers on their actual active tab; row/column
selections are sent as explicit bounded cell ranges. Changed selections publish within 150 ms; idle cursors refresh every two seconds
so peers that finish mounting after the join event still receive them. This uses
the existing cursor-only message without server retention or new payload fields.

Following a Sheet collaborator uses the public reveal-range controller without
changing the local active range. Already-visible cells stay in place. Profile
saves take effect in editor membership on reopening the editor. Docs retain native
canvas presence until SPN-058; disabling the entire collaboration UI caused missing
Docs dependencies in the prototype. Owner scope decision [#127](implementation/SPN-036.md#legacy-decision-127-profiles-and-public-sheet-following).
