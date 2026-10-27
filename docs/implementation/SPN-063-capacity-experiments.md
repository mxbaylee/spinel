# SPN-063: reproducible metadata capacity probe

**Run:** 2026-10-27. **Purpose:** support the
[SQLite capacity writeup](SPN-063-capacity.md). This supplements the
[recovery probes](SPN-063-experiments.md); it does not certify supported document
counts, sustained throughput or concurrent-user capacity.

## Provenance, bounds and method

The source modules enumerated and hashed below are unchanged from
[`a9893ce3c72d0a707f97e4444f9b3f48a65dd226`](https://github.com/mxbaylee/spinel/commit/a9893ce3c72d0a707f97e4444f9b3f48a65dd226).
This uses the actual `AuthStore`, `WorkspaceStore`, Space schema and database
wrapper with Node 26.12.1, libsql 0.5.29 and reported SQLite 3.45.1. Environment:
Linux x64, kernel 6.18.55, local overlay filesystem. Dependencies were imported
from an existing locked installation without modifying it.

Fixtures contain flat ordinary Sheet/Doc metadata for one synthetic account.
They have no native snapshots, images, history, assigned tags or appearance
records. Direct metadata insertion intentionally bypasses native document
creation. Each dataset uses one connection in one process; no concurrent editors,
HTTP requests, browser work or external provider resources are involved.

- Three sequential batches of 100 `WorkspaceStore.get()` calls per size, with ten
  warm calls first. The repeated deterministic keys are `1 + (i * 97) % size`.
  At 100,000 rows they sample IDs 1 through 9,604, a **hot subset**, not random
  whole-database reads. A separate instrumented get checks the final ID.
- One instrumented full list warms each dataset; one uninstrumented timed list
  follows. Exactly one extra row tests the 10,000/10,001 refusal boundary.
- Statement instrumentation counts read calls/rows returned to JavaScript and
  captures real EXPLAIN plans. It excludes transaction-control `exec` and its own
  EXPLAIN calls. Returned rows are not SQLite scan counts or physical IO counts.
  A query can scan/sort many matches before its LIMIT.
- The timed calls restore the original `prepare` method. Explicit GC runs
  **between** measurements, outside timers. Caches remain warm; there is no
  cold-cache, steady-state memory, per-request percentile or throughput result.
- The process-tree watchdog has an unchanged 512 MiB cap and 60-second deadline,
  requires 3 GiB available host memory to begin and aborts below 1 GiB available.
  The fixture requires 1 GiB free staging space. The repository serial runner
  permits one heavy workload at a time. These are lab bounds, not target-host
  deployment resources. No reliable total elapsed time was recorded.

The main writeup contains the results table. The full original output below
records configuration, schema/indexes, source hashes, samples and query plans.
Indexed metadata lookup times remained similar in this warm, narrow workload;
the full list took 54.617 ms at 1,000 rows and 843.349 ms at 10,000. At 10,001 and
100,000 it refused with 413. The 265.081 ms at 100,000 measures refusal, not a
successful large-library listing. Do not derive supported QPS from these batches.

## Initial attempt and resource outcome

The first attempt used 50 warm gets, three 1,000-get batches and three timed lists
per dataset, without `--expose-gc`. The external guard terminated it at
**538,088 KiB watched-tree RSS**, beyond 512 MiB, and it produced no final result.
Its exact code/log are preserved below. It is a failed bounded attempt.

The successful revision reduced sampling and used GC between operations. The
guard remained unchanged: **287,940 KiB (281.2 MiB) watched-tree peak**,
**213,740 KiB (208.7 MiB) experiment-process peak**, `aborted: false`. The tree
includes the child; these memory figures must not be added. All synthetic
`run-*` databases from both attempts were removed. A killed process cannot rely
on its `finally` cleanup, so interrupted-run cleanup was checked separately.

The first abort motivates further bounded memory measurements; this evidence
does not establish a production leak or supported sustained workload.

| Artifact | SHA-256 |
| --- | --- |
| `capacity.ts` | `50dd12835a47dd9d812eaca22982df7d7304ae4ef919c9798c299480cfd4ca46` |
| `guard.ts` | `e1b7ce19e5201f69ca05f9c98e33ab150ccc894ad23f9d4bc2d16fa97a9c1dc5` |
| `results.json` | `5d27986b6bf334a46744faee2616ebb7970a8a005864269f2d2df5ee8f1cf778` |
| `guard.log` | `538136341c82e72d8f9ad339e64acb11d377c42fae4015d73c4b4b09177bbb25` |
| `aborted-capacity.ts` | `9a3fa3a7c8f754ec0df679e6c8d3de42b701425c493a442d44501a792f11761e` |
| `aborted-guard.log` | `a14c533e2f53ac0f6af93b323e88b24bf577462c5b69cb6ff451ba4959ea2d5c` |

## Reproduce

Use an empty sibling lab directory and a checkout at the source commit above with
its locked dependencies installed. Select Node 26.12.1 for every `node` invocation.
Save the code blocks below verbatim, including final newlines. On Linux:

```sh
SPN063_SOURCE=/absolute/path/to/spinel
SPN063_CAPACITY=/absolute/path/to/new-capacity-lab
mkdir -p "$SPN063_CAPACITY/source"
cd "$SPN063_SOURCE"
cp --parents \
  server/database.ts \
  src/server/auth/store.ts \
  src/server/workspace/store.ts \
  src/server/workspace/space-schema.ts \
  src/server/workspace/ordinary-scope.ts \
  src/server/appearance/data.ts \
  src/server/workspace/links.ts \
  src/server/workspace/space-scope.ts \
  src/server/workspace/guest-session.ts \
  src/shared/workspace.ts \
  src/shared/appearance.ts \
  src/shared/emoji.ts \
  src/profile/profile.ts \
  src/profile/person-icon-catalog.json \
  src/ui/palette.ts \
  "$SPN063_CAPACITY/source"
ln -s "$(realpath node_modules)" "$SPN063_CAPACITY/source/node_modules"
cd "$SPN063_CAPACITY"
node "$SPN063_SOURCE/scripts/serial.ts" \
  node guard.ts \
  node --expose-gc --max-old-space-size=192 capacity.ts \
  > results.json 2> guard.log
```

The symlink is only dependency resolution; it does not enforce read-only access.
The probe reads those files and runs no installer/patcher. Verify the listed
production-source hashes before attributing a rerun to this baseline.

For the initial attempt, the final invocation was
`node --max-old-space-size=192 capacity.ts`, with the initial code now preserved
as `aborted-capacity.ts`; there was no `--expose-gc`. It used the same guard and
serial runner. Reproduction does not require repeating that larger failed run.
The guard uses Linux `/proc`. On another OS, use the documented external
process-tree/memory-pressure equivalent and record the changed environment.

### Successful probe: capacity.ts

```typescript
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { platform, arch, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { openDatabase } from './source/server/database.ts';
import { AuthStore, AuthError } from './source/src/server/auth/store.ts';
import { WorkspaceStore } from './source/src/server/workspace/store.ts';
import { migrateSpaceSchema } from './source/src/server/workspace/space-schema.ts';
import { MAX_ANCESTOR_READS } from './source/src/server/workspace/ordinary-scope.ts';

const MiB = 1024 ** 2;
const sources = [
  'server/database.ts', 'src/server/auth/store.ts', 'src/server/workspace/store.ts',
  'src/server/workspace/space-schema.ts', 'src/server/workspace/ordinary-scope.ts',
  'src/server/appearance/data.ts', 'src/server/workspace/links.ts',
  'src/server/workspace/space-scope.ts', 'src/server/workspace/guest-session.ts',
  'src/shared/workspace.ts', 'src/shared/appearance.ts', 'src/shared/emoji.ts',
  'src/profile/profile.ts', 'src/profile/person-icon-catalog.json', 'src/ui/palette.ts',
];
const round = (value: number) => Number(value.toFixed(3));
const collect = async () => {
  (globalThis as { gc?: () => void }).gc?.();
  await new Promise<void>(resolve => setImmediate(resolve));
};
const root = mkdtempSync(join(import.meta.dirname, 'run-'));
const fs = statfsSync(root);
assert(fs.bavail * fs.bsize > 1024 * MiB, 'At least 1 GiB free required');
const output: Record<string, unknown> = {
  sourceCommit: 'a9893ce3c72d0a707f97e4444f9b3f48a65dd226',
  environment: { node: process.version, platform: platform(), arch: arch(), kernel: release(),
    libsql: JSON.parse(readFileSync(new URL('./source/node_modules/libsql/package.json', import.meta.url), 'utf8')).version },
  sourceSha256: Object.fromEntries(sources.map(path => [path,
    createHash('sha256').update(readFileSync(join(import.meta.dirname, 'source', path))).digest('hex')])),
  scope: 'Flat ordinary metadata only; no native snapshots, images, history, HTTP or browser. Warm local single-process measurements.',
  discoveryBudget: MAX_ANCESTOR_READS,
  measurementMethod: 'Three batches of 100 point gets; one timed list after an instrumented warm list; explicit GC only between operations, outside timers.',
};
type Value = string | number | bigint | Uint8Array | null;
type Summary = { statements: number; returnedSqlRows: number; plans: Record<string, unknown> };
const summaries = [];
try {
  for (const size of [1000, 10000, 100000]) {
    console.error(`Starting ${size} metadata rows`);
    const db = openDatabase(join(root, `metadata-${size}.sqlite`));
    try {
      const auth = new AuthStore(db);
      migrateSpaceSchema(db);
      const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
      const owner = auth.createUser('Synthetic owner');
      if (!output.pragmas) {
        output.pragmas = Object.fromEntries(['page_size', 'max_page_count', 'cache_size', 'mmap_size',
          'synchronous', 'busy_timeout', 'journal_mode', 'wal_autocheckpoint', 'foreign_keys', 'temp_store']
          .map(name => [name, db.prepare(`PRAGMA ${name}`).get()]));
        output.sqliteVersion = db.prepare('SELECT sqlite_version() AS version').get()!.version;
        output.compileOptions = db.prepare('PRAGMA compile_options').all()
          .map(row => row.compile_options).filter(value => /MAX_|DEFAULT_CACHE|DEFAULT_PAGE|THREADSAFE|ENABLE_FTS|ENABLE_JSON/.test(String(value)));
        output.itemSchema = db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE tbl_name='workspace_items' ORDER BY type,name").all();
        writeFileSync(join(import.meta.dirname, 'partial.json'), JSON.stringify(output, null, 2));
      }
      const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      const insert = db.prepare('INSERT INTO workspace_items(id,owner_id,parent_id,kind,name,created_at,updated_at) VALUES(?,?,NULL,?,?,?,?)');
      auth.transaction(() => {
        for (let i = 1; i <= size; i++) insert.run(id(i), owner.id, i % 2 ? 'sheet' : 'doc',
          `Document ${String(size - i).padStart(6, '0')}`, 1, 1);
      });
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      const databaseBytes = statSync(db.path).size;
      const original = db.prepare.bind(db);
      let active: Summary | undefined;
      db.prepare = (sql: string) => {
        const statement = original(sql);
        const note = (args: Value[], rowCount: number) => {
          if (!active) return;
          active.statements++;
          active.returnedSqlRows += rowCount;
          const kind = sql.includes("'owner' AS access FROM workspace_items") ? 'ownerListing'
            : sql.startsWith('SELECT id,parent_id AS parentId') && sql.endsWith('WHERE id=?') ? 'pointMetadata' : undefined;
          if (kind && !active.plans[kind]) active.plans[kind] = {
            sql, plan: original('EXPLAIN QUERY PLAN ' + sql).all(...args),
          };
        };
        return { ...statement,
          get: (...args: Value[]) => { const value = statement.get(...args); note(args, value ? 1 : 0); return value; },
          all: (...args: Value[]) => { const value = statement.all(...args); note(args, value.length); return value; },
        };
      };
      const tracedPrepare = db.prepare;
      active = { statements: 0, returnedSqlRows: 0, plans: {} };
      assert.equal(workspace.get(owner.id, id(size)).id, id(size));
      const pointWork = active;
      active = undefined;
      db.prepare = original;
      for (let i = 0; i < 10; i++) workspace.get(owner.id, id(1 + (i * 97) % size));
      await collect();
      const getBatches = [];
      for (let batch = 0; batch < 3; batch++) {
        const start = performance.now();
        for (let i = 0; i < 100; i++) workspace.get(owner.id, id(1 + (i * 97) % size));
        getBatches.push(round(performance.now() - start));
        await collect();
      }
      const list = () => {
        try { return { rows: workspace.list(owner.id).length, status: 200 }; }
        catch (error) {
          if (!(error instanceof AuthError)) throw error;
          return { status: error.status, error: error.message };
        }
      };
      db.prepare = tracedPrepare;
      active = { statements: 0, returnedSqlRows: 0, plans: {} };
      const warmList = list();
      const listWork = active;
      active = undefined;
      db.prepare = original;
      await collect();
      if (size <= MAX_ANCESTOR_READS) assert.equal(warmList.rows, size);
      else assert.equal(warmList.status, 413);
      const listSamples = [];
      for (let trial = 0; trial < 1; trial++) {
        const start = performance.now();
        const outcome = list();
        listSamples.push({ ...outcome, ms: round(performance.now() - start) });
        await collect();
      }
      let boundary: unknown;
      if (size === MAX_ANCESTOR_READS) {
        insert.run(id(size + 1), owner.id, 'sheet', 'One more metadata item', 1, 1);
        boundary = list();
        assert.equal((boundary as { status: number }).status, 413);
      }
      summaries.push({ metadataRows: size, databaseBytes,
        pointGetBatchOperations: 100, pointGetBatchMs: getBatches, pointWork, listWork,
        listSamples, ...(boundary ? { oneAdditionalRow: boundary } : {}),
        rssMiBAtEnd: round(process.memoryUsage().rss / MiB) });
      output.samples = summaries;
      writeFileSync(join(import.meta.dirname, 'partial.json'), JSON.stringify(output, null, 2));
      console.error(`Completed ${size} metadata rows`);
    } finally { db.close(); }
    await collect();
  }
  output.samples = summaries;
  output.processMaxRssKiB = process.resourceUsage().maxRSS;
} finally { rmSync(root, { recursive: true, force: true }); }
console.log(JSON.stringify(output, null, 2));
```

### External watchdog: guard.ts

```typescript
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

const available = () => Number(/MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1] ?? 0);
if (available() < 3 * 1024 * 1024) throw new Error('Less than 3 GiB available; defer experiment.');
const [command, ...args] = process.argv.slice(2);
const child = spawn(command, args, { stdio: 'inherit', detached: true });
const hostPid = Number(readFileSync('/proc/self/stat', 'utf8').split(' ')[0]);
let peakKiB = 0;
let aborted = false;
let owned: number[] = [];
const abort = (reason: string) => {
  if (aborted) return;
  aborted = true;
  console.error(reason);
  for (const pid of owned.toReversed()) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  try { process.kill(-child.pid!, 'SIGKILL'); } catch {}
};
const timer = setInterval(() => {
  const rows: Array<{ pid: number; parent: number; rssKiB: number; localPid: number }> = [];
  for (const pid of readdirSync('/proc').filter(value => /^\d+$/.test(value))) {
    try {
      const parts = readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /, '').split(' ');
      const status = readFileSync(`/proc/${pid}/status`, 'utf8');
      rows.push({ pid: Number(pid), parent: Number(parts[1]),
        rssKiB: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0),
        localPid: Number(/^NSpid:\s+(.+)$/m.exec(status)?.[1].trim().split(/\s+/).at(-1) ?? pid) });
    } catch {}
  }
  const descendants = new Set([hostPid]);
  for (let more = true; more;) {
    more = false;
    for (const row of rows) if (descendants.has(row.parent) && !descendants.has(row.pid)) {
      descendants.add(row.pid); more = true;
    }
  }
  owned = rows.filter(row => row.pid !== hostPid && descendants.has(row.pid)).map(row => row.localPid);
  const rss = rows.filter(row => descendants.has(row.pid)).reduce((sum, row) => sum + row.rssKiB, 0);
  peakKiB = Math.max(peakKiB, rss);
  if (rss > 512 * 1024 || available() < 1024 * 1024) abort('Resource limit exceeded.');
}, 100);
const timeout = setTimeout(() => abort('Experiment exceeded 60 seconds.'), 60_000);
child.on('error', error => { console.error(error); abort('Child failed.'); });
child.on('close', code => {
  clearInterval(timer); clearTimeout(timeout);
  console.error(JSON.stringify({ watchdogPeakKiB: peakKiB, aborted }));
  process.exitCode = aborted ? 125 : (code ?? 1);
});
```

### Original complete results: results.json

```json
{
  "sourceCommit": "a9893ce3c72d0a707f97e4444f9b3f48a65dd226",
  "environment": {
    "node": "v26.12.1",
    "platform": "linux",
    "arch": "x64",
    "kernel": "6.18.55",
    "libsql": "0.5.29"
  },
  "sourceSha256": {
    "server/database.ts": "cd1e5921e3ee0bb5981c70d166680c438581c7f03545c81df13b7d7feb524903",
    "src/server/auth/store.ts": "685ce48e89ec1dc8377846d43fc8f5c35c70b3a56ca1420405fd857fc358fedf",
    "src/server/workspace/store.ts": "afc74277890a7508cd1a58297a7cfca3e1cd2b1927d0307f09093e0aae1ae68e",
    "src/server/workspace/space-schema.ts": "0e4d955a041051a322ecde2620c558c7b70655b4fd1a02a6f9405c878b12499b",
    "src/server/workspace/ordinary-scope.ts": "7d88dd7476791c8fc0aee2d15f8e2f49e2c2288632b0510b18805735a2e2b50c",
    "src/server/appearance/data.ts": "3a77bf807af16eeef72d65e3eab0caa49e46cb90ceb7a2d6f82448da2aeb47cf",
    "src/server/workspace/links.ts": "e64171f8d3a35e7c895bd47521963abf8b6cc9734a205e7adbb094cdd9aa56a4",
    "src/server/workspace/space-scope.ts": "3bb37289e2221f35f762e1c205135fa0a6809a946a824255f779aaaaa649de0a",
    "src/server/workspace/guest-session.ts": "b4cce5ae2bae4501461870227518bffc94e30618bb2360f70d447f32d7995f19",
    "src/shared/workspace.ts": "89eec6d4ada5b17229325bfb460a121d6b1c047a45d1c018b74c5444ee394c99",
    "src/shared/appearance.ts": "9a564a52c4c83ed660b58f79b5701855877f23975bd6703aec0b59038ce00e94",
    "src/shared/emoji.ts": "76f594702bd3f5237e5eb6895e001dea5fd02a4c7004bb4ce14156b64148dbb0",
    "src/profile/profile.ts": "1d7cf6d4f357a738d2e8beff4487d64e11131bfde1df2b69881732a0c53b9162",
    "src/profile/person-icon-catalog.json": "f32357697bcf946ceb177b5c2cadba53ca613102b0207c9693a4dfe248bf8b58",
    "src/ui/palette.ts": "ce27ba0d6aef260b0d74658c99c0ce517437b513a3de7920157cffedfba9499a"
  },
  "scope": "Flat ordinary metadata only; no native snapshots, images, history, HTTP or browser. Warm local single-process measurements.",
  "discoveryBudget": 10000,
  "measurementMethod": "Three batches of 100 point gets; one timed list after an instrumented warm list; explicit GC only between operations, outside timers.",
  "pragmas": {
    "page_size": {
      "page_size": 4096
    },
    "max_page_count": {
      "max_page_count": 4294967294
    },
    "cache_size": {
      "cache_size": -2000
    },
    "mmap_size": {
      "mmap_size": 0
    },
    "synchronous": {
      "synchronous": 2
    },
    "busy_timeout": {
      "timeout": 5000
    },
    "journal_mode": {
      "journal_mode": "wal"
    },
    "wal_autocheckpoint": {
      "wal_autocheckpoint": 1000
    },
    "foreign_keys": {
      "foreign_keys": 1
    },
    "temp_store": {
      "temp_store": 0
    }
  },
  "sqliteVersion": "3.45.1",
  "compileOptions": [
    "DEFAULT_CACHE_SIZE=-2000",
    "DEFAULT_PAGE_SIZE=4096",
    "ENABLE_FTS3",
    "ENABLE_FTS3_PARENTHESIS",
    "ENABLE_FTS4",
    "ENABLE_FTS5",
    "MAX_ATTACHED=10",
    "MAX_COLUMN=2000",
    "MAX_COMPOUND_SELECT=500",
    "MAX_DEFAULT_PAGE_SIZE=8192",
    "MAX_EXPR_DEPTH=1000",
    "MAX_FUNCTION_ARG=127",
    "MAX_LENGTH=1000000000",
    "MAX_LIKE_PATTERN_LENGTH=50000",
    "MAX_MMAP_SIZE=0x7fff0000",
    "MAX_PAGE_COUNT=0xfffffffe",
    "MAX_PAGE_SIZE=65536",
    "MAX_SQL_LENGTH=1000000000",
    "MAX_TRIGGER_DEPTH=1000",
    "MAX_VARIABLE_NUMBER=32766",
    "MAX_VDBE_OP=250000000",
    "MAX_WORKER_THREADS=8",
    "THREADSAFE=1"
  ],
  "itemSchema": [
    {
      "type": "index",
      "name": "sqlite_autoindex_workspace_items_1",
      "sql": null
    },
    {
      "type": "index",
      "name": "workspace_items_owner_kind",
      "sql": "CREATE INDEX workspace_items_owner_kind\n        ON workspace_items(owner_id,kind,space_id,trashed_at)"
    },
    {
      "type": "index",
      "name": "workspace_items_owner_parent",
      "sql": "CREATE INDEX workspace_items_owner_parent ON workspace_items(owner_id,parent_id)"
    },
    {
      "type": "index",
      "name": "workspace_items_parent",
      "sql": "CREATE INDEX workspace_items_parent ON workspace_items(parent_id)"
    },
    {
      "type": "index",
      "name": "workspace_items_space_parent_position",
      "sql": "CREATE INDEX workspace_items_space_parent_position\n        ON workspace_items(space_id,parent_id,space_position,id)"
    },
    {
      "type": "index",
      "name": "workspace_items_trash",
      "sql": "CREATE INDEX workspace_items_trash ON workspace_items(trashed_at)"
    },
    {
      "type": "index",
      "name": "workspace_space_discovery_children",
      "sql": "CREATE INDEX workspace_space_discovery_children\n        ON workspace_items(owner_id,parent_id)\n        WHERE space_id IS NULL AND space_position IS NULL AND trashed_at IS NULL\n          AND trash_batch IS NULL AND kind IN ('folder','space')"
    },
    {
      "type": "table",
      "name": "workspace_items",
      "sql": "CREATE TABLE workspace_items (\n    id TEXT PRIMARY KEY,\n    owner_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,\n    parent_id TEXT REFERENCES workspace_items(id) ON DELETE RESTRICT,\n    kind TEXT NOT NULL CHECK(kind IN ('folder','sheet','doc','space')),\n    name TEXT NOT NULL,\n    created_at INTEGER NOT NULL,\n    updated_at INTEGER NOT NULL,\n    trashed_at INTEGER,\n    trash_batch TEXT,\n    space_id TEXT REFERENCES workspace_items(id) ON DELETE RESTRICT,\n    space_position INTEGER,\n    CHECK (\n      (space_id IS NULL AND space_position IS NULL) OR\n      (space_id IS NOT NULL AND space_position IS NOT NULL AND space_id<>id\n        AND kind IN ('folder','sheet','doc')\n        AND space_position BETWEEN 0 AND 9007199254740991)\n    )\n  ) STRICT"
    }
  ],
  "samples": [
    {
      "metadataRows": 1000,
      "databaseBytes": 540672,
      "pointGetBatchOperations": 100,
      "pointGetBatchMs": [
        20.631,
        25.03,
        24.038
      ],
      "pointWork": {
        "statements": 6,
        "returnedSqlRows": 4,
        "plans": {
          "pointMetadata": {
            "sql": "SELECT id,parent_id AS parentId,kind,name,created_at AS createdAt,updated_at AS updatedAt FROM workspace_items WHERE id=?",
            "plan": [
              {
                "id": 3,
                "parent": 0,
                "notused": 0,
                "detail": "SEARCH workspace_items USING INDEX sqlite_autoindex_workspace_items_1 (id=?)"
              }
            ]
          }
        }
      },
      "listWork": {
        "statements": 2004,
        "returnedSqlRows": 2012,
        "plans": {
          "ownerListing": {
            "sql": "SELECT id,parent_id AS parentId,kind,name,created_at AS createdAt,updated_at AS updatedAt, 'owner' AS access FROM workspace_items\n           WHERE owner_id=? AND trashed_at IS NULL\n             AND kind IN (?,?,?) AND space_id IS NULL AND space_position IS NULL\n           ORDER BY name COLLATE NOCASE,id LIMIT ?",
            "plan": [
              {
                "id": 7,
                "parent": 0,
                "notused": 0,
                "detail": "SEARCH workspace_items USING INDEX workspace_items_owner_kind (owner_id=? AND kind=? AND space_id=? AND trashed_at=?)"
              },
              {
                "id": 55,
                "parent": 0,
                "notused": 0,
                "detail": "USE TEMP B-TREE FOR ORDER BY"
              }
            ]
          }
        }
      },
      "listSamples": [
        {
          "rows": 1000,
          "status": 200,
          "ms": 54.617
        }
      ],
      "rssMiBAtEnd": 108.824
    },
    {
      "metadataRows": 10000,
      "databaseBytes": 3645440,
      "pointGetBatchOperations": 100,
      "pointGetBatchMs": [
        28.172,
        23.332,
        19.202
      ],
      "pointWork": {
        "statements": 6,
        "returnedSqlRows": 4,
        "plans": {
          "pointMetadata": {
            "sql": "SELECT id,parent_id AS parentId,kind,name,created_at AS createdAt,updated_at AS updatedAt FROM workspace_items WHERE id=?",
            "plan": [
              {
                "id": 3,
                "parent": 0,
                "notused": 0,
                "detail": "SEARCH workspace_items USING INDEX sqlite_autoindex_workspace_items_1 (id=?)"
              }
            ]
          }
        }
      },
      "listWork": {
        "statements": 20004,
        "returnedSqlRows": 20012,
        "plans": {
          "ownerListing": {
            "sql": "SELECT id,parent_id AS parentId,kind,name,created_at AS createdAt,updated_at AS updatedAt, 'owner' AS access FROM workspace_items\n           WHERE owner_id=? AND trashed_at IS NULL\n             AND kind IN (?,?,?) AND space_id IS NULL AND space_position IS NULL\n           ORDER BY name COLLATE NOCASE,id LIMIT ?",
            "plan": [
              {
                "id": 7,
                "parent": 0,
                "notused": 0,
                "detail": "SEARCH workspace_items USING INDEX workspace_items_owner_kind (owner_id=? AND kind=? AND space_id=? AND trashed_at=?)"
              },
              {
                "id": 55,
                "parent": 0,
                "notused": 0,
                "detail": "USE TEMP B-TREE FOR ORDER BY"
              }
            ]
          }
        }
      },
      "listSamples": [
        {
          "rows": 10000,
          "status": 200,
          "ms": 843.349
        }
      ],
      "oneAdditionalRow": {
        "status": 413,
        "error": "This item list is too large to process at once."
      },
      "rssMiBAtEnd": 197.73
    },
    {
      "metadataRows": 100000,
      "databaseBytes": 35074048,
      "pointGetBatchOperations": 100,
      "pointGetBatchMs": [
        24.838,
        26.033,
        23.722
      ],
      "pointWork": {
        "statements": 6,
        "returnedSqlRows": 4,
        "plans": {
          "pointMetadata": {
            "sql": "SELECT id,parent_id AS parentId,kind,name,created_at AS createdAt,updated_at AS updatedAt FROM workspace_items WHERE id=?",
            "plan": [
              {
                "id": 3,
                "parent": 0,
                "notused": 0,
                "detail": "SEARCH workspace_items USING INDEX sqlite_autoindex_workspace_items_1 (id=?)"
              }
            ]
          }
        }
      },
      "listWork": {
        "statements": 3,
        "returnedSqlRows": 10013,
        "plans": {
          "ownerListing": {
            "sql": "SELECT id,parent_id AS parentId,kind,name,created_at AS createdAt,updated_at AS updatedAt, 'owner' AS access FROM workspace_items\n           WHERE owner_id=? AND trashed_at IS NULL\n             AND kind IN (?,?,?) AND space_id IS NULL AND space_position IS NULL\n           ORDER BY name COLLATE NOCASE,id LIMIT ?",
            "plan": [
              {
                "id": 7,
                "parent": 0,
                "notused": 0,
                "detail": "SEARCH workspace_items USING INDEX workspace_items_owner_kind (owner_id=? AND kind=? AND space_id=? AND trashed_at=?)"
              },
              {
                "id": 55,
                "parent": 0,
                "notused": 0,
                "detail": "USE TEMP B-TREE FOR ORDER BY"
              }
            ]
          }
        }
      },
      "listSamples": [
        {
          "status": 413,
          "error": "This item list is too large to process at once.",
          "ms": 265.081
        }
      ],
      "rssMiBAtEnd": 208.73
    }
  ],
  "processMaxRssKiB": 213740
}
```

### Successful guard output: guard.log

```text
Starting 1000 metadata rows
Completed 1000 metadata rows
Starting 10000 metadata rows
Completed 10000 metadata rows
Starting 100000 metadata rows
Completed 100000 metadata rows
{"watchdogPeakKiB":287940,"aborted":false}
```

### Initial resource-aborted probe: aborted-capacity.ts

```typescript
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statfsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { platform, arch, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { openDatabase } from './source/server/database.ts';
import { AuthStore, AuthError } from './source/src/server/auth/store.ts';
import { WorkspaceStore } from './source/src/server/workspace/store.ts';
import { migrateSpaceSchema } from './source/src/server/workspace/space-schema.ts';
import { MAX_ANCESTOR_READS } from './source/src/server/workspace/ordinary-scope.ts';

const MiB = 1024 ** 2;
const sources = [
  'server/database.ts', 'src/server/auth/store.ts', 'src/server/workspace/store.ts',
  'src/server/workspace/space-schema.ts', 'src/server/workspace/ordinary-scope.ts',
  'src/server/appearance/data.ts', 'src/server/workspace/links.ts',
  'src/server/workspace/space-scope.ts', 'src/server/workspace/guest-session.ts',
  'src/shared/workspace.ts', 'src/shared/appearance.ts', 'src/shared/emoji.ts',
  'src/profile/profile.ts', 'src/profile/person-icon-catalog.json', 'src/ui/palette.ts',
];
const round = (value: number) => Number(value.toFixed(3));
const root = mkdtempSync(join(import.meta.dirname, 'run-'));
const fs = statfsSync(root);
assert(fs.bavail * fs.bsize > 1024 * MiB, 'At least 1 GiB free required');
const output: Record<string, unknown> = {
  sourceCommit: 'a9893ce3c72d0a707f97e4444f9b3f48a65dd226',
  environment: { node: process.version, platform: platform(), arch: arch(), kernel: release(),
    libsql: JSON.parse(readFileSync(new URL('./source/node_modules/libsql/package.json', import.meta.url), 'utf8')).version },
  sourceSha256: Object.fromEntries(sources.map(path => [path,
    createHash('sha256').update(readFileSync(join(import.meta.dirname, 'source', path))).digest('hex')])),
  scope: 'Flat ordinary metadata only; no native snapshots, images, history, HTTP or browser. Warm local single-process measurements.',
  discoveryBudget: MAX_ANCESTOR_READS,
};
type Value = string | number | bigint | Uint8Array | null;
type Summary = { statements: number; returnedSqlRows: number; plans: Record<string, unknown> };
const summaries = [];
try {
  for (const size of [1000, 10000, 100000]) {
    const db = openDatabase(join(root, `metadata-${size}.sqlite`));
    try {
      const auth = new AuthStore(db);
      migrateSpaceSchema(db);
      const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
      const owner = auth.createUser('Synthetic owner');
      if (!output.pragmas) {
        output.pragmas = Object.fromEntries(['page_size', 'max_page_count', 'cache_size', 'mmap_size',
          'synchronous', 'busy_timeout', 'journal_mode', 'wal_autocheckpoint', 'foreign_keys', 'temp_store']
          .map(name => [name, db.prepare(`PRAGMA ${name}`).get()]));
        output.sqliteVersion = db.prepare('SELECT sqlite_version() AS version').get()!.version;
        output.compileOptions = db.prepare('PRAGMA compile_options').all()
          .map(row => row.compile_options).filter(value => /MAX_|DEFAULT_CACHE|DEFAULT_PAGE|THREADSAFE|ENABLE_FTS|ENABLE_JSON/.test(String(value)));
        output.itemSchema = db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE tbl_name='workspace_items' ORDER BY type,name").all();
      }
      const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      const insert = db.prepare('INSERT INTO workspace_items(id,owner_id,parent_id,kind,name,created_at,updated_at) VALUES(?,?,NULL,?,?,?,?)');
      auth.transaction(() => {
        for (let i = 1; i <= size; i++) insert.run(id(i), owner.id, i % 2 ? 'sheet' : 'doc',
          `Document ${String(size - i).padStart(6, '0')}`, 1, 1);
      });
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      const databaseBytes = statSync(db.path).size;
      const original = db.prepare.bind(db);
      let active: Summary | undefined;
      db.prepare = (sql: string) => {
        const statement = original(sql);
        const note = (args: Value[], rowCount: number) => {
          if (!active) return;
          active.statements++;
          active.returnedSqlRows += rowCount;
          const kind = sql.includes("'owner' AS access FROM workspace_items") ? 'ownerListing'
            : sql.startsWith('SELECT id,parent_id AS parentId') && sql.endsWith('WHERE id=?') ? 'pointMetadata' : undefined;
          if (kind && !active.plans[kind]) active.plans[kind] = {
            sql, plan: original('EXPLAIN QUERY PLAN ' + sql).all(...args),
          };
        };
        return { ...statement,
          get: (...args: Value[]) => { const value = statement.get(...args); note(args, value ? 1 : 0); return value; },
          all: (...args: Value[]) => { const value = statement.all(...args); note(args, value.length); return value; },
        };
      };
      const tracedPrepare = db.prepare;
      active = { statements: 0, returnedSqlRows: 0, plans: {} };
      assert.equal(workspace.get(owner.id, id(size)).id, id(size));
      const pointWork = active;
      active = undefined;
      db.prepare = original;
      for (let i = 0; i < 50; i++) workspace.get(owner.id, id(1 + (i * 97) % size));
      const getBatches = [];
      for (let batch = 0; batch < 3; batch++) {
        const start = performance.now();
        for (let i = 0; i < 1000; i++) workspace.get(owner.id, id(1 + (i * 97) % size));
        getBatches.push(round(performance.now() - start));
      }
      const list = () => {
        try { return { rows: workspace.list(owner.id).length, status: 200 }; }
        catch (error) {
          if (!(error instanceof AuthError)) throw error;
          return { status: error.status, error: error.message };
        }
      };
      db.prepare = tracedPrepare;
      active = { statements: 0, returnedSqlRows: 0, plans: {} };
      const warmList = list();
      const listWork = active;
      active = undefined;
      db.prepare = original;
      if (size <= MAX_ANCESTOR_READS) assert.equal(warmList.rows, size);
      else assert.equal(warmList.status, 413);
      const listSamples = [];
      for (let trial = 0; trial < 3; trial++) {
        const start = performance.now();
        const outcome = list();
        listSamples.push({ ...outcome, ms: round(performance.now() - start) });
      }
      let boundary: unknown;
      if (size === MAX_ANCESTOR_READS) {
        insert.run(id(size + 1), owner.id, 'sheet', 'One more metadata item', 1, 1);
        boundary = list();
        assert.equal((boundary as { status: number }).status, 413);
      }
      summaries.push({ metadataRows: size, databaseBytes,
        pointGetBatchOperations: 1000, pointGetBatchMs: getBatches, pointWork, listWork,
        listSamples, ...(boundary ? { oneAdditionalRow: boundary } : {}),
        rssMiBAtEnd: round(process.memoryUsage().rss / MiB) });
    } finally { db.close(); }
  }
  output.samples = summaries;
  output.processMaxRssKiB = process.resourceUsage().maxRSS;
} finally { rmSync(root, { recursive: true, force: true }); }
console.log(JSON.stringify(output, null, 2));
```

### Initial guard output: aborted-guard.log

```text
Resource limit exceeded.
{"watchdogPeakKiB":538088,"aborted":true}
```
