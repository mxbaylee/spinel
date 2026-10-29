import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { SyncServer } from '@spinel/sync-server';
import { createApp } from '../../../server/app.ts';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { SpaceStore } from '../workspace/spaces.ts';
import { GUEST_TTL, guestCookieName, LinkAccess } from '../workspace/links.ts';
import { HistoryStore } from '../history/store.ts';
import { AssistantOAuth } from '../auth/oauth.ts';
import type {
  MaintenanceAdminStatus,
  MaintenanceBridge,
  MaintenanceCommand,
  MaintenancePublicStatus,
} from '../../shared/maintenance.ts';
import { publicMaintenance } from '../../shared/maintenance.ts';

vi.setConfig({ testTimeout: 30_000 });
const cleanups: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-maint-http-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), 'Maintenance test shell');
  let status: MaintenanceAdminStatus = {
    available: true,
    phase: 'running',
    epoch: 'before',
    notice: null,
    operationId: randomUUID(),
    authorityExpiresAt: Date.now() + 60_000,
    generationId: randomUUID(),
    lastFailure: null,
    readyToResume: false,
  };
  const listeners = new Set<(status: MaintenancePublicStatus) => void>();
  const set = (next: Partial<MaintenanceAdminStatus>) => {
    status = { ...status, ...next };
    for (const listener of listeners) listener(publicMaintenance(status));
  };
  const control = vi.fn(async (_command: MaintenanceCommand) => ({ status }));
  const drained = vi.fn((epoch: string) => {
    if (epoch === status.epoch) set({ phase: 'paused' });
  });
  const failed = vi.fn();
  const bridge: MaintenanceBridge = {
    status: () => publicMaintenance(status),
    adminStatus: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    control,
    drained,
    fail: failed,
    ready() {},
    close() {},
  };
  const filename = join(directory, 'workspace.sqlite');
  const origin = 'http://localhost:3000';
  const app = await createApp({
    databasePath: filename,
    staticDirectory: directory,
    origin,
    maintenance: bridge,
  });
  cleanups.push(() => app.close());
  // A separate fixture connection supplies accounts before any browser work.
  const db = openDatabase(filename);
  cleanups.push(() => db.close());
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  const operator = auth.createUser('Operator', true),
    owner = auth.createUser('Owner');
  db.prepare('INSERT INTO auth_passkeys VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
    'operator-key',
    operator.id,
    Buffer.from([1]),
    0,
    '[]',
    'Test passkey',
    'Browser',
    Date.now(),
    null,
    0,
    'singleDevice',
  );
  const operatorSession = auth.createSession(operator.id, undefined, 'operator-key');
  const ownerSession = auth.createSession(owner.id);
  const sheet = workspace.create(owner.id, {
    kind: 'sheet',
    name: 'Preserved work',
    parentId: null,
  });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const root = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const cookie = (admin = false) =>
    `${COOKIE_NAME}=${admin ? operatorSession.token : ownerSession.token}`;
  const send = (
    path: string,
    options: {
      method?: string;
      body?: unknown;
      admin?: boolean;
      headers?: Record<string, string>;
    } = {},
  ) =>
    fetch(root + path, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: {
        Cookie: cookie(options.admin),
        Origin: origin,
        'X-Spinel-Epoch': 'before',
        'X-Spinel-Account': options.admin ? operator.id : owner.id,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  return {
    app,
    directory,
    auth,
    db,
    workspace,
    operator,
    owner,
    operatorSession,
    sheet,
    root,
    origin,
    cookie,
    send,
    set,
    bridge,
    control,
    drained,
    failed,
  };
}

test.each(['sheet', 'space'] as const)(
  'paused %s guest metadata still enforces expiry without opening any writer route',
  async (kind) => {
    const realNow = Date.now;
    let elapsed = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + elapsed);
    const f = await fixture();
    const workspace = new WorkspaceStore(f.auth, { spacesEnabled: true });
    const id =
      kind === 'sheet'
        ? f.sheet.id
        : new SpaceStore(workspace).createRoot(f.owner.id, { name: 'Guest space', parentId: null })
            .space.id;
    const change = workspace.links.begin(id, 'viewer');
    workspace.links.finish(id, change.epoch, true);
    const session = workspace.links.exchange(id, change.token);
    const headers = { Cookie: `${guestCookieName(id)}=${session.token}` };
    expect((await f.send(`/api/guest/${id}`, { headers })).status).toBe(200);
    f.set({ phase: 'draining', epoch: 'after' });
    await expect.poll(() => f.bridge.status().phase).toBe('paused');
    const authorized = await f.send(`/api/guest/${id}`, { headers });
    expect(authorized.status).toBe(200);
    expect((await authorized.json()).item).toMatchObject({ id, kind, access: 'viewer' });
    for (const path of ['session', 'collaboration'])
      expect(
        (
          await f.send(`/api/guest/${id}/${path}`, {
            headers: { ...headers, 'X-Spinel-Epoch': 'after' },
            body: {},
          })
        ).status,
      ).toBe(503);
    expect((await f.send(`/api/guest/${id}/pdf`, { headers })).status).toBe(503);
    elapsed = GUEST_TTL + 1;
    const expired = await f.send(`/api/guest/${id}`, { headers });
    expect(expired.status).toBe(404);
    expect(await expired.json()).toEqual({ error: 'This link no longer works.' });
    expect(f.failed).not.toHaveBeenCalled();
  },
);

