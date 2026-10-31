import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { BackupService } from './service.ts';
import { restoreRoutes } from './restore-routes.ts';
import * as journal from '../maintenance/journal.ts';

const cleanups: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
async function fixture(controller = true) {
  const identity = { pid: process.pid, start: '12345', boot: randomUUID(), token: '' };
  vi.spyOn(journal, 'processIdentity').mockImplementation((pid) =>
    pid === process.pid ? identity : null,
  );
  const directory = await mkdtemp(join(tmpdir(), 'spinel-restore-http-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'app.sqlite'),
    db = openDatabase(databasePath);
  cleanups.push(() => db.close());
  const auth = new AuthStore(db),
    operator = auth.createUser('Operator', true),
    member = auth.createUser('Member');
  db.prepare('INSERT INTO auth_passkeys VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
    'operator-key',
    operator.id,
    Buffer.from([1]),
    0,
    '[]',
    'Browser',
    'Passkey',
    Date.now(),
    null,
    0,
    'singleDevice',
  );
  const session = auth.createSession(operator.id, undefined, 'operator-key');
  const ordinary = auth.createSession(member.id);
  const origin = 'https://spinel.example';
  const target = { generationId: randomUUID(), epoch: randomUUID() };
  const service = new BackupService(db, {
    databasePath,
    origin,
    image: `sha256:${'a'.repeat(64)}`,
    ...(controller
      ? {
          restoreController: {
            estimate: async () => ({
              target,
              resources: {
                provisional: true,
                checkedAt: Date.now(),
                requiredAdditionalBytes: 512 * 1024 ** 2,
                availableBytes: 1024 ** 3,
                sufficient: true,
                filesystems: [
                  {
                    purposes: ['application', 'preparation', 'recovery'],
                    requiredAdditionalBytes: 512 * 1024 ** 2,
                    availableBytes: 1024 ** 3,
                    sufficient: true,
                  },
                ],
              },
            }),
            target: () => target,
            observe: async () => ({ target, record: null, pending: false }),
            admit: async () => {
              throw new Error('No lifecycle implementation in HTTP fixture');
            },
            begin: async () => {
              throw new Error('No lifecycle implementation in HTTP fixture');
            },
          },
        }
      : {}),
  });
  cleanups.push(() => service.close());
  const app = express();
  app.use('/restore', restoreRoutes(auth, service.restores, origin));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/restore`;
  const request = (
    path: string,
    body: unknown = {},
    overrides: Record<string, string> = {},
    method = 'POST',
  ) =>
    fetch(url + path, {
      method,
      headers: {
        Cookie: `${COOKIE_NAME}=${session.token}`,
        Origin: origin,
        'X-Spinel-Account': operator.id,
        'Content-Type': 'application/json',
        ...overrides,
      },
      ...(method !== 'GET' ? { body: JSON.stringify(body) } : {}),
    });
  const body = () => ({
    source: 'upload',
    requestId: randomUUID(),
    key: randomBytes(32).toString('base64'),
  });
  return { directory, db, auth, operator, session, ordinary, member, service, request, body };
}

test('restore routes require current Operator, exact Origin/account and fresh passkey proof', async () => {
  const f = await fixture();
  expect((await f.request('/preparations', f.body())).status).toBe(428);
  f.auth.markVerified(f.session.session, 'operator-key');
  expect(
    (await f.request('/preparations', f.body(), { Origin: 'https://other.example' })).status,
  ).toBe(403);
  expect(
    (await f.request('/preparations', f.body(), { 'X-Spinel-Account': f.member.id })).status,
  ).toBe(409);
  expect(
    (
      await f.request('/preparations', f.body(), {
        Cookie: `${COOKIE_NAME}=${f.ordinary.token}`,
        'X-Spinel-Account': f.member.id,
      })
    ).status,
  ).toBe(404);
  expect(
    (await readdir(f.directory)).filter((name) => name.startsWith('.restore-preparation-')),
  ).toEqual([]);
});

test('manual source routes reject private descriptors and keys outside the exact format', async () => {
  const f = await fixture();
  f.auth.markVerified(f.session.session, 'operator-key');
  for (const extra of [
    { path: '/tmp/source.sqlite' },
    { keyFile: '/etc/key' },
    { authority: {} },
    { deployment: {} },
  ])
    expect((await f.request('/preparations', { ...f.body(), ...extra })).status).toBe(400);
  expect(
    (await f.request('/preparations', { ...f.body(), key: Buffer.alloc(33).toString('base64') }))
      .status,
  ).toBe(400);
  const body = f.body(),
    response = await f.request('/preparations', body);
  expect(response.status).toBe(202);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const result = await response.json();
  expect(result.source).toBe('upload');
  expect(JSON.stringify(result)).not.toContain(body.key);
  expect(JSON.stringify(result)).not.toContain(f.directory);
  const current = await f.request('/', {}, {}, 'GET');
  expect((await current.json()).job.id).toBe(result.id);
  const replacement = f.auth.createSession(f.operator.id, undefined, 'operator-key');
  const differentSession = await f.request(
    '/',
    {},
    { Cookie: `${COOKIE_NAME}=${replacement.token}` },
    'GET',
  );
  expect((await differentSession.json()).job).toBeNull();
  expect(
    (
      await f.request(`/preparations/${result.id}/confirm`, {
        confirmation: 'a'.repeat(64),
        consequencesVersion: 1,
        acceptLostWork: false,
      })
    ).status,
  ).toBe(400);
  expect((await f.request(`/preparations/${result.id}/cancel`, {})).status).toBe(200);
});

test('a partial or missing lifecycle controller never enables Begin or creates private staging', async () => {
  const f = await fixture(false);
  f.auth.markVerified(f.session.session, 'operator-key');
  const status = await f.request('/', {}, {}, 'GET');
  expect(await status.json()).toMatchObject({ available: false, consequencesVersion: 1 });
  expect((await f.request('/preparations', f.body())).status).toBe(503);
  expect(
    (await readdir(f.directory)).filter((name) => name.startsWith('.restore-preparation-')),
  ).toEqual([]);
});

test('durable status rechecks the current Operator after asynchronous observation', async () => {
  const f = await fixture();
  f.service.restores.options.controller!.observe = async () => {
    f.auth.revokeSession(f.session.session.token_hash);
    return {
      target: f.service.restores.options.controller!.target(),
      record: null,
      pending: false,
    };
  };
  expect((await f.request('/', {}, {}, 'GET')).status).toBe(404);
});

test('unavailable observation cannot produce a successful empty outcome response', async () => {
  const f = await fixture();
  f.service.restores.options.controller!.observe = async () => {
    throw new Error('/private/supervisor/evidence');
  };
  const response = await f.request('/', {}, {}, 'GET');
  expect(response.status).toBe(503);
  expect((await response.text()).includes('/private/')).toBe(false);
});
