# SPN-063: reproducible local storage probes

**Run:** 2026-10-27. **Purpose:** inform the
[storage/recovery implementation plan](SPN-063.md), not certify production or
complete SPN-063. Synthetic fixtures only; no provisioned cloud resources,
production data, exported credentials or tracked runtime changes.

## Provenance and bounds

The probes ran unchanged copies of `server/database.ts` and
`src/server/backup/archive.ts` at
[`a9893ce3c72d0a707f97e4444f9b3f48a65dd226`](https://github.com/mxbaylee/spinel/commit/a9893ce3c72d0a707f97e4444f9b3f48a65dd226).
The semantic fixture extracts the exact `spinel_sync_units` table definition from
that commit's `src/server/sync/store.ts`. This avoids substituting another SQLite
implementation for the one Spinel actually uses.

| Item | Observed value or enforced bound |
| --- | --- |
| Node | 26.12.1, matching the repository pin |
| Driver | `libsql` 0.5.29, matching the lockfile; existing dependency directory reused read-only |
| Embedded SQLite | 3.45.1; `PRAGMA synchronous = 2` (FULL) |
| Environment | Linux x64, kernel 6.18.55, local overlay filesystem |
| Samples | Three sequential copies per 1 / 16 / 64 MiB payload; no concurrent clients |
| Free-space preflight | At least 1 GiB available in disposable staging |
| Memory guard | At least 3 GiB host available before start; abort if available memory falls below 1 GiB or watched tree exceeds 512 MiB |
| Runtime guard | External 60-second deadline; one workload under the repository serial runner |
| Measured process peak | 108,468 KiB = 105.9 MiB |
| Measured watched-tree peak | 180,240 KiB = 176.0 MiB; not an addition to the process figure |
| Guard result | `aborted: false`; successful exit |
| Cleanup | Every `run-*` fixture directory removed in `finally`; output copies removed between timing samples |

The actual engine version is evidence, not proof of upstream patch coverage.
Verify the libSQL build's fix provenance for SQLite's
[WAL-reset bug](https://sqlite.org/wal.html#the_wal_reset_bug) before launch or
adding concurrent worker/replication connections; see the plan. The probes did
not exercise that race or establish fork patch status.

| Artifact | SHA-256 |
| --- | --- |
| `server/database.ts` | `cd1e5921e3ee0bb5981c70d166680c438581c7f03545c81df13b7d7feb524903` |
| `src/server/backup/archive.ts` | `36edc1503eec00c0efc2688cffd72f5805df4fd4e325c273a537f84244d58662` |
| `src/server/sync/store.ts` | `bca9df7706577dcaba00b0c25a22ddaa90d080c08feb9a6985e1ec71bb14f83b` |
| `probe.ts` below | `ab50a8e5cb39a7a670f43fb83b89b6fe9328f8b1f2bd0ee08095e059262894b5` |
| `guard.ts` below | `e1b7ce19e5201f69ca05f9c98e33ab150ccc894ad23f9d4bc2d16fa97a9c1dc5` |
| Original `results.json` below | `f073bdf920f7a8818693e2c48d8e872da1720e1f06c58b0f0117ade09baa5830` |

## Results and interpretation

### 1. An apparently healthy raw copy can omit committed work

The fixture creates and checkpoints the schema, disables automatic checkpoints,
commits a sentinel into the live WAL, and copies only the main database file while
its connection remains open. It separately calls production `backup()`.

| Source/copy | Sentinel rows | Production integrity/FK check |
| --- | ---: | --- |
| Live source | 1 | — |
| Raw main-file copy without WAL | 0 | Passed |
| Production `VACUUM INTO` snapshot | 1 | Passed |

The main file was 8,192 bytes and WAL was 4,152 bytes. The current consistent
snapshot handled this case correctly. “One file” portability requires a safe
snapshot or shutdown/checkpoint procedure; file readability and structural
integrity do not establish completeness. This is a controlled example, not a
claim every raw copy necessarily loses data.

### 2. Synchronous copy blocks the event loop

The fixture inserts 64 KiB blob rows, checkpoints, then schedules a zero-delay
timer immediately before each call to production `backup()`. It validates every
copy's integrity and expected row count. This measures the copy call only.

| Payload | Actual DB MiB | Copy samples, ms | Median copy, ms | Timer-delay samples, ms |
| --- | ---: | --- | ---: | --- |
| 1 MiB | 1.016 | 4.002, 4.088, 5.068 | 4.088 | 4.083, 4.130, 5.102 |
| 16 MiB | 16.133 | 27.836, 33.820, 74.473 | 33.820 | 27.902, 33.943, 74.562 |
| 64 MiB | 64.508 | 83.915, 82.082, 157.812 | 83.915 | 92.711, 82.137, 157.903 |

The asynchronous function declaration does not make its synchronous database call
nonblocking. Timers on that loop cannot run while the copy executes. The variation
also makes it inappropriate to extrapolate linearly from these samples to large
databases or slower disks.

**Limitations:** three samples per size; repeated reads may benefit from cache;
synthetic blob rows reuse one random payload per dataset; no document workload,
foreground clients, contention, full-archive compression/upload, production
hardware or PostgreSQL comparison. These are not p95/p99, RTO or capacity SLOs.
The next useful measurement is real edit/ack latency during backup and verification
with realistic history and images on the selected deployment hardware.

### 3. Structural recovery is not semantic recovery

The exact current sync-unit schema accepts snapshot text without validating its
JSON or native identity. The probe supplies a valid row and two deliberately
faulty source rows, then calls real `makeArchive()` and `restoreArchive()`.

| Source fixture | Archive restored | Integrity/FKs | Rows | JSON valid | Snapshot identity matches unit |
| --- | --- | --- | ---: | --- | --- |
| Valid | Yes | Passed | 1 | Yes | Yes |
| Invalid JSON | Yes | Passed | 1 | No | No |
| Wrong snapshot ID | Yes | Passed | 1 | Yes | No |

Restored snapshot text exactly matched the source in each case. A separate narrow
JSON/identity predicate rejected the two injected faults. Encryption worked as
intended: there was no ciphertext modification or authentication bypass. Hashes
and counts can faithfully preserve already-invalid application state. SPN-063
therefore needs domain assertions as well as snapshot-fidelity checks. This
fixture is not a complete native Sheet/Doc or role-authorization test.

## Reproduce

Use a disposable checkout of the source commit above named `spinel`, with its
locked dependencies available and **Node 26.12.1** selected. Keep the sibling lab
directory outside the checkout. These commands do not touch an ordinary Spinel
database. Save the following two TypeScript blocks exactly as `probe.ts` and
`guard.ts` in `spn063-lab` (including the final newline).

```sh
mkdir -p spn063-lab/source/server spn063-lab/source/src/server/backup
cp spinel/server/database.ts spn063-lab/source/server/database.ts
cp spinel/src/server/backup/archive.ts spn063-lab/source/src/server/backup/archive.ts
ln -s "$(realpath spinel/node_modules)" spn063-lab/source/node_modules
cd spn063-lab
node ../spinel/scripts/serial.ts node guard.ts node --max-old-space-size=128 probe.ts > results.json 2> guard.log
```

Check source hashes and the printed driver/runtime before comparing results.
Measured timings and process peaks vary; structural outcomes/assertions should
remain the same. The probe labels the baseline commit but does not verify a Git
checkout for you. Do not run it against modified sources and report baseline
results. The `source/node_modules` symlink is a read-only dependency reuse, not a
second SQLite runtime loaded into the process.

The guard reads Linux `/proc` and is specific to that environment. On macOS use
the repository's documented memory-pressure and process-tree watchdog equivalent.
No timeout/memory-aborted run counts as passing. A forced kill cannot execute the
probe's `finally`; after confirming no owned workload remains, remove only that
lab's abandoned `run-*` directory. All fixtures and keys here are synthetic;
real restore staging still requires encrypted private storage.

### probe.ts

```ts
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statfsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { platform, arch, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { DatabaseSync, backup, openDatabase } from './source/server/database.ts';
import { checkDatabase, makeArchive, restoreArchive } from './source/src/server/backup/archive.ts';

const base = 'a9893ce3c72d0a707f97e4444f9b3f48a65dd226';
const MiB = 1024 ** 2;
const root = mkdtempSync(join(import.meta.dirname, 'run-'));
const filesystem = statfsSync(root);
assert(filesystem.bavail * filesystem.bsize > 1024 * MiB, 'At least 1 GiB free required');
const result: Record<string, unknown> = {
  sourceCommit: base,
  environment: {
    node: process.version, platform: platform(), arch: arch(), kernel: release(),
    driver: JSON.parse(readFileSync(new URL('./source/node_modules/libsql/package.json', import.meta.url), 'utf8')).version,
    sourceSha256: Object.fromEntries(['server/database.ts', 'src/server/backup/archive.ts'].map(path =>
      [path, createHash('sha256').update(readFileSync(join(import.meta.dirname, 'source', path))).digest('hex')])),
  },
};
const open: DatabaseSync[] = [];
const dbAt = (name: string) => {
  const db = openDatabase(join(root, name));
  open.push(db);
  return db;
};
const count = (db: DatabaseSync) => Number(db.prepare('SELECT count(*) AS n FROM probe').get()!.n);
const rounded = (ms: number) => Number(ms.toFixed(3));

try {
  // Establish schema in the main file, then keep the acknowledged insert in WAL.
  const wal = dbAt('wal.sqlite');
  wal.exec('PRAGMA wal_autocheckpoint=0; CREATE TABLE probe(id INTEGER PRIMARY KEY) STRICT; PRAGMA wal_checkpoint(TRUNCATE);');
  wal.prepare('INSERT INTO probe VALUES (?)').run(1);
  const rawPath = join(root, 'raw-copy.sqlite');
  copyFileSync(wal.path, rawPath);
  const raw = new DatabaseSync(rawPath, { readOnly: true });
  open.push(raw);
  checkDatabase(raw);
  const vacuumPath = join(root, 'consistent-copy.sqlite');
  await backup(wal, vacuumPath);
  const consistent = new DatabaseSync(vacuumPath, { readOnly: true });
  open.push(consistent);
  checkDatabase(consistent);
  result.walCopy = {
    liveRows: count(wal), rawCopyRows: count(raw), vacuumRows: count(consistent),
    rawCopyIntegrity: 'ok', vacuumIntegrity: 'ok',
    mainBytes: statSync(wal.path).size, walBytes: statSync(wal.path + '-wal').size,
    sqliteVersion: wal.prepare('SELECT sqlite_version() AS version').get()!.version,
    synchronous: wal.prepare('PRAGMA synchronous').get()!.synchronous,
  };
  assert.equal(count(wal), 1);
  assert.equal(count(raw), 0);
  assert.equal(count(consistent), 1);
  for (const db of [consistent, raw, wal]) db.close();

  const timings = [];
  for (const payloadMiB of [1, 16, 64]) {
    const db = dbAt(`timing-${payloadMiB}.sqlite`);
    db.exec('CREATE TABLE payload(id INTEGER PRIMARY KEY, bytes BLOB NOT NULL) STRICT; BEGIN IMMEDIATE');
    const insert = db.prepare('INSERT INTO payload VALUES (?,?)');
    const payload = randomBytes(64 * 1024);
    const rows = payloadMiB * 16;
    for (let i = 0; i < rows; i++) insert.run(i, payload);
    db.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE);');
    const samples = [];
    for (let trial = 0; trial < 3; trial++) {
      const copy = join(root, `timing-${payloadMiB}-${trial}.sqlite`);
      const start = performance.now();
      const timer = new Promise<number>(resolve => setTimeout(() => resolve(performance.now() - start), 0));
      await backup(db, copy);
      const copyMs = performance.now() - start;
      const timerMs = await timer;
      const check = new DatabaseSync(copy, { readOnly: true });
      try {
        checkDatabase(check);
        assert.equal(check.prepare('SELECT count(*) AS n FROM payload').get()!.n, rows);
      } finally { check.close(); }
      samples.push({ copyMs: rounded(copyMs), zeroTimerMs: rounded(timerMs) });
      rmSync(copy);
    }
    timings.push({ payloadMiB, databaseBytes: statSync(db.path).size, rows, samples });
    db.close();
    rmSync(db.path);
  }
  result.vacuumTimings = timings;

  // This is a narrow sync-table fixture, not a full application acceptance test.
  // Use the exact current table definition, including its CHECK constraints.
  const storeSource = readFileSync(new URL('../spinel/src/server/sync/store.ts', import.meta.url), 'utf8');
  const schema = storeSource.match(/CREATE TABLE IF NOT EXISTS spinel_sync_units \([\s\S]+?\) STRICT;/)?.[0];
  assert(schema);
  const recovery = {
    format: 1 as const, createdAt: '2026-10-27T00:00:00.000Z',
    origin: 'https://spinel.example', image: `sha256:${'a'.repeat(64)}`,
    runtimeEnvironment: 'SYNTHETIC_FIXTURE=1\n',
  };
  const semantic = [];
  for (const fault of ['valid', 'invalid-json', 'wrong-identity']) {
    const db = dbAt(`semantic-${fault}.sqlite`);
    db.exec(schema);
    const snapshot = fault === 'invalid-json' ? 'not-json' : JSON.stringify({
      id: fault === 'wrong-identity' ? 'unexpected-id' : 'unit-one', name: 'Synthetic',
      sheetOrder: ['sheet-one'], sheets: { 'sheet-one': { id: 'sheet-one', cellData: {} } },
    });
    db.prepare('INSERT INTO spinel_sync_units VALUES(?,?,?,?,?)').run('unit-one', 'sheet', 1, snapshot, 1);
    checkDatabase(db);
    const key = randomBytes(32);
    const archive = await makeArchive(db, root, key, recovery);
    try {
      const destination = join(root, `restored-${fault}`);
      assert.deepEqual(await restoreArchive(archive.archive, key, root, destination), recovery);
      const restored = new DatabaseSync(join(destination, 'spinel.sqlite'), { readOnly: true });
      try {
        checkDatabase(restored);
        const row = restored.prepare('SELECT * FROM spinel_sync_units').get()!;
        assert.equal(row.snapshot, snapshot); // Backup preserves even already-invalid data exactly.
        let validJson = false, identityMatches = false;
        try { const value = JSON.parse(String(row.snapshot)); validJson = true; identityMatches = value.id === row.unit_id; } catch {}
        semantic.push({ fault, archiveRestored: true, integrity: 'ok', rows: 1, validJson, identityMatches });
        assert.equal(validJson && identityMatches, fault === 'valid');
      } finally { restored.close(); }
    } finally { await archive.dispose(); db.close(); }
  }
  result.semanticChecks = semantic;
  result.processMaxRssKiB = process.resourceUsage().maxRSS;
} finally {
  for (const db of open.toReversed()) if (db.isOpen) db.close();
  rmSync(root, { recursive: true, force: true });
}
console.log(JSON.stringify(result, null, 2));
```

### guard.ts

```ts
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

## Original machine-readable output

```json
{
  "sourceCommit": "a9893ce3c72d0a707f97e4444f9b3f48a65dd226",
  "environment": {
    "node": "v26.12.1",
    "platform": "linux",
    "arch": "x64",
    "kernel": "6.18.55",
    "driver": "0.5.29",
    "sourceSha256": {
      "server/database.ts": "cd1e5921e3ee0bb5981c70d166680c438581c7f03545c81df13b7d7feb524903",
      "src/server/backup/archive.ts": "36edc1503eec00c0efc2688cffd72f5805df4fd4e325c273a537f84244d58662"
    }
  },
  "walCopy": {
    "liveRows": 1,
    "rawCopyRows": 0,
    "vacuumRows": 1,
    "rawCopyIntegrity": "ok",
    "vacuumIntegrity": "ok",
    "mainBytes": 8192,
    "walBytes": 4152,
    "sqliteVersion": "3.45.1",
    "synchronous": 2
  },
  "vacuumTimings": [
    {
      "payloadMiB": 1,
      "databaseBytes": 1064960,
      "rows": 16,
      "samples": [
        {
          "copyMs": 4.002,
          "zeroTimerMs": 4.083
        },
        {
          "copyMs": 4.088,
          "zeroTimerMs": 4.13
        },
        {
          "copyMs": 5.068,
          "zeroTimerMs": 5.102
        }
      ]
    },
    {
      "payloadMiB": 16,
      "databaseBytes": 16916480,
      "rows": 256,
      "samples": [
        {
          "copyMs": 27.836,
          "zeroTimerMs": 27.902
        },
        {
          "copyMs": 33.82,
          "zeroTimerMs": 33.943
        },
        {
          "copyMs": 74.473,
          "zeroTimerMs": 74.562
        }
      ]
    },
    {
      "payloadMiB": 64,
      "databaseBytes": 67641344,
      "rows": 1024,
      "samples": [
        {
          "copyMs": 83.915,
          "zeroTimerMs": 92.711
        },
        {
          "copyMs": 82.082,
          "zeroTimerMs": 82.137
        },
        {
          "copyMs": 157.812,
          "zeroTimerMs": 157.903
        }
      ]
    }
  ],
  "semanticChecks": [
    {
      "fault": "valid",
      "archiveRestored": true,
      "integrity": "ok",
      "rows": 1,
      "validJson": true,
      "identityMatches": true
    },
    {
      "fault": "invalid-json",
      "archiveRestored": true,
      "integrity": "ok",
      "rows": 1,
      "validJson": false,
      "identityMatches": false
    },
    {
      "fault": "wrong-identity",
      "archiveRestored": true,
      "integrity": "ok",
      "rows": 1,
      "validJson": true,
      "identityMatches": false
    }
  ],
  "processMaxRssKiB": 108468
}
```

### Original guard output

```json
{"watchdogPeakKiB":180240,"aborted":false}
```

The source hashes, code blocks and original output above are durable evidence for
this investigation. They add no application test, scheduled verifier or runtime
dependency; future implementation must run its own current-commit acceptance.
