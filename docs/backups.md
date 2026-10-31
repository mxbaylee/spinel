# Offsite backups and recovery

## Recovery requirements and hosting options

Spinel is [pre-production](development.md#deployment-stage) until SPN-038 launches
`spinel.baylee.dev`. The SQLite/Spaces procedure below is the current working
implementation and the selected path for SPN-063. The owner asked to retain
SQLite without database adapters if capacity is acceptable; the
[accepted decision](implementation/SPN-063.md#accepted-decision-keep-sqlite-without-database-adapters)
and [capacity writeup](implementation/SPN-063-capacity.md) support that choice for
the intended deployment (owner direction and agent assessment, 2026-10-27).
This resolves the earlier open comparison from 2026-10-21 while preserving the
requirement to demonstrate recovery of the whole workspace.

Keep an inventory of accounts and grants, document snapshots and history, images,
and the configuration/credentials needed to restore service. Set an acceptable
recovery point and recovery time for the selected deployment, then demonstrate
them with an isolated restore. SPN-063 adds recurring verification and visible
last-success/failure status for the selected SQLite recovery path.

DigitalOcean offers different kinds of protection, which cover different failures:

| Option             | What it supplies                                                                                               | What Spinel still needs to establish                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Droplet backups    | Scheduled system-disk images.                                                                                  | Attached volumes are excluded; active database writes need an appropriate consistent backup method.             |
| Volumes            | Data replicated across hosts, plus volume snapshots.                                                           | Hardware redundancy does not recover an earlier application state after a bad write or deletion.                |
| Managed PostgreSQL | Daily backups and seven-day point-in-time recovery; eligible configurations with standby nodes offer failover. | Select an applicable plan, preserve assets/configuration outside that database, and prove application recovery. |

Sources checked 2026-10-21: DigitalOcean's [backup limits](https://docs.digitalocean.com/products/backups/details/limits/),
[volume durability](https://docs.digitalocean.com/products/volumes/details/features/),
and [PostgreSQL features](https://docs.digitalocean.com/products/databases/postgresql/details/features/).
Recheck current plans and costs when choosing a deployment. These options do not
change the browser storage/eviction and pending-edit requirements in SPN-055.
No cloud resources are provisioned by this grooming decision.

The [SPN-063 storage and recovery plan](implementation/SPN-063.md) retains the
alternative-backend comparison and specifies direct SQLite recovery work without
database adapters. The later [backup-options proposal](implementation/SPN-063-backup-options.md)
adds manual encrypted downloads, configurable S3-compatible destinations,
separate diagnostics retention and staged UI restore/maintenance. The accepted
[pre-deployment implementation decision](implementation/SPN-063.md#accepted-decision-implement-recovery-before-deployment)
adds a supported filesystem destination to build and test the shared workflow
locally. SPN-063 implements that destination and the recurring isolated verifier
before deployment; selected-provider and target-host acceptance remain in SPN-038
before public exposure. Admin separates publication, restore verification and
offsite coverage. SPN-109 adds encrypted Admin downloads and deployment-owned
backup policy for local storage and DigitalOcean Spaces. AWS S3 is a separate
[post-production feature request](todo/SPN-114.md). SPN-111 implements
[supervised maintenance](maintenance.md) for pause, drain and restart of the
same dataset. SPN-112 adds [assisted workspace restore](#restore-through-admin)
under that supervisor. Diagnostics expiry remains SPN-110; fresh-host CLI recovery
is also available.

## Deployment policy and manual downloads

The server's private `BACKUP_CONFIG_PATH` file owns policy and credentials. Admin
shows effective safe values; browser requests never choose filesystem paths,
database names, SQL, provider endpoints or secret values. The fixed backup dataset
is `workspace`. The separate diagnostics download, live retention and document
history retain their independent policies.

New configuration files should declare `"version": 1`. They default automatic
backup and recurring verification **off**; enable them explicitly with
`"automatic": true` when a supported destination is ready. Existing unversioned
filesystem and Spaces files preserve their automatic schedule. `manualDownload`
defaults true and can be disabled by deployment. Disabling it prevents delivery
of an already prepared archive too. Unknown new-policy fields are rejected.

For manual-only use, supply a private 32-byte recovery key and the current runtime
environment file, both on the encrypted application volume. The application still
needs a valid immutable `SPINEL_IMAGE` reference and canonical origin. No cloud
credentials or destination directory are required:

```json
{
  "version": 1,
  "type": "manual",
  "dataset": "workspace",
  "prefix": "example-instance",
  "keyFile": "/data/backup.key",
  "keyId": "workspace-2026-01",
  "runtimeEnvironmentFile": "/data/recovery-runtime.env",
  "manualDownload": true
}
```

The configuration and runtime environment files are capped at 1 MiB and must be
private regular files; the recovery key is exactly 32 bytes. Keep a separate
recoverable copy of the key. Its identifier may appear in Admin; the key itself
is never part of the download or returned to the browser.

In **Admin → Backups & health**, choose **Prepare workspace backup**, confirm
with an Operator passkey, then choose **Download encrypted backup** when ready.
The browser's normal download manager receives a `.spinel` archive. A fresh
passkey proof lasts five minutes; preparation that outlasts it requires another
verification before delivery. A successful browser handoff does not prove that
the file was retained, copied offsite or restored successfully.

Only the initiating cookie session can see, cancel or receive its job. Returning
to that session can recover the current job; signing out does not transfer it
to a later session. Preparation has a 30-minute cancellation deadline; synchronous
SQLite snapshot/inventory work can delay observing cancellation until that work
returns. Target-host measurements must establish that latency. A ready archive is
available for ten minutes; delivery has its own ten-minute limit. **Cancel backup**
or **Cancel delivery** removes the staged copy. Expiry, disconnected downloads,
lost access, shutdown and dead-process restart cleanup remove it as well. Only
one export, publication or verification job can hold the recovery lease at once.

Supervised maintenance blocks new backup actions, cancels admitted preparation
and delivery, and drains their cleanup. A ready archive remains private and inert while
paused; its expiry clock continues, so it cannot be delivered after its deadline.
Heartbeat, expiry and staging cleanup wait for an admitted running tick. A
supervised shutdown after draining leaves retained staging for the next running
startup to reconcile. After resume, reload Administration before another backup
action; download permissions issued before the pause cannot be reused.

**Previously saved backups** lists complete artifacts from the configured
filesystem or Spaces destination. Selection uses an opaque ID. The server holds
the selected point against retention and checks encrypted authentication,
inventory, origin and the configured current/retained key before delivery. Old
application image references remain downloadable for independent recovery; no
workspace is activated by this action.

Creation refuses a logical SQLite source larger than 8 GiB; encrypted archives
remain capped at 5 GiB. Encryption and delivery stream bounded chunks with disk
reserve checks. Staging is private and database-specific. Routine backup does
not pause edits for the entire job; the consistent SQLite copy remains
synchronous, so target-host save-interference measurements are still required.

For automatic local operation, add `"version": 1, "automatic": true` to the
[filesystem configuration](#filesystem-destination-for-local-operation). For
automatic DigitalOcean operation, add those fields to the existing Spaces
configuration below. Retention remains seven daily, four weekly and six monthly
calendar windows. A local publication and a manual download do not establish
offsite recovery. See [the implementation decisions](implementation/SPN-109.md).

Publication and verification remain associated with the destination actually used
by that operation. Changing deployment configuration while a job runs does not
make the newly selected destination protected: it needs its own successful
publication and recovery evidence. A newer configuration error or unavailable key
cannot be replaced by an older status refresh completing later.

The SPN-109 bounded DigitalOcean contract passed on 2026-10-28 after the owner
updated the GitHub credentials: private publication/readback, anonymous denial,
authenticated download/decryption, paginated catalog, pending cleanup and
retention, with complete test-object cleanup. The [preserved evidence and exact
source commit](implementation/SPN-109.md#digitalocean-acceptance-and-remaining-launch-evidence)
supersede the initial unavailable probe. Before public launch, still complete
credential rotation and the [target-host and cold-recovery gate](todo/SPN-038.md).
A small synthetic provider round trip does not establish deployment capacity or
host-loss recovery.

For the GitHub Spaces acceptance workflow, set `DIGITAL_OCEAN_ENDPOINT` to the
HTTPS bucket origin, `https://BUCKET.REGION.digitaloceanspaces.com`.
`DIGITAL_OCEAN_ACCESS_KEY` accepts a JSON pair with `accessKeyId` and
`secretAccessKey`, or the documented DigitalOcean export with `access_key` and
`secret_key`, either directly or wrapped as `{"key": {...}}`. Native exports may
include only the optional `name`, `created_at` and `grants` metadata; the runner
ignores it and always takes the target bucket from the endpoint. These are the
[API creation response](https://docs.digitalocean.com/products/spaces/reference/api/spaces-keys/)
and [Ansible return value](https://docs.digitalocean.com/reference/ansible/reference/modules/spaces_key/)
formats. Alternatively, supply a plain access key ID and put its secret in
`DIGITAL_OCEAN_SECRET_KEY`. Leave that separate secret unset when supplying JSON;
mixed credential sources are rejected. Use a bucket-scoped Read/Write/Delete key.
The probe reports readiness without printing credentials, and missing or invalid
configuration remains unavailable evidence until a real provider run succeeds.

## Current SQLite and Spaces implementation

Spinel backs up to a **private DigitalOcean Space**. It uses SQLite's `VACUUM INTO`
to make a consistent copy, compresses it and encrypts it with AES-256-GCM before any
network transfer. The 32-byte random recovery key must be kept separately from
Spaces and from the droplet. Losing that key makes every backup using it unreadable.

The copy runs synchronously on the same SQLite runtime as the application and
collaboration adapter, briefly queuing other application requests. It does not
copy live database/WAL files directly. The SDK's libsql package has no implemented
JavaScript backup method; using a second SQLite library in the process risks
corruption. This preserves one consistent backup without that risk; see
[decision #68](implementation/SPN-025.md#legacy-decision-68-single-sqlite-runtime-and-consistent-copies).

This preserves accounts, passkeys, sessions, invitations, folders, grants, trash,
native Sheets/Docs snapshots, collaboration generations, retained checkpoints,
restore receipts, uploaded image bytes, and Space roots/membership/order and
subtree recovery metadata: all currently live in SQLite. Every
table is included. Before adding
an external database or filesystem blob store, extend this inventory and the
consistent backup/restore procedure; a SQLite-only backup cannot protect those.

The SPN-078 model tests verify exact native content, stable IDs/formula bindings,
membership/order and recovery records after reopen and a SQLite snapshot copy.
[SPN-092](implementation/SPN-092.md) adds the actual encrypted BackupService
round trip and SPN-064 ownership handover with freshly reopened native services,
described in the verification record below. Continue restoring the recorded
immutable application version; an older image cannot be assumed to understand a
newer Space schema. Space Trash and recovery groups containing Space data use
the [same 30-day recovery window as ordinary Trash](trash.md). Backup retention
is separate: keeping an archive does not extend an application's recovery
deadline, and application cleanup does not rewrite old backup objects. Restored
deletion timestamps keep their original age, including after ownership handover.
Before starting a new server against deliberately retained or restored test data,
follow the [read-only expiry inventory](implementation/SPN-095.md#previously-retained-data-and-activation);
startup cleanup can remove content already past its original deadline.

The encrypted copy also contains the canonical origin, immutable application
image reference and runtime environment file. Host-specific Tailscale identity,
TLS certificates and disk-unlock material are recreated on the fresh host; they
are not application data. Keep the reviewed image in a durable registry or
independent archive: a local Docker image ID alone does not preserve the image.

Offsite recovery is required before daily use: the droplet is a single point
of failure for the Owner's documents (grooming, 2026-10-17;
[decision #23](implementation/grooming-2026-10-17.md#legacy-decision-23-first-integration-grooming)). Backup tooling is
TypeScript, as required by the owner on 2026-10-17.

The owner selected Spaces and authorized a temporary cloud restore drill in
[decision #34](implementation/SPN-030.md#legacy-decision-34-backup-destination-and-temporary-drill). The format, schedule
and recovery choices are recorded in
[decision #36](implementation/SPN-030.md#legacy-decision-36-encrypted-nightly-recovery-bundle). They give the Operator
one recovery bundle and visible failures, preserve the Owner's work and the
Collaborator's permissions, and keep Link guests' access scoped to their grants.
Full database backups and restored credentials remain sensitive even though the
Operator's ordinary application account cannot open documents.

## Set up

1. Follow [the encrypted-volume deployment guide](deployment.md). Keep the database,
   plaintext backup/restore staging, key and configuration inside the unlocked
   encrypted mount. The app stages beside `DATABASE_PATH`, in private temporary
   directories. Reserve approximately twice the database size plus 256 MiB of free
   space; the precheck rejects insufficient space. Allow additional headroom for
   growth during a run. Do not use the unencrypted root filesystem for staging.
2. Create a private Space in the selected region, without CDN or public listing.
   Use a **dedicated bucket-scoped read/write/delete key**, not an account-wide key.
   Disable object versioning for this retention policy; deleting current objects
   does not delete historical versions. Use a unique, permanent prefix per instance.
   Do not change prefixes casually: old backups then need deliberate retention.
3. Generate a key on a secure operator machine with the Node version in `.nvmrc`:

   ```bash
   node scripts/deploy/backup.ts keygen /private/recovery/spinel.key
   ```

   This refuses an existing file and writes 32 random bytes with mode 0600.
   Keep a separate recovery copy in your password manager or encrypted offline
   storage. Securely transfer a working copy to `/srv/spinel/data/app/backup.key`,
   owned by UID 1000, mode 0600. Never paste it into chat or commit it.

4. On the encrypted volume, create `app/backup.json`, UID 1000, mode 0600:

   ```json
   {
     "region": "nyc3",
     "bucket": "YOUR-PRIVATE-BUCKET",
     "prefix": "spinel-instance-one",
     "accessKeyId": "REPLACE-PRIVATELY",
     "secretAccessKey": "REPLACE-PRIVATELY",
     "keyFile": "/data/backup.key",
     "runtimeEnvironmentFile": "/data/recovery-runtime.env"
   }
   ```

   Region chooses the actual regional endpoint; the SDK signing configuration
   follows DigitalOcean's `us-east-1` example. Store only server-readable secrets.

5. Add `BACKUP_CONFIG_PATH=/data/backup.json` to the deployment runtime environment.
   Copy that **complete, current** runtime environment into
   `/srv/spinel/data/app/recovery-runtime.env`, UID 1000, mode 0600. Update this
   recovery copy whenever runtime configuration changes. The Compose package sets
   `SPINEL_IMAGE` from the actual immutable deployed image. Keep `APP_ORIGIN`
   consistent with the canonical hostname; passkeys are tied to its relying party.
6. Restart through `systemctl restart spinel`, then complete the
   [cold verify/start/resume sequence](deployment.md#configure-and-start). Jobs
   remain paused until resume, then the app catches up a missed night. The
   independent `backup.ts run` and `backup.ts verify` commands refuse a dataset
   owned by the supervisor, even when its child is stopped. To run either CLI
   manually, first pause/stop the app and shut down the supervisor, then use a
   one-off container with the same environment and mounted private paths after
   preflight. Restart control and verify/start/resume afterward. The cold lease
   spans the entire CLI database lifetime; the scheduled backup/verification
   lease also prevents two recovery jobs from overlapping.
   Open Admin and verify a recent **Last successful backup**, with no error.
   Keep the recovery key, bucket/region/prefix and reviewed image location outside
   the droplet. Credentials can be replaced; the encryption key cannot be recovered.

## Schedule, retention and failures

The default backup time is 02:00 UTC; `backupHourUtc` selects another whole UTC
hour. Weekly verification defaults to Sunday at 03:00 UTC; configure
`verificationDayUtc` (0 Sunday through 6 Saturday) and `verificationHourUtc`
(0–23). The app catches up missed backup/verification runs and retries failed
attempts hourly. A first startup creates a backup and then verifies it in the
same scheduling cycle when automatic policy is enabled. In supervised mode this
cycle begins only after explicit
resume; a paused application runs no backup or verification job. It must be
running on an unlocked volume. A restarted process
waits up to one hour for an interrupted process's lease to expire. Graceful
shutdown drains the active job. Backup and verification share the same lease;
they cannot compete for staging or prune a source during verification or an active
selected-artifact download. A forced
stop leaves private staging on encrypted storage. The next lease holder reconciles
only generated, private `.recovery-job-*` directories owned by this service. Old
standalone `.backup-*`/`.restore-*` directories require inspection while no recovery
command is running; never remove the live database or sidecars.

A streaming upload uses a `.pending` object, downloads it to verify SHA-256,
then publishes it with a server-side copy. Unverified pending objects are never
retention candidates or restore choices. Failed transfers try bounded cleanup;
the next exclusive job reconciles recognized abandoned pending objects in this
instance's prefix. Only after publishing
a good backup does the job prune recognized backup filenames in its own prefix.
No automatic bucket-wide deletion occurs. Uploads above 5 GiB fail visibly; add
multipart support before the encrypted backup reaches that limit.

Retention keeps the newest backup in each of the last **7 UTC days, 4 Monday-based
weeks and 6 calendar months**, including the current period. Overlapping periods
share a recovery point; missing periods cannot be manufactured. It always keeps
the newest recognized backup, the current successful upload, the last inspected
source (including a failed verification) and future-dated
objects. This is a calendar window, not a promise of 17 distinct objects.

Admin shows the configured destination, publication time, current failure and an
overdue warning after 26 hours without publication. Restore verification has its
own attempt, last success, current failure, verified key and eight-day overdue
warning. A failed check keeps the last successful verification visible. Local
publication says **Local backup saved** and continues to request an independent
offsite copy. A verification pass does not establish host-loss independence.
Retention failure still shows an error even if the new upload succeeded. SDK
messages are deliberately not exposed because they may include request secrets.
Check private configuration permissions, available space, key length, immutable
image, Spaces credentials/network access and bucket policy, then retry. Status
is persisted in SQLite and available only to active admins. It is not an external
alert service and cannot report while the whole instance is down.

## Filesystem destination for local operation

The filesystem destination is supported on **Linux local filesystems**, including
a locally run production container. It stores the same encrypted `.spinel`
bundles as Spaces and needs no cloud account or credentials. A directory on the
application host does not satisfy the offsite-before-daily-use requirement.
Other operating systems can exercise this profile in a Linux container; network
shares and synchronization folders are not certified by these tests.

Prepare a private, canonical directory owned by the app's UID, with mode 0700.
For deployment, validate its intended mounted volume before configuring it. Run
the identity command **in the environment that will run the backup**:

```bash
node scripts/deploy/backup.ts identity /private/spinel-backups
```

Copy its exact `root`, `rootDevice` and `rootInode` values into a private 0600
configuration file. The values below are examples, not a valid identity for your
directory:

```json
{
  "type": "filesystem",
  "root": "/private/spinel-backups",
  "rootDevice": "2049",
  "rootInode": "12345",
  "prefix": "spinel-local",
  "keyFile": "/private/spinel-backup.key",
  "keyId": "workspace-2026-01",
  "runtimeEnvironmentFile": "/private/recovery-runtime.env",
  "backupHourUtc": 2,
  "verificationDayUtc": 0,
  "verificationHourUtc": 3
}
```

Set `BACKUP_CONFIG_PATH`, `DATABASE_PATH`, `APP_ORIGIN` and immutable `SPINEL_IMAGE`
in the app/CLI environment. The existing `run`, `list`, `download` and `restore`
commands work with this destination; `verify` runs the same isolated check used
by the scheduler. Stop the application and its supervisor before `run` or `verify`;
these commands hold the cold dataset lease for their complete database lifetime.
`list`, `download` and fresh-directory `restore` do not open the live workspace:

```bash
node scripts/deploy/backup.ts run
node scripts/deploy/backup.ts verify
node scripts/deploy/backup.ts list /private/backup.json
```

Missing/replaced roots, changed device/inode identity, unsafe permissions,
symlinks, traversal and foreign prefixes fail closed. The adapter never creates
a fallback root. Reconfirm the intended storage before recording a legitimate
new identity after a host/volume change; do not automatically accept a changed
mount. Payload and namespace handles remain bound to verified private directories.
Publication writes an exclusive temporary file, reads back its checksum, flushes
it and publishes with a no-replace hard link plus directory synchronization.
Only complete names enter the catalog. The next leased job removes abandoned
pending files; collisions preserve the existing artifact.

Transfers are capped at 5 GiB and filesystem catalog scans at 10,000 entries.
These are explicit resource limits, not an advertised workspace capacity. Keep
the key and reviewed image independently recoverable even for local practice.

## Recurring isolated recovery verification

New archives contain a snapshot-bound schema/table inventory with exact typed
row digests inside the authenticated encrypted bundle. Verification downloads the
newest published point, restores it in a private disposable target and checks
SQLite integrity/foreign keys, inventory, native snapshots/models, images,
history, Space structure, generations and access-state invariants. It does not
activate the database, start application jobs or send notifications. A corrupt
newest point fails visibly instead of silently substituting an older good one.

The child process uses the same pinned SQLite runtime, a 256 MiB JavaScript heap,
a 512 MiB Linux RSS guard and a two-minute deadline. Before launch it requires
640 MiB of available cgroup capacity and 768 MiB of available host memory; while
running it stops below 128/256 MiB respectively. Missing cgroup probes retain
the available host, RSS, heap and time protections. It has scoped file
permissions and no Node network permission. Decompression defaults to an 8 GiB
ceiling. Artifact retrieval and local publication check available destination
space before and during transfer; decompression also retains a 256 MiB reserve.
Memory, disk, size and time refusals have fixed actionable Operator messages and
do not retry every retained key. Semantic admission is bounded at
100,000 workspace items, 256 tables and 32 MiB per inventory row. Exceeding a limit
is a failed check, not successful partial coverage. Record actual host budgets
and timings at launch; the local limits are not a performance guarantee.

The parent removes its owned verification target even after killing the worker.
The source artifact and last good verification remain available on failure.
Older SPINEL01 bundles still work with offline `restore`; bundles without the new
inventory cannot claim complete weekly verification and are reported as failed.
Verification requires the recorded origin and current compatible image metadata;
test an older image separately rather than silently accepting a version mismatch.

## Credential and encryption-key rotation

Use a unique nonsecret `keyId` for each encryption key. To rotate, create a new
private 32-byte key and independent recovery copy, then change `keyFile`/`keyId`
in the deployment config. Add old IDs and private key paths to `retainedKeyFiles`,
for example `{"workspace-2026-01":"/private/old-backup.key"}`. At most 16 retained
keys are supported. Do not map the active ID again or reuse an ID for different
bytes. Run a new backup and verification, and verify a retained old archive before
removing any old-key access. The verifier records the authenticated key identifier
that actually recovered the selected archive. Key files never accompany downloads.

Rotating Spaces access credentials does not change the archive encryption key;
replace the dedicated scoped credential and test publication/retrieval with it.
For suspected compromise, revoke the compromised storage credential, preserve
incident evidence, rotate encryption keys and recovery authority as applicable,
and follow the fresh-host procedure. New encryption cannot retract plaintext or
old ciphertext already obtained with a stolen old key. Keep retained backups
recoverable until their retention expires; if policy requires retiring a key
earlier, explicitly account for the backups made unreadable. Live session/guest
reconciliation when replacing a dataset is part of assisted restore, not this
isolated verifier. Ordinary maintenance still refuses an unexpected replacement
inode; assisted restore has its own retained custody, opening barriers and fresh
generation/epoch admission.

Sources: [SQLite VACUUM INTO](https://www.sqlite.org/lang_vacuum.html#vacuuminto),
[DigitalOcean AWS SDK configuration](https://docs.digitalocean.com/products/spaces/reference/aws-sdks/).

## Restore through Admin

Use **Backups & health → Restore workspace** in a supervised Linux deployment.
The Operator can restore a whole encrypted workspace without viewing its contents.
Direct development startup does not supply the independent supervisor and reports
this capability unavailable. The [maintenance guide](maintenance.md) describes
the supported filesystem, namespace, private recovery root and service account.
Actual validation and remaining acceptance work are recorded in
[SPN-112](implementation/SPN-112.md); source implementation alone is not a tested
deployment.

1. Select **Prepare restore**. Choose **Previously saved backup** from the configured
   filesystem/Spaces catalog, or **Encrypted backup from this device**. An upload
   needs the complete `.spinel` bundle, at most 5 GiB, and its separate original
   32-byte recovery key. It needs no automatic backup destination. A bare SQLite
   file is not accepted. Catalog recovery uses the deployment's configured active
   and retained keys; it does not ask the browser for provider credentials.
2. Complete the fresh Operator passkey check. It lasts five minutes, and upload,
   verification and the preview must finish within it; otherwise preparation
   fails saying the passkey check expired. For a large backup over a slow
   connection, choose a saved backup instead ([SPN-124](todo/SPN-124.md) lifts
   this limit). Preparation takes private custody,
   checks the encrypted inventory, compatible immutable image/origin and resource
   requirements, and builds a provisional reconciliation preview. The current
   workspace keeps running. The backup retention lease protects the selected
   point while preparation owns it. **Cancel preparation** is available before
   admission; closing a dialog or changing Admin sections is not cancellation.
   The ready view reports verified inventory/snapshot/image coverage and estimated
   additional disk space on each application/recovery volume. These estimates are
   provisional: space is not reserved, and the supervisor checks it again before
   pausing edits. Insufficient preparation capacity leaves editing running and
   asks you to free space and prepare again. Larger later inputs can still require
   recovery; a successful estimate does not guarantee completion. A failure names
   its cause where Spinel can tell it safely: a key that cannot decrypt the backup
   (a wrong key and altered bytes look the same), a backup from another workspace
   address or application image, an expired passkey check, or a memory, time, size
   or disk limit. No failure message includes paths, contents or native errors.
3. Select **Review restore**, inspect the source fingerprint, exact target and
   provisional consequences, then freshly authenticate and confirm. Work accepted
   after the backup, including edits accepted before maintenance drains, is lost
   if that backup is activated. Everyone is signed out, personal filing is removed,
   sharing can be removed or downgraded, and archived ownership/trash may require
   recovery. Counts can change before the final frozen comparison.
4. Wait for the recorded outcome. Confirmation first durably hands the encrypted
   source to the supervisor, then starts maintenance separately so its HTTP reply
   can drain. An accepted reply or reachable server is not completion. After service
   returns, sign in again and refresh restore status. **Backup restored** is a
   historical completed outcome; later edits may have changed the workspace.
   **Original content was recovered** means the candidate failed and one verified
   original-content recovery completed; access and sessions may still have changed.
   **Restore did not replace the workspace** means that attempt stopped before
   activation, so the workspace kept its own content and nobody was signed out.
   For 30 days after a restore ends, every account sees a banner after signing in.
   After **Backup restored** it gives the restore date and the backup's date, and
   says later changes were discarded, everyone was signed out and filing, links or
   sharing may have changed. After **Original content was recovered** it says the
   restore did not finish, the workspace kept its own content, and everyone was
   still signed out with links or sharing possibly changed, because rollback
   reconciles access the same way. It contains no document names or counts, and
   an open document hides it until the member returns to a list. Dismissing it
   hides it in that browser only.

Current account state and passkeys remain authoritative. Archived credentials
cannot authorize activation or renew the original confirmation. Sharing is capped
by current grants, guest capabilities and sessions are revoked, and native/offline
retry fences prevent old clients replaying discarded work. Common item IDs keep
current ownership; archive-only components are isolated for explicit handover and
restored trash is held for recovery. The preview describes these losses without
exposing document contents to the Operator. Restoring a historical backup does not
claim that the resulting reconciled workspace was newly backed up, and uploaded
configuration never replaces current endpoints, secrets or schedules.

If a reply is lost, **Refresh restore status** before acting. An offered
**Retry confirmed restore** repeats only the original exact intent while its
authority remains valid. A new passkey check cannot renew that old confirmation.
Unknown, expired or unresolved outcomes block new preparation. Cancellation after
admission is not an undo operation; do not start another restore to guess whether
the first one completed.

The supervisor preserves closed original files and requires independent final
stop/readiness evidence before opening a candidate. A failed trial permits at
most one refreshed original-content attempt within the original authority window;
it never copies raw original files back over a live or newly acknowledged
generation. A committed outcome survives restart cleanup without reinstalling
prepared bytes. On supervisor restart, an unexecuted, fully identified admission
is marked failed and left stopped/unverified for explicit host recovery. A proven
non-start in the still-running application releases only that attempt's logical
hold, retaining its recovery evidence and permitting a new preparation.
Missing evidence, expired
authority or ambiguous ownership keeps the workspace closed.

Two fixed limits bound activation:

- **Five minutes from the passkey check.** Reading the held source, the final
  capacity check, stopping the application, the work below, and any
  original-content recovery after a failed trial must all finish within five
  minutes of the confirmation's passkey check.
- **Two minutes of custody.** Once the application has stopped, the supervisor
  allows 120 seconds to preserve the original files, freeze a comparison copy,
  prepare and activate the candidate, health-check it privately and commit. A
  failed trial gets a separate 120 seconds to capture and freeze its evidence.
  Each step's own timeouts also stay inside this budget. The budget is not
  configurable; it grows with database size only through the time each step takes.

If either limit runs out before commit, the restore fails. What happens next
depends on how far it got:

- **Before activation**, the live database is untouched. The supervisor checks
  that its files still match the preserved original and that no opening barrier
  exists, records **Restore did not replace the workspace**, and reopens the
  original through the ordinary verify, start and resume steps. If that check or
  reopening fails, or the supervisor restarted, the workspace stays stopped until
  the Operator runs those steps ([runbook](maintenance.md#an-unresolved-restore)).
- **After a failed trial**, one original-content recovery runs. If it cannot
  finish in the passkey window's remaining time, the workspace stays closed as an
  unresolved restore.
- **Anywhere else after activation** (for example a power loss during the trial),
  the workspace stays closed as an unresolved restore ([SPN-128](todo/SPN-128.md)).

The real-process acceptance fixture took under a minute from confirmation to
commit; no measurement exists yet for a large database on the 1 GiB / 0.75 CPU
profile, and SPN-038's launch drill measures it on the target host. Rehearse a
restore of a realistically sized backup on the target host before relying on this
path. If confirmation to commit takes more than about a minute, do not rely on it:
a failed trial's evidence capture and original-content recovery need about as long
again ([SPN-124](todo/SPN-124.md) separates the work's lifetime from the passkey
window).

The private journal retains at most **64 restore IDs**, including completed and
failed attempts. Successful source/custody evidence is deliberately retained;
there is no automatic pruning or supported journal-deletion shortcut. A 65th
new ID is refused. Keep these records and plan recovery-root capacity accordingly;
changing that bound or retention policy requires a separately reviewed recovery
design ([SPN-125](todo/SPN-125.md)). Each attempt that reached activation keeps
its encrypted source (the archive's size, at most 5 GiB), the preserved original
database files and a frozen comparison copy (each about the live database's
size), plus one more database-sized capture for each failed trial. Plan at least
the archive size plus three times the database size per restore you expect before
retention lands, and after a rehearsal measure the recovery root with
`du -sh <recovery root>` rather than relying on this estimate. Preparation's
disk estimate covers the next attempt only, not this accumulation. The supported layout mounts the application directory as one filesystem:
the database and any WAL/SHM files must share its device. The recovery root may
use a separate volume. Free bytes are counted once per device, while the existing
application and recovery safety reserves both remain required on a shared volume.

For an unresolved restore, follow the [maintenance runbook](maintenance.md#an-unresolved-restore).
Preserve the private recovery root, encrypted source,
raw/frozen custody and opening barrier. Use the independent CLI's `status` to
inspect maintenance state. Ordinary verify/start/resume refuses unresolved
execution; deleting journals, barriers or retained files is not a recovery step.
Resolve the retained evidence and deployment ownership before reopening, or use
the separate fresh-host recovery procedure with an explicit access review.

## Restore onto a fresh host

1. Retrieve the reviewed application image/version and recovery key independently
   of the old host. Prepare the new host and encrypted mount following
   [deployment.md](deployment.md); do not start an empty Spinel instance yet.
   Obtain bucket-scoped read credentials, and a private backup config file.
   With the recorded repository version and `npm ci`, list and download:

   ```bash
   node scripts/deploy/backup.ts list /private/backup.json
   node scripts/deploy/backup.ts download /private/backup.json 'PREFIX/TIMESTAMP-UUID.spinel' /srv/spinel/data/recovery.spinel
   node scripts/deploy/backup.ts restore /srv/spinel/data/recovery.spinel /private/spinel.key /srv/spinel/data /srv/spinel/data/restored
   ```

   `restore` needs only the downloaded backup and key, not Spaces credentials or
   the old database. It authenticates the full stream, checks SQLite integrity
   and foreign keys, and validates the recovery manifest before publishing the
   new directory. Wrong keys, changed/truncated bytes and existing destinations
   fail. It never overwrites live data. The destination and staging must be on
   the same encrypted filesystem.

2. Read `restored/recovery.json` privately. Restore its exact runtime environment
   to the deployment environment file (0600), adjusting host-specific paths and
   new backup credentials. Select its recorded immutable image. Recreate private
   network access and certificates. Use the **same canonical origin** to keep
   existing passkeys usable; a different hostname requires the documented account
   recovery/enrollment flow. Do not expose a restored development origin publicly.
3. With the service stopped and no preexisting `app/`, rename `restored/` to `app/`
   and set ownership UID/GID 1000, mode 0700; database and recovery manifest 0600.
   Recreate the backup config/key/runtime recovery copy there. Keep the original
   encrypted download until verification finishes. Prepare a new private
   `recovery/` directory beside `app/`, owned by UID/GID 1000, mode 0700. Do not
   copy the old supervisor journal from the failed host or place it inside the
   restored workspace. Start through deployment preflight, then use this new
   host's cold authority to verify, start and resume the recovered generation
   before signing in with the existing operator and everyday accounts. An
   existing controller refuses a changed database inode; replacing a dataset
   behind its journal is not a supported live activation procedure.
4. Verify each document type, image, sharing grant, trash item and existing history
   checkpoint against pre-backup counts/hashes. Include Space child IDs/order,
   Formula bindings, live generations and earlier internal Trash. Confirm a viewer
   cannot edit or open unrelated documents. Reopen after a restart. Confirm the next offsite
   backup succeeds and status reports its new timestamp.
5. Record source/target versions, backup identifier, equality checks, sign-in and
   permissions outcomes in the PR. A file listing or successful decryption alone
   is **not** a successful application restore. Delete disposable cloud test
   resources and temporary credentials after recording the evidence.

## Verification record

Automated tests exercise native snapshot/image/account/grant/unknown-history-table
round trips, integrity and authentication failures, destination collision,
retention boundaries, upload failure without pruning, persistent status,
scheduler catch-up and shared leases. HTTP/browser tests cover admin-only status
and its failure/last-success presentation.

### Native Space recovery acceptance, 2026-10-22

`src/server/collaboration/space-native.test.ts` runs the real `BackupService`
against an injected object-storage transport, authenticates and restores the
encrypted archive, and compares every durable SQL table before starting fresh
application and native services. Recovery metadata is checked separately and
the operational backup lease is reset. This exercises the production backup and
restore path without provisioning a cloud host.

The restored fixture then runs SPN-064's actual disabled-owner handover. Stable
IDs, content, sibling order, Formula bindings and evaluated results, image bytes,
live generations, checkpoints, restore labels/receipts and earlier internal Trash
survive. The new owner restores the whole Space and an earlier deleted subtree;
an existing viewer can still read snapshots and images but cannot restore them.
Old guest capabilities are invalidated. The Operator, an unrelated account and
the departed owner, even after reactivation, cannot read the transferred content.

Checkpoint CI at
[`4aa5ea4`](https://github.com/mxbaylee/spinel/commit/4aa5ea444a0a3f17dd7e18d46ecbda20ca882b33)
passed this native acceptance. It is separate from the fresh-host drill below
and does not substitute for final-head CI or independent merge approval; the
[implementation record](implementation/SPN-092.md) tracks that evidence.

### Fresh-host Spaces drill, 2026-10-17 Pacific (2026-10-18 UTC)

The owner explicitly delegated temporary resource creation, backup/restore and
teardown to the agent. This was an agent-run drill using synthetic data, not a
claim that the owner manually repeated every command. Source code was reviewed
commit `c27c667c0b1d14b8921a80ae47e7d5ef3ab860ce`, Node 24.19.0. The source ran on
the FileVault-enabled Mac; the destination was a newly created Ubuntu 24.04.5
DigitalOcean droplet with one Intel vCPU and 1967 MiB RAM. An initially empty
4 GiB loopback file was formatted as LUKS2/ext4 and mounted at `/srv/spinel/data`.
The random disk key remained on the Mac and was supplied through SSH stdin,
not stored on the unencrypted host root. This proves restore into encrypted
storage; it does not repeat SPN-029's separate attached-volume reboot/TLS checks.

A private SFO3 Space used restricted listing, no CDN/versioning, and a limited
read/write/delete key scoped to that test bucket. Anonymous listing returned
HTTP 403. The first actual upload/readback/download/local restore passed. Large
image transfer from the Mac was too slow, so the destination built the reviewed
Git archive directly; its SHA-256 was
`bca1b9c312d0a55059ab6dbe923e27170319aab4b38366a98504c2ae1f28bc2b`.
The source backup then recorded this exact available recovery image:
`sha256:173026b19d5b101163633029fa74c8b3c043fb22b070097eb88b795a0293d5eb` (amd64).
The abandoned large-image transfers are not backup success evidence.

The destination independently downloaded
`drill/2026-10-18T02-37-38.730Z-6f9c5499-66b2-42a4-9217-57dd5d908fab.spinel`
from Spaces and ran the documented restore command into a new directory on LUKS.
It received no copy of the source database. All 13 application tables matched
the source's logical SHA-256:
`5a28790d72cada3494a24093b2b113244f10e440ad03cbac4e223265a7fdaf95`.
The comparison excluded only backup operational state and recovery metadata.
Counts included three users/passkeys/sessions, five workspace items (including
trash), one native Sheet snapshot, one Doc snapshot, one PNG blob, one sharing
grant and a synthetic historical-checkpoint table. History UI had not shipped
at that checkpoint; this last table verified preservation of additional database
tables, not history-feature acceptance. Canonical origin and runtime environment
matched the encrypted recovery manifest.

The restored app ran as UID 1000 with a read-only container root and 512 MiB
memory cap, binding only host loopback. SSH was source-IP restricted. An SSH
tunnel preserved the original synthetic `http://localhost:3118` relying-party
origin; no public app or DNS records were created. Browser checks used the three
original cryptographic WebAuthn credentials, supplied by virtual authenticators,
to sign in again as Operator, Owner and Collaborator. Existing credentials were
not replaced. Owner/Collaborator read the expected native snapshots and exact
image bytes; the viewer's edit returned 403, an unrelated document returned 404,
the Operator's document request returned 403, and an unauthenticated guest got 401. Every check passed again after replacing the running app container.

The restored host then produced and verified a new offsite backup at
`2026-10-18T02:39:18.706Z`, with no admin error. Its object was
`drill/2026-10-18T02-39-18.481Z-5d1be4f2-05cd-4e17-bdab-9e1df3623ab8.spinel`.
Listing showed only this newest daily recovery point after retention. Admin
reported configured backups and that last-good timestamp. After the second
backup, Node used 52.82 MiB; the host had 1441 MiB available. These are small-fixture
samples, not large-database capacity guarantees.

An independent reviewer then compared the seven durable data tables directly
against source hashes and all three original credential/public-key records
(excluding expected sign-in counters/timestamps). SQLite integrity passed with
no foreign-key violations; image, origin, environment and backup status matched.
Spaces HEAD/ACL checks confirmed the 13,414-byte recovery object and no public
access grants.

After that review, the temporary bucket-scoped key was revoked and the test
droplet was deleted. DigitalOcean confirmed the Space was scheduled for deletion
on 2026-10-31 and was no longer being billed from the deletion request on
2026-10-18 UTC. No separate volumes, snapshots, reserved IPs, DNS records or
Tailscale nodes were created for this drill. Temporary local synthetic data and
keys were removed after recording the evidence. PR #35 records the final
reviewed SHA, grade and required CI results.
