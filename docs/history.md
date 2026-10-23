# Document history

Spinel keeps compressed native Sheet and Doc checkpoints in the same SQLite file
as the documents, images and collaboration data. Sheet and Doc editors have a
Versions panel for naming the current state or a past checkpoint, opening a read-only
preview, and restoring a selected version. **Browse history** opens today’s timeline
and the older-day calendar in the isolated preview tab. Future editors must join
this capture path before they accept document saves.

Opening a live document preserves its baseline before editing is enabled. Raw
collaboration submissions also pass that baseline guard. The older native save
path preserves the prior saved content atomically before its first overwrite;
for a new document it preserves the first successful save. Its optimistic revision
and write-ID checks still reject stale writes and accept identical retries.

Confirmed edits mark a document dirty. Every 30 seconds the scheduler captures
dirty documents if five minutes have elapsed since their last checkpoint, or if
they have been idle for 60 seconds. An uninterrupted editing session therefore
gets checkpoints about five minutes apart; an idle capture can occur up to 30
seconds after the idle threshold. Unchanged documents do not create duplicates.
The scheduler reconciles public collaboration revision metadata after a missed
event or restart; it conservatively restarts the idle timer for a recovered edit.
Capture failures leave dirty work eligible for a later retry.

Native saves and collaboration each have their own revision sequence. Migration
preserves both sets of checkpoints instead of treating revision 1 in one sequence
as a duplicate of revision 1 in the other. A capture that overlaps another edit
does not mark the newer revision as captured. Shutdown waits for running capture
work before closing the collaboration service and database.

## Retention and storage

