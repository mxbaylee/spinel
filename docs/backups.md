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

| Option | What it supplies | What Spinel still needs to establish |
| --- | --- | --- |
| Droplet backups | Scheduled system-disk images. | Attached volumes are excluded; active database writes need an appropriate consistent backup method. |
| Volumes | Data replicated across hosts, plus volume snapshots. | Hardware redundancy does not recover an earlier application state after a bad write or deletion. |
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
offsite coverage. SPN-111 implements [supervised maintenance](maintenance.md) for
pause, drain and restart of the same dataset. Manual Admin exports, diagnostics
expiry and assisted live restore remain separate work in SPN-109, SPN-110 and
SPN-112; fresh-host CLI recovery is available.

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
same scheduling cycle. In supervised mode this cycle begins only after explicit
resume; a paused application runs no backup or verification job. It must be
running on an unlocked volume. A restarted process
waits up to one hour for an interrupted process's lease to expire. Graceful
shutdown drains the active job. Backup and verification share the same lease;
they cannot compete for staging or prune a source during verification. A forced
stop leaves private staging on encrypted storage. The next lease holder reconciles
only generated, private `.recovery-job-*` directories owned by this service. Old
standalone `.backup-*`/`.restore-*` directories require inspection while no recovery
command is running; never remove the live database or sidecars.

A streaming upload uses a `.pending` object, downloads it to verify SHA-256,
then publishes it with a server-side copy. Unverified pending objects are never
retention candidates or restore choices. If interrupted, they may remain: remove
abandoned pending objects after checking no job is running. Only after publishing
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
reconciliation when replacing a dataset belongs to SPN-112, not this verifier.
SPN-111's generation/epoch fencing supports maintenance of the current dataset
and refuses an unexpected replacement inode.

Sources: [SQLite VACUUM INTO](https://www.sqlite.org/lang_vacuum.html#vacuuminto),
[DigitalOcean AWS SDK configuration](https://docs.digitalocean.com/products/spaces/reference/aws-sdks/).

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
the Operator's document request returned 403, and an unauthenticated guest got
401. Every check passed again after replacing the running app container.

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
