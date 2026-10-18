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

The fresh-host DigitalOcean Spaces drill is pending. Do not claim SPN-030 complete
until that evidence and an independent review are recorded.
