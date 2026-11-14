import { fork } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { expect, test } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import { COOKIE_NAME, hashToken } from '../auth/store.ts';
import { MaintenanceSupervisor } from '../maintenance/supervisor.ts';
import type { RestoreJobRecord } from '../maintenance/restore-jobs.ts';
import type { RestoreStopRecord } from '../maintenance/restore-stop.ts';
import { RecoveryResourceError } from './resource-error.ts';
import type { RestoreHttpSeed } from '../maintenance/restore-http-fixture.ts';
import {
  validRestoreNotice,
  validRestoreResources,
  validRestoreVerification,
  type RestoreNotice,
  type RestorePreparation,
  type RestoreStatus,
} from '../../shared/restore.ts';

const origin = 'https://spinel.example';
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest();

/** This speaks the real WebAuthn assertion format, not a replacement verifier.
 * Only the synthetic public credential is seeded; private keys stay in memory. */
function authenticator() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const id = randomBytes(32).toString('base64url');
  // COSE EC2: kty2, algES256(-7), curveP256(1), x/y coordinates.
  const cose = Buffer.concat([
    Buffer.from([0xa5, 1, 2, 3, 0x26, 0x20, 1, 0x21, 0x58, 32]),
    Buffer.from(jwk.x!, 'base64url'),
    Buffer.from([0x22, 0x58, 32]),
    Buffer.from(jwk.y!, 'base64url'),
  ]);
  let counter = 0;
  return {
    id,
    publicKey: cose.toString('base64url'),
    counter: () => counter,
    assertion(challenge: string, userId: string): AuthenticationResponseJSON {
      const clientDataJSON = Buffer.from(
        JSON.stringify({
          type: 'webauthn.get',
          challenge,
          origin,
          crossOrigin: false,
        }),
      );
      const count = Buffer.alloc(4);
      count.writeUInt32BE(++counter);
      const data = Buffer.concat([hash(new URL(origin).hostname), Buffer.from([0x05]), count]);
      return {
        id,
        rawId: id,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientDataJSON.toString('base64url'),
          authenticatorData: data.toString('base64url'),
          signature: sign(
            'sha256',
            Buffer.concat([data, hash(clientDataJSON)]),
            privateKey,
          ).toString('base64url'),
          userHandle: Buffer.from(userId).toString('base64url'),
        },
      };
    },
  };
}

async function seed(databasePath: string, credential: ReturnType<typeof authenticator>) {
  const child = fork(
    fileURLToPath(new URL('../maintenance/restore-http-fixture.ts', import.meta.url)),
    [],
    {
      env: { ...process.env, DATABASE_PATH: databasePath },
      execArgv: [],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    },
  );
  return new Promise<RestoreHttpSeed>((resolve, reject) => {
    let result: RestoreHttpSeed | undefined;
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.on('message', (value: unknown) => {
      if (value && typeof value === 'object' && 'operatorId' in value)
        result = value as RestoreHttpSeed;
    });
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('HTTP fixture could not start.'));
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0 || !result) reject(new Error('HTTP fixture did not finish.'));
      else resolve(result);
    });
    child.send({ kind: 'credential', id: credential.id, publicKey: credential.publicKey });
  });
}

/** HTTP/IPC controller acceptance, not browser/TLS or remote-provider acceptance.
 * No controller, ownership message, archive verifier or auth verifier is mocked. */
