# SPN-063: SQLite capacity and scaling

**Recorded:** 2026-10-27. **Status:** supporting analysis for the
[accepted SQLite/no-database-adapter decision](SPN-063.md#accepted-decision-keep-sqlite-without-database-adapters).
**Question:** what limits apply to size, documents, reads and concurrency, and
does Spinel need a different database or an adapter pattern?

**Conclusion:** retain SQLite and the existing single-application-instance model.
The engine's capacity is appropriate for the intended roughly two-person
workspace, and no measured requirement here justifies database-engine adapters.
Backup destinations are a separate [operating-model proposal](SPN-063-backup-options.md).
The first observed growth constraints are Spinel's catalog processing,
native-document work and recovery resources. Keep those constraints visible and
measure the selected deployment before promising a supported workload.

This is a writeup before implementation. It changes no application code or
limits. Engine limits, enforced application safeguards, observed experiments and
proposed acceptance tests are distinct kinds of evidence. None establishes an
unqualified maximum number of supported users or usable documents.

Code baseline:
[`a9893ce3c72d0a707f97e4444f9b3f48a65dd226`](https://github.com/mxbaylee/spinel/commit/a9893ce3c72d0a707f97e4444f9b3f48a65dd226).
The [complete capacity experiment record](SPN-063-capacity-experiments.md) includes
unchanged production-source hashes, exact query plans, raw output, reproduction
code and the initial resource-aborted attempt. Recheck the audit after runtime
or schema changes.

## 1. Database size: a high engine ceiling, a smaller operating envelope

SQLite's [documented limits](https://www.sqlite.org/limits.html) allow at most
4,294,967,294 pages. That has also been the upstream default page-count limit
since 3.45.0. The actual file ceiling is `page_size × max_page_count`; the build
and current database settings matter.

| Dimension | Engine/configuration evidence | Meaning here |
| --- | --- | --- |
| Current configured file ceiling | The actual Spinel runtime reported 4,096-byte pages and 4,294,967,294 maximum pages: **17,592,186,036,224 bytes**, about **17.6 TB / 16 TiB**. | A configured theoretical ceiling, not a tested or supportable deployment size. |
| Largest documented page/file combination | With 65,536-byte pages, the ceiling is **281,474,976,579,584 bytes**, about **281 TB / 256 TiB**. SQLite says this extreme has not been exercised at full size. | No reason to change Spinel's page size or plan around this number. |
| Single string/BLOB/encoded row | The probe reported compiled `MAX_LENGTH=1000000000`. | Spinel's much smaller native snapshot/image budgets apply first. |
| Document count | SQLite has no application-document quota. | Documents use multiple records and related data; bytes and operation costs determine useful capacity. |

The probe used the pinned **Node 26.12.1 / libsql 0.5.29** path and observed
embedded SQLite **3.45.1**. It reported WAL, `synchronous=2` (FULL), foreign keys
enabled, a 5,000 ms busy timeout, `cache_size=-2000`, `mmap_size=0` and a 1,000-page
automatic WAL-checkpoint threshold. The negative cache setting describes an
approximate KiB budget for that connection's page cache; it is not a cap on
process memory. See SQLite's [PRAGMA reference](https://www.sqlite.org/pragma.html).

A database need not fit entirely in RAM: SQLite reads pages through a cache.
The application still needs memory for active native models, JSON parsing,
result arrays, buffers and the Node runtime. The current
[Compose app limit](../../deploy/compose.yaml) is **1 GiB / 0.75 CPU** on a planned
2 GiB host; the [production Node command](../../Dockerfile) sets **256 MiB old
space and 8 MiB semi-space**. Those are configuration limits, not measured
capacity guarantees. A metadata probe on this development filesystem cannot
certify them.

### Forecast bytes from the complete retained state

Use the following accounting model, with measured bytes per category:

> Live database ≈ current snapshots + retained checkpoints + accepted edits and
> receipts + images + metadata/indexes + allocated free pages.

Add WAL, backup/restore scratch, encrypted archives and growth during a job when
sizing the volume. These are additional to the live file.

Illustrative arithmetic only: 1,000 current snapshots averaging 100 KiB occupy
about 98 MiB before history/images/indexes; 10,000 averaging 1 MiB occupy about
9.8 GiB before those additions. The second workload can hit recovery limits while
remaining tiny relative to SQLite's file ceiling. Neither example is a supported
document-count claim or an assumed real-world average.

Three current growth behaviors make counting visible documents insufficient:

- [Sync retention](../../src/server/sync/store.ts) nulls older before-images after
  the 128-revision/16-MiB reconciliation window, while preserving mutations and
  retry receipts for the surviving generation. That window does not cap the
  entire edit log.
- [History policy](../../src/server/history/policy.ts) retains named and
  before-restore checkpoints indefinitely. Unnamed checkpoints become less
  frequent with age, ending in daily buckets with no terminal expiration age.
- [Image storage](../../src/server/workspace/documents.ts) and
  [history handling](../../src/server/history/store.ts) deliberately retain image
  bytes that may still be referenced by old/offline content. The stored-image
  budget can be used by images no longer visible in the latest document.

The current backup transport caps an individual encrypted archive at **5 GiB**.
Compression makes that different from a 5 GiB database limit; image-heavy data
may compress poorly. [Backup staging](../../src/server/backup/archive.ts) checks
for **2.1 × logical database bytes + 256 MiB of available space** before starting,
with further headroom needed for growth/WAL and restoration. The 16-TiB engine
ceiling does not establish that today's full-snapshot backup can serve such a
database. SPN-063 must prove backup and verified restore at the supported size.

## 2. Total documents: current operation budgets arrive first

The application does not enforce one global maximum document count. Different
operations have different boundaries. Some data can exist in the database even
when an application operation refuses to process its entire catalog.

| Application area | Current safeguard/behavior | Capacity interpretation |
| --- | --- | --- |
| Native Sheet/Doc snapshot | **10 MiB serialized JSON**; see [sync types](../../lib/sync-server/src/types.ts) and [native validation](../../lib/sync-server/src/native.ts). | Per-document snapshot bound; separately stored image BLOBs are additional. |
| Image upload/storage | **5 MiB per image**, **16 million pixels**, **50 MiB stored images per document**, two concurrent decodes; see [documents](../../src/server/workspace/documents.ts). | Image bytes and decode memory can dominate a modest document catalog. |
| Ordinary Owner listing | **10,000 item/ancestor-read work budget**; returns a complete result or refuses with 413. See [ordinary scope](../../src/server/workspace/ordinary-scope.ts) and [workspace store](../../src/server/workspace/store.ts). | Includes folders/ancestry work; not a promise of 10,000 usable documents per instance. No pagination at this boundary. |
| Space membership | **10,000 members**, with bounded discovery/recovery reads; see [Space structure](../../src/server/workspace/space-structure.ts), [Spaces](../../src/server/workspace/spaces.ts) and [catalog](../../src/server/workspace/document-catalog.ts). | A separate per-Space bound; not a way to infer a supported instance total. |
| Native-model cache | **8 loaded units**, evicted by LRU/60-second idle policy; see [service](../../src/server/collaboration/service.ts) and [sync server](../../lib/sync-server/src/server.ts). | More documents can be stored/opened over time. A wider active working set can cause reload churn; eight is not a total document/user quota. |
| Version browsing/maintenance | History metadata is listed without pagination; bounded maintenance can refuse/skip excessive work. See [history store](../../src/server/history/store.ts). | Capacity must include long-lived data and maintenance, not just a fresh catalog. |

Portable imports have their own smaller structural limits in
[portable validation](../../src/server/workspace/portableValidation.ts), such as
worksheet/cell counts. Those are renderer/import safeguards, not SQLite limits.
Raising a safety constant without bounding the work and testing memory would not
constitute a scaling solution.

### Observed metadata experiment

This used real `AuthStore`, `WorkspaceStore` and Space-schema migration code, with
flat metadata records for one synthetic account. There were **no native snapshots,
images, history, assigned tags, appearance records, HTTP requests or active
editors**. Direct fixture insertion deliberately bypassed document creation to
isolate catalog behavior; 100,000 metadata rows do not mean 100,000 valid native
documents were created or opened.

| Metadata rows | Main database file after checkpoint | Three batches of 100 warm `get()` calls, ms | One warmed full-list sample |
| ---: | ---: | --- | --- |
| 1,000 | 540,672 B | 20.631 / 25.030 / 24.038 | **54.617 ms**, 1,000 items returned |
| 10,000 | 3,645,440 B | 28.172 / 23.332 / 19.202 | **843.349 ms**, 10,000 items returned |
| 100,000 | 35,074,048 B | 24.838 / 26.033 / 23.722 | **413 refusal** after 265.081 ms; no successful catalog result |

Adding exactly one ordinary item to the 10,000-row fixture also returned 413.
The flat fixtures establish that boundary; they do not cover deeper ancestry,
other owners, shared discovery or Space paths.

**Inference:** the measured indexed lookup path handles this increase in table
size without a comparable increase in its warm batch time. The current full-list
path is already costly at a much smaller catalog and refuses beyond its work
budget. Optimizing or paginating that path is the relevant growth work.

Three batch timings and one list timing are not tail-latency statistics. The
repeated timed keys sample a hot subset (IDs 1 through 9,604 at 100,000 rows),
not random whole-database or cold-cache reads. Do not invert them into supported
requests per second. The initial broader harness
exceeded its 512 MiB process-tree guard and was terminated without final results.
The reduced probe used explicit garbage collection between measurements and
completed at **281.2 MiB watched-tree / 208.7 MiB experiment-process peak RSS**.
This demonstrates a bounded local observation, not sustained-memory stability
or a production memory diagnosis. Both attempts are preserved in the
[experiment record](SPN-063-capacity-experiments.md).

## 3. Reads: no fixed operations-per-second quota

SQLite does not define a universal read-operations-per-second limit. Useful
throughput depends on query plans, bytes returned, cache/IO behavior and CPU work
after the database call. An indexed item lookup, a catalog-wide search and opening
a large spreadsheet are different workloads.

In this probe, the actual metadata lookup used the primary-key index. The Owner
list used `workspace_items_owner_kind` plus a temporary B-tree for the requested
case-insensitive name ordering. SQLite's [query planner](https://www.sqlite.org/queryplanner.html)
and [EXPLAIN QUERY PLAN](https://www.sqlite.org/eqp.html) references explain these
operations. A sort in a particular query plan is evidence to investigate, not
proof that an additional index alone solves the complete request.

The instrumented warm calls counted **six read statements for a metadata get**,
**2,004 for listing 1,000 items**, and **20,004 for 10,000 items**. These counts
exclude transaction-control statements and the instrumentation's EXPLAIN calls.
The list resolves scope and tags per item and creates complete result arrays.
[Search](../../src/server/workspace/search.ts) additionally constructs the full
accessible catalog and filters/sorts it in JavaScript. Shared discovery also
expands descendants and cleans placements. It is not a paginated SQL search.

The current [database wrapper](../../server/database.ts) performs synchronous
calls. List/search use [AuthStore transactions](../../src/server/auth/store.ts),
whose outer transaction starts `BEGIN IMMEDIATE`; much of this read-oriented work
therefore also reserves the writer. Native-model work and result materialization
occupy the main Node event loop. SQLite's ability to run readers on separate
connections does not parallelize those application operations.

When measurements require larger libraries, use bounded/paginated discovery,
batched lookups and query-plan-supported indexes. Preserve authorization and
snapshot consistency while shortening transactions. Measure full requests and
browser response as well as SQL duration. A remote database would retain the
application work and add network round trips to repeated queries.

## 4. Concurrency: connected people, active documents and writers differ

SQLite supports multiple read transactions on separate connections, but only
**one write transaction at a time per database file**. In WAL mode, readers can
continue alongside that writer. Short writes take turns, so this is compatible
with multiple people editing at the user level. See
[transactions](https://www.sqlite.org/lang_transaction.html) and
[WAL concurrency](https://www.sqlite.org/wal.html#concurrency).

There is no universal user count derivable from that rule. Capacity depends on
how often edits arrive and how much time each edit occupies the writer and main
thread. As arrival rate approaches service capacity, queues and latency grow.
An idle tab and an editor repeatedly mutating a large Sheet have very different
costs. Long read transactions can also delay checkpoints and grow the WAL; a
5-second busy timeout only bounds waiting for a lock, not writer overload.

Current application admission guards are concrete but are not performance SLOs:

| Guard | Scope | What it does not establish |
| --- | --- | --- |
| **64 WebSocket connections** | One server process; [transport](../../src/server/sync/transport.ts). | 64 distinct people or 64 active editors with acceptable latency. Tabs/devices/guest connections consume this allowance. |
| **8 pending frames per socket** | Queued inbound work; excess closes the socket. | Eight simultaneous editors per document. |
| **64 pending submissions** | Across native units in the [sync server](../../lib/sync-server/src/server.ts). | A sustained edits-per-second rate. |
| **64 KiB incoming frame**, **16 MiB buffered output** | Transport byte budgets. | The maximum saved document size; snapshot/reconnect behavior has separate constraints. |

Every accepted native edit also handles a complete current snapshot:
[storage load/commit](../../src/server/sync/store.ts) parses/serializes snapshots,
and the [native engine](../../lib/sync-server/src/native.ts) validates/applies
state. A small change to a large document can therefore cost much more than a
small SQL update. The synchronous commit contract preserves the final access and
revision checks; optimizations must retain those semantics.

The [existing recovery experiment](SPN-063-experiments.md) additionally showed
that `VACUUM INTO` blocks the event loop despite `backup()` being declared async.
The longest observed 64-MiB-payload copy was 157.812 ms in that narrow probe.
Representative editing, search, image uploads, maintenance and backup overlap
must be measured together before establishing a supported concurrency envelope.

## 5. Scaling path and evidence required before launch

Retain the backend and improve a measured bottleneck when necessary:

1. **Bound catalog work.** Add pagination/incremental traversal and batch repeated
   lookups when the current discovery budget or response latency becomes a real
   limit. Include complete access checks and stable pagination semantics.
2. **Control foreground pauses.** Measure native-model reloads, full-snapshot
   work, transaction scope and background scheduling. Isolate suitable copy and
   verification work in a bounded process using the supported SQLite runtime.
3. **Budget retained data and recovery.** Track file/WAL/history/image growth,
   free disk, encrypted archive size and verified recovery time. Test history-rich
   fixtures rather than extrapolating from metadata-only rows.
4. **Increase host resources when justified.** More CPU, RAM for the active
   working set and faster local storage can help within one-instance SQLite.
   Raising a resource/admission limit still requires the same workload checks.

These are contingent improvements, not extra implementation tasks completed by
this PR. Keeping SQLite does not require prematurely implementing all of them.

### Proposed measurement matrix

Choose numeric pass/fail budgets for foreground latency, recoverable loss, restore
time and resource headroom **before** running the next tests. Use the actual
1-GiB/0.75-CPU app constraints and planned host, with one heavy workload at a time
and an external watchdog. The following are test inputs, not support claims:

| Axis | Proposed progression | Decision it informs |
| --- | --- | --- |
| Real catalog | 100 → 1,000 → 5,000 → 9,999 ordinary items; separately 10,001; include folders, tags, sharing and Spaces. | Acceptable list/search/open latency and correct refusal/pagination behavior. |
| Real retained storage | 100 MiB → 1 GiB → 5 GiB of representative snapshots/images/history; record archive bytes separately. | Backup pause, disk high-water mark, transport limit and full verified RTO. |
| Active document working set | 1 → 2 → 8 → 16 documents, including same-document collaboration. | Model-cache churn versus edit/authorization costs. |
| Connections | Two-person baseline first; then 8/16/32 active synthetic tabs; separately exercise 64/65 admission. | Useful edit throughput and latency versus admission protection. |
| Document complexity | Everyday small files, approximately 1 MiB snapshots, selected near-10-MiB snapshots and images. | Parsing/model/full-snapshot amplification and browser/native constraints. |
| Overlap and age | Edit/read/search/upload during history jobs and backup; many edits/checkpoints; reconnect within/beyond retained reconciliation window. | Foreground interference, growth and recovery of long-lived work. |

Collect sample counts; p50/p95/p99/max end-to-end save acknowledgments and
open/search latency; queue/refusal/retry/lock-wait counts; event-loop delay; CPU;
process/container/host memory; WAL/checkpoint progress; disk/staging peaks; bytes
per accepted edit; backup duration and verified restore duration. Preserve access,
receipt, ordering and recovered-data correctness checks. Stop a tier on sustained
budget failure or resource pressure and record the outcome. A successful isolated
query benchmark cannot substitute for this workload.

### When to reopen the database decision

Reconsider only for a concrete requirement: sustained writer contention after
focused improvements, independently writable application instances on multiple
machines, or an availability/recovery objective the single-host architecture
cannot meet simply. That would require a fresh design decision and comparable
acceptance evidence; no database adapter framework is reserved or built now.

WAL requires suitable same-host storage; do not have multiple hosts open the
file over a network filesystem. More application processes also require shared
collaboration/presence/ownership coordination. A database with concurrent writers
would solve only part of that architecture. SQLite's
[appropriate-use guidance](https://www.sqlite.org/whentouse.html) supports its use
behind an application server and identifies write concurrency as a key reason
to consider a client/server engine.

Finally, preserve the main plan's
[runtime patch prerequisite](SPN-063.md#resources-concurrency-and-recovery-cost-are-part-of-correctness).
The reported fork version alone does not establish whether upstream WAL-reset
fixes are present. Verify the selected build before launch or introducing
concurrent worker/replication connections. This research observed no such
corruption; selecting SQLite does not select an unmaintained build forever.
