import { fork, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { maintenanceControl } from '../../../scripts/deploy/maintenance.ts';
import { assertWorkspaceHandlesClosed } from './supervisor.ts';
import { restoreBarrierPath } from './restore-barrier.ts';
import { sameProcess } from './journal.ts';
import { processResourcesReleased } from './process-exit.ts';
import type { RestoreJobRecord } from './restore-jobs.ts';
import { authenticator, restoreHttpClient, seed, seedOwner } from './restore-http-test-client.ts';

const cuts = ['admission', 'activation', 'private-open', 'commit', 'postcommit'] as const;
const alive = (child: ChildProcess) => child.exitCode === null && child.signalCode === null;
async function kill(child: ChildProcess) {
  if (!alive(child)) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  const [, signal] = await exited;
  expect(signal).toBe('SIGKILL');
}
async function close(child: ChildProcess) {
  if (!alive(child)) return;
  const exited = once(child, 'exit');
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  child.kill('SIGTERM');
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}
async function evidence(root: string) {
  const result: Record<string, string> = {};
  const walk = async (path: string) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile())
        result[file] = createHash('sha256')
          .update(await readFile(file))
          .digest('hex');
      else throw new Error('Unexpected crash evidence type.');
    }
  };
  for (const entry of await readdir(root, { withFileTypes: true }))
    if (entry.isDirectory() && entry.name.startsWith('restore-') && entry.name !== 'restore-jobs')
      await walk(join(root, entry.name));
  return result;
}

/** Never give the long-lived test process a native handle to the live inode.
 * libsql may retain handles beyond close(); observations use disposable copies. */
