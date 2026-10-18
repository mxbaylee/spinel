# Offsite backups and recovery

Spinel backs up to a **private DigitalOcean Space**. It uses SQLite's online backup
API, compresses the consistent copy and encrypts it with AES-256-GCM before any
network transfer. The 32-byte random recovery key must be kept separately from
Spaces and from the droplet. Losing that key makes every backup using it unreadable.

This preserves accounts, passkeys, sessions, invitations, folders, grants, trash,
native Sheets/Docs snapshots and uploaded image bytes: all currently live in
SQLite. Every table is included, including future history tables. Before adding
an external database or filesystem blob store, extend this inventory and the
consistent backup/restore procedure; a SQLite-only backup cannot protect those.

The encrypted copy also contains the canonical origin, immutable application
image reference and runtime environment file. Host-specific Tailscale identity,
TLS certificates and disk-unlock material are recreated on the fresh host; they
are not application data. Keep the reviewed image in a durable registry or
independent archive: a local Docker image ID alone does not preserve the image.

Offsite recovery is required before daily use: the droplet is a single point
of failure for the Owner's documents (grooming, 2026-10-17;
[decision #23](https://github.com/mxbaylee/spinel/issues/23)). Backup tooling is
TypeScript, as required by the owner on 2026-10-17.

The owner selected Spaces and authorized a temporary cloud restore drill in
[decision #34](https://github.com/mxbaylee/spinel/issues/34). The format, schedule
and recovery choices are recorded in
[decision #36](https://github.com/mxbaylee/spinel/issues/36). They give the Operator
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
3. Generate a key on a secure operator machine with Node 24.19.0:

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
6. Restart through `systemctl restart spinel`. The app catches up a missed night
   at startup. For an immediate backup, run from `/opt/spinel`:

   ```bash
   docker compose --env-file /etc/spinel/deploy.env -f deploy/compose.yaml exec app node scripts/deploy/backup.ts run
   ```

   A shared database lease prevents the CLI and scheduler from overlapping.
   Open Admin and verify a recent **Last successful backup**, with no error.
   Keep the recovery key, bucket/region/prefix and reviewed image location outside
   the droplet. Credentials can be replaced; the encryption key cannot be recovered.

## Schedule, retention and failures

The app runs at 02:00 UTC, catches up after downtime, and retries unsuccessful
attempts hourly. It must be running on an unlocked volume. A restarted process
waits up to one hour for an interrupted process's lease to expire. Graceful
shutdown waits for an in-flight backup, but a forced container stop can interrupt
it; the next eligible run retries. Private staging from a killed process stays
on encrypted storage; remove only abandoned `.backup-*`/`.restore-*` directories
while no backup or restore is running. Never remove the live database or sidecars.

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
the newest recognized backup, the current successful upload and future-dated
objects. This is a calendar window, not a promise of 17 distinct objects.

Admin shows configured/missing setup, running state, the last attempt, the last
verified upload, failures and an overdue warning after 26 hours without success.
Retention failure still shows an error even if the new upload succeeded. SDK
messages are deliberately not exposed because they may include request secrets.
Check private configuration permissions, available space, key length, immutable
image, Spaces credentials/network access and bucket policy, then retry. Status
is persisted in SQLite and available only to active admins. It is not an external
alert service and cannot report while the whole instance is down.

Sources: [Node SQLite online backup](https://nodejs.org/download/release/v24.19.0/docs/api/sqlite.html#sqlitebackupsource-db-path-options),
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
   encrypted download until verification finishes. Start through the deployment
   preflight, then sign in with the existing operator and everyday accounts.
4. Verify each document type, image, sharing grant, trash item and existing history
   checkpoint against pre-backup counts/hashes. Confirm a viewer cannot edit or
   open unrelated documents. Reopen after a restart. Confirm the next offsite
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
grant and a synthetic historical-checkpoint table. History UI has not shipped;
this last table verifies preservation of additional database tables, not a
claim that a history feature exists. Canonical origin and runtime environment
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
