# Explicit pre-launch collaboration transition

This offline tool retains **every document** in the selected database, including
recoverable trash, children of Spaces and documents owned by disabled accounts.
It creates new files. It never replaces the selected database or starts a server.
There is no assumption that a live production database exists; disposable test
databases may instead be initialized afresh. Choosing a fresh database does not
authorize discarding work selected for retention.

Stop the application and keep it stopped throughout this procedure. Preserve its
encrypted backup and configuration. Use private directories on the same encrypted
storage normally used for database recovery. The bundle contains private native
snapshots and a full database copy, including credentials and image bytes.

1. Keep a separate checkout of pre-cutover commit
   `81cc0774bda11f9bf65942ef84cf7d847bd08029`, with its pinned dependencies installed
   using `npm ci`. The exporter resolves the 1.1.0 packages from that checkout and
   calls only their documented public APIs. No proprietary storage is decoded or
   rewritten. The replacement application has no direct collaboration Pro dependency
   or runtime integration. Until SPN-075 removes the print packages, npm may retain
   collaboration packages transitively through printing; the later of the two PRs
   owns their final removal and the no-Pro dependency gate.
2. From the new checkout, run:

   ```sh
   node scripts/sync-transition/cli.ts export --source /private/old/spinel.sqlite --bundle /private/transition-bundle --legacy-checkout /private/legacy-checkout
   node scripts/sync-transition/cli.ts import --bundle /private/transition-bundle --destination /private/converted
   ```

   Use initially absent bundle and destination directories. Reuse the exact same
   paths when retrying an interruption. Export retries use the frozen source copy
   created by the first invocation; they do not merge later changes from the old
   application. If the old application was restarted, stop it and make a new bundle
   and destination from its latest database before switching.
3. A successful import publishes `/private/converted/spinel.sqlite`. Before that,
   only `pending.sqlite` exists; do not point a server at it. The application also
   refuses a database with an incomplete transition receipt or an unconverted
   collaboration unit. Completed documents are verified and skipped on retry.
   A repeat after publication re-verifies the original output. If the new app has
   edited it, retry refuses and leaves those newer changes untouched; continue
   using the verified live copy rather than treating import as a restore command.
4. Start the new application against the published copy in an isolated verification
   environment. Verify ordinary Sheets/Docs, both editors and presence, named and
   Before restore versions, native Formula edits, images, Trash restoration, Space
   structure/recovery and the intended account, guest and MCP access boundaries.
   Test encrypted backup/restore of the converted copy. Retain the original source,
   source-copy bundle, legacy checkout and recovery configuration until these checks
   succeed. Switching the actual configured database remains a separate operator
   action; this tool does not perform it.

Each legacy unit is exported through `getUnitLoadDataWithBlocks`,
`UnitSnapshotMaterializer` and the public native converters. Stored opaque
resources are merged using Spinel's existing resource rule. A ready/preparing
legacy marker with no public unit is refused; the tool never substitutes an older
native save. Interrupted legacy restore jobs must first be recovered with the old
application. This avoids deciding which restore was intended during conversion.

The destination starts as a complete SQLite `VACUUM INTO` copy. History payloads,
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