async function probeCopy(directory: string, databasePath: string, includeWal: boolean) {
  const probeDirectory = await mkdtemp(join(directory, 'closed-probe-'));
  const target = join(probeDirectory, 'workspace.sqlite');
  await copyFile(databasePath, target);
  await chmod(target, 0o600);
  if (includeWal) {
    try {
      await copyFile(`${databasePath}-wal`, `${target}-wal`);
      await chmod(`${target}-wal`, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return target;
}

test.skipIf(process.platform !== 'linux').each(cuts)(
  'real SIGKILL at %s preserves the durable restore decision and all retained evidence',
  async (cut) => {
    const directory = await mkdtemp(join(tmpdir(), 'spinel-restore-crash-'));
    const root = join(directory, 'recovery'),
      data = join(directory, 'data');
    await mkdir(root, { mode: 0o700 });
    await mkdir(data, { mode: 0o700 });
    const databasePath = join(data, 'workspace.sqlite'),
      marker = join(directory, 'cut.json');
    const credential = authenticator();
    const source = await seed(databasePath, credential);
    const ownerCredential = authenticator();
    const ownerId =
      cut === 'postcommit'
        ? await seedOwner(databasePath, source.folderId, ownerCredential)
        : undefined;
    const identity = statSync(databasePath);
    const portProbe = createServer();
    await new Promise<void>((resolve) => portProbe.listen(0, '127.0.0.1', resolve));
    const port = (portProbe.address() as { port: number }).port;
    await new Promise<void>((resolve, reject) =>
      portProbe.close((error) => (error ? reject(error) : resolve())),
    );
    const base = `http://127.0.0.1:${port}`;
    const ownerClient = ownerId ? restoreHttpClient(base, ownerId, ownerCredential) : undefined;
    let controller: ChildProcess | undefined;
    let recoveryComplete = false;
    const launch = async (initial: boolean) => {
      const child = fork(
        fileURLToPath(new URL('./restore-crash-fixture.ts', import.meta.url)),
        [],
        {
          env: {
            ...process.env,
            DATABASE_PATH: databasePath,
            SPINEL_MAINTENANCE_ROOT: root,
            SPINEL_TEST_APP_PORT: String(port),
            SPINEL_TEST_CRASH_MARKER: marker,
            SPINEL_TEST_CRASH_CUT: initial ? cut : '',
            SPINEL_TEST_INITIAL_BOOT: initial ? '1' : '0',
          },
          execArgv: [],
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        },
      );
      controller = child;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Crash controller startup timed out.')),
          40_000,
        );
        const message = (value: unknown) => {
          if (value && typeof value === 'object' && 'kind' in value && value.kind === 'ready') {
            clearTimeout(timer);
            child.off('exit', exit);
            child.off('message', message);
            resolve();
          }
        };
        const exit = () => {
          clearTimeout(timer);
          child.off('message', message);
          reject(new Error('Crash controller exited before readiness.'));
        };
        child.on('message', message);
        child.once('exit', exit);
      });
      return child;
    };
    try {
      const first = await launch(true);
      const client = restoreHttpClient(base, source.operatorId, credential);
      await client.authenticate();
      const prepared = await client.prepare(source);
      const statePath = join(root, 'restore-jobs', prepared.id, 'state.json');
      const record = () => JSON.parse(readFileSync(statePath, 'utf8')) as RestoreJobRecord;
      // Admission dies before replying to HTTP. Observe that request's eventual
      // disconnect without allowing it to hide an unhandled rejection.
      const confirmation = client.confirm(prepared).then(
        (response) => ({ status: response.status }),
        () => ({ status: null }),
      );
      if (cut !== 'admission') expect((await confirmation).status).toBe(202);
      let acknowledgedId: string | undefined;
      if (cut === 'postcommit') {
        await expect.poll(() => record().phase, { timeout: 100_000 }).toBe('candidate-committed');
        await expect
          .poll(
            async () => {
              try {
                return (await client.request('/api/auth/session')).status;
              } catch {
                return 0;
              }
            },
            { timeout: 20_000 },
          )
          .toBe(401);
        await ownerClient!.authenticate();
        const acknowledged = await ownerClient!.json<{ item: { id: string; name: string } }>(
          await ownerClient!.request('/api/items', {
            kind: 'folder',
            name: 'Acknowledged after restore',
            parentId: null,
          }),
          201,
        );
        expect(acknowledged.item.name).toBe('Acknowledged after restore');
        acknowledgedId = acknowledged.item.id;
        // The real HTTP response precedes the controller's irreversible cut.
        first.send({ kind: 'postcommit-cut' });
      }
      await expect.poll(() => existsSync(marker), { timeout: 100_000 }).toBe(true);
      const reached = JSON.parse(await readFile(marker, 'utf8')) as {
        cut: string;
        pid: number;
        bytesWritten?: number;
      };
      expect(reached.cut).toBe(cut);
      const before = record();
      const main = JSON.parse(await readFile(join(root, 'journal.json'), 'utf8'));
      if (cut === 'private-open') {
        expect(reached.pid).toBe(before.execution!.trial!.child.pid);
        expect(before.phase).toBe('trial-opening');
        expect(before.execution!.readiness).toBeUndefined();
        expect(before.execution!.failure).toBeUndefined();
      } else expect(reached.pid).toBe(first.pid);
      if (cut === 'admission') {
        expect(before.phase).toBe('accepted');
        expect(main.restoreJob).toBeNull();
      } else {
        expect(before.execution!.stop!.fingerprint).toBeTruthy();
        expect(before.phase).toBe(
          cut === 'activation'
            ? 'candidate-replacing'
            : cut === 'private-open'
              ? 'trial-opening'
              : 'candidate-committed',
        );
      }
      const retained = await evidence(root);
      const liveHash = createHash('sha256')
        .update(await readFile(databasePath))
        .digest('hex');
      if (cut !== 'admission') expect(Object.keys(retained).length).toBeGreaterThan(0);
      if (cut === 'activation') {
        expect(reached.bytesWritten).toBe(64 * 1024);
        expect(before.execution!.preparation!.candidate!.bytes).toBeGreaterThan(
          reached.bytesWritten!,
        );
        expect(liveHash).not.toBe(before.execution!.preparation!.candidate!.sha256);
      }
      if (cut === 'postcommit') {
        // Kill the actual writer first. Killing only its supervisor would let
        // the application's IPC-disconnect handler close/checkpoint gracefully.
        // The supervisor is still synchronously blocked at its durable marker.
        const application = before.execution!.trial!.child;
        expect(main.child).toEqual(application);
        expect(sameProcess(application)).toBe(true);
        expect(
          /^PPid:\s+(\d+)$/m.exec(readFileSync(`/proc/${application.pid}/status`, 'utf8'))?.[1],
        ).toBe(String(first.pid));
        expect(statSync(`${databasePath}-wal`).size).toBeGreaterThan(32);
        process.kill(application.pid, 'SIGKILL');
        await expect
          .poll(() => processResourcesReleased(String(application.pid)), {
            timeout: 5000,
          })
          .toBe(true);
        expect(statSync(`${databasePath}-wal`).size).toBeGreaterThan(32);
        const closedTuple = await Promise.all(
          [databasePath, `${databasePath}-wal`].map(async (path) =>
            createHash('sha256')
              .update(await readFile(path))
              .digest('hex'),
          ),
        );
        // This read-only immutable view deliberately excludes WAL. Prove the
        // acknowledged row still requires recovery of the surviving WAL; never
        // change production checkpoint settings to manufacture that condition.
        const mainOnly = pathToFileURL(await probeCopy(directory, databasePath, false));
        mainOnly.searchParams.set('mode', 'ro');
        mainOnly.searchParams.set('immutable', '1');
        const database = new DatabaseSync(mainOnly.href);
        try {
          expect(
            database.prepare('SELECT 1 FROM workspace_items WHERE id=?').get(acknowledgedId!),
          ).toBeUndefined();
        } finally {
          database.close();
        }
        expect(
          await Promise.all(
            [databasePath, `${databasePath}-wal`].map(async (path) =>
              createHash('sha256')
                .update(await readFile(path))
                .digest('hex'),
            ),
          ),
        ).toEqual(closedTuple);
      }
      await kill(first);
      await confirmation;
      await launch(false);
      assertWorkspaceHandlesClosed(databasePath);
      expect(statSync(databasePath).ino).toBe(identity.ino);
      expect(await evidence(root)).toEqual(retained);
      if (cut === 'activation' || cut === 'private-open') {
        expect(record()).toEqual(before);
        expect(existsSync(restoreBarrierPath(databasePath))).toBe(true);
        expect(
          createHash('sha256')
            .update(await readFile(databasePath))
            .digest('hex'),
        ).toBe(liveHash);
        await expect(
          maintenanceControl(root, { action: 'verify', operationId: prepared.id }),
        ).rejects.toThrow();
      } else {
        if (cut === 'admission') {
          expect(record().phase).toBe('failed');
          expect(record().intent).toEqual(before.intent);
        } else expect(record()).toEqual(before);
        expect(existsSync(restoreBarrierPath(databasePath))).toBe(false);
        // Explicit ordinary recovery verifies the selected live content. It must
        // never reinstall the prepared candidate over the HTTP-acknowledged row.
        const operationId = randomUUID();
        for (const action of ['verify', 'start', 'resume'] as const)
          await maintenanceControl(root, { action, operationId });
        await client.authenticate();
        if (acknowledgedId) {
          await ownerClient!.authenticate();
          const read = await ownerClient!.json<{ item: { name: string } }>(
            await ownerClient!.request(`/api/items/${acknowledgedId}`),
          );
          expect(read.item.name).toBe('Acknowledged after restore');
        }
      }
      await close(controller!);
      await launch(false);
      assertWorkspaceHandlesClosed(databasePath);
      if (cut !== 'activation' && cut !== 'private-open') {
        const location = pathToFileURL(await probeCopy(directory, databasePath, true));
        location.searchParams.set('mode', 'ro');
        const database = new DatabaseSync(location.href);
        try {
          expect(
            database.prepare('SELECT name FROM workspace_items WHERE id=?').get(source.folderId)
              ?.name,
          ).toBe(cut === 'admission' ? 'Current folder' : 'Archived folder');
          if (acknowledgedId)
            expect(
              database.prepare('SELECT name FROM workspace_items WHERE id=?').get(acknowledgedId)
                ?.name,
            ).toBe('Acknowledged after restore');
        } finally {
          database.close();
        }
      }
      expect(await evidence(root)).toEqual(retained);
      expect(
        createHash('sha256')
          .update(await readFile(source.archive))
          .digest('hex'),
      ).toBe(source.sha256);
      recoveryComplete = true;
    } finally {
      if (controller) await close(controller);
      if (!recoveryComplete) {
        // A blocked private child ignores IPC/TERM. Reopen through the actual
        // supervisor so its identity-checked stopGroup reaps that orphan even
        // when an assertion failed; preserve all files for diagnosis.
        try {
          await launch(false);
        } finally {
          if (controller) await close(controller);
        }
        assertWorkspaceHandlesClosed(databasePath);
      }
      // Never remove evidence beneath a surviving orphan after a failed test.
      if (recoveryComplete) {
        assertWorkspaceHandlesClosed(databasePath);
        await rm(directory, { recursive: true, force: true });
      }
    }
  },
  180_000,
);
