/** Test-only real WebAuthn signer and credential bootstrap; never seeds sessions. */
import { fork, type ChildProcess } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { RestoreHttpSeed } from './restore-http-fixture.ts';
import { readFile } from 'node:fs/promises';
import { COOKIE_NAME } from '../auth/store.ts';
import type { RestorePreparation } from '../../shared/restore.ts';
export const origin = 'https://spinel.example';
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest();
/** This speaks the real WebAuthn assertion format, not a replacement verifier.
 * Only the synthetic public credential is seeded; private keys stay in memory. */
export function authenticator() {
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

/** An IPC error does not prove a spawned SQLite owner has exited. Contain the
 * exact owned child and settle only after exit; an unwitnessed closure is an
 * explicit failure that callers must retain fixture files for. */
function seedResult<T>(
  child: ChildProcess,
  credential: ReturnType<typeof authenticator>,
  timeoutMs: number,
  read: (value: unknown) => T | undefined,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let result: T | undefined, failure: Error | undefined;
    let settled = false;
    let containmentStarted = false;
    let closureTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(closureTimer);
      if (error) reject(error);
      else resolve(result!);
    };
    const contain = () => {
      if (settled) return;
      failure ??= new Error('Credential bootstrap failed.');
      if (!child.pid) {
        finish(new Error('Credential bootstrap did not spawn.'));
        return;
      }
      if (containmentStarted) return;
      containmentStarted = true;
      // Keep the original timeout until completion, even after an IPC error.
      // Do not signal a PID from metadata or a process group shared with tests.
      try {
        child.kill('SIGKILL');
      } catch {
        /* Wait for observed exit below. */
      }
      closureTimer ??= setTimeout(
        () =>
          finish(
            new Error(
              'Credential bootstrap physical closure is unconfirmed; preserve the fixture directory.',
            ),
          ),
        5000,
      );
    };
    const timer = setTimeout(contain, timeoutMs);
    child.on('message', (value: unknown) => {
      result = read(value) ?? result;
    });
    child.on('error', contain);
    child.once('exit', (code) => {
      if (failure || code !== 0 || result === undefined)
        finish(failure ?? new Error('Credential bootstrap exited without a result.'));
      else finish();
    });
    try {
      child.send(
        { kind: 'credential', id: credential.id, publicKey: credential.publicKey },
        (error) => {
          if (error) contain();
        },
      );
    } catch {
      contain();
    }
  });
}

export async function seed(databasePath: string, credential: ReturnType<typeof authenticator>) {
  const child = fork(fileURLToPath(new URL('./restore-http-fixture.ts', import.meta.url)), [], {
    env: { ...process.env, DATABASE_PATH: databasePath },
    execArgv: [],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  return seedResult<RestoreHttpSeed>(child, credential, 30_000, (value) =>
    value && typeof value === 'object' && 'operatorId' in value
      ? (value as RestoreHttpSeed)
      : undefined,
  );
}

export async function seedOwner(
  databasePath: string,
  folderId: string,
  credential: ReturnType<typeof authenticator>,
) {
  const child = fork(
    fileURLToPath(new URL('./restore-crash-owner-fixture.ts', import.meta.url)),
    [],
    {
      env: { ...process.env, DATABASE_PATH: databasePath, SPINEL_TEST_FOLDER_ID: folderId },
      execArgv: [],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    },
  );
  return seedResult<string>(child, credential, 10_000, (value) =>
    value && typeof value === 'object' && 'ownerId' in value && typeof value.ownerId === 'string'
      ? value.ownerId
      : undefined,
  );
}

export function restoreHttpClient(
  base: string,
  actorId: string,
  credential: ReturnType<typeof authenticator>,
  signal?: AbortSignal,
) {
  let cookie = '',
    epoch: string | undefined;
  const request = async (path: string, body?: unknown, binary?: Buffer) => {
    const response = await fetch(base + path, {
      method: body === undefined && !binary ? 'GET' : 'POST',
      headers: {
        Origin: origin,
        'X-Spinel-Account': actorId,
        ...(epoch ? { 'X-Spinel-Epoch': epoch } : {}),
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
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000),
    });
    const replacement = response.headers.get('set-cookie');
    if (replacement?.startsWith(`${COOKIE_NAME}=`)) cookie = replacement.split(';')[0];
    return response;
  };
  const json = async <T>(response: Response, status = 200): Promise<T> => {
    if (response.status !== status)
      throw new Error(`Unexpected fixture HTTP status ${response.status}.`);
    return response.json() as Promise<T>;
  };
  const prove = async (kind: 'authentication' | 'reauthentication') => {
    const options = await json<{ options: { challenge: string }; challengeId: string }>(
      await request(`/api/auth/${kind}/options`, {}),
    );
    await json(
      await request(`/api/auth/${kind}/verify`, {
        challengeId: options.challengeId,
        response: credential.assertion(options.options.challenge, actorId),
      }),
    );
  };
  return {
    request,
    json,
    reauthenticate: () => prove('reauthentication'),
    async authenticate() {
      cookie = '';
      epoch = (await json<{ epoch: string }>(await request('/api/maintenance'))).epoch;
      await prove('authentication');
    },
    async prepare(source: RestoreHttpSeed) {
      await prove('reauthentication');
      const key = await readFile(source.keyFile);
      let prepared: RestorePreparation;
      try {
        prepared = await json<RestorePreparation>(
          await request('/api/admin/restores/preparations', {
            requestId: randomUUID(),
            source: 'upload',
            key: key.toString('base64'),
          }),
          202,
        );
      } finally {
        key.fill(0);
      }
      prepared = await json<RestorePreparation>(
        await request(
          `/api/admin/restores/preparations/${prepared.id}/upload`,
          undefined,
          await readFile(source.archive),
        ),
      );
      if (prepared.state !== 'ready') throw new Error('Crash fixture source did not become ready.');
      await prove('reauthentication');
      return prepared;
    },
    confirm(prepared: RestorePreparation) {
      return request(`/api/admin/restores/preparations/${prepared.id}/confirm`, {
        confirmation: prepared.confirmation,
        consequencesVersion: 1,
        acceptLostWork: true,
      });
    },
  };
}
