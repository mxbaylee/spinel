# Document history

Spinel keeps compressed native Sheet and Doc checkpoints in the same SQLite file
as the documents, images and collaboration data. History has no HTTP endpoint or
UI yet; naming, browsing and restoring versions belong to SPN-024–026. Future
editors must join this capture path before they accept document saves.

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
[decision #39](https://github.com/mxbaylee/spinel/issues/39):

- Under one hour: keep every captured checkpoint, including idle breaks.
- One to six hours: retain the latest checkpoint in each UTC half-hour bucket.
- Six to 24 hours: retain the latest checkpoint in each UTC hour bucket.
- Older: retain the final available checkpoint of each UTC day.
- Named versions never expire or displace an unnamed retention slot. The newest
  available version is always retained, even for an inactive document.

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

## Images, access and recovery

Retained versions keep their document-scoped image URLs. Uploaded image bytes
remain in SQLite even after an image is removed from the live document. The
existing 50 MiB image quota applies to all uploads for that document. There is no
new image garbage collector: an apparently unused upload might still be in an
offline edit. This conservative policy preserves retained versions and pending
edits; see [decision #23](https://github.com/mxbaylee/spinel/issues/23) and
[decision #51](https://github.com/mxbaylee/spinel/issues/51).

History reads use the current document access resolver and recheck access after
decompression. Current viewers can read versions; revoked users, disabled users
and administrators without document access cannot. Checkpoints are scoped to the
requested document. Background capture selects a currently authorized active
user through that same resolver, including inherited shares. Disabling an owner
does not stop checkpoints while an active collaborator still has access. If no
eligible user remains, existing history stays stored and capture resumes when
access returns. Link guests gain no new route or permission.

Trash preserves history. Permanent document deletion cascades to checkpoints,
progress markers and image bytes. The existing encrypted backup archive includes
all of these in one consistent SQLite backup. Recovery verification covers a
retained named version whose image was removed from the live document, followed
by authenticated archive restore and reads under a shared viewer's identity.

## Why application-owned checkpoints

The optional Univer collaboration history service was evaluated using its public
README and type declarations. It indexes derived changeset segments, but its
public API does not provide this compressed snapshot retention and pinned-version
policy. Spinel therefore materializes native snapshots through public SDK APIs
and owns only its checkpoint tables. No Pro implementation is inspected or
patched. [Decision #51](https://github.com/mxbaylee/spinel/issues/51) records the
tradeoff for the Owner, Collaborator, Operator and Link guest.
