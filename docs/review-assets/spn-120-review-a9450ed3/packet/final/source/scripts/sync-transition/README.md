# Explicit pre-launch collaboration transition

This offline tool retains **every document** in the selected database, including
recoverable trash, children of Spaces and documents owned by disabled accounts.
It creates new files. It never replaces the selected database or starts a server.
There is no assumption that a live production database exists; disposable test
databases may instead be initialized afresh. Choosing a fresh database does not
authorize discarding work selected for retention.

Stop the application and its maintenance supervisor, and keep both stopped
throughout this procedure. The Linux CLI holds the same cold workspace leases as
the supervisor for every source, bundle and output SQLite file for the whole
command. An active supervisor refuses export/import even when its child is
paused or stopped. Do not release a running supervisor's lease by deleting files;
shut it down through the [maintenance procedure](../../docs/maintenance.md).
New copying and working files acquire inode ownership before SQLite opens them,
including backup creation. Ownership follows publication renames and retains
replaced inodes until the command exits, because native handles may outlive
`close()`. Distinct source and destination files must not be hard-link aliases.
The source remains an offline requirement for direct legacy servers too.
Preserve its
encrypted backup and configuration. Use private directories on the same encrypted
storage normally used for database recovery. The bundle contains private native
snapshots and a full database copy, including credentials and image bytes.

1. Keep a separate checkout of pre-cutover commit
   `81cc0774bda11f9bf65942ef84cf7d847bd08029`, with its pinned dependencies installed
   using `npm ci`. The exporter resolves the 1.1.0 packages from that checkout and
   calls only their documented public APIs. No proprietary storage is decoded or
   rewritten. The replacement application has no Pro dependency, license registration
   or legacy runtime integration. Its required dependency check covers root and
   workspace manifests plus the resolved lockfile. This separately installed old
   checkout is used only by the explicit offline export/recovery procedure.
2. From the new checkout, run:

   ```sh
   node scripts/sync-transition/cli.ts export --source /private/old/spinel.sqlite --bundle /private/transition-bundle --legacy-checkout /private/legacy-checkout
   node scripts/sync-transition/cli.ts import --bundle /private/transition-bundle --destination /private/converted
   ```

   Use initially absent bundle and destination directories. Reuse the exact same
   paths when retrying an interruption. Each new directory is published with its
   provenance record already in place; an interrupted first write leaves the
   requested path available for retry. Unrelated existing directories are refused.
   Export retries use the frozen source copy
   created by the first invocation; they do not merge later changes from the old
   application. If the old application was restarted, stop it and make a new bundle
   and destination from its latest database before switching.

3. A successful import publishes `/private/converted/spinel.sqlite`. Before that,
   only `pending.sqlite` exists; do not point a server at it. The application also
   refuses a database with an incomplete transition receipt or an unconverted
   collaboration unit. Retained native-flag trial databases also require this
   transition once when they lack verified activation provenance: a native unit
   cannot prove that an old SDK copy under the same ID is absent. Fresh empty
   applications initialize automatically and record their native-only activation.
   Completed documents are verified and skipped on retry.
   A repeat after publication re-verifies the original output. If the new app has
   edited it, retry refuses and leaves those newer changes untouched; continue
   using the verified live copy rather than treating import as a restore command.
   Verification uses enforced SQLite read-only access and includes committed WAL
   contents. Preserve the database and any WAL together; a different main-file
   digest alone does not prove that document content changed. The
   [SPN-118 record](../../docs/implementation/SPN-118.md) explains the checked
   lifecycle boundary and independent content/metadata preservation evidence.
   Copy creation uses a separate disposable file and publishes `pending.sqlite`
   only after SQLite integrity and retained metadata checks; a mid-copy failure
   is safely recreated on retry.
4. Start the new application against the published copy in an isolated verification
   environment. Verify ordinary Sheets/Docs, both editors and presence, named and
   Before restore versions, native Formula edits, images, Trash restoration, Space
   structure/recovery and the intended account, guest and MCP access boundaries.
   Test encrypted backup/restore of the converted copy. Retain the original source,
   source-copy bundle, legacy checkout and recovery configuration until these checks
   succeed. Switching the actual configured database remains a separate operator
   action; this tool does not perform it. A supervisor bound to the old generation
   refuses a replacement database inode. Validate the new copy under a separately
   configured recovery root; this transition tool does not authorize SPN-112's
   future assisted activation path.

Each legacy unit is exported through `getUnitLoadDataWithBlocks`,
`UnitSnapshotMaterializer` and the public native converters. Stored opaque
resources are merged using Spinel's existing resource rule. A ready/preparing
legacy marker with no public unit is refused; the tool never substitutes an older
native save. Interrupted legacy restore jobs must first be recovered with the old
application. This avoids deciding which restore was intended during conversion.

The bundle's `source.sqlite` is immutable. A second `metadata.sqlite` copy is
sanitized through the old SDK's public hard-delete API after snapshots have been
exported. The application-owned inventory supplies active units, original IDs,
native-sync IDs, restore-job previous/next IDs and purge-outbox IDs. Each ID is
probed through the public SDK adapter; any SDK copy is hard-deleted even when a
native unit has the same ID. A fresh public SDK reader verifies that every
selected ID is no longer loadable through the old SDK. All application-table
hashes, including native units and edit receipts, must remain unchanged. Import uses
this sanitized copy so later permanent deletion cannot leave an old Pro snapshot
behind in the live database. The original source still supports recovery with the
old application. Arbitrary orphan SDK units that have no application fence,
generation/restore receipt or purge-outbox identity cannot be inventoried through
the documented API; the tool does not inspect private tables or claim to discover
such corruption. Reconcile any independently known orphan before cutover.

A deleted legacy item can leave only a purge-outbox ID after its application
fence cascades away. Before native-only activation, existing collaboration fences,
native units and unresolved purge work require this offline verification. A
completed sanitized transition or the fresh application's durable native-only
activation marker permits normal
native remove-before-outbox-clear and cancelled-restore cleanup after a restart.
An ambiguous already-missing outbox ID in a pre-cutover native-only database also
requires the transition once; it is never silently assumed to be native.

The destination starts as a complete SQLite `VACUUM INTO` copy of that sanitized
metadata database. History payloads,
names, Before restore labels, active generation IDs and revision offsets, grants,
credentials, Space topology/deletion batches, images and ownership handover state
remain in place. Source-copy hashes and application-table hashes are verified.
Existing Spinel-native units and their receipts are untouched. Legacy units retain
their original head revision, with the transform replay window starting there;
pre-cutover edits cannot replay against an invented older base. Formula metadata
is validated as definitions, with no stored calculated values. Source or payload
corruption, missing image bytes and a changed retry manifest fail closed.

Progress contains fixed event names and counts only. Errors deliberately omit SDK
payloads, document names and credentials. No source or output is deleted after a
failure. The disposable SDK working copy is removed after the reader closes; the
immutable source copy remains available for recovery.
