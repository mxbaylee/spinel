# Live collaboration

Sheets and Docs use Spinel's own transform library, native browser client and
SQLite sync server. Every prepared document uses this one path; there is no
rollout flag or legacy transport fallback. The open-source Univer editor remains
responsible for rendering and native commands. The reusable implementation lives
in `@spinel/sync-transform`, `@spinel/sync-client` and `@spinel/sync-server`.

The [SPN-056 integrated review](implementation/SPN-056.md#integrated-verification-2026-10-26)
records accepted conflict/refusal and undo policies. [SPN-059](implementation/SPN-059.md)
records activation, retained-data transition and verification. SPN-075 supplies
native PDF export. The application has no Univer Pro dependency or license
registration. `npm run dependencies:check`, enforced by the required Lint gate,
checks dependency declarations in the root and every workspace plus the complete
resolved lockfile, including aliases and transitive packages. The independently
installed legacy checkout used by the offline exporter remains outside this graph.
The [integration decision](implementation/SPN-059.md#coordinate-the-two-pro-removal-prs)
records how the two replacement PRs were combined.

## Storage and retained-data transition

The application and sync log share the same SQLite file and connection. Sessions,
grants, Space topology, root privacy epochs, images, history and restore receipts
remain in their existing application stores. Final authorization and the edit,
receipt and snapshot write happen in one transaction. Acknowledgments follow
that commit. A failed validation or write discards the candidate native runtime.

Each document has one current native snapshot, a durable accepted-revision log,
and immutable retry receipts. Sparse before-images reconstruct exact common-base
cells for transformation. At most 128 revisions and 16 MiB per unit remain in the
transform window; older submissions resync. Durable accepted edits and retry
identities survive that window. At most eight native units are cached and idle
units are evicted after 60 seconds. Snapshots are bounded to 10 MiB, with additional
geometry and expanded-work limits in the [server contract](../lib/sync-server/README.md).

Fresh documents initialize atomically from their native snapshot. The initial
sync unit and application preparation fence commit together, so failed creation
can retry without permitting an old whole-snapshot save. A prepared legacy
collaboration document cannot silently fall back to its obsolete native row.
The application refuses incomplete transitions and legacy prepared units that
have not been imported.

The explicit [transition tools](../scripts/sync-transition/README.md) retain all
source documents by default and operate on a separate database copy. They export
current materialized snapshots through public APIs from a pinned pre-cutover
checkout, verify them, and import into a full copy of the source database.
Checkpoints, named versions, Formula definitions, restore IDs/offsets, images,
Spaces, internal trash/deletion batches, grants and handover state are preserved.
No children are flattened and no child grants are manufactured. Progress is
restart-safe and tied to a source fingerprint; the source stays recoverable.
Fresh disposable databases and actual legacy exports have separate checks.

Before switching a deployment, stop old writers and retain its source database
and verified backup. Do not use the old application against the converted copy.
Old `/universer-api`, `/guest-api`, `/space-api` and `/guest-space-api` protocol
routes are retired with 404 responses, and old sockets cannot upgrade. Copy
unsaved old-tab work before reloading; it cannot be submitted to a second backend.
This repository remains pre-production; this implementation does not itself
operate on any real user dataset or deploy a replacement service.

## Native protocol and consistency

Incoming edits transform past accepted edits using the cells at their exact common
base and `side: 'right'`. Final credentials, grant, exact Space root/child, ancestry,
privacy epoch and restore generation are checked in the write transaction.
MCP writes require an exact revision, and OAuth refresh retains the original
connection's retry identity. Each broadcast recipient proves current access
immediately before publication. No client-provided actor field grants authority.

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
the boundary for SPN-053; native sync does not provide an offline disk outbox.

The public native collaboration mutation event is the only outgoing capture
source. Capture ignores `onlyLocal`, `fromCollab` and `fromChangeset`, keeps
`syncOnly`, and excludes only the two exact renderer-control refresh IDs. Every
other mutation receives strict admission, including unknown operation-shaped IDs.
Sender normalization preserves triggers, inlines styles, records worksheet order,
marks inserted paragraph IDs and supplies shift context. Atomic transform groups,
cell claims and tails stay together under the wire bounds. Remote application
copies params and sets `fromCollab` on the live editor, preventing echo while
retaining native formula registration and dependent recalculation. Its confirmed
revision replica retains a separate local-only application path. Native undo
services remain enabled; no Pro collaboration preset is used. Every accepted peer
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

## Access, lifecycle and recovery

Current account sessions and document-scoped guest credentials authenticate every
snapshot request, ticket and socket upgrade. Tickets are one-use, expire after
30 seconds, and bind the cookie, active generation and exact route scope.
Operators and unrelated accounts cannot read, viewers cannot submit, and a guest
credential never becomes account authority. Mutation targets cannot escape their
unit; images must have been uploaded into that exact document. Invalid candidates
are refused before a durable write.

A 500 ms access scan and precommit revalidation close revoked sessions. Local
permission points make editors read-only without writing shared permission rules.
Account users with unsaved work retain the existing copy/recovery guidance;
revoked guests lose the entire document surface and its private content.
Credentials, names, mutations and document contents never appear in the fixed
`collaboration.edit_denied` audit event. [Sharing](sharing.md) and
[history](history.md) define the existing role and recovery rules.

Soft Trash keeps live content. Permanent deletion atomically queues the relevant
native generations before metadata cascades. Purge invalidates loaded runtimes,
removes their snapshots/revision receipts, and acknowledges the queue afterward;
startup and a minute timer retry interruptions. A live generation is never
purged. Raw protocol lifecycle calls cannot invoke deletion or version restore.

Restore drains admitted edits, preserves a permanent Before restore checkpoint,
validates the target, creates a new generation and atomically switches the active
ID. Logical revision offsets keep history monotonic. Stale tabs cannot edit the
replacement generation; failed staging remains recoverable through the existing
restore receipt and purge process.

## Editor controls

The existing save and connection controls use native sync acknowledgments, never
socket reachability alone. Pending edits survive a temporary disconnect in the
open tab; a stable envelope retries after reconnect without duplicate application.
Offline persistence remains the separate SPN-053 responsibility.

The toolbar lock, Protect range, Protect sheet, Change permissions, Remove
protection and Calculation options are hidden because their mutations are outside
the transform contract. Sheet-tab Copy is hidden for a sheet with 6,000 or more
stored cell entries, matching the native split-copy boundary. The command guard
also checks the actual target before mutation, so a stale menu cannot bypass it.
Small-sheet Copy, the name box, defined names, formula editing and cross-sheet
cut-and-paste remain available.

Doc startup still waits for its own layout, viewport and attached native input;
this wait cancels on navigation and fails visibly after 30 seconds. Bundled layout
assets avoid a late network dependency for cold offline layout. Image upload and
insertion remain guarded until the drawing mutation enters synchronization.
Presence uses the same saved account profiles and anonymous guest-root rules as
before; [profile behavior](design/account.md#saved-profile-behaviour-spn-036) applies.

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

Raw snapshot reopen verifies the saved drawing model. The separate browser
activation renderer catches invalid-extent preparation per image, omits that
image and its selection, and continues with other drawings. It does not delete
the persisted image. Thus a retained collapsed image can be invisible and
unselectable after a tab switch or reopen; automatic visual recovery is not
implemented. See the [accepted rendering boundary](implementation/SPN-056.md#retained-drawing-visibility-on-tab-activation-and-reopen).

Both full-file hashes and the pinned version are validated before either format
is written. Tests execute the actual upstream resize/refresh methods in both
formats, assert upstream rejection and repaired preservation, and exercise
native queued delivery plus raw snapshot reopen. The installer touches no Pro
package. SPN-099 independently reviews removal on upgrade; unfamiliar bytes
must be investigated instead of bypassing the guard. See the
[decision and evidence](implementation/SPN-056.md#retain-collapsed-drawing-geometry-through-native-refresh).

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
  two screens drift silently; a rejection is visible and unsupported menus are hidden. The package README lists them.
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

## Verification

The seven required CI gates remain Backlog, Pull request, Lint, Typecheck, Unit
tests, Lib tests and Playwright smoke. Browser projects exercise the default native
path in development, production and mobile HTTPS. Separate native evidence
projects compare complete confirmed browser snapshots against the server through
edits, reconnect, lost acknowledgments and reload. Two seeded browser soak jobs
exercise repeated Sheet and Doc edits with independent intent assertions. The
Playwright aggregate also requires actual retained-data transition and production
container checks. No pending, skipped or aborted workload counts as a pass.

Regression coverage retains account/guest/Space scope, revocation, one-use tickets,
origin protection, history checkpoints, restore generations, permanent purge,
MCP credential/exact-base/retry identity, Formula privacy, and backup restoration.
Protocol-specific tests now exercise native snapshot/replay instead of retired
SDK block or permission-batch endpoints. Retired routes are explicitly refused.

The native browser snapshot observer is enabled only in disposable test builds
with `VITE_SYNC_EVIDENCE=1`. It is read-only and ordinary builds omit it; there is
no production global that can issue editor commands. Browser tests retain the
one-second peer-delivery criterion and fail flaky-only successes. The broader
headless mixed matrix keeps all 100 seeds and at least 100,000 mutations; it is
separate from actual browser-soak evidence.

A passing suite does not establish unrestricted editor capacity. The intended
workspace remains small, and deployment capacity verification remains separate.
Headers, footers, notes, locked SDT blocks and footnotes remain outside the proven
mixed fuzz coverage; the [SPN-056 evidence and limitations](implementation/SPN-056.md#recommendation-and-remaining-limits-for-spn-059)
remain authoritative. Current cutover results and both independent grades belong
in the SPN-059 PR; the previous integration reviews do not approve this change.