test('real Operator HTTP confirmation crosses custody ACK and Begin into committed private release', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-restore-http-'));
  const root = join(directory, 'recovery'),
    data = join(directory, 'data');
  await mkdir(root, { mode: 0o700 });
  await mkdir(data, { mode: 0o700 });
  const databasePath = join(data, 'workspace.sqlite');
  let supervisor: MaintenanceSupervisor | undefined;
  try {
    const credential = authenticator();
    const source = await seed(databasePath, credential);
    const portProbe = createServer();
    await new Promise<void>((resolve, reject) => {
      portProbe.once('error', reject);
      portProbe.listen(0, '127.0.0.1', resolve);
    });
    const port = (portProbe.address() as { port: number }).port;
    await new Promise<void>((resolve, reject) =>
      portProbe.close((error) => (error ? reject(error) : resolve())),
    );
    const base = `http://127.0.0.1:${port}`;
    let restoreId: string | undefined,
      custodyBeforeDrain = false,
      preparationReleasedBeforeDrain = false;
    const statePath = () => join(root, 'restore-jobs', restoreId!, 'state.json');
    const record = () => {
      try {
        return JSON.parse(readFileSync(statePath(), 'utf8')) as RestoreJobRecord;
      } catch {
        throw new Error('Durable restore record is unavailable.');
      }
    };
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
      // Only process environment/port selection is replaced. This is the shipped
      // application entrypoint and the supervisor owns its complete protocol.
      createChild: (_token, environment) =>
        fork(fileURLToPath(new URL('../../../server/index.ts', import.meta.url)), [], {
          env: {
            ...environment,
            PORT: String(port),
            HOST: '127.0.0.1',
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
      onTransition: (status) => {
        if (restoreId && status.phase === 'draining') {
          try {
            const current = record();
            custodyBeforeDrain =
              current.phase === 'pause-planned' &&
              existsSync(join(root, `restore-${restoreId}-source`, 'ready'));
            preparationReleasedBeforeDrain = !readdirSync(data).some((name) =>
              name.startsWith('.restore-preparation-'),
            );
          } catch {
            /* The observations fail below without disturbing the controller. */
          }
        }
      },
    });
    // Diagnostic call-through only: never change the guard, budgets or result.
    // Retain typed resource codes and numeric kernel observations, never messages.
    let stopDiagnostic: Record<string, string | number | null> | null = null;
    type StopControl = {
      stopForRestoreOwned(
        id: string,
        checkpoint?: {
          request(record: RestoreStopRecord): void;
          witness(record: RestoreStopRecord): void;
        },
      ): Promise<RestoreStopRecord>;
    };
    const stopControl = supervisor as unknown as StopControl;
    const originalStop = stopControl.stopForRestoreOwned.bind(supervisor);
    stopControl.stopForRestoreOwned = async (...args) => {
      try {
        return await originalStop(...args);
      } catch (error) {
        const numeric = (path: string, pattern: RegExp) => {
          try {
            const value = Number(pattern.exec(readFileSync(path, 'utf8'))?.[1]);
            return Number.isSafeInteger(value) && value >= 0 ? value : null;
          } catch {
            return null;
          }
        };
        stopDiagnostic = {
          code: error instanceof RecoveryResourceError ? error.code : 'untyped-failure',
          phase: supervisor!.status().phase,
          cgroupLimitBytes: numeric('/sys/fs/cgroup/memory.max', /^(\d+)/),
          cgroupUsedBytes: numeric('/sys/fs/cgroup/memory.current', /^(\d+)/),
          hostAvailableKiB: numeric('/proc/meminfo', /^MemAvailable:\s+(\d+)/m),
          processRssBytes: process.memoryUsage().rss,
        };
        throw error;
      }
    };
    const boot = randomUUID();
    await supervisor.coldControl({ action: 'verify', operationId: boot });
    await supervisor.coldControl({ action: 'start', operationId: boot });
    await supervisor.coldControl({ action: 'resume', operationId: boot });
    const originalGeneration = supervisor.status().generationId;
    let cookie = '',
      epoch: string | undefined;
    const request = async (path: string, body?: unknown, binary?: Buffer, timeoutMs = 25_000) => {
      let response: Response;
      try {
        response = await fetch(base + path, {
          method: body === undefined && !binary ? 'GET' : 'POST',
          headers: {
            Origin: origin,
            'X-Spinel-Account': source.operatorId,
            ...(epoch === undefined ? {} : { 'X-Spinel-Epoch': epoch }),
            ...(cookie ? { Cookie: cookie } : {}),
            ...(binary
              ? { 'Content-Type': 'application/octet-stream' }
              : body === undefined
                ? {}
                : { 'Content-Type': 'application/json' }),
          },
          ...(binary
            ? { body: new Uint8Array(binary) }
            : body === undefined
              ? {}
              : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new Error('Bounded HTTP restore request failed.');
      }
      const replacement = response.headers.get('set-cookie');
      if (replacement?.startsWith(`${COOKIE_NAME}=`)) cookie = replacement.split(';')[0];
      return response;
    };
    const json = async <T>(response: Response, status = 200): Promise<T> => {
      expect(response.status, 'HTTP status; private response body intentionally omitted').toBe(
        status,
      );
      try {
        return (await response.json()) as T;
      } catch {
        throw new Error('Expected a bounded JSON response.');
      }
    };
    const prove = async (kind: 'authentication' | 'reauthentication') => {
      const options = await json<{ options: { challenge: string }; challengeId: string }>(
        await request(`/api/auth/${kind}/options`, {}),
      );
      await json(
        await request(`/api/auth/${kind}/verify`, {
          challengeId: options.challengeId,
          response: credential.assertion(options.options.challenge, source.operatorId),
        }),
      );
    };
    // Match the shipped client's initial public observation. Never adopt the
    // replacement generation's epoch for this old authenticated tab.
    const initial = await json<{ available: boolean; epoch: string }>(
      await request('/api/maintenance'),
    );
    expect(initial.available).toBe(true);
    epoch = initial.epoch;
    await prove('authentication');
    const oldCookie = cookie;
    expect(Boolean(oldCookie), 'real authentication returned a session cookie').toBe(true);
    const oldSessionHash = hashToken(oldCookie.slice(COOKIE_NAME.length + 1));
    const status = await json<{ available: boolean; job: unknown }>(
      await request('/api/admin/restores'),
    );
    expect(status.available).toBe(true);
    expect(status.job).toBeNull();
    await prove('reauthentication');
    const key = await readFile(source.keyFile);
    const secretKey = key.toString('base64');
    const publicBodies: string[] = [];
    const publicJob = async (response: Response, expectedStatus = 200) => {
      const value = await json<RestorePreparation>(response, expectedStatus);
      publicBodies.push(JSON.stringify(value));
      expect(Object.keys(value).sort()).toEqual(
        [
          'id',
          'state',
          'source',
          'createdAt',
          'expiresAt',
          'bytes',
          'sourceSha256',
          'sourceCreatedAt',
          'target',
          'preview',
          'verification',
          'resources',
          'confirmation',
          'consequencesVersion',
          'error',
        ].sort(),
      );
      return value;
    };
    let prepared: RestorePreparation;
    try {
      prepared = await publicJob(
        await request('/api/admin/restores/preparations', {
          requestId: randomUUID(),
          source: 'upload',
          key: secretKey,
        }),
        202,
      );
    } finally {
      key.fill(0);
    }
    restoreId = prepared.id;
    expect(prepared.state).toBe('uploading');
    prepared = await publicJob(
      await request(
        `/api/admin/restores/preparations/${restoreId}/upload`,
        undefined,
        await readFile(source.archive),
        60_000,
      ),
    );
    expect(prepared.state).toBe('ready');
    expect(prepared.sourceSha256).toBe(source.sha256);
    // Operator-visible preparation evidence: verified counts and the capacity
    // plan checked before pausing, never paths or secrets (checked below).
    expect(validRestoreVerification(prepared.verification)).toBe(true);
    expect(validRestoreResources(prepared.resources)).toBe(true);
    expect(prepared.resources?.sufficient).toBe(true);
    expect(prepared.preview).toMatchObject({
      provisional: true,
      currentAccounts: 2,
      currentPasskeys: 1,
    });
    await prove('reauthentication');
    const accepted = await publicJob(
      await request(`/api/admin/restores/preparations/${restoreId}/confirm`, {
        confirmation: prepared.confirmation,
        consequencesVersion: 1,
        acceptLostWork: true,
      }),
      202,
    );
    expect(
      accepted.state,
      'Begin response settled while its HTTP admission could still drain',
    ).toBe('started');
    // Stop promptly on protective recovery, preserving only safe diagnostics.
    const snapshot = () => {
      const current = record();
      return {
        job: current.phase,
        phase: supervisor!.status().phase,
        failure: supervisor!.status().lastFailure,
        outcome: current.execution?.outcome?.role ?? null,
      };
    };
    const deadline = Date.now() + 100_000;
    let observed = snapshot();
    while (Date.now() < deadline) {
      observed = snapshot();
      if (observed.phase === 'recovery-required')
        throw new Error(
          `HTTP restore entered protective recovery: ${JSON.stringify({ ...observed, stop: stopDiagnostic })}`,
        );
      if (observed.job === 'candidate-committed' && observed.phase === 'running') break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    expect(observed).toEqual({
      job: 'candidate-committed',
      phase: 'running',
      failure: null,
      outcome: 'candidate',
    });
    const terminal = record();
    expect(custodyBeforeDrain).toBe(true);
    expect(preparationReleasedBeforeDrain).toBe(true);
    expect(terminal.execution?.stop?.fingerprint).toBeTruthy();
    expect(terminal.execution?.readiness?.fingerprint).toBe(
      terminal.execution?.outcome?.fingerprint,
    );
    expect(terminal.execution?.trial?.generationId).toBe(supervisor.status().generationId);
    expect(supervisor.status().generationId).not.toBe(originalGeneration);
    expect(supervisor.journal.state.restoreJob).toBeNull();
    expect(terminal.intent.authority.actorId).toBe(source.operatorId);
    expect(terminal.intent.authority.sessionHash).toBe(oldSessionHash);
    expect(terminal.intent.source.archive.sha256).toBe(source.sha256);
    expect(terminal.intent.preview).toEqual(prepared.preview);
    const retained = await readFile(join(root, `restore-${restoreId}-source`, 'source.spinel.enc'));
    expect(hash(retained).toString('hex')).toBe(source.sha256);
    expect(
      (await request('/api/auth/session')).status,
      'old session rejected after private release',
    ).toBe(401);
    // A new page/session observes the replacement epoch and authenticates anew;
    // this never renews the original restore confirmation or its old session.
    cookie = '';
    epoch = (await json<{ epoch: string }>(await request('/api/maintenance'))).epoch;
    await prove('authentication');
    // Every account learns of the replacement after signing in again: two
    // dates, never the source, key, origin, image or archived environment.
    const session = await json<{ restore: unknown }>(await request('/api/auth/session'));
    expect(validRestoreNotice(session.restore)).toBe(true);
    expect((session.restore as RestoreNotice).outcome).toBe('restored');
    expect((session.restore as RestoreNotice).at).toBeLessThanOrEqual(Date.now());
    expect((session.restore as RestoreNotice).at).toBeGreaterThan(Date.now() - 10 * 60_000);
    publicBodies.push(JSON.stringify(session));
    const completed = await json<RestoreStatus>(await request('/api/admin/restores'));
    publicBodies.push(JSON.stringify(completed));
    expect(completed.pending).toBe(false);
    expect(completed.job).toBeNull();
    expect(Object.keys(completed.outcome!).sort()).toEqual(['id', 'source', 'state', 'updatedAt']);
    expect(completed.outcome?.state).toBe('backup-restored');
    expect(completed.outcome?.id).toBe(restoreId);
    expect(completed.outcome?.source.sha256).toBe(source.sha256);
    for (const text of publicBodies) {
      expect(
        [
          directory,
          source.keyFile,
          source.archive,
          secretKey,
          oldCookie,
          terminal.intent.continuationHash,
        ].some((secret) => text.includes(secret)),
        'public restore DTO contains private material',
      ).toBe(false);
      expect(
        /continuationToken|databasePath|keyFile|sessionHash/.test(text),
        'public restore DTO contains private fields',
      ).toBe(false);
    }
    await supervisor.close();
    supervisor = undefined;
    // Enforce the observer's read-only mode independently of adapter options,
    // including its last-close/WAL behavior on the pinned native driver.
    const location = pathToFileURL(databasePath);
    location.searchParams.set('mode', 'ro');
    const saved = new DatabaseSync(location.href);
    try {
      expect(
        saved.prepare('SELECT name FROM workspace_items WHERE id=?').get(source.folderId)?.name,
      ).toBe('Archived folder');
      expect(
        saved
          .prepare('SELECT COUNT(*) AS count FROM auth_sessions WHERE token_hash=?')
          .get(oldSessionHash)?.count,
      ).toBe(0);
      expect(
        saved.prepare('SELECT counter FROM auth_passkeys WHERE id=?').get(credential.id)?.counter,
      ).toBe(credential.counter());
    } finally {
      saved.close();
    }
  } finally {
    // Failed shutdown preserves private evidence; do not remove files underneath
    // an owner whose physical closure was not established.
    await supervisor?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 240_000);