test('an admitted link revocation remains visible to the guest after pause drains', async () => {
  const f = await fixture();
  const change = f.workspace.links.begin(f.sheet.id, 'editor');
  f.workspace.links.finish(f.sheet.id, change.epoch, true);
  const session = f.workspace.links.exchange(f.sheet.id, change.token);
  const headers = { Cookie: `${guestCookieName(f.sheet.id)}=${session.token}` };
  const finish = LinkAccess.prototype.finish;
  vi.spyOn(LinkAccess.prototype, 'finish').mockImplementation(function (
    this: LinkAccess,
    id,
    epoch,
    enabled,
  ) {
    finish.call(this, id, epoch, enabled);
    // Pause while this real, already-admitted HTTP revocation still owns its
    // response. Guest polling must retain its authoritative 404 afterward.
    if (id === f.sheet.id && !enabled) f.set({ phase: 'draining', epoch: 'after' });
  });
  expect(
    (await f.send(`/api/items/${f.sheet.id}/link`, { method: 'PUT', body: { role: null } })).status,
  ).toBe(200);
  await expect.poll(() => f.bridge.status().phase).toBe('paused');
  const revoked = await f.send(`/api/guest/${f.sheet.id}`, { headers });
  expect(revoked.status).toBe(404);
  expect(await revoked.json()).toEqual({ error: 'This link no longer works.' });
});

