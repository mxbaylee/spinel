# Trash and recovery

Owners can choose **Trash** beside a document or folder, then open **Trash** in
the folder sidebar to recover it. A folder deletion includes its active subtree.
Trashed items leave ordinary folder listings and reject metadata, content, saves,
sharing changes and image requests for everyone. Existing browser content cannot
be recalled; a subsequent save is refused and retains the editor's unsaved-work
warning. Admin accounts cannot inspect trash or workspace content.

Trash lists every retained item, including nested contents, with deletion and
recovery dates. **Restore** returns an item and the descendants deleted with it
to its original active parent, or My files if that parent is unavailable. An
individual nested item can be restored while its parent stays trashed. Items
deleted independently before their parent stay in trash until separately
restored. Restoration preserves IDs, native snapshots, image bytes and grants;
current inherited/direct permissions apply again at the restored location.

Recovery lasts 30 elapsed UTC days after deletion. Cleanup runs on server startup
and every 24 hours, permanently deleting items whose recovery period has ended.
Expired items awaiting cleanup cannot be restored. **Empty trash** is the explicit
early-purge action: it asks for the exact number of documents and folders and
warns that deletion cannot be undone. If another tab changes that set, the server
refuses the old confirmation and the UI reloads the count. Cancel preserves all
items. Each owner can empty only their own trash.

Collaborators cannot trash the owner's documents. Removing a shared item from a
personal folder is part of SPN-018's placement feature, which does not exist yet;
it leaves the owner's copy, access grant and Shared with me entry intact. This
scope disposition preserves the original SPN-021 remove-from-view outcome in
that ticket, where the per-user references belong.

## Storage and operations

The additive workspace migration adds nullable `trashed_at` and `trash_batch`
fields and an expiry index. Every deletion gets a fresh batch ID in an immediate
transaction. Soft deletion updates only metadata, so native snapshot/image/grant
foreign-key cascades do not run. The central access resolver rejects a trashed
item or ancestor, covering direct and inherited shares as well as image access.

Restore changes the selected root's location and clears only matching-batch
metadata in one transaction. Permanent cleanup deletes leaves before parents,
then SQLite cascades remove native snapshots, images, grants, history checkpoints
and history progress markers. Soft deletion preserves [history](history.md);
permanent deletion removes it. A malformed hierarchy that
cannot safely be deleted rolls the cleanup back and logs an error rather than
removing live descendants. The daily job is stopped when the server closes;
startup catches up after downtime. Failed runs log an error and retry on the
next daily run. Operator diagnostics for job state remains SPN-032.

The count confirmation is bound to an opaque hash of item IDs and deletion batch
IDs; equal counts or a restore-and-retrash cannot reuse a stale confirmation.
No document title or content is written to the cleanup log. Trash is recovery
within the same database, not an offsite backup; SPN-030 covers machine loss.

These rules retain SPN-021's 30-day undo and purge requirements (PRD §2.1),
[decision #23](https://github.com/mxbaylee/spinel/issues/23)'s soft-delete storage
boundary, and [decision #30](https://github.com/mxbaylee/spinel/issues/30)'s batch
restoration, confirmation and placement scope, dated 2026-10-17. They favour
predictable cleanup for the Operator, reversible mistakes for the Owner,
non-destructive organization and current grants for the Collaborator, and no
trash discovery or content access for the Link guest.

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
