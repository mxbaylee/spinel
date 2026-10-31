import { fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, vi } from 'vitest';
import { RestoreJobs } from '../maintenance/restore-jobs.ts';
import type { RestoreJobRecord } from '../maintenance/restore-jobs.ts';
import { MaintenanceSupervisor } from '../maintenance/supervisor.ts';
import {
  authenticator,
  origin,
  restoreHttpClient,
  seed,
} from '../maintenance/restore-http-test-client.ts';
import type { RestorePreparation, RestoreStatus } from '../../shared/restore.ts';

async function retainedFiles(directory: string) {
  const files: Record<string, string> = {};
  const walk = async (path: string) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else {
        expect(entry.isFile()).toBe(true);
        files[relative(directory, child)] = createHash('sha256')
          .update(await readFile(child))
          .digest('hex');
      }
    }
  };
  await walk(directory);
  return files;
}

test.skipIf(process.platform !== 'linux').each(['published-failure', 'full-journal'] as const)(
  'real %s admission releases only its logical hold and permits a new Operator preparation',
  async (scenario) => {
    const directory = await mkdtemp(join(tmpdir(), 'spinel-restore-admission-'));
    const data = join(directory, 'data'),
      root = join(directory, 'recovery');
    let supervisor: MaintenanceSupervisor | undefined;
    let passed = false;
    const originalCheckpoint = RestoreJobs.prototype.checkpoint;
    const originalAdmit = RestoreJobs.prototype.admit;
    let injected = 0;
    const fault =
      scenario === 'published-failure'
        ? vi.spyOn(RestoreJobs.prototype, 'checkpoint').mockImplementation(function (
            this: RestoreJobs,
            ...args
          ) {
            // Actual encrypted custody and the main reference already exist. Refuse
            // only its first source-retained publication; the real failure journal and
            // subsequent observation/recovery are not mocked.
            if (args[3] === 'source-retained' && injected++ === 0)
              throw new Error('Injected source-retained publication failure.');
            return originalCheckpoint.apply(this, args);
          })
        : vi.spyOn(RestoreJobs.prototype, 'admit').mockImplementation(function (
            this: RestoreJobs,
            intent,
          ) {
            if (injected++ === 0) {
              // Retain 64 canonical terminal IDs, then let the real capacity guard
              // refuse the requested 65th admission before any record is published.
              for (let index = 0; index < 64; index++) {
                const previous = structuredClone(intent),
                  id = randomUUID();
                previous.id = id;
                previous.source.id = id;
                const record = originalAdmit.call(this, previous).record;
                this.checkpoint(id, record.intentHash, record.revision, 'failed');
              }
            }
            return originalAdmit.call(this, intent);
          });
    try {
      await mkdir(data, { mode: 0o700 });
      await mkdir(root, { mode: 0o700 });
      const databasePath = join(data, 'workspace.sqlite');
      const credential = authenticator();
      const source = await seed(databasePath, credential);
      const probe = createServer();
      await new Promise<void>((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', resolve);
      });
      const port = (probe.address() as { port: number }).port;
      await new Promise<void>((resolve, reject) =>
        probe.close((error) => (error ? reject(error) : resolve())),
      );
      supervisor = await MaintenanceSupervisor.open({
        root,
        databasePath,
        publicPort: 0,
        applicationPolicy: {
          origin,
          image: `spinel@sha256:${'a'.repeat(64)}`,
          spaceReview: true,
          staticDirectory: join(data, 'assets'),
        },
        createChild: (_token, environment) =>
          fork(fileURLToPath(new URL('../../../server/index.ts', import.meta.url)), [], {
            env: {
              ...environment,
              HOST: '127.0.0.1',
              PORT: String(port),
              BACKUP_CONFIG_PATH: join(data, 'absent-backup-config'),
            },
            execArgv: ['--max-old-space-size=256', '--max-semi-space-size=8'],
            detached: true,
            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          }),
        budgets: {
          startMs: 25_000,
          verifyMs: 20_000,
          drainMs: 15_000,
          stopMs: 5000,
          restoreMs: 90_000,
        },
      });
      const operationId = randomUUID();
      for (const action of ['verify', 'start', 'resume'] as const)
        await supervisor.coldControl({ action, operationId });
      const originalTarget = supervisor.status();
      const client = restoreHttpClient(`http://127.0.0.1:${port}`, source.operatorId, credential);
      await client.authenticate();
      const first = await client.prepare(source);
      const admitted = await client.json<RestorePreparation>(await client.confirm(first), 202);
      expect(admitted.state).toBe('admitting');
      expect(injected).toBe(1);
      const recordPath = join(root, 'restore-jobs', first.id, 'state.json');
      const failed =
        scenario === 'published-failure'
          ? (JSON.parse(await readFile(recordPath, 'utf8')) as RestoreJobRecord)
          : null;
      if (failed) {
        expect(failed.phase).toBe('failed');
        expect(failed.execution).toBeUndefined();
      } else await expect(readFile(recordPath)).rejects.toHaveProperty('code', 'ENOENT');
      expect(supervisor.journal.state.restoreJob).toBeNull();
      expect(supervisor.status()).toMatchObject({
        phase: 'running',
        generationId: originalTarget.generationId,
        epoch: originalTarget.epoch,
      });
      const stagingNames = (await readdir(data)).filter((name) =>
        name.startsWith('.restore-preparation-'),
      );
      expect(stagingNames).toHaveLength(1);
      const staging = join(data, stagingNames[0]);
      const custody =
        scenario === 'published-failure'
          ? join(root, `restore-${first.id}-source`)
          : join(root, 'restore-jobs');
      const held = await retainedFiles(staging),
        sealed = await retainedFiles(custody);
      expect(Object.keys(held)).toContain('handoff.json');
      if (failed) expect(Object.keys(sealed)).toContain('ready');
      else
        expect(Object.keys(sealed).filter((name) => name.endsWith('/state.json'))).toHaveLength(64);

      // The same still-running app and real session observe the exact failure.
      // Before the repair, this outcome hid the old UI job but its permanent
      // in-memory admission/lease still made the next preparation return409.
      const outcome = await client.json<RestoreStatus>(await client.request('/api/admin/restores'));
      expect(outcome.pending).toBe(false);
      if (failed) expect(outcome.outcome).toMatchObject({ id: first.id, state: 'did-not-start' });
      else expect(outcome.outcome).toBeNull();
      expect(outcome.job === null || outcome.job.state === 'failed').toBe(true);
      expect(await retainedFiles(staging)).toEqual(held);
      expect(await retainedFiles(custody)).toEqual(sealed);
      const next = await client.prepare(source);
      expect(next.id).not.toBe(first.id);
      expect(next.state).toBe('ready');
      const repeated = await client.json<RestorePreparation>(await client.confirm(first), 202);
      expect(repeated.state).toBe('failed');
      if (failed) expect(JSON.parse(await readFile(recordPath, 'utf8'))).toEqual(failed);
      else await expect(readFile(recordPath)).rejects.toHaveProperty('code', 'ENOENT');
      const current = await client.json<RestoreStatus>(await client.request('/api/admin/restores'));
      expect(current.job).toMatchObject({ id: next.id, state: 'ready' });
      expect(await retainedFiles(staging)).toEqual(held);
      expect(await retainedFiles(custody)).toEqual(sealed);
      const cancelled = await client.json<RestorePreparation>(
        await client.request(`/api/admin/restores/preparations/${next.id}/cancel`, {}),
      );
      expect(cancelled.state).toBe('cancelled');
      passed = true;
    } finally {
      fault.mockRestore();
      await supervisor?.close();
      if (passed) await rm(directory, { recursive: true, force: true });
    }
  },
  120_000,
);
