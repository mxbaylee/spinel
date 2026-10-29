# Server health and diagnostics

The Operator opens **Administration → Backups & health**. Health is read-only;
diagnostics offers **Download diagnostics** and **Diagnostics actions → Truncate
diagnostics…**. Ordinary members and guests cannot inspect or clear this data.
The implementation and its outstanding validation are recorded in
[SPN-032](implementation/SPN-032.md). Spinel is still pre-production: this guide
does not claim a running deployment or an active external monitor.

## Read the health measurements

Host used memory is total minus Linux `MemAvailable`, compared with the 2 GiB
planning budget from [deployment](deployment.md). On platforms without that
measurement, total minus free memory is explicitly labelled as an approximation.
Process RSS and cgroup-v2 container usage/limit are separate measurements; never
add them to host usage. Missing cgroup data is unavailable, not zero. The warning
starts at the first observed sample above 80% of the host budget and clears when
usage falls to or below it. Sampling occurs at startup, each minute and on refresh;
the warning timestamp is an observation, not the exact instant a problem began.

Live connections counts connected editors with an open unit. Physical database
and WAL sizes are separate from logical database pages. Application/collaboration
share one file and count once; diagnostics uses a separate file. Device/inode
identity prevents aliases from counting twice. Growth is the signed change from
the first measurement of that file in this process, including its WAL. Restart
resets that baseline. Missing storage measurements remain unknown.

Free space refers to the volume containing the application database. Backup
staging uses the actual archive guard: 2.1 times logical database bytes plus
256 MiB reserve. The separate 5 GiB upload ceiling applies to the produced backup
archive, whose compression/encryption size cannot be predicted from database
pages. Compare the generated archive with that ceiling during backup; a health
card cannot promise an upload will fit. See [backups](backups.md).

History maintenance includes both capture and pruning. Trash expiry and the
collaboration purge queue report their actual runs; the latter also performs
restore-generation cleanup. **Space Trash expiry** is configured when Space
exposure is enabled and reports its actual startup/daily attempts, last success
and failure state. With `SPINEL_SPACE_REVIEW=0` it remains **Not configured** and
hidden Space groups are retained. A failure keeps its first observed failure
time until a successful run. Successful bounded work does not mean all expired
content or every queued generation has already been removed.

Space cleanup scans an indexed page of at most 256 root metadata rows, validates
at most 16 eligible graphs per pass and bounds each graph to 10,000 members.
Collaboration cleanup processes at most 100 ordered queued generations per pass.
Both check a one-second elapsed budget between units of work; an in-progress
transaction or generation can take longer. Failed Space graphs stay intact while
unrelated eligible roots continue; cursors advance past failures for later retry.
Native purge failures at startup or on the minute retry leave the application
available and preserve durable queue entries. A final shutdown attempt also
retains unfinished entries for the next startup. These jobs log only static status
or counts, never names, locations, content or arbitrary exception text.

