/** Real provider/catalog/controller acceptance. The image policy is synthetic;
 * immutable production-image/browser acceptance is recorded separately. */
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from '../../server/database.ts';
import type { SpacesConfig } from '../../src/server/backup/config.ts';
import type { SpacesStore } from '../../src/server/backup/spaces.ts';
import {
  authenticator,
  origin,
  restoreHttpClient,
  seed,
} from '../../src/server/maintenance/restore-http-test-client.ts';
import type { RestoreJobRecord } from '../../src/server/maintenance/restore-jobs.ts';
import { MaintenanceSupervisor } from '../../src/server/maintenance/supervisor.ts';
import type { RestorePreparation, RestoreStatus } from '../../src/shared/restore.ts';

interface RestoreEvidence {
  status: 'passed' | 'failed';
  failedStep?: string;
  checks: string[];
  runtime: 'real-app-child-process';
  imagePolicy: 'synthetic-fixture';
  localCleanup: 'safe' | 'retain';
  archiveBytes?: number;
  sourceSha256?: string;
}
const requireResult = (condition: unknown) => {
  if (!condition) throw new Error('Supervised provider acceptance assertion failed.');
};

export async function runSupervisedSpacesRestore(options: {
  configuration: SpacesConfig;
  remote: SpacesStore;
  directory: string;
  signal: AbortSignal;
  deadline: number;
  own: (key: string) => void;
}): Promise<RestoreEvidence> {
  const { configuration, remote, directory, signal } = options;
  const evidence: RestoreEvidence = {
    status: 'failed',
    checks: [],
    runtime: 'real-app-child-process',
    imagePolicy: 'synthetic-fixture',
    // Bootstrap owns SQLite too. A failed seed without a returned exit witness
    // cannot authorize deletion even before a supervisor has been returned.
    localCleanup: 'retain',
  };
  let step = 'complete-app-provider-fixture';
  let supervisor: MaintenanceSupervisor | undefined;
  let closeAttempted = false;
  const closeController = async () => {
    if (!supervisor || closeAttempted) return;
    // A rejected close is not retried: the controller's closing flag can make
    // a subsequent call resolve without establishing physical closure.
    closeAttempted = true;
    await supervisor.close();
    evidence.localCleanup = 'safe';
    supervisor = undefined;
  };
  try {
    signal.throwIfAborted();
    const data = join(directory, 'controller-data');
    const root = join(directory, 'controller-recovery');
    await mkdir(data, { mode: 0o700 });
    await mkdir(root, { mode: 0o700 });
    const databasePath = join(data, 'workspace.sqlite');
    const credential = authenticator();
    const source = await seed(databasePath, credential);
    evidence.localCleanup = 'safe';
    evidence.archiveBytes = source.bytes;
    evidence.sourceSha256 = source.sha256;
    const runtimeEnvironmentFile = join(data, 'runtime.env');
    await writeFile(runtimeEnvironmentFile, 'NODE_ENV=production\n', { mode: 0o600, flag: 'wx' });
    const configPath = join(data, 'backup.json');
    await writeFile(
      configPath,
      JSON.stringify({
        ...configuration,
        version: 1,
        automatic: false,
        keyId: 'http-fixture',
        keyFile: source.keyFile,
        runtimeEnvironmentFile,
      }),
      { mode: 0o600, flag: 'wx' },
    );
    const key = `${configuration.prefix}/${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.spinel`;
    // The caller registers ownership before publication and performs independent
    // cleanup after cancellation. No bucket-wide discovery authorizes deletion.
    options.own(key);
    options.own(`${key}.pending`);
    await remote.put(key, source.archive, source.sha256, signal);
    requireResult((await remote.list(signal)).length === 1);
    evidence.checks.push(step);

    const portProbe = createServer();
    await new Promise<void>((resolve, reject) => {
      portProbe.once('error', reject);
      portProbe.listen(0, '127.0.0.1', resolve);
    });
    const port = (portProbe.address() as { port: number }).port;
    await new Promise<void>((resolve, reject) =>
      portProbe.close((error) => (error ? reject(error) : resolve())),
    );
    step = 'provider-controller-start';
    // Even a rejected open may have attempted ownership/reconciliation. Without
    // a returned controller and positively completed close, retain its files.
    evidence.localCleanup = 'retain';
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
        fork(fileURLToPath(new URL('../../server/index.ts', import.meta.url)), [], {
          env: {
            ...environment,
            HOST: '127.0.0.1',
            PORT: String(port),
            BACKUP_CONFIG_PATH: configPath,
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
    const boot = randomUUID();
    await supervisor.coldControl({ action: 'verify', operationId: boot });
    await supervisor.coldControl({ action: 'start', operationId: boot });
    await supervisor.coldControl({ action: 'resume', operationId: boot });
    const originalGeneration = supervisor.status().generationId;
    const client = restoreHttpClient(
      `http://127.0.0.1:${port}`,
      source.operatorId,
      credential,
      signal,
    );
    await client.authenticate();
    step = 'operator-provider-catalog';
    const catalog = await client.json<{ entries: { id: string; createdAt: number }[] }>(
      await client.request('/api/admin/restores/catalog'),
    );
    requireResult(catalog.entries.length === 1 && /^[a-f0-9]{64}$/.test(catalog.entries[0].id));
    requireResult(!JSON.stringify(catalog).includes(configuration.prefix));
    evidence.checks.push(step);

    step = 'catalog-source-preparation';
    await client.reauthenticate();
    let prepared = await client.json<RestorePreparation>(
      await client.request('/api/admin/restores/preparations', {
        requestId: randomUUID(),
        source: 'catalog',
        artifactId: catalog.entries[0].id,
      }),
      202,
    );
    const preparationDeadline = Date.now() + 60_000;
    while (prepared.state === 'preparing' && Date.now() < preparationDeadline) {
      await delay(100, undefined, { signal });
      const status = await client.json<RestoreStatus>(await client.request('/api/admin/restores'));
      requireResult(status.job?.id === prepared.id);
      prepared = status.job!;
    }
    requireResult(
      prepared.state === 'ready' &&
        prepared.source === 'catalog' &&
        prepared.sourceSha256 === source.sha256 &&
        prepared.bytes === source.bytes &&
        prepared.preview?.currentAccounts === 2 &&
        prepared.preview.currentPasskeys === 1,
    );
    evidence.checks.push(step);
    await client.reauthenticate();
    step = 'catalog-confirmation-and-private-release';
    const accepted = await client.json<RestorePreparation>(await client.confirm(prepared), 202);
    requireResult(accepted.state === 'started');
    const statePath = join(root, 'restore-jobs', prepared.id, 'state.json');
    let record: RestoreJobRecord;
    const executionDeadline = Date.now() + 100_000;
    for (;;) {
      signal.throwIfAborted();
      record = JSON.parse(await readFile(statePath, 'utf8')) as RestoreJobRecord;
      requireResult(supervisor.status().phase !== 'recovery-required');
      if (record.phase === 'candidate-committed' && supervisor.status().phase === 'running') break;
      requireResult(Date.now() < executionDeadline);
      await delay(100, undefined, { signal });
    }
    requireResult(
      record.execution?.readiness?.fingerprint === record.execution?.outcome?.fingerprint &&
        record.execution?.outcome?.role === 'candidate' &&
        record.intent.source.archive.sha256 === source.sha256 &&
        supervisor.status().generationId !== originalGeneration &&
        supervisor.journal.state.restoreJob === null,
    );
    evidence.checks.push(step);

    step = 'provider-restore-session-revocation-and-outcome';
    requireResult((await client.request('/api/auth/session')).status === 401);
    await client.authenticate();
    const outcome = await client.json<RestoreStatus>(await client.request('/api/admin/restores'));
    requireResult(
      outcome.pending === false &&
        outcome.job === null &&
        outcome.outcome?.id === prepared.id &&
        outcome.outcome.state === 'backup-restored' &&
        outcome.outcome.source.sha256 === source.sha256,
    );
    evidence.checks.push(step);
    step = 'provider-controller-closure';
    await closeController();
    step = 'provider-restored-content-and-current-passkey';
    const location = pathToFileURL(databasePath);
    location.searchParams.set('mode', 'ro');
    const saved = new DatabaseSync(location.href);
    try {
      requireResult(
        saved.prepare('SELECT name FROM workspace_items WHERE id=?').get(source.folderId)?.name ===
          'Archived folder' &&
          Number(
            saved.prepare('SELECT counter FROM auth_passkeys WHERE id=?').get(credential.id)
              ?.counter,
          ) >= credential.counter(),
      );
    } finally {
      saved.close();
    }
    evidence.checks.push(step);
    signal.throwIfAborted();
    requireResult(Date.now() < options.deadline);
    evidence.status = 'passed';
  } catch {
    evidence.failedStep = step;
  } finally {
    try {
      await closeController();
    } catch {
      evidence.status = 'failed';
      evidence.failedStep ??= 'provider-controller-closure';
    }
  }
  return evidence;
}