The owner approved this schedule in
[decision #39](implementation/SPN-023.md#legacy-decision-39-history-retention-spacing):

- Under one hour: keep every captured checkpoint, including idle breaks.
- One to six hours: retain the latest checkpoint in each UTC half-hour bucket.
- Six to 24 hours: retain the latest checkpoint in each UTC hour bucket.
- Older: retain the final available checkpoint of each UTC day.
- Named versions never expire or displace an unnamed retention slot. The newest
  available version is always retained, even for an inactive document.
- Before restore checkpoints are retained until permanent document deletion, even
  if their optional user-assigned name is removed.

Age ranges are half-open: exactly one hour enters the half-hour tier, six hours
enters the hourly tier, and 24 hours enters the daily tier. Buckets can thin only
snapshots that actually exist; there is no invented version for an inactive day.
Daily checkpoints accumulate while a document exists, and named versions add to
that storage. Neither is a fixed total-history quota.

The repeatable storage fixture saves a 64 KiB hexadecimal document every five
minutes for seven days, using the actual native save, capture and prune path. Its
budget is at most 64 retained checkpoints, less than 4 MiB of compressed history
payload and less than 8 MiB for that fixture's checkpointed SQLite file. These are
test budgets for representative history overhead, not guarantees for arbitrary
10 MiB documents, images, named versions or SDK operational changesets. SDK data
is not pruned through undocumented tables or APIs.

## Named versions

Editors can use **Versions → Name this version** after local edits finish saving.
The server captures the confirmed revision it observes for that request, separately
from any older background capture. An edit committed afterward remains live and
will receive its own checkpoint normally. Naming never restores or alters content.

Names are trimmed, contain 1–120 characters and need not be unique. Naming the
same source/revision updates that checkpoint's name. The list marks named versions
with a pin; editors can name a past checkpoint, rename it, or remove its name.
Removing the name returns it to normal pruning unless it also has a Before restore label. Named versions persist until
unnamed or their document is permanently deleted. This includes backup/restore.

`GET /api/items/:id/history` lists metadata under current read access.
`POST /api/items/:id/history` with `{name}` captures and names current content;
`PATCH /api/items/:id/history/:checkpoint` with `{name}` renames, and `{name:null}`
unpins it. Mutations require the configured origin, a current session and edit
access. Current-state capture rechecks the session and edit access after async
work, before committing. A concurrent native migration returns a retryable UI
error rather than pinning an obsolete native copy. Viewers can read the list but
cannot name or unname. No anonymous history route is added.

These bounds and semantics were chosen in [decision #56](implementation/SPN-024.md#legacy-decision-56-names-bind-exact-saved-versions)
to preserve the Owner's recovery points, allow authorized Collaborators to label
shared work, keep Operator storage simple and maintain Link guest access boundaries.

## Images, access and recovery

Retained versions keep their document-scoped image URLs. Uploaded image bytes
remain in SQLite even after an image is removed from the live document. The
existing 50 MiB image quota applies to all uploads for that document. There is no
new image garbage collector: an apparently unused upload might still be in an
offline edit. This conservative policy preserves retained versions and pending
edits; see [decision #23](implementation/grooming-2026-10-17.md#legacy-decision-23-first-integration-grooming) and
[decision #51](implementation/SPN-023.md#legacy-decision-51-materialized-native-history-checkpoints).

History reads use the current document access resolver and recheck access after
decompression. Current viewers can read versions; revoked users, disabled users
and administrators without document access cannot. Checkpoints are scoped to the
requested document. Background capture selects a currently authorized active
user through that same resolver, including inherited shares. For ordinary files,
disabling an owner does not stop checkpoints while an active collaborator still has access. If no
eligible user remains, existing history stays stored and capture resumes when
access returns. Link guests gain no new route or permission.

Trash preserves history. Permanent document deletion cascades to checkpoints,
progress markers and image bytes. The existing encrypted backup archive includes
all of these in one consistent SQLite backup. Recovery verification covers a
retained named version whose image was removed from the live document, followed
by authenticated archive restore and reads under a shared viewer's identity.

## Space documents

[SPN-092](implementation/SPN-092.md) applies the same checkpoint, naming and restore
policy to one native child at `/api/spaces/:spaceId/items/:itemId/history`.
[Spaces are enabled by default](sharing.md#space-sharing); explicitly disabling
them refuses these routes and preserves deferred checkpoints. Public list,
preview, naming and restore require a current everyday account session and the
exact root and child; an account Viewer
can read, while an Editor or Owner can name and restore. Guests, MCP credentials
and the private background capability gain no public history permission.

A valid guest edit can preserve a private baseline before it commits. Prepared
documents and raw submissions retain their original credentials through capture;
every caller joining shared capture or restore work independently rechecks its
current access. Compression, decompression and native reads do not retain an old
grant across an await. Current-version capture also fences the live generation.
Preview links keep the Space root, and historical Formula definitions evaluate
with current source permissions through the same exact child scope.

Space background work uses an unforgeable in-process read capability bound to one
active everyday actor, root and child. It does not invent a browser session or
grant edits. Disabled Space owners make the whole Space unavailable, including
background history; the ordinary disabled-owner policy above remains separate.

Every deferred Space checkpoint stays intact while the gate is disabled, the
candidate is unsupported or inaccessible, or its bounded maintenance batch cannot
be completed. A supported capture or metadata read admits that child's history
to the existing checkpoint retention schedule for the current maintenance pass;
pruning still resolves current live access again. Space and ordinary candidate
batches are separate so unsupported Space work cannot consume the ordinary batch.
This is checkpoint retention only: no automatic Space Trash expiry is introduced.

`src/server/history/space.test.ts` covers account-only routes, each coalesced
caller's authorization and bounded maintenance. Native restore and the
[encrypted backup/ownership handover acceptance](backups.md#native-space-recovery-acceptance-2026-10-22)
also preserve checkpoints, images, generation offsets and Before restore labels.
The [implementation record](implementation/SPN-092.md) keeps this checkpoint
acceptance distinct from final-head CI and merge approval.

## Why application-owned checkpoints

The optional Univer collaboration history service was evaluated using its public
README and type declarations. It indexes derived changeset segments, but its
public API does not provide this compressed snapshot retention and pinned-version
policy. Spinel therefore materializes native snapshots through public SDK APIs
and owns only its checkpoint tables. No Pro implementation is inspected or
patched. [Decision #51](implementation/SPN-023.md#legacy-decision-51-materialized-native-history-checkpoints) records the
tradeoff for the Owner, Collaborator, Operator and Link guest.


## Browsing snapshots

**Versions → Browse history** opens a separate preview tab. Today shows every
retained snapshot on a slider; drag it with touch or use arrow keys to preview
another snapshot. Older days shows a month calendar, highlighting only dates with
actual retained checkpoints and marking named versions with a pin. Choose a day,
then use its version selector to reach every saved checkpoint, including multiple
named and **Before restore** checkpoints on the same day. Inactive days are disabled;
no placeholder snapshots are created.

The calendar and displayed times use **UTC**, explicitly labelled to match existing
UTC retention buckets. Stored timestamps and pruning rules are unchanged. A named
version is never hidden just because an unnamed daily checkpoint exists. The UTC
day updates across midnight; Refresh history reloads the permitted checkpoint list.

Selection only changes an isolated read-only native viewer, never the live editor.
Rapid slider changes are debounced and the previous viewer is disposed. The previous
preview is hidden while a different selection is loading, so its restore button
cannot be confused with the newly selected timestamp. While a confirmed restore
is running, history selection and refresh controls are disabled. An unavailable
requested checkpoint produces an error instead of silently choosing another restore
target. Current viewers can browse; only editors may restore through the existing
confirmation and generation guard. No history route is added for Link guests.

[Decision #81](implementation/SPN-026.md#legacy-decision-81-utc-history-navigation), 2026-10-18, aligns recovery
dates for the Owner and Collaborator, keeps the Operator’s retention/storage model,
and preserves the Link guest boundary. This carries SPN-026’s two-view and touch
requirements (PRD §5), using SPN-025’s isolated preview and restore fencing from
decisions [#39](implementation/SPN-023.md#legacy-decision-39-history-retention-spacing)/[#55](implementation/SPN-025.md#legacy-decision-55-atomic-native-restore-and-generation-replacement)/[#68](implementation/SPN-025.md#legacy-decision-68-single-sqlite-runtime-and-consistent-copies) and grooming 2026-10-18.

## Preview and restore

Choose **Versions → Preview version** to open an isolated, read-only native viewer
in another tab. It has no live collaboration client or autosave. The live editor
stays open so unsaved work can be copied. Current readers can preview; only current
editors see and may use **Restore this version**. Confirming restores for everyone,
then opens the live document with the same application URL and access grants.

Restore freezes admission of new server edits and finishes already accepted
submissions. It saves the exact drained content with a permanent **Before restore**
label, without changing any user-assigned checkpoint name. The live document then
becomes the selected retained snapshot at a new increasing logical revision. The
label, active version switch, completion receipt and cleanup record commit in one
application transaction. The Owner or Collaborator can restore that Before restore
checkpoint to undo the operation. Retained image references are validated against
the same document before a replacement can become live.

Other open editors become read-only and ask the user to copy unsaved changes and
reload. Offline clients may continue showing local edits until connectivity returns;
those old edits cannot silently overwrite the replacement. Spinel preserves the SDK's
old per-unit recovery cache, but does not automatically merge it into a restored version.

The application item ID is stable. Each restore stages a new internal SDK unit through
its public creation API, so it supports both old native checkpoints and collaboration
checkpoints without confusing their revision counters. Logical revision equals the
SDK revision plus the generation's offset. Known native self references are rebased;
worksheet IDs, user text, opaque resources and document image URLs are preserved.
Resource names omitted by the public SDK materializer are retained in an
application-owned table and added back to native snapshots. Runtime-managed
resources keep their current SDK content; preserved metadata never replaces it.
No SDK-owned storage is modified. Client-submitted SDK revert mutations are rejected;
restoration must pass the application preservation and authorization workflow.

A request ID is bound to the item, caller and selected checkpoint. A lost-response
retry returns its original completion instead of replacing newer work a second time.
A mismatched ID, concurrent restore or stale expected generation is rejected. Session
and edit access are rechecked immediately before the atomic switch. After interruption,
startup cancels any staged, unpublished replacement and keeps the old live version.
A committed replacement remains live, and the old SDK unit is deleted through the
public API using the durable cleanup queue. These application tables are included in
the same encrypted SQLite backup as checkpoints, images and SDK data.
Application and SDK connections share one pinned SQLite runtime to avoid competing
lock registries during restart; repeated reopen/integrity and encrypted recovery
tests cover this boundary. [Decision #68](implementation/SPN-025.md#legacy-decision-68-single-sqlite-runtime-and-consistent-copies).

`GET /api/items/:id/history/:checkpoint` returns an authorized native preview.
`POST /api/items/:id/history/:checkpoint/restore` accepts `{requestId,unitId}`, with
the active unit ID supplied by the authenticated editor/preview response. Both routes
recheck current access, and the mutation also requires the configured origin and
current session. No anonymous or administrative document access is introduced.

The owner chose freeze, drain, preserve and refresh in
[decision #55](implementation/SPN-025.md#legacy-decision-55-atomic-native-restore-and-generation-replacement), 2026-10-18. This retains
all accepted work for the Owner and Collaborator, gives the Operator deterministic
crash recovery using one database, and preserves Link guest access boundaries.
Atomic pre-state preservation, retained images and stale-write fencing carry forward
[decision #23](implementation/grooming-2026-10-17.md#legacy-decision-23-first-integration-grooming), 2026-10-17.