Backup configuration, running state, last attempt/success, errors and overdue
status use the shared backup controller. SPN-063 implements recurring isolated
restore verification before deployment under the
[pre-deployment recovery decision](implementation/SPN-063.md#accepted-decision-implement-recovery-before-deployment).
Provider and target-host acceptance remain required in SPN-038 before public
exposure. Admin reports current verification failure and its last successful
check separately from publication; local backup success does not imply offsite protection.

## Reproduce and download

Use the everyday account to reproduce a problem, then use the Operator account
to download the consistent SQLite snapshot. A formula preview is an initial
instrumented scenario. Browser and backend observations share an opaque run ID;
the selected-reference parser is observed around its public library call.
Automatic diagnostics contain registered operation/job codes, numeric metrics,
static log messages, and authorized opaque user/file/Space IDs and route templates.
They never contain document names/content, formulas, raw URLs, credentials or
arbitrary exception text. Browser claims remain explicitly `frontend`; the server
derives identity and rechecks current access. Guests do not collect diagnostics.

Docs additionally observe `doc-compose` around a public history/collaboration
flush triggered by the bounded capacity or owned quiet-period policy. Its
histogram measures that paired flush in milliseconds, with the existing success
counter and operation result. It does not measure SDK-owned idle flushes, key
latency, render time or network acknowledgment;
no text, selections or edit actions are collected. Collection retains the same
account and visibility gates. The [SPN-108 benchmark](implementation/SPN-108.md)
separately captures synthetic input timings, both native queues and CPU profiles.

One browser collector belongs to one authenticated account/session. Hidden,
offline, disconnected and signed-out states discard its pending observations;
reconnection obtains a fresh collection binding. This is deliberately lossy
operational evidence, independent of durable edit delivery. Dropped records are
reported rather than retried indefinitely. No browser diagnostic queue persists.

Download creates a separate consistent SQLite file, not a raw copy of the live
database and WAL. Only one export is active at a time. Snapshot creation and
delivery each have a 30-second deadline; cancellation/disconnection cleans up
temporary files. The UI confirms handoff to the browser, not that a user saved
the file. Check the browser's Downloads. Exported opaque activity identifiers
remain sensitive operational metadata; share the file deliberately.

The store lives beside `DATABASE_PATH` as `diagnostics.sqlite`, or
`diagnostics-events.sqlite` if the application itself has that filename. It
refuses application-file aliases and non-diagnostic tables. Keep it and temporary
exports on the encrypted data volume with restricted permissions. It is not a
replacement for application backups; losing diagnostics must not lose documents.

## Inspect the exported file locally

Open the downloaded file using a local SQLite client. These queries target schema
version 1; they do not run on the server or expose an admin SQL endpoint.

```sql
PRAGMA integrity_check;
PRAGMA user_version;
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
-- Expected application tables: none. Tables: diagnostics_state and events.

SELECT received_at, source, level, message, actor_id, file_id, route, run_id, details
FROM events WHERE kind='log' ORDER BY received_at;

SELECT run_id, source, component, name, details, metric_kind, metric_unit, metric_value
FROM events WHERE run_id IS NOT NULL ORDER BY run_id, received_at;

-- Counters are increments. Keep frontend/backend origins separate.
SELECT source, json_extract(details, '$.operation') AS operation,
       sum(metric_value) AS increments
FROM events WHERE metric_kind='counter' GROUP BY source, operation;

-- Histograms contain raw observations, not precomputed percentiles.
SELECT source, json_extract(details, '$.operation') AS operation,
       count(*) AS observations, avg(metric_value) AS mean_ms, max(metric_value) AS max_ms
FROM events WHERE name='operation.duration' AND metric_unit='milliseconds'
GROUP BY source, operation;

-- Gauges are separate point observations; process/host/container overlap.
SELECT received_at, name, details, metric_value, metric_unit
FROM events WHERE metric_kind='gauge' ORDER BY received_at;
```

Every record has occurrence and server-receipt timestamps, source/build, schema
version, registered name and validated JSON details. Actor/file/Space/route/run
fields are nullable. Logs have explicit severity and static messages. Metric
names constrain kind/unit/value. See the
[public contract](../lib/diagnostics/README.md) before adding instrumentation.

## Emitter maintenance inventory

Maintain this table when code moves or changes an observed boundary. The PR's
**Diagnostic upkeep** section explains added, moved, retired or unchanged
observations and the associated regression evidence. Preserve the actual
operation's content, history, permission, save and peer-delivery assertions when
testing observers off, enabled, throwing or under collection pressure. Metrics
are evidence about an operation; they never grant authority or replace its tests.

The new operation, sync, persistence, flush, checkpoint and maintenance durations
use monotonic `performance.now()` differences in
milliseconds. `occurred_at` is the producer's wall time and `received_at` is the
server's receipt time; neither substitutes for a monotonic duration. Browser
observations are claims tagged `frontend`; backend observations use verified
actors when the operation has one. Automatic history and supervisor work remain
unattributed instead of assigning the file owner as the actor.

| Observation | Production emitter and exact boundary | Regression owner |
| --- | --- | --- |
| `operation.*: document-open` | `web/DocEditor.tsx`, `web/SheetEditor.tsx`: mounted editor initialization through usable native editor, access/formulas/presence initialization and save watcher installation; failure/unmount completes once. Includes Space children through the same editors. | `src/ui/operationDiagnostics.test.ts`, `e2e/diagnostics.spec.ts` |
| `operation.*: document-save-local` | `web/offline/OfflineSession.ts`: persistence invocation through successful `saveCheckpoint` transaction. No-prepared/read-only skips do not claim a local durable write. | `src/ui/offlinePersistence.test.ts`, `e2e/diagnostics.spec.ts` |
| `operation.*: document-save-server-ack` | `lib/sync-client/src/client.ts`: oldest freshly enqueued group through validation of its matching acknowledgment's structure, ordering and held revision, before local confirmed-state replay. A later local replay error cannot turn a known durable acknowledgment into a server-save failure. Rebased/restored buffered work has no provable enqueue time and starts at allocation of its new immutable envelope, before required pre-send persistence. An already-immutable restored request starts at its first observed send. Within that client lifetime, reconnect/resend retains the observation and duplicate receipts cannot add a second success. A refusal or pre-validation interruption cancels the wait when server durability is unknown; it cannot claim that an already-sent write failed. | `lib/sync-client/tests/diagnostics.test.ts`, `e2e/diagnostics.spec.ts` |
| `operation.*: search` | `web/SearchPanel.tsx`: after the 150 ms debounce, request through handing current scoped results to React; superseded/disposed results are cancelled. `src/server/workspace/routes.ts`: authorized catalog query through returned result or failure, excluding transport and browser rendering. Keep the two sources separate. | `src/ui/operationDiagnostics.test.ts`, `src/server/workspace/search.test.ts`, `e2e/diagnostics.spec.ts` |
| `operation.*: snapshot-restore` | `src/server/collaboration/service.ts`: one admitted restore run, after the selected checkpoint is loaded, through preserved-before checkpoint/native replacement and durable generation completion. Coalesced callers and completed receipt retries do not create another operation. | `src/server/history/store.test.ts` |
| `sync.client.connection` | `web/spinelSync.ts`: initial/reconnect attempt through native replay readiness, failure or disposal; fixed initial/transport/timeout/offline reason vocabulary. Maintenance resumes through clean refresh and replacement-editor readiness, not a connection to the old room. | `src/ui/spinelSync.test.ts`, `e2e/diagnostics.spec.ts`, existing sync/offline browser suites |
| `sync.client.resync`, `sync.edit.resync`, `sync.resync.pending` | `lib/sync-client/src/client.ts`: refusal through pending receipt/checkpoint preservation and host handoff. `handed-off` does not mean the replacement editor is ready; that is a separate `document-open`. | `lib/sync-client/tests/diagnostics.test.ts` |
| `sync.client.refresh` | `web/spinelSync.ts`: clean cached-base refresh through `refreshClean` commit and replacement-editor handoff, or failure/cancellation. Fixed retention/access-change/maintenance reasons distinguish this path from a pending-edit refusal. Replacement readiness remains a separate `document-open`. | `src/ui/spinelSync.test.ts` |
| `sync.client.queue`, `sync.client.acknowledged` | `lib/sync-client/src/client.ts`: pending native-mutation count (inflight mutations plus buffered group lengths), oldest age and receipt classification. Queue samples occur at most once per second plus the immediate empty transition; this count is not saves, requests or flush groups. Age is null after reload/rebase when this process cannot prove an originating monotonic time. No diagnostic timestamp is persisted with edits. | `lib/sync-client/tests/diagnostics.test.ts` |
| `doc-compose`, `native.flush` | `src/ui/boundedDocHistory.ts` → `web/DocEditor.tsx`: owned capacity/quiet-period flush through native return or original throw; reason, pre-flush history/collaboration group counts, elapsed time and outcome. | `src/ui/boundedDocHistory.test.ts`, existing paired Doc responsiveness/callback CI |
| `native.checkpoint` | `lib/sync-client/src/client.ts`: lazy checkpoint capture or skip/failure at the existing persistence hook, distinct from storage completion. | `lib/sync-client/tests/diagnostics.test.ts` |
| `offline.persistence` | `web/offline/OfflineSession.ts`: actual checkpoint persistence or explicit not-prepared/read-only skip; retains original storage errors. | `src/ui/offlinePersistence.test.ts` |
| `offline.publication`, `offline.recovery` | `web/offline/OfflineSession.ts`, `web/spinelSync.ts`: the active account's publication/recovery attempt through result/cancellation; collection can remain absent offline. | `src/ui/offlineCreation.test.ts`, `src/ui/spinelSync.test.ts`, existing offline browser suites |
| `offline.server.publication`, `offline.server.recovery` | `src/server/workspace/offline-creation.ts`, `portable.ts`: verified request through committed publication or matched durable receipt; `published` and `duplicate` are distinct. Failure records omit unverified file context. | `src/server/workspace/offline-creation.test.ts`, `offline-recovery.test.ts` |
| `history.checkpoint` | `src/server/history/store.ts`: asynchronous native/collaboration capture through its transaction commit, skip or failure. Captures count once; a shared capture is not a second write. The synchronous native-save baseline remains part of the save transaction and is not separately counted. | `src/server/history/store.test.ts`, existing native/Space history suites |
| `maintenance.phase`, `maintenance.verification` | `src/server/maintenance/supervisor.ts`: distinct supervisor phases and actual closed-workspace verification success/failure/refusal. Supervisor remains observable while the application is stopped. | `src/server/maintenance/supervisor.test.ts` |
| `maintenance.drain`, `maintenance.refused` | `src/server/maintenance/gate.ts`: drain entry through permit settlement/deadline, with active permit count at entry; that count includes nested permits, not unique HTTP requests. Fixed paused/stale-epoch refusal codes. | `src/server/maintenance/gate.test.ts`, `src/server/diagnostics/store.test.ts` |
| `runtime.cpu`, `runtime.event-loop` | `src/server/diagnostics/runtime.ts` via existing minute health sampling: cumulative process user+system CPU delta in milliseconds; mean/max event-loop delay from a bounded 20 ms-resolution histogram, converted from nanoseconds to milliseconds. Each row states its actual monotonic window. | `src/server/diagnostics/runtime.test.ts` |
| Existing Formula/job/memory/storage/server-sync observations | Existing producers remain in place; registry changes retain schema-v1 names, units and exports. Legacy `document-save` remains readable; new producers use the two explicit save names. | Existing diagnostics, Formula, health and sync suites |

The runtime sampler skips windows shorter than one second, resets its delay
histogram after sampling and disables it during shutdown. CPU milliseconds may
exceed wall milliseconds when process threads use several cores. These bounded
samples cannot identify the cause of an earlier unprofiled pause.

The browser endpoint admits the four exact `operation.*` names, the explicit
client registry, and the three exact resync names above. It does not admit
arbitrary server sync, history, runtime, maintenance or writer-loss events.
Existing session/account/generation and file/Space authorization remain in force.
Operations beginning before a collection handshake, while hidden/offline, or
crossing suspension may have no retained observation. No delayed event is rebound
to a replacement account or collection; there is no persistent diagnostic queue.

Maintenance's internal sink accepts only registered maintenance events and writes
them synchronously through its existing lifecycle allowance; ordinary application
writes remain blocked. Request-driven refusal observations are limited to one per
fixed reason per monotonic second (two reasons, at most two writes per second).
Extra attempts increase the existing queue-loss counter before record allocation
or disk work. Truncation and phase changes do not refill that allowance. The
low-frequency drain, phase and verification observations retain their separate
lifecycle path. The supervisor is a secondary writer to the same bounded
diagnostics store. It never deletes the application's temporary exports, captures
the current generation for each new observation, and leaves old queued records
bound to their original generation. Truncation therefore cannot resurrect old
supervisor observations. `diagnostics.writer-loss` reports fixed cumulative loss
counters for one supervisor `run_id`; final counters also appear in its process
log. These are process-lifetime limits, not measured per-user loss. If storage is
unavailable, there may be no loss snapshot in the export.

## Clear, limits and failure handling

Truncate requires confirmation. It irreversibly clears diagnostics and, when
SPN-098 adds them, submitted feedback and corresponding flags. Documents,
accounts, backups and collaboration state are untouched. Cancel changes nothing.
The confirmation carries the collection generation: if another clear or export
intervenes, refresh and confirm again. Old queued events and retries cannot be
relabelled into the new generation. New observations can appear immediately.
Clearing records does not promise that the physical database shrinks.

The initial store has a 64 MiB logical/main-file limit and stops collection at a
96 MiB combined database/WAL threshold. Each queue is capped at 256 events/1 MiB;
one event is at most 8 KiB, one batch 64 events/64 KiB. Ingest accepts at most
120 events per actor/minute and 600 globally. Writes require 256 MiB free reserve;
export staging requires 352 MiB. At capacity, observations drop until space is
available or the Operator clears records. There is no automatic age deletion.
The [SPN-063 backup-options proposal](implementation/SPN-063-backup-options.md#three-independent-retention-policies)
discusses seven-day live-event expiry and independent optional archive retention;
neither is implemented by that writeup.
Loss counters reset with the process. Diagnostics initialization failure disables
collection without preventing app startup. See the
[implementation limits](implementation/SPN-032.md#concrete-bounds-and-lifecycle)
for exact failure, cancellation and resource boundaries.

## External availability check at launch

`GET /healthz` returns only `{"status":"up"}` with HTTP 200 or
`{"status":"down"}` with 503. It performs a minimal database-connection query;
it does not prove backups, every document, available disk space or all jobs are
healthy. It reveals no versions, users, filenames or measurements. A stopped
server, locked encrypted volume or broken proxy may return no response instead.

When SPN-038 deploys public HTTPS, the Operator can configure one free UptimeRobot
HTTP(S) monitor for `https://spinel.baylee.dev/healthz`, with five-minute checks and
their chosen alert destination. Require HTTP 200, send no cookies/credentials,
and test a real failure/recovery before relying on it. UptimeRobot's
[free-plan guide](https://help.uptimerobot.com/en/articles/11604710-who-should-use-uptimerobot-s-free-plan)
and [setup instructions](https://help.uptimerobot.com/en/articles/11358364-how-to-create-your-first-monitor-on-uptimerobot-quick-setup-guide)
were checked on 2026-10-23. No monitor or service account is created by this ticket;
there is currently no deployment to watch. This outside check remains useful when
the in-app health screen itself cannot load.