test('real control routes require current Operator, origin and fresh passkey without leaking private status', async () => {
  const f = await fixture(),
    path = '/api/admin/maintenance';
  expect(await (await fetch(f.root + '/api/maintenance')).json()).toEqual({
    available: true,
    phase: 'running',
    epoch: 'before',
    notice: null,
  });
  const outsider = await f.send(path);
  expect(outsider.status).toBe(404);
  expect(await outsider.json()).toEqual({ error: 'Not found.' });
  expect((await f.send(path, { admin: true })).status).toBe(200);
  expect(
    (await f.send(path + '/pause', { admin: true, body: { operationId: randomUUID() } })).status,
  ).toBe(428);
  f.auth.markVerified(f.operatorSession.session, 'operator-key');
  expect(
    (
      await f.send(path + '/pause', {
        admin: true,
        body: { operationId: randomUUID() },
        headers: { Origin: 'https://elsewhere.example' },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await f.send(path + '/pause', {
        admin: true,
        body: { operationId: randomUUID() },
        headers: { 'X-Spinel-Account': f.owner.id },
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await f.send(path + '/pause', {
        admin: true,
        body: { operationId: randomUUID(), command: 'arbitrary' },
      })
    ).status,
  ).toBe(400);
  const operationId = randomUUID();
  const intentExpiresAt = f.auth.verifiedUntil(f.operatorSession.session)!;
  expect(
    (await f.send(path + '/pause', { admin: true, body: { operationId, intentExpiresAt } })).status,
  ).toBe(200);
  expect(f.control).toHaveBeenCalledTimes(1);
  expect(f.control.mock.calls[0][0]).toMatchObject({
    action: 'pause',
    operationId,
    authority: { actorId: f.operator.id, sessionHash: f.operatorSession.session.token_hash },
  });
  const command = f.control.mock.calls[0][0];
  if (command.action !== 'pause') throw new Error('Expected pause');
  expect(command.authority.expiresAt).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
  f.auth.markVerified(f.operatorSession.session, 'operator-key');
  const delayed = await f.send(path + '/notice', {
    admin: true,
    body: {
      operationId: randomUUID(),
      intentExpiresAt: Date.now() - 1,
      id: randomUUID(),
      startsAt: Date.now() + 60_000,
      timeZone: 'UTC',
      durationMinutes: 30,
    },
  });
  expect(delayed.status).toBe(428);
  expect(f.control).toHaveBeenCalledTimes(1);
  f.set({ phase: 'draining', epoch: 'after' });
  await expect.poll(() => f.bridge.status().phase).toBe('paused');
  // A stale notice can still be withdrawn while edits are paused.
  f.auth.markVerified(f.operatorSession.session, 'operator-key');
  const noticeId = randomUUID();
  const withdrawn = await f.send(path + '/cancel-notice', {
    admin: true,
    body: {
      operationId: randomUUID(),
      intentExpiresAt: f.auth.verifiedUntil(f.operatorSession.session)!,
      noticeId,
    },
  });
  expect(withdrawn.status, await withdrawn.clone().text()).toBe(200);
  expect(f.control).toHaveBeenCalledTimes(2);
  expect(f.control.mock.calls[1][0]).toMatchObject({ action: 'cancel-notice', noticeId });
  expect((await f.send('/api/auth/session', { admin: true })).status).toBe(200);
  expect((await f.send(path, { admin: true })).status).toBe(200);
  f.db.prepare('UPDATE auth_users SET is_admin=0 WHERE id=?').run(f.operator.id);
  const revoked = await f.send(path + '/resume', {
    admin: true,
    body: { operationId, resumeToken: 'a'.repeat(43) },
  });
  expect(revoked.status).toBe(404);
  expect(await revoked.json()).toEqual({ error: 'Not found.' });
});

test('HTTP writers, write-capable reads, offline bases and OAuth keep their protocol boundaries', async () => {
  const f = await fixture();
  const registered = await fetch(f.root + '/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Maintenance test',
      redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: 'none',
    }),
  });
  expect(registered.status, await registered.clone().text()).toBe(201);
  const prepared = await f.send(`/api/items/${f.sheet.id}/collaboration`, { body: {} });
  expect(prepared.status, await prepared.clone().text()).toBe(200);
  const bundle = await f.send(`/api/items/${f.sheet.id}/offline-bundle`);
  expect(bundle.status, await bundle.clone().text()).toBe(200);
  expect((await bundle.json()).maintenanceEpoch).toBe('before');
  f.set({ phase: 'draining', epoch: 'after' });
  await expect.poll(() => f.bridge.status().phase).toBe('paused');
  // Express matches routes case-insensitively, so case variants must not bypass admission.
  for (const path of [
    '/api/items',
    '/API/items',
    '/Api/Items',
    `/api/items/${f.sheet.id}/offline-bundle`,
    `/sync-api/items/${f.sheet.id}/snapshot?unitId=${f.sheet.id}`,
    `/SYNC-API/items/${f.sheet.id}/snapshot?unitId=${f.sheet.id}`,
  ])
    expect((await f.send(path)).status, path).toBe(503);
  expect(
    (
      await f.send('/api/items', {
        body: { kind: 'doc', name: 'Blocked', parentId: null },
        headers: { 'X-Spinel-Epoch': 'after' },
      })
    ).status,
  ).toBe(503);
  for (const path of ['/register', '/REGISTER'])
    expect(
      (
        await fetch(f.root + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
      path,
    ).toBe(503);
  f.set({ phase: 'running' });
  const stale = await f.send('/api/items', {
    body: { kind: 'doc', name: 'Stale offline attempt', parentId: null },
  });
  expect(stale.status).toBe(409);
  expect((await stale.json()).code).toBe('maintenance-epoch');
  expect(
    (
      await f.send('/api/items', {
        body: { kind: 'doc', name: 'Current', parentId: null },
        headers: { 'X-Spinel-Epoch': 'after' },
      })
    ).status,
  ).toBe(201);
  expect(
    f.db
      .prepare("SELECT count(*) AS n FROM workspace_items WHERE name='Stale offline attempt'")
      .get()?.n,
  ).toBe(0);
  expect(f.failed).not.toHaveBeenCalled();
});

test('a real socket submission drains to durable acknowledgment while later old-epoch frames are fenced', async () => {
  const f = await fixture();
  expect((await f.send(`/api/items/${f.sheet.id}/collaboration`, { body: {} })).status).toBe(200);
  const prefix = `/sync-api/items/${f.sheet.id}`;
  const ticketResponse = await f.send(`${prefix}/ticket?unitId=${f.sheet.id}`, { body: {} });
  expect(ticketResponse.status).toBe(200);
  const ticket = (await ticketResponse.json()).ticket;
  const socket = new WebSocket(
    `${f.root.replace('http:', 'ws:')}${prefix}/socket?unitId=${f.sheet.id}&ticket=${ticket}&epoch=before`,
    { headers: { Cookie: f.cookie(), Origin: f.origin } },
  );
  cleanups.push(() => socket.terminate());
  const frames: Array<{ type: string; mutationId?: string }> = [];
  socket.on('message', (data) => frames.push(JSON.parse(String(data))));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  await expect
    .poll(() => frames, { message: 'Initial supervised socket frames' })
    .toEqual(expect.arrayContaining([expect.objectContaining({ type: 'snapshot' })]));
  const started = deferred(),
    finish = deferred();
  const original = SyncServer.prototype.submit;
  vi.spyOn(SyncServer.prototype, 'submit').mockImplementationOnce(async function (
    this: typeof SyncServer.prototype,
    input,
    identity,
  ) {
    started.resolve();
    await finish.promise;
    return original.call(this, input, identity);
  });
  const mutationId = randomUUID();
  const submit = {
    type: 'submit',
    mutationId,
    baseRevision: 1,
    mutations: [
      {
        id: 'sheet.mutation.set-range-values',
        params: {
          unitId: f.sheet.id,
          subUnitId: 'first',
          cellValue: { 0: { 0: { v: 'Accepted during drain' } } },
        },
      },
    ],
  };
  socket.send(JSON.stringify(submit));
  await started.promise;
  f.set({ phase: 'draining', epoch: 'after' });
  await expect.poll(() => frames.some((frame) => frame.type === 'maintenance')).toBe(true);
  expect(f.drained).not.toHaveBeenCalled();
  finish.resolve();
  await expect
    .poll(() => frames.some((frame) => frame.type === 'ack' && frame.mutationId === mutationId))
    .toBe(true);
  await expect.poll(() => f.bridge.status().phase).toBe('paused');
  expect(
    f.db
      .prepare('SELECT count(*) AS n FROM spinel_sync_revisions WHERE mutation_id=?')
      .get(mutationId)?.n,
  ).toBe(1);
  f.set({ phase: 'running' });
  const afterResume = frames.length;
  socket.send(JSON.stringify({ ...submit, mutationId: randomUUID() }));
  await expect
    .poll(() => frames.slice(afterResume).some((frame) => frame.type === 'maintenance'))
    .toBe(true);
  expect(f.db.prepare('SELECT count(*) AS n FROM spinel_sync_revisions').get()?.n).toBe(1);
  expect(f.failed).not.toHaveBeenCalled();
});

test('a running history job is included in drain and a later timer cannot write while paused', async () => {
  const started = deferred(),
    finish = deferred();
  const prototype = HistoryStore.prototype as unknown as { scan(): Promise<boolean> };
  const original = prototype.scan;
  let history!: HistoryStore;
  const scan = vi.spyOn(prototype, 'scan').mockImplementationOnce(async function (
    this: typeof prototype,
  ) {
    history = this as unknown as HistoryStore;
    started.resolve();
    await finish.promise;
    return original.call(this);
  });
  const f = await fixture();
  await started.promise;
  f.set({ phase: 'draining', epoch: 'after' });
  expect(f.drained).not.toHaveBeenCalled();
  finish.resolve();
  await expect.poll(() => f.bridge.status().phase).toBe('paused');
  const count = scan.mock.calls.length;
  await history.tick();
  expect(scan).toHaveBeenCalledTimes(count);
  expect(f.failed).not.toHaveBeenCalled();
});

test('a disconnected OAuth request drains its provider promise and cannot resume DB work in a new epoch', async () => {
  const f = await fixture();
  const oauth = new AssistantOAuth(f.auth, f.origin);
  const client = oauth.clientsStore.registerClient({
    client_name: 'Delayed client',
    redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: 'none',
  });
  const verifier = 'v'.repeat(43),
    challenge = createHash('sha256').update(verifier).digest('base64url');
  const started = deferred(),
    finish = deferred(),
    refused = deferred();
  vi.spyOn(AssistantOAuth.prototype, 'challengeForAuthorizationCode').mockImplementationOnce(
    async () => {
      started.resolve();
      await finish.promise;
      return challenge;
    },
  );
  const exchange = vi
    .spyOn(AssistantOAuth.prototype, 'exchangeAuthorizationCode')
    .mockImplementationOnce(async () => {
      refused.resolve();
      throw new Error('A retired provider must not be called.');
    });
  const controller = new AbortController();
  const request = fetch(f.root + '/token', {
    method: 'POST',
    signal: controller.signal,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: client.client_id,
      code: 'a'.repeat(43),
      code_verifier: verifier,
      redirect_uri: client.redirect_uris[0],
      resource: oauth.resource,
    }),
  }).catch(() => undefined);
  await Promise.race([
    started.promise,
    request.then(async (response) => {
      throw new Error(
        `OAuth request ended before provider work: ${response?.status} ${await response?.text()}`,
      );
    }),
  ]);
  f.set({ phase: 'draining', epoch: 'after' });
  controller.abort();
  await request;
  await expect.poll(() => f.app.maintenance.pending).toBe(1);
  expect(f.drained).not.toHaveBeenCalled();
  expect(f.app.maintenance.pending).toBeGreaterThan(0);
  const begin = f.app.maintenance.begin.bind(f.app.maintenance);
  vi.spyOn(f.app.maintenance, 'begin').mockImplementation((epoch) => {
    try {
      return begin(epoch);
    } catch (error) {
      refused.resolve();
      throw error;
    }
  });
  finish.resolve();
  await expect.poll(() => f.bridge.status().phase).toBe('paused');
  f.set({ phase: 'running' });
  await refused.promise;
  expect(exchange).not.toHaveBeenCalled();
  expect(f.failed).not.toHaveBeenCalled();
});

test('a pause during a stalled archive upload cancels it with a reason instead of failing the drain', async () => {
  const f = await fixture();
  const imports = join(f.directory, '.archive-imports');
  let upload!: ReturnType<typeof httpRequest>;
  const reply = new Promise<{ status: number; body: string }>((resolve, reject) => {
    upload = httpRequest(
      `${f.root}/api/items/archive-import`,
      {
        method: 'POST',
        headers: {
          Cookie: f.cookie(),
          Origin: f.origin,
          'X-Spinel-Epoch': 'before',
          'X-Spinel-Account': f.owner.id,
          'Content-Type': 'application/zip',
          'Content-Length': String(64 * 1024 * 1024),
        },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () => resolve({ status: response.statusCode!, body }));
      },
    );
    upload.on('error', reject);
    // A slow client: one megabyte arrives, then the upload stalls indefinitely.
    upload.write(Buffer.alloc(1024 * 1024));
  });
  cleanups.push(() => upload.destroy());
  await expect.poll(async () => (await readdir(imports).catch(() => [])).length).toBe(1);
  expect(f.app.maintenance.pending).toBeGreaterThan(0);
  f.set({ phase: 'draining', epoch: 'after' });
  // Without cancellation this upload would hold the drain until its deadline.
  await expect.poll(() => f.bridge.status().phase, { timeout: 5_000 }).toBe('paused');
  expect(f.failed).not.toHaveBeenCalled();
  const { status, body } = await reply;
  expect(status).toBe(503);
  expect(JSON.parse(body).error).toMatch(/maintenance stopped this import\. No files were added/);
  await expect.poll(() => readdir(imports)).toEqual([]);
  expect(f.db.prepare('SELECT COUNT(*) AS total FROM workspace_items').get()!.total).toBe(1);
});
