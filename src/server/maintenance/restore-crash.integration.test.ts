import { fork, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
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
import { restoreSnapshotFingerprint } from '../backup/inventory.ts';
import type { RestoreTrialStopRequest } from './restore-trial-stop.ts';
import { restoreTrialReference } from './restore-trial.ts';
import { processResourcesReleased } from './process-exit.ts';
import { currentRestoreRecovery, restoreJobPhase } from './restore-jobs.ts';
import type { RestoreJobRecord } from './restore-jobs.ts';
import { finishRestoreCrashCleanup } from './restore-crash-cleanup-fixture.ts';
import { authenticator, restoreHttpClient, seed, seedOwner } from './restore-http-test-client.ts';

const cuts = [
  'admission',
  'custody',
  'freeze',
  'activation-plan',
  'staging',
  'activation',
  'private-open',
  'commit',
  'postcommit',
  'original-activation',
  'original-commit',
] as const;
const cutPhases: Partial<Record<(typeof cuts)[number], string>> = {
  custody: 'originals-retained',
  freeze: 'frozen',
  'activation-plan': 'activation-planned',
  staging: 'candidate-staged',
  activation: 'candidate-replacing',
  'private-open': 'trial-opening',
  'original-activation': 'original-replacing',
  'original-commit': 'original-committed',
};
const coldPhases = {
  'cold-admission': 'original-capture-planned',
  'cold-prepared': 'original-prepared',
  'cold-activation': 'original-replacing',
  'cold-trial-planned': 'original-trial-planned',
  'cold-private-open': 'original-trial-opening',
  'cold-commit': 'original-committed',
} as const;
const scenarios: {
  name: string;
  cut: (typeof cuts)[number];
  cold?: keyof typeof coldPhases;
}[] = [
  ...cuts.map((cut) => ({ name: cut, cut })),
  ...(Object.keys(coldPhases) as (keyof typeof coldPhases)[]).map((cold) => ({
    name: cold,
    cut: 'original-activation' as const,
    cold,
  })),
];
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
async function retains(root: string, previous: Record<string, string>) {
  const current = await evidence(root);
  for (const [path, hash] of Object.entries(previous)) expect(current[path], path).toBe(hash);
  return current;
}
async function seedLink(databasePath: string, ownerId: string) {
  const child = fork(
    fileURLToPath(new URL('./restore-crash-security-fixture.ts', import.meta.url)),
    [],
    {
      env: { ...process.env, DATABASE_PATH: databasePath, SPINEL_TEST_OWNER_ID: ownerId },
      execArgv: [],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    },
  );
  return new Promise<string>((resolve, reject) => {
    let linkedId: string | undefined;
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.on('message', (value: unknown) => {
      if (
        value &&
        typeof value === 'object' &&
        'linkedId' in value &&
        typeof value.linkedId === 'string'
      )
        linkedId = value.linkedId;
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0 && linkedId) resolve(linkedId);
      else reject(new Error('Crash security seed did not close successfully.'));
    });
    child.once('error', reject);
  });
}
async function mutateCopiedTrial(databasePath: string, folderId: string) {
  const child = fork(
    fileURLToPath(new URL('./restore-crash-tamper-fixture.ts', import.meta.url)),
    [],
    {
      env: { ...process.env, DATABASE_PATH: databasePath, SPINEL_TEST_FOLDER_ID: folderId },
      execArgv: [],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    },
  );
  return new Promise<string>((resolve, reject) => {
    let fingerprint: string | undefined;
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.on('message', (value: unknown) => {
      if (
        value &&
        typeof value === 'object' &&
        'fingerprint' in value &&
        typeof value.fingerprint === 'string' &&
        /^[a-f0-9]{64}$/.test(value.fingerprint)
      )
        fingerprint = value.fingerprint;
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0 && fingerprint) resolve(fingerprint);
      else reject(new Error('The copied private-trial mutation did not close successfully.'));
    });
    child.once('error', reject);
  });
}
async function liveTuple(databasePath: string) {
  const result: Record<string, { bytes: Buffer; mode: number } | null> = {};
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      result[suffix] = {
        bytes: await readFile(databasePath + suffix),
        mode: statSync(databasePath + suffix).mode & 0o777,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      result[suffix] = null;
    }
  }
  return result;
}
async function restoreTestTuple(
  databasePath: string,
  tuple: Awaited<ReturnType<typeof liveTuple>>,
) {
  assertWorkspaceHandlesClosed(databasePath);
  for (const [suffix, value] of Object.entries(tuple)) {
    if (!value) await rm(databasePath + suffix, { force: true });
    else {
      await writeFile(databasePath + suffix, value.bytes, { mode: value.mode });
      await chmod(databasePath + suffix, value.mode);
    }
  }
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
async function inspectCopy(
  directory: string,
  databasePath: string,
  includeWal: boolean,
  inspect: (database: DatabaseSync) => void,
) {
  const location = pathToFileURL(await probeCopy(directory, databasePath, includeWal));
  location.searchParams.set('mode', 'ro');
  if (!includeWal) location.searchParams.set('immutable', '1');
  const database = new DatabaseSync(location.href);
  try {
    inspect(database);
  } finally {
    database.close();
  }
}

test.skipIf(process.platform !== 'linux').each(scenarios)(
  'real SIGKILL at $name preserves the durable restore decision and all retained evidence',
  async ({ cut, cold }) => {
    const originalRecovery = cut === 'original-activation' || cut === 'original-commit';
    const partial = cut === 'activation' || cut === 'original-activation';
    const preActivation =
      cut === 'custody' || cut === 'freeze' || cut === 'activation-plan' || cut === 'staging';
    const unresolved = partial || cut === 'private-open';
    const recoversOriginal = unresolved || cut === 'original-commit';
    const directory = await mkdtemp(join(tmpdir(), 'spinel-restore-crash-'));
    const root = join(directory, 'recovery'),
      data = join(directory, 'data');
    await mkdir(root, { mode: 0o700 });
    await mkdir(data, { mode: 0o700 });
    const databasePath = join(data, 'workspace.sqlite'),
      marker = join(directory, 'cut.json'),
      coldMarker = join(directory, 'cold-cut.json');
    const credential = authenticator();
    const source = await seed(databasePath, credential);
    const ownerCredential = authenticator();
    const ownerId =
      cut === 'postcommit' || recoversOriginal
        ? await seedOwner(databasePath, source.folderId, ownerCredential)
        : undefined;
    const linkedId = recoversOriginal ? await seedLink(databasePath, ownerId!) : undefined;
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
    let cleanupOperation: string | undefined;
    let primaryFailure: { error: unknown } | undefined;
    let recoveryComplete = false;
    let clockOffset = 0;
    const launch = async (initial: boolean, coldAttempt = false, cleanup = false) => {
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
            SPINEL_TEST_COLD_CRASH_MARKER: coldMarker,
            SPINEL_TEST_COLD_CRASH_CUT: coldAttempt ? cold : '',
            SPINEL_TEST_CLOCK_OFFSET: String(clockOffset),
            SPINEL_TEST_INITIAL_BOOT: initial ? '1' : '0',
            SPINEL_TEST_CLEANUP_OPERATION: cleanup ? cleanupOperation : undefined,
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
      if (recoversOriginal) await ownerClient!.authenticate();
      const prepared = await client.prepare(source);
      cleanupOperation = prepared.id;
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
        expect(before.phase).toBe(cutPhases[cut] ?? 'candidate-committed');
      }
      const witnessBytes = originalRecovery
        ? await readFile(join(directory, 'failed-trial-witness.json'))
        : undefined;
      const retained = await evidence(root);
      let completedEvidence = retained;
      const liveHash = createHash('sha256')
        .update(await readFile(databasePath))
        .digest('hex');
      if (cut !== 'admission') expect(Object.keys(retained).length).toBeGreaterThan(0);
      if (partial) {
        const selected = originalRecovery
          ? before.execution!.rollback!.image!
          : before.execution!.preparation!.candidate!;
        expect(reached.bytesWritten).toBe(64 * 1024);
        expect(selected.bytes).toBeGreaterThan(reached.bytesWritten!);
        expect(liveHash).not.toBe(selected.sha256);
      }
      if (recoversOriginal) {
        const execution = before.execution!,
          frozen = execution.frozen!;
        const original = join(
          root,
          `restore-${prepared.id}`,
          `freeze-${execution.freezeSlot}`,
          frozen.directory,
          'frozen.sqlite',
        );
        const bytes = await readFile(original);
        expect(bytes.length).toBe(frozen.bytes);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(frozen.sha256);
        expect(frozen.fingerprint).toBe(execution.stop!.fingerprint);
        await inspectCopy(directory, original, false, (database) => {
          expect(restoreSnapshotFingerprint(database)).toBe(execution.stop!.fingerprint);
          expect(
            database.prepare('SELECT name FROM workspace_items WHERE id=?').get(source.folderId)
              ?.name,
          ).toBe('Current folder');
          expect(
            Number(database.prepare('SELECT count(*) AS n FROM auth_sessions').get()!.n),
          ).toBeGreaterThan(0);
          expect(
            database.prepare('SELECT state FROM workspace_links WHERE item_id=?').get(linkedId!)
              ?.state,
          ).toBe('active');
          expect(
            database
              .prepare('SELECT 1 FROM workspace_guest_sessions WHERE item_id=?')
              .get(linkedId!),
          ).toBeDefined();
        });
        expect(await readFile(original)).toEqual(bytes);
      }
      if (originalRecovery) {
        const execution = before.execution!;
        const failure = execution.failure!;
        const wire = JSON.parse(witnessBytes!.toString('utf8')) as {
          receivedAt: number;
          pid: number;
          rejectedReadiness: { fingerprint: string; reference: { role: string } };
          witness: { kind: string; fingerprint: string; stop: RestoreTrialStopRequest };
        };
        expect(wire.rejectedReadiness.reference.role).toBe('candidate');
        expect(wire.rejectedReadiness.fingerprint).toBe(
          execution.preparation!.candidate!.fingerprint,
        );
        expect(wire.witness.kind).toBe('restore-trial-witness');
        expect(wire.witness.fingerprint).toMatch(/^[a-f0-9]{64}$/);
        expect(wire.witness.fingerprint).not.toBe('0'.repeat(64));
        expect(wire.pid).toBe(execution.trial!.child.pid);
        expect(wire.witness.stop.child).toEqual(execution.trial!.child);
        expect(wire.witness.stop.reference).toEqual(restoreTrialReference(execution.trial!));
        expect(wire.rejectedReadiness.reference).toEqual(restoreTrialReference(execution.trial!));
        expect(wire.witness.stop.request).toEqual(failure.stop.request);
        expect(failure.stop.fingerprint).toBe(wire.witness.fingerprint);
        expect(failure.stop.acceptedAt).toBeGreaterThanOrEqual(wire.receivedAt);
        expect(failure.stop.acceptedAt).toBeLessThan(failure.stop.request.deadline);
        expect(failure.stop.request.challengeId).not.toBe(execution.stop!.request.challengeId);
        expect(processResourcesReleased(String(wire.pid))).toBe(true);
        expect(execution.frozen!.fingerprint).toBe(execution.stop!.fingerprint);
        expect(failure.freeze!.output!.fingerprint).toBe(wire.witness.fingerprint);
        expect(execution.rollback!.attempt!.generationId).not.toBe(execution.attempt!.generationId);
        expect(execution.outcome).toBeUndefined();
        expect(execution.readiness).toBeUndefined();
        expect(failure.from).toBe('trial-opening');
        const retainedRoot = join(root, `restore-${prepared.id}`);
        const frozen = execution.frozen!;
        const failed = failure.freeze!.output!;
        for (const [path, image, expectedName] of [
          [
            join(retainedRoot, `freeze-${execution.freezeSlot}`, frozen.directory, 'frozen.sqlite'),
            frozen,
            'Current folder',
          ],
          [
            join(
              retainedRoot,
              `failed-freeze-${failure.freeze!.slot}`,
              failed.directory,
              'frozen.sqlite',
            ),
            failed,
            'Archived folder',
          ],
        ] as const) {
          const bytes = await readFile(path);
          expect(bytes.length).toBe(image.bytes);
          expect(createHash('sha256').update(bytes).digest('hex')).toBe(image.sha256);
          const location = pathToFileURL(await probeCopy(directory, path, false));
          location.searchParams.set('mode', 'ro');
          location.searchParams.set('immutable', '1');
          const database = new DatabaseSync(location.href);
          try {
            expect(restoreSnapshotFingerprint(database)).toBe(image.fingerprint);
            expect(
              database.prepare('SELECT name FROM workspace_items WHERE id=?').get(source.folderId)
                ?.name,
            ).toBe(expectedName);
            expect(
              database
                .prepare('SELECT user_id FROM auth_passkeys WHERE id=?')
                .get(ownerCredential.id)?.user_id,
            ).toBe(ownerId);
          } finally {
            database.close();
          }
          expect(await readFile(path)).toEqual(bytes);
        }
        const raw = join(retainedRoot, `failed-${failure.capture!.slot}`, 'raw');
        for (const [name, image] of Object.entries(failure.capture!.manifest!.files)) {
          if (!image) continue;
          const bytes = await readFile(join(raw, name));
          expect(bytes.length).toBe(image.bytes);
          expect(createHash('sha256').update(bytes).digest('hex')).toBe(image.sha256);
        }
        if (cut === 'original-commit') {
          expect(execution.rollback!.outcome!.role).toBe('original');
          expect(execution.rollback!.outcome!.fingerprint).toBe(
            execution.rollback!.image!.fingerprint,
          );
          expect(main.child).toEqual(execution.rollback!.trial!.child);
          expect(sameProcess(execution.rollback!.trial!.child)).toBe(true);
          expect(existsSync(restoreBarrierPath(databasePath))).toBe(true);
        }
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
      // This is clock-controlled expiry, not five minutes of elapsed runtime.
      // The historical WebAuthn proof stays byte-for-byte unchanged.
      if (recoversOriginal) clockOffset = 6 * 60_000;
      await launch(false, Boolean(cold));
      assertWorkspaceHandlesClosed(databasePath);
      expect(statSync(databasePath).ino).toBe(identity.ino);
      expect(await evidence(root)).toEqual(retained);
      if (unresolved) {
        expect(main.restoreJob?.jobId).toBe(prepared.id);
        expect(record()).toEqual(before);
        expect(existsSync(restoreBarrierPath(databasePath))).toBe(true);
        expect(
          createHash('sha256')
            .update(await readFile(databasePath))
            .digest('hex'),
        ).toBe(liveHash);
        for (const action of ['verify', 'start', 'resume'] as const)
          await expect(
            maintenanceControl(root, { action, operationId: prepared.id }),
          ).rejects.toThrow();
      } else {
        if (cut === 'admission') {
          expect(record().phase).toBe('failed');
          expect(record().intent).toEqual(before.intent);
        } else if (preActivation) {
          // Restart records the untouched original as failed, keeping every piece
          // of evidence, and leaves it stopped under the restore's own operation.
          const { phase, revision, updatedAt, execution, ...rest } = before;
          expect(record()).toEqual({
            ...rest,
            phase: 'failed',
            revision: revision + 1,
            updatedAt: record().updatedAt,
            execution: {
              ...execution,
              abandoned: { phase, updatedAt, reason: expect.any(String) },
            },
          });
          const reopened = JSON.parse(await readFile(join(root, 'journal.json'), 'utf8'));
          expect(reopened.restoreJob).toBeNull();
          expect(reopened.phase).toBe('stopped');
          expect(reopened.operation.id).toBe(prepared.id);
          expect(
            createHash('sha256')
              .update(await readFile(databasePath))
              .digest('hex'),
          ).toBe(liveHash);
        } else expect(record()).toEqual(before);
        expect(existsSync(restoreBarrierPath(databasePath))).toBe(false);
        // Explicit ordinary recovery verifies the selected live content. It must
        // never reinstall the prepared candidate over the HTTP-acknowledged row.
        if (!recoversOriginal) {
          const operationId = preActivation ? prepared.id : randomUUID();
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
      }
      let committed: RestoreJobRecord | undefined;
      const recover = () =>
        maintenanceControl(root, { action: 'recover-original', operationId: prepared.id });
      if (recoversOriginal) {
        const refuseUntrustedEvidence = async () => {
          const prior = record(),
            tuple = await liveTuple(databasePath);
          const barrier = await readFile(restoreBarrierPath(databasePath));
          assertWorkspaceHandlesClosed(databasePath);
          await expect(recover()).rejects.toThrow();
          assertWorkspaceHandlesClosed(databasePath);
          expect(await liveTuple(databasePath)).toEqual(tuple);
          expect(await readFile(restoreBarrierPath(databasePath))).toEqual(barrier);
          expect(statSync(databasePath).ino).toBe(identity.ino);
          const stopped = JSON.parse(await readFile(join(root, 'journal.json'), 'utf8'));
          expect(stopped.phase).toBe('recovery-required');
          expect(stopped.child).toBeNull();
          expect(stopped.verifier).toBeNull();
          const refused = record();
          expect(refused.intent).toEqual(before.intent);
          expect(refused.intentHash).toBe(before.intentHash);
          expect(refused.execution).toEqual(before.execution);
          expect(refused.phase).toBe(before.phase);
          expect(currentRestoreRecovery(refused)!.outcome).toBeUndefined();
          const earlier = prior.recovery?.attempts ?? [];
          expect(refused.recovery!.attempts.slice(0, earlier.length)).toEqual(earlier);
          return refused;
        };
        const restartAfterRefusal = async (refused: RestoreJobRecord) => {
          // Only test-owned fixture changes have been restored. Every retained
          // production input and each rejected attempt must remain immutable.
          completedEvidence = await retains(root, completedEvidence);
          await close(controller!);
          await launch(false);
          assertWorkspaceHandlesClosed(databasePath);
          expect(record()).toEqual(refused);
          expect(await evidence(root)).toEqual(completedEvidence);
        };
        if (cut === 'activation' && !cold) {
          const original = join(
            root,
            `restore-${prepared.id}`,
            `freeze-${before.execution!.freezeSlot}`,
            before.execution!.frozen!.directory,
            'frozen.sqlite',
          );
          const bytes = await readFile(original),
            held = join(directory, 'held-original.sqlite');
          for (const mode of ['missing', 'altered'] as const) {
            let refused: RestoreJobRecord;
            if (mode === 'missing') await rename(original, held);
            else {
              const altered = Buffer.from(bytes);
              altered[altered.length - 1] ^= 1;
              await writeFile(original, altered);
            }
            try {
              refused = await refuseUntrustedEvidence();
            } finally {
              if (mode === 'missing') await rename(held, original);
              else await writeFile(original, bytes);
            }
            expect(await readFile(original)).toEqual(bytes);
            await restartAfterRefusal(refused!);
          }
        }
        if (cut === 'private-open') {
          const tuple = await liveTuple(databasePath);
          const copy = await probeCopy(directory, databasePath, true);
          const changedFingerprint = await mutateCopiedTrial(copy, source.folderId);
          expect(changedFingerprint).not.toBe(
            before.execution!.preparation!.candidate!.fingerprint,
          );
          let refused: RestoreJobRecord;
          try {
            assertWorkspaceHandlesClosed(databasePath);
            await copyFile(copy, databasePath);
            await rm(databasePath + '-wal', { force: true });
            await rm(databasePath + '-shm', { force: true });
            expect(statSync(databasePath).ino).toBe(identity.ino);
            refused = await refuseUntrustedEvidence();
          } finally {
            await restoreTestTuple(databasePath, tuple);
          }
          expect(await liveTuple(databasePath)).toEqual(tuple);
          expect(statSync(databasePath).ino).toBe(identity.ino);
          await restartAfterRefusal(refused!);
        }
        const priorAttempts = structuredClone(record().recovery?.attempts ?? []);
        if (cold) {
          let earlyFailure: { error?: unknown } | undefined;
          const interrupted = recover().then(
            () => {
              earlyFailure = {};
            },
            (error: unknown) => {
              earlyFailure = { error };
            },
          );
          await expect
            .poll(() => existsSync(coldMarker) || earlyFailure !== undefined, { timeout: 100_000 })
            .toBe(true);
          if (!existsSync(coldMarker))
            throw (
              earlyFailure?.error ??
              new Error('Cold recovery completed without reaching its crash cut.')
            );
          const coldReached = JSON.parse(await readFile(coldMarker, 'utf8'));
          expect(coldReached.cut).toBe(cold);
          const attempted = record(),
            attempt = currentRestoreRecovery(attempted)!;
          expect(attempt.phase).toBe(coldPhases[cold]);
          expect(attempted.intent).toEqual(before.intent);
          expect(attempted.execution).toEqual(before.execution);
          expect(attempted.phase).toBe(before.phase);
          expect(attempt.grantedAt).toBeGreaterThan(before.intent.authority.expiresAt);
          expect(attempt.deadline - attempt.grantedAt).toBe(90_000);
          if (attempt.image) {
            const preparedPath = join(
              root,
              `restore-${prepared.id}`,
              `cold-${attempt.slot}`,
              'work',
              attempt.image.directory,
              'rollback.sqlite',
            );
            const bytes = await readFile(preparedPath);
            expect(bytes.length).toBe(attempt.image.bytes);
            expect(createHash('sha256').update(bytes).digest('hex')).toBe(attempt.image.sha256);
            if (cold === 'cold-prepared')
              await inspectCopy(directory, preparedPath, false, (database) => {
                expect(restoreSnapshotFingerprint(database)).toBe(attempt.image!.fingerprint);
                expect(
                  database
                    .prepare('SELECT name FROM workspace_items WHERE id=?')
                    .get(source.folderId)?.name,
                ).toBe('Current folder');
              });
          }
          const coldMain = JSON.parse(await readFile(join(root, 'journal.json'), 'utf8'));
          if (cold === 'cold-admission') {
            expect(coldMain.operation.actorId).toBe(before.intent.authority.actorId);
            expect(coldMain.generationId).toBe(attempt.priorGenerationId);
          }
          if (cold === 'cold-trial-planned') {
            expect(coldMain.generationId).toBe(attempt.priorGenerationId);
            expect(coldMain.child).toBeNull();
          }
          if (cold === 'cold-activation') {
            expect(coldReached.bytesWritten).toBe(64 * 1024);
            expect(attempt.image!.bytes).toBeGreaterThan(coldReached.bytesWritten);
            expect(
              createHash('sha256')
                .update(await readFile(databasePath))
                .digest('hex'),
            ).not.toBe(attempt.image!.sha256);
          }
          if (cold === 'cold-private-open') {
            expect(coldReached.pid).toBe(attempt.trial!.child.pid);
            expect(coldReached.readiness.reference).toEqual(restoreTrialReference(attempt.trial!));
            expect(coldReached.readiness.fingerprint).toBe(attempt.image!.fingerprint);
            expect(attempt.readiness).toBeUndefined();
            expect(attempt.outcome).toBeUndefined();
          } else expect(coldReached.pid).toBe(controller!.pid);
          if (cold === 'cold-commit') {
            expect(attempt.outcome!.fingerprint).toBe(attempt.image!.fingerprint);
            expect(coldMain.child).toEqual(attempt.trial!.child);
            expect(sameProcess(attempt.trial!.child)).toBe(true);
          }
          const coldEvidence = await retains(root, retained);
          await kill(controller!);
          await interrupted;
          clockOffset += 6 * 60_000;
          await launch(false);
          assertWorkspaceHandlesClosed(databasePath);
          expect(record()).toEqual(attempted);
          expect(await evidence(root)).toEqual(coldEvidence);
          if (cold === 'cold-trial-planned') {
            const restarted = JSON.parse(await readFile(join(root, 'journal.json'), 'utf8'));
            expect(restarted.child).toBeNull();
            expect(restarted.generationId).toBe(attempt.priorGenerationId);
            expect(sameProcess(attempt.trial!.child)).toBe(true);
            expect(processResourcesReleased(String(attempt.trial!.child.pid))).toBe(false);
          }
          expect((await recover()).status.phase).toBe('running');
          if (cold === 'cold-trial-planned')
            expect(processResourcesReleased(String(attempt.trial!.child.pid))).toBe(true);
          if (cold === 'cold-commit') expect(record()).toEqual(attempted);
          else {
            expect(record().recovery!.attempts.slice(0, -1)).toEqual(attempted.recovery!.attempts);
            expect(currentRestoreRecovery(record())!.grantedAt).toBeGreaterThan(attempt.deadline);
            expect(currentRestoreRecovery(record())!.slot).not.toBe(attempt.slot);
          }
          completedEvidence = await retains(root, coldEvidence);
        } else expect((await recover()).status.phase).toBe('running');

        committed = record();
        expect(restoreJobPhase(committed)).toBe('original-committed');
        expect(committed.intent).toEqual(before.intent);
        expect(committed.execution).toEqual(before.execution);
        expect((committed.recovery?.attempts ?? []).slice(0, priorAttempts.length)).toEqual(
          priorAttempts,
        );
        const current = currentRestoreRecovery(committed);
        if (unresolved) {
          expect(current).toBeDefined();
          expect(current!.grantedAt).toBeGreaterThan(before.intent.authority.expiresAt);
          expect(current!.deadline - current!.grantedAt).toBe(90_000);
          expect(current!.outcome!.role).toBe('original');
          expect(current!.outcome!.fingerprint).toBe(current!.image!.fingerprint);
        } else expect(committed).toEqual(before);
        expect(existsSync(restoreBarrierPath(databasePath))).toBe(false);
        completedEvidence = await retains(root, completedEvidence);
        const recoveredImage = current?.image ?? committed.execution!.rollback!.image!;
        // The recovered image reconciles access and generation fences. Its full
        // fingerprint differs from raw original content, which was independently
        // authenticated above against the application's shutdown witness.
        await close(controller!);
        await launch(false);
        assertWorkspaceHandlesClosed(databasePath);
        await inspectCopy(directory, databasePath, true, (database) => {
          expect(restoreSnapshotFingerprint(database)).toBe(recoveredImage.fingerprint);
          expect(
            database.prepare('SELECT name FROM workspace_items WHERE id=?').get(source.folderId)
              ?.name,
          ).toBe('Current folder');
          expect(database.prepare('SELECT 1 FROM auth_sessions').get()).toBeUndefined();
          expect(database.prepare('SELECT 1 FROM workspace_guest_sessions').get()).toBeUndefined();
          expect(
            database
              .prepare('SELECT state,token_hash,preview_hash FROM workspace_links WHERE item_id=?')
              .get(linkedId!),
          ).toEqual({ state: 'off', token_hash: null, preview_hash: null });
        });
        expect((await recover()).status.phase).toBe('running');
        expect(record()).toEqual(committed);
        expect(await evidence(root)).toEqual(completedEvidence);
        expect((await client.request('/api/auth/session')).status).toBe(401);
        expect((await ownerClient!.request('/api/auth/session')).status).toBe(401);
        await client.authenticate();
        const status = await client.json<{
          outcome: { id: string; state: string };
          pending: boolean;
        }>(await client.request('/api/admin/restores'));
        expect(status.outcome.id).toBe(prepared.id);
        expect(status.outcome.state).toBe('original-recovered');
        expect(status.pending).toBe(false);
        await ownerClient!.authenticate();
        const session = await ownerClient!.json<{ restore: { outcome: string } }>(
          await ownerClient!.request('/api/auth/session'),
        );
        expect(session.restore.outcome).toBe('recovered');
        const folder = await ownerClient!.json<{ item: { name: string } }>(
          await ownerClient!.request(`/api/items/${source.folderId}`),
        );
        expect(folder.item.name).toBe('Current folder');
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
        if (cut === 'activation' && !cold) {
          // A historical successful recovery must not steal a different ordinary
          // maintenance operation, even though it selected this live generation.
          const operationId = randomUUID();
          for (const action of ['pause', 'stop'] as const)
            await maintenanceControl(root, { action, operationId });
          const stopped = await readFile(join(root, 'journal.json'));
          const bytes = await readFile(databasePath);
          await expect(recover()).rejects.toThrow('exact current maintenance operation');
          expect(await readFile(join(root, 'journal.json'))).toEqual(stopped);
          expect(await readFile(databasePath)).toEqual(bytes);
          expect(record()).toEqual(committed);
          for (const action of ['verify', 'start', 'resume'] as const)
            await maintenanceControl(root, { action, operationId });
        }
      }
      await close(controller!);
      await launch(false);
      assertWorkspaceHandlesClosed(databasePath);
      if (recoversOriginal) {
        expect((await recover()).status.phase).toBe('running');
        expect(record()).toEqual(committed);
        expect(await evidence(root)).toEqual(completedEvidence);
        await close(controller!);
        assertWorkspaceHandlesClosed(databasePath);
      }
      {
        const location = pathToFileURL(await probeCopy(directory, databasePath, true));
        location.searchParams.set('mode', 'ro');
        const database = new DatabaseSync(location.href);
        try {
          expect(
            database.prepare('SELECT name FROM workspace_items WHERE id=?').get(source.folderId)
              ?.name,
          ).toBe(
            cut === 'admission' || preActivation || recoversOriginal
              ? 'Current folder'
              : 'Archived folder',
          );
          if (recoversOriginal) {
            const key = database
              .prepare('SELECT user_id,public_key,counter FROM auth_passkeys WHERE id=?')
              .get(ownerCredential.id);
            expect(key?.user_id).toBe(ownerId);
            expect(Buffer.from(key!.public_key as Uint8Array).toString('base64url')).toBe(
              ownerCredential.publicKey,
            );
            // Acknowledged fresh authentication after the first recovery must
            // survive the second restart, rather than reinstalling prepared bytes.
            expect(key?.counter).toBe(ownerCredential.counter());
            expect(ownerCredential.counter()).toBeGreaterThan(0);
          }
          if (acknowledgedId)
            expect(
              database.prepare('SELECT name FROM workspace_items WHERE id=?').get(acknowledgedId)
                ?.name,
            ).toBe('Acknowledged after restore');
        } finally {
          database.close();
        }
      }
      expect(await evidence(root)).toEqual(completedEvidence);
      if (witnessBytes)
        expect(await readFile(join(directory, 'failed-trial-witness.json'))).toEqual(witnessBytes);
      expect(
        createHash('sha256')
          .update(await readFile(source.archive))
          .digest('hex'),
      ).toBe(source.sha256);
      recoveryComplete = true;
    } catch (error) {
      primaryFailure = { error };
      throw error;
    } finally {
      let controllerClosed = false;
      await finishRestoreCrashCleanup(
        [
          async () => {
            if (controller) await close(controller);
            controllerClosed = true;
          },
          async () => {
            // Do not open a competing controller or remove evidence if closure failed.
            if (!controllerClosed) return;
            if (!recoveryComplete) {
              // Startup reaps adopted children. The exact recorded planned permit
              // also owns a child that may not yet appear in main.child.
              let startupFailure: { error: unknown } | undefined;
              try {
                await launch(false, false, true);
              } catch (error) {
                startupFailure = { error };
                throw error;
              } finally {
                await finishRestoreCrashCleanup(
                  [
                    async () => {
                      if (controller) await close(controller);
                    },
                  ],
                  startupFailure,
                );
              }
              assertWorkspaceHandlesClosed(databasePath);
            } else {
              assertWorkspaceHandlesClosed(databasePath);
              await rm(directory, { recursive: true, force: true });
            }
          },
        ],
        primaryFailure,
      );
    }
  },
  180_000,
);
