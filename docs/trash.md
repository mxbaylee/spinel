# Trash and recovery

Owners and File admins can choose **Trash** beside a document, folder or Space.
The Owner opens **Trash** in the folder sidebar to recover it. A folder deletion includes its active subtree.
Trashed items leave ordinary folder listings and reject metadata, content, saves,
sharing changes and image requests for everyone. Existing browser content cannot
be recalled; a subsequent save is refused and retains the editor's unsaved-work
warning. Server Operator accounts cannot inspect trash or workspace content.

My files Trash lists deleted outer files, folders and Space roots with deletion
and recovery dates. Internal Space batches appear only in that Space's Trash.
**Restore** returns an item and the descendants deleted with it to its original
active parent, or My files if that parent is unavailable. An
individual nested item can be restored while its parent stays trashed. Items
deleted independently before their parent stay in trash until separately
restored. Restoration preserves IDs, native snapshots, image bytes and grants;
current inherited/direct permissions apply again at the restored location.

Recovery lasts 30 elapsed UTC days after deletion for ordinary files, whole
Spaces, enclosing folder batches and internal Space batches. The exact deadline
is the original deletion timestamp plus 2,592,000,000 milliseconds; restoration
is refused at that instant even if cleanup has not run. The UI shows
**Recover until** before the deadline and **Recovery ended** with a disabled Restore
button afterward. Cleanup runs on startup and every 24 hours, making bounded
progress through expired content. **Empty trash** is the explicit
early-purge action: it asks for the exact complete deletion set, including Space
contents and earlier internal deletions, and warns that deletion cannot be undone.
If another tab changes that set, the server
refuses the old confirmation and the UI reloads the count. Cancel preserves all
items. Each owner can empty only their own trash.

View/Edit collaborators cannot trash the owner's outer files; delegated File
admins can. Removing a shared item from a personal folder uses personal filing;
it leaves the owner's copy, access grant and Shared with me entry intact. This
scope disposition preserves the original SPN-021 remove-from-view outcome in
that ticket, where the per-user references belong.

## Space recovery

Account Editors and File admins may restore internal subtrees; only the Owner
may permanently delete them early after confirming the current exact subtree.
Viewers and Link guests cannot browse Space Trash. Outer recovery remains
Owner-only. An unavailable original internal parent restores to the Space root
with a generic explanation; no inaccessible location is disclosed.

Deleting an outer Space marks its root while retaining its child structure and
earlier internal deletion batches. Earlier independent batches keep their own
timestamps and can expire while the outer Space remains in its recovery window.
Restoring the outer Space does not restore those batches or renew their dates.
A restored item that is deleted again gets a fresh batch and timestamp; unrelated
older batches keep theirs. Ownership handover preserves every original deadline.
Disabled owners cannot restore, but their expired content still receives system
cleanup. Explicitly disabling Space exposure instead disables Space expiry and
keeps hidden Spaces and containing deletion groups out of ordinary cleanup.

## Storage and operations

The additive workspace migration adds nullable `trashed_at` and `trash_batch`
fields and an expiry index. Every deletion gets a fresh batch ID in an immediate
transaction. Soft deletion updates only metadata, so native snapshot/image/grant
foreign-key cascades do not run. The central access resolver rejects a trashed
item or ancestor, covering direct and inherited shares as well as image access.

Restore changes the selected root's location and clears only matching-batch
metadata in one transaction. Space expiry rechecks current ownership, timestamp
and batch identity inside an immediate transaction, then validates the complete
retained graph. A restored root, a new deletion identity or a handover since
candidate selection makes that candidate ineligible for the current pass. An
expired outer Space removes its whole validated graph, including children whose
access was closed by the root tombstone. Internal cleanup removes only complete
expired batches, preserving live and younger unrelated content.

Permanent cleanup deletes leaves before parents, and SQLite cascades remove
native snapshots, images, grants, [history](history.md) checkpoints and history
progress markers. Deletion also enqueues collaboration generations in the
existing durable purge queue. A malformed, oversized or failed Space transaction
rolls back in full; cleanup does not repair it or leave orphan children.

Each Space pass reads an indexed page of at most 256 root metadata rows and
validates at most 16 eligible graphs, with at most 10,000 members per graph. The
one-second elapsed budget is checked between units of work, so one transaction
can exceed it. The cursor advances past live and malformed roots; later daily
passes resume the scan and eventually revisit retained failures. Unrelated
eligible Spaces and ordinary Trash continue without exposing failed content.

Collaboration purge runs at startup, each minute and during shutdown. Each pass
handles at most 100 ordered queued generations and checks its one-second budget
between generations. It refuses active generations and acknowledges queue entries
only after cleanup succeeds. Interrupted or failed work remains durable for
retry, including after restart; startup purge failures do not keep the app from
opening, and a shutdown failure does not discard remaining work. Timers stop when
the server closes. [Operator health](diagnostics.md) reports actual job attempts,
successes and failures; cleanup logs contain only counts or static status.

The count confirmation is bound to an opaque hash of item IDs and deletion batch
IDs; equal counts or a restore-and-retrash cannot reuse a stale confirmation.
No document title or content is written to the cleanup log. Trash is recovery
within the same database. [Offsite backup retention](backups.md) remains separate:
it neither extends application recovery windows nor is shortened by app cleanup.

Before activating this policy against deliberately retained or restored data,
follow the [read-only count/date inventory](implementation/SPN-095.md#previously-retained-data-and-activation).
The earlier Space exemption is removed without resetting timestamps or batches;
already expired rows are immediately ineligible for restoration and eligible for
bounded startup cleanup. Review a consistent copy and preserve needed data before
activation. No deployment or retained-data inspection is implied by this code change.

These rules retain SPN-021's 30-day undo and purge requirements (PRD §2.1),
[decision #23](implementation/grooming-2026-10-17.md#legacy-decision-23-first-integration-grooming)'s soft-delete storage
boundary, and [decision #30](implementation/SPN-021.md#legacy-decision-30-trash-batches-and-exact-set-deletion)'s batch
restoration, confirmation and placement scope, dated 2026-10-17. They favour
predictable cleanup for the Operator, reversible mistakes for the Owner,
non-destructive organization and current grants for the Collaborator, and no
trash discovery or content access for the Link guest.
[SPN-095's retention decision](implementation/SPN-095.md), accepted by the Owner
on 2026-10-22, extends that same recovery window to Spaces and their internal batches.

## Verification

Store tests cover nested shared Sheets/Docs, native data and image preservation,
prior independent deletions, individual recovery to root, grant resumption,
owner/admin/disabled boundaries, empty confirmation generations, the exact UTC
30-day boundary, child-first purge and foreign-key cascades, additive migration,
and startup/daily cleanup with a fake clock. HTTP tests cover missing/admin/shared
sessions, origin checks, stale confirmation, metadata/content denial, restart
persistence and recovery. Browser tests in development and production trash a
nested folder with both native editors, restore and reopen it, keep an earlier
deleted child in trash, cancel emptying, reject a changed count, and confirm a
fresh permanent purge without losing live documents.

`src/server/workspace/space-expiry.test.ts` adds exact-boundary outer/internal
expiry, prior independent batches, restore/retrash and handover races, disabled
owners/exposure, malformed and oversized graphs, bounded cursor progress,
transaction rollback and durable native retry. The SPN-095 browser cases in
`e2e/spaces.spec.ts` verify Owner/Editor deadlines and refusal, younger-batch
recovery, outer Space/folder expiry and light/dark/phone production views.
Production stories use the same recovery components. The PR records executed
results and independent visual review; this inventory does not assert a test run.
