# Supervised maintenance

SPN-111 adds a deployment-owned pause around the current workspace. It can drain
accepted operations, stop every application process, verify that the live SQLite
and WAL handles are closed, and start the same generation under maintenance.
Replacing a dataset from a backup remains [SPN-112](todo/SPN-112.md).

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
The supervisor holds that lease too, so they cannot open the same inode through
different paths or PID namespaces. The direct app also holds the cold-operation
lease during startup, then releases that one for legacy live setup workflows.
Before opening SQLite it checks for orphan handles left by an interrupted
supervisor. A new empty database is created and its inode leased before any
SQLite connection opens.

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
The `/proc` scan proves their
closure and refuses unreadable candidate owners; it never treats `EACCES` as an
empty descriptor list. An arbitrary SQLite process in another namespace is not
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
inode and control root, releasing automatically after a crash. Live-application
ownership and cold-operation exclusion are separate leases. Standalone
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
The controller persists its closed boot state before exposing public status and
finishes old-process reconciliation before opening its private command socket.

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

The parent issues a single-operation resume secret to the initiating browser and
stores only its hash outside the database. It expires no later than five minutes
after current verification and is bound to the operation and generation. It
cannot be renewed by credentials in a paused/restored database. Expiry or a lost
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

## Notices and time zones

Notices are one-off announcements. They record a full absolute instant, an IANA
time zone and an estimated duration of one minute through one day. A repeated
local clock time during the autumn DST transition is two different instants;
the UI must select an explicit instant. There is no recurring local-time scheduler
and no implicit interpretation of a missing spring-forward clock time.

When the announced time arrives while the controller runs, the notice becomes
started. If the controller was down at that instant, restart marks it missed.
Neither state disappears when the estimate ends: it remains visible until
explicit cancellation/replacement. Publishing, reaching or cancelling a notice
never pauses editing and never grants restore/resume authority. Offline devices
are not promised receipt of an announcement.

## Budgets and acceptance boundary

Default bounds are 30 seconds to drain, 15 seconds for TERM shutdown followed by
at most 3 seconds for forced process exit, 30 seconds for application readiness,
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
