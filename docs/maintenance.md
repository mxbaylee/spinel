# Supervised maintenance

SPN-111 adds a deployment-owned pause around the current workspace. It can drain
accepted operations, stop every application process, verify that the live SQLite
and WAL handles are closed, and start the same generation under maintenance.
Replacing a dataset from a backup uses the separate
[Admin restore flow](backups.md#restore-through-admin), with durable encrypted
source custody and independent generation admission. Ordinary maintenance commands
do not authorize replacement or bypass an unresolved restore's opening barrier.

## Supported control boundary

Use Linux, a local filesystem with working file and directory `fsync`, one
application instance and the pinned Node runtime. Start the deployment through
`server/supervisor.ts`. The supervisor runs the fixed `server/index.ts` application
entrypoint as a separate process group; it accepts no executable, shell command,
PID, database path or archive path through its control API. It needs no Docker
socket. Ordinary `npm start`/`npm run dev` and direct `server/index.ts` development/test
runs report supervised maintenance as unavailable. Use `npm run start:supervised`
(or `npm run dev:supervised`) for this capability; deployment Compose selects
that launcher explicitly. A direct Linux app holds a separate live-application
lease until its process exits, including after SQLite's close method returns.
The supervisor shares that lease with every separate process opening the live
workspace, so they cannot open the same inode through different paths or PID
namespaces. The direct app also holds the cold-operation
lease during startup, then releases that one for legacy live setup workflows.
A new empty database is created and its inode leased before any SQLite
connection opens. Direct developer startup does not inspect unrelated desktop
processes; a supervised orphan retains actual kernel ownership that blocks it.

Every app and offline command touching one dataset must share the same Linux
network namespace and service UID. Abstract Unix leases are scoped to that
network namespace; the official `network_mode: host` deployment supplies this
boundary even when containers have separate PID namespaces. Application workers
remain inside their supervisor's PID namespace. Restart reconciliation must use
that same PID namespace, or the previous namespace must have fully terminated.
The official container runs the supervisor as PID 1; its death terminates every
member of that namespace. A host supervisor can restart in the host namespace.
Moving a crashed host deployment into a new PID namespace while host orphans are
still alive is unsupported: stop those old processes before changing topology.
Inherited ownership still excludes another app or cold command across those PID
namespaces. Within this profile, the `/proc` scan verifies closure of visible
same-UID workspace owners and refuses unreadable candidate owners; it never
treats `EACCES` as an empty descriptor list. An arbitrary SQLite process in another namespace is not
a supported way to access the managed dataset. Stop/reconcile all such external
work before maintenance.

Set `DATABASE_PATH` to the existing workspace and `SPINEL_MAINTENANCE_ROOT` to an
existing canonical absolute directory, owned by the service UID with mode 0700.
The recovery directory must be outside the workspace/diagnostics directory. Mount
it independently from archived data; do not include it in a workspace backup or
place it in disposable diagnostics storage. Keep it private to the deployment
account. Do not replace the configured directory while the controller runs.

The private journal binds an instance, generation, current database device/inode,
retry epoch and bounded operation authorization. Updates replace one small 0600
JSON file after syncing it, then sync the directory. Linux abstract Unix sockets
provide exclusive kernel-owned leases for the canonical database path, existing
inode and control root. Live-application ownership and cold-operation exclusion
are separate leases. Before the application or maintenance verifier opens
SQLite, the supervisor transfers copies of all four path/inode listeners over
private IPC and waits for complete receipt. Those copies remain held until each
recipient process exits, including after native database close and parent death.
Worker threads share that process lifetime; any separate live-workspace worker
must inherit the same ownership before opening SQLite. The final process exit
releases the dataset leases without stale-file takeover. Standalone
database-writing CLIs retain `acquireColdWorkspace` through process exit after
any SQLite-open attempt, because native descriptors may survive `.close()`.
Lease listeners are unreferenced so they cannot keep a failed CLI alive.
A second supervisor or offline writer cannot race the running deployment. The
journal retains up to 128 operation-intent receipts throughout their authorization
windows. Nonconsecutive retries return current status without repeating an action;
a reused ID with different intent is refused, and a full unexpired receipt window
refuses new actions rather than evicting replay protection.

The loopback maintenance service defaults to `127.0.0.1:3002`;
`SPINEL_MAINTENANCE_PORT` can select another fixed deployment port. Its public
`GET /api/maintenance` returns only availability, phase, opaque retry epoch and
notice. It never returns operation IDs, credentials, actors or generation details.
Other requests receive a minimal 503 page/JSON response. Keep this service behind
the configured proxy; it is independent of the application and its database.
The deployment proxy also has a fixed static 503 fallback, so a controller crash
does not depend on another upstream to explain the outage. It does not invent an
authoritative retry epoch when the controller is unavailable.
The private `control.sock` within the recovery root is mode 0600 and accepts only
fixed recovery commands. Possession of the deployment OS account is the cold-host
authority, separate from any credentials inside a restored database.

## First startup and restart

The initial database must exist: perform ordinary first-account/setup preparation
before starting the supervisor. Start `server/supervisor.ts` with the deployment
environment. It intentionally leaves the workspace closed. A missing journal,
controller interruption, changed process identity or corrupt journal cannot
silently reopen editing.
The controller first acquires only the recovery-root lease and persists its
closed boot state before exposing public status. It reconciles the journal's
recorded process groups, then acquires both dataset leases and rechecks the file
identity before opening its private command socket. A surviving inherited owner
or competing offline command prevents admission; no database opens during this
reconciliation. Partial/failed ownership handoff cannot make a child ready.
After recorded orphan reconciliation succeeds, kernel ownership can briefly
outlast process/descriptor visibility during exit. Startup waits only on a real
busy-lease result, within the same TERM plus forced-exit deadline. It still needs
an exclusive bind of all four listeners, a fresh closed-handle check and an
unchanged known generation before admitting control. A persistent competing
process remains an error; no lease is unlinked, stolen or treated as acquired.

Run the CLI as the service UID with `SPINEL_MAINTENANCE_ROOT` set:

```sh
node scripts/deploy/maintenance.ts status
node scripts/deploy/maintenance.ts verify
```

`verify` returns the operation ID. Reuse that exact ID for the following commands:

```sh
node scripts/deploy/maintenance.ts start --operation 00000000-0000-4000-8000-000000000000
node scripts/deploy/maintenance.ts resume --operation 00000000-0000-4000-8000-000000000000
```

Replace the illustrative ID with the returned value. If a prior operation already
exists, `verify` also requires `--operation` with that current ID. Commands reject
a different operation ID and consumed resume authorizations. The CLI accepts no
arbitrary JSON, filesystem paths or command text.

Verification runs a fixed read-only worker against the configured file, checking
SQLite integrity and foreign keys under a memory/time budget. The application
then initializes and proves readiness while edits and jobs remain paused. Resume
requires the same known file generation and a ready application. A changed
workspace inode is refused; this feature cannot authorize or activate a
replacement dataset. An invalid journal is preserved as a private
`rejected-<uuid>.json` only during an explicit cold-host recovery operation.

## Pause, stop and restart the same generation

The application requires a current Operator session, a recent verified passkey,
exact origin/CSRF checks and a fresh operation ID before asking its parent to
pause. The parent persists the pause and changes the retry epoch before the
application drains. Accepted HTTP, sync and job work must settle within the drain
budget. A timeout keeps maintenance active; it never reports successful drain.
Scheduled backups and verification, backup preparation and download, and
workspace archive export and import are cancelled when draining begins rather
than holding the drain open. Each says that maintenance stopped it. People
restart a download, export or import after resume; a scheduled job retries
within an hour once the workspace is running (or waits to be run again if
automatic backups are off). An application restart stops the same work and says
so instead. One step cannot be interrupted: the snapshot copy at the start of a
backup (`VACUUM INTO` plus integrity checks) is synchronous. On a large
workspace it can outlast the 25-second drain, which then fails into
`recovery-required` with `drain-failed`; use the current operation ID to run
stop → verify → start → resume, then pause again. Stop must close the surviving
application before verification. Queued work from before the pause is not resent
automatically after resume: each tab keeps it for the person to reconcile.

The parent issues a single-operation resume secret to the initiating browser and
stores only its hash outside the database. It expires no later than five minutes
after current verification and is bound to the operation, generation and the
Operator account that paused. Another administrator cannot use it. It cannot be
renewed by credentials in a paused/restored database. A pause expected to run
longer than five minutes ends with the cold CLI. Expiry or a lost
browser response leaves the cold-host CLI available. If account recovery must change authentication while
application auth is broken, stop the application, shut down the supervisor to
release its dataset lease, run the cold setup/recovery CLI, then restart control
and verify/start/resume the same generation. Do not run an independent database
writer while the supervisor owns the dataset.

For an explicit local maintenance operation:

```sh
node scripts/deploy/maintenance.ts pause
node scripts/deploy/maintenance.ts stop --operation 00000000-0000-4000-8000-000000000000
node scripts/deploy/maintenance.ts verify --operation 00000000-0000-4000-8000-000000000000
node scripts/deploy/maintenance.ts start --operation 00000000-0000-4000-8000-000000000000
node scripts/deploy/maintenance.ts resume --operation 00000000-0000-4000-8000-000000000000
```

Use the ID from `pause`/`status`. Stop refuses a running or still-draining app.
It sends TERM to the exact owned process group, waits within the stop budget,
then KILLs surviving owned workers if necessary. It checks `/proc` for both
surviving group members and handles for the workspace, WAL and shared-memory
sidecars. An unrelated handle owner is never killed; its presence keeps recovery
closed. Close that explicitly owned offline operation before retrying verification.

After controller death, the child's private IPC disconnect closes its gate and
initiates shutdown. Restarted control reconciles the persisted process identity
before allowing a fresh verification. It uses Linux boot identity, process start time and a random per-process-group
ownership marker to avoid signalling an unrelated reused PID. Surviving orphan
workers must carry that exact inherited marker before their group can be stopped.
This marker is not authorization and sanitized worker environments copy only that
field, without inheriting application credentials. Unknown state remains in
maintenance. The proxy can continue explaining the outage while application auth
and ordinary jobs are unavailable.

## An unresolved restore

Admin reports an unresolved or unknown restore outcome, the workspace stays in
maintenance, and ordinary verify/start/resume refuse to reopen it. The files alone
cannot prove which generation is intended, so recovery is deliberate:

1. Leave the workspace closed. Do not delete the private recovery root, its
   `restore-*` directories or journals, the `<database>.restore-pending` opening
   barrier or any retained source; do not run another database writer.
2. Record `node scripts/deploy/maintenance.ts status`, then restart the supervisor
   once. Restart finishes reopening a committed outcome without reinstalling
   prepared bytes, and marks an admission that never executed as failed and stopped.
3. If status now shows a stopped operation and no pending restore, run verify,
   start and resume with that operation ID, sign in as the Operator and
   **Refresh restore status**. Only a recorded outcome says which data is live.
4. If verify still refuses, the restore stopped between freezing the original and
   committing an outcome, for example when the host lost power during the
   candidate's trial or ran past the confirmation's five-minute window. The
   preserved original is intact in the recovery root, but no supported command
   reinstalls it yet ([SPN-128](todo/SPN-128.md)); copying those files back by hand
   is not a recovery step. Copy the whole application directory and recovery root
   read-only to separate encrypted storage, then follow
   [fresh-host recovery](backups.md#restore-onto-a-fresh-host) from the last
   verified backup with its access review. That loses work accepted after the
   backup, so tell the Owner and Collaborators before reopening. Keep the copy
   until that host is checked; it is the only evidence of the lost work.

## Notices and time zones

Notices are one-off announcements. They record a full absolute instant, an IANA
time zone and an estimated duration of one minute through one day. A repeated
local clock time during the autumn DST transition is two different instants;
the UI must select an explicit instant. There is no recurring local-time scheduler
and no implicit interpretation of a missing spring-forward clock time.

When the announced time arrives while the controller runs, the notice becomes
started. If the controller was down at that instant, restart marks it missed.
Neither state disappears when the estimate ends: it remains visible until
explicit cancellation/replacement. During a pause, the initiating tab can cancel
using its still-unexpired passkey verification from that pause. It cannot renew
verification while workspace writes are gated. After that proof expires or is
lost, resume using the tab's remaining authority or the server recovery controls,
reload Administration, and verify again to cancel. Scheduling needs a running
workspace ([authority decision](implementation/SPN-111.md#bound-paused-notice-cancellation-to-the-existing-proof)). A cancelled notice clears
once its announced window has passed. Publishing, reaching or cancelling a notice
never pauses editing and never grants restore/resume authority. Offline devices
are not promised receipt of an announcement.

## Budgets and acceptance boundary

Default bounds are 30 seconds to drain, 15 seconds for TERM shutdown followed by
at most 3 seconds for forced process exit (the application drains for 10 of
those 15 seconds, so an orderly stop does not need SIGKILL), 30 seconds for application readiness,
and 15 seconds for the isolated verification worker. Its V8 heap is capped at
64 MiB with a 4 MiB nursery. JSON control input is at most 4 KiB; journal input is
at most 32 KiB. A process inventory above 32,768 entries or 4,096 descriptors for
one relevant user process is refused, preserving maintenance instead of guessing.
The supported service should retain its existing container memory/PID/disk limits.

Disposable process tests cover a real SQLite app and stubborn WAL worker,
shutdown/restart, authority expiry and replay, generation replacement refusal,
private paths/leases, absolute DST instants, cancelled/missed notices and minimal
proxy responses. SIGKILL barriers exercise persisted starting, running, draining,
paused, stopping and stopped states without relying on application cleanup.
These are local process/filesystem proofs, not power-loss simulation. Selected
provider and actual target-host filesystem/proxy/resource acceptance remain in
[SPN-038](todo/SPN-038.md) before public exposure.
