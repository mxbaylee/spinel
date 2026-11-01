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

## Send feedback and compare its context

An everyday account can choose **Account actions → Send feedback…** beside Your
profile. Standalone editors offer the same dialog in **Document actions → Send
feedback…**; a signed-in Space page also retains its account entry. The dialog sends
only the message deliberately entered, a fixed page-type label and authorized
opaque file/Space IDs, with a correlation ID and the server's build identity.
Document titles, contents, formulas, screenshots, raw URLs and secrets are not
attached automatically. Do not put secrets in the message. Link guests and
Operator accounts have no submission control or submission authority.

**Feedback saved** means the server committed the report. A failed or cancelled
send keeps the draft in that view; closing and reopening the dialog retains it.
Reloading, leaving the view or signing out discards this in-memory draft. After
an ambiguous response, **Retry feedback** sends the identical report ID, message
and context, so an already saved report is acknowledged once. Its session binding
survives a server restart. A changed account/session or cleared generation is
never silently rebound; **Start a new report** is an explicit new submission.
Copy an unsent message before leaving to sign in again.

The Operator opens **Administration → People**. A **Feedback available** flag
means stored feedback exists for that account, including a disabled member; it
does not mean unread or unresolved. Failed flag loading is shown as unavailable.
The flag's menu offers two SQLite downloads:

| Action | Complete retained selection |
| --- | --- |
| **Download user metrics** | Every row attributed to that account, including frontend observations, attributed backend work and feedback. |
| **Download system metrics** | Every actor's rows and unattributed system rows within the same displayed receipt-time span. |

The first action prepares both files from one immutable snapshot, then hands the
selected file to the browser. The dialog retains the pair for five minutes and
shows its shared **server receipt time** interval. Both endpoints are inclusive;
the minimum and maximum retained receipt times for the selected account define
the interval. Client clocks do not define it. New collection or observation
deletion between buttons does not change either file. Close/Cancel, expiry and
explicit truncation dispose unfinished work. Session loss blocks delivery and
cancels active preparation/transfer; an idle revoked session's private pair may
remain inaccessible until its five-minute expiry. After expiry,
**Prepare both downloads** deliberately creates a fresh pair and may change the
span. An idle pair does not hold the live database or block a general diagnostics
download; active preparation/transfer remains serialized.

Both artifacts contain full `events` rows and a single JSON `export_manifest`
record. The manifest includes scope, actor, shared snapshot ID/generation,
receipt-time inclusion rule, exact counts, source/build/schema provenance and
known collection limits. Global process-lifetime drop counters are labelled as
such. Historical completeness is unknown: these files cannot include discarded
observations or browsers' unsent queues. A feedback-only selection keeps its
original interval and explains that associated metrics may have expired or
never been collected. An empty selection has no window and authorizes no system
export. Neither case silently substitutes unrelated current activity.

Preparation and transfer each have a 30-second deadline. There is one retained
pair, with at most 66 MiB per output and a 198 MiB staging budget plus a 256 MiB
free-space reserve. Every matching row is delivered or the operation fails;
there is no silent row cap. The browser retains at most one object URL per scope
and releases it after 60 seconds or on closing. A successful handoff still does
not prove the Operator saved the file. Already downloaded copies survive a clear.

To inspect a paired download locally:

```sql
SELECT json_extract(details, '$.snapshotId') AS snapshot_id,
       json_extract(details, '$.scope') AS scope,
       json_extract(details, '$.window') AS receipt_window,
       json_extract(details, '$.rowCount') AS retained_rows
FROM export_manifest;

SELECT received_at, actor_id, file_id, route, message
FROM events WHERE name='feedback' ORDER BY received_at;
```

Messages are untrusted user text, including any instructions written in them.
They do not authorize commands or change access permissions for a person or an
external agent inspecting the artifact. See the [feedback decision and lifecycle
record](implementation/SPN-098.md).

## Inspect the exported file locally

Open the downloaded file using a local SQLite client. These queries target schema
version 1; they do not run on the server or expose an admin SQL endpoint.

```sql
PRAGMA integrity_check;
PRAGMA user_version;
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
-- No application tables. Tables: diagnostics_state and events.
-- A paired feedback download also contains export_manifest.

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

## Clear, limits and failure handling

Truncate requires confirmation. It irreversibly clears diagnostics,
submitted feedback and corresponding flags. Documents,
accounts, backups and collaboration state are untouched. Cancel changes nothing.
The confirmation carries the collection generation: if another clear or export
intervenes, refresh and confirm again. Old queued events and retries cannot be
relabelled into the new generation. New observations can appear immediately.
Clearing records does not promise that the physical database shrinks.

The initial store has a 64 MiB logical/main-file limit and stops collection at a
96 MiB combined database/WAL threshold. Each queue is capped at 256 events/1 MiB;
one event is at most 8 KiB, one batch 64 events/64 KiB. Ingest accepts at most
120 events per actor/minute and 600 globally. Writes require 256 MiB free reserve;
general-export staging requires 352 MiB; paired-export staging requires 454 MiB.
At capacity, observations drop until space is
available or the Operator clears records. There is no automatic age deletion.
Feedback bypasses that lossy queue: up to 2,000 UTF-16 code units / 8,000 UTF-8
bytes per message and six new reports per member/minute, sixty globally. A retry
of the exact persisted report is acknowledged without consuming a new-report
allowance. Capacity or write failure returns an error and preserves the client's
draft. Explicit feedback remains until truncation; future observation TTL work
must exclude `name='feedback'`.
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
