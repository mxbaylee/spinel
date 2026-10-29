/** Separate real controller process. Cuts stop after actual effects without
 * throwing through controller cleanup; only the external test sends SIGKILL. */
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RestoreJobs } from './restore-jobs.ts';
import { MaintenanceSupervisor } from './supervisor.ts';

const root = process.env.SPINEL_MAINTENANCE_ROOT;
const databasePath = process.env.DATABASE_PATH;
const marker = process.env.SPINEL_TEST_CRASH_MARKER;
const cut = process.env.SPINEL_TEST_CRASH_CUT;
if (!process.send || !root || !databasePath || !marker)
  throw new Error('Private crash controller required.');
const mark = (name: string, bytesWritten?: number) => {
  const fd = openSync(marker, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify({ cut: name, pid: process.pid, bytesWritten }));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const directory = openSync(dirname(marker), 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
};

if (cut === 'admission') {
  const admit = RestoreJobs.prototype.admit;
  RestoreJobs.prototype.admit = function (...args) {
    const result = admit.apply(this, args);
    mark('admission');
    return result;
  };
}
if (cut === 'commit') {
  const commit = RestoreJobs.prototype.markCandidateCommitted;
  RestoreJobs.prototype.markCandidateCommitted = function (...args) {
    const result = commit.apply(this, args);
    mark('commit');
    return result;
  };
}
if (cut === 'activation') {
  // Patch only this test process's FileHandle prototype, and match the exact
  // existing live inode plus durable replacing phase before stopping a write.
  const probePath = join(dirname(databasePath), `.crash-probe-${randomUUID()}`);
  const probe = await open(probePath, 'wx', 0o600);
  const prototype = Object.getPrototypeOf(probe) as { write: typeof probe.write };
  const write = prototype.write;
  await probe.close();
  await unlink(probePath);
  prototype.write = async function (this: typeof probe, ...args: Parameters<typeof write>) {
    const result = await Reflect.apply(write, this, args);
    const held = await this.stat();
    const named = statSync(databasePath);
    if (result.bytesWritten > 0 && held.ino === named.ino && held.dev === named.dev) {
      const main = JSON.parse(readFileSync(join(root, 'journal.json'), 'utf8'));
      const id = main.restoreJob?.jobId;
      if (id) {
        const job = JSON.parse(readFileSync(join(root, 'restore-jobs', id, 'state.json'), 'utf8'));
        if (job.phase === 'candidate-replacing') mark('activation', result.bytesWritten);
      }
    }
    return result;
  } as typeof probe.write;
}

const supervisor = await MaintenanceSupervisor.open({
  root,
  databasePath,
  publicPort: 0,
  applicationPolicy: {
    origin: 'https://spinel.example',
    image: `spinel@sha256:${'a'.repeat(64)}`,
    spaceReview: true,
    staticDirectory: join(dirname(databasePath), 'assets'),
  },
  createChild: (_token, environment) =>
    fork(
      fileURLToPath(
        new URL(
          cut === 'private-open' ? './restore-crash-app-fixture.ts' : '../../../server/index.ts',
          import.meta.url,
        ),
      ),
      [],
      {
        env: {
          ...environment,
          PORT: process.env.SPINEL_TEST_APP_PORT!,
          HOST: '127.0.0.1',
          BACKUP_CONFIG_PATH: join(dirname(databasePath), 'absent-backup-config'),
          SPINEL_TEST_CRASH_MARKER: marker,
        },
        execArgv: ['--max-old-space-size=256', '--max-semi-space-size=8'],
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      },
    ),
  budgets: { startMs: 25_000, verifyMs: 20_000, drainMs: 15_000, stopMs: 5000, restoreMs: 90_000 },
});
if (process.env.SPINEL_TEST_INITIAL_BOOT === '1') {
  const operationId = randomUUID();
  for (const action of ['verify', 'start', 'resume'] as const)
    await supervisor.coldControl({ action, operationId });
}
process.send({ kind: 'ready', status: supervisor.status() });
process.on('message', (value: unknown) => {
  if (value && typeof value === 'object' && 'kind' in value && value.kind === 'postcommit-cut') {
    if (cut !== 'postcommit' || supervisor.status().phase !== 'running')
      throw new Error('Postcommit cut is not eligible.');
    mark('postcommit');
  }
});
process.on('SIGTERM', () => {
  void supervisor.close().then(() => process.disconnect?.());
});
