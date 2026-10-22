import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, expect, test, vi } from 'vitest';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore, COOKIE_NAME } from './store.ts';
import { AdminStore } from './admin.ts';
import { InvitationService } from './invitations.ts';
import { authRoutes } from './routes.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { migrateSpaceSchema } from '../workspace/space-schema.ts';
import type { TransferPreview } from '../../shared/adminRecovery.ts';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const db = openDatabase(':memory:');
  cleanup.push(() => db.close());
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth);
  migrateSpaceSchema(db);
  const operator = auth.createUser('Operator', true);
  const source = auth.createUser('Departed');
  const target = auth.createUser('Recipient');
  const doc = workspace.create(source.id, {
    name: 'Secret document title',
    kind: 'doc',
    parentId: null,
  });
  const invites = new InvitationService(auth, 'http://localhost:3000');
  const admin = new AdminStore(auth, invites);
  const adminSession = auth.createSession(operator.id);
  const memberSession = auth.createSession(target.id);
  admin.disable(operator.id, source.id);
  const hook = vi.fn(async () => {});
  const app = express();
  app.use('/api/auth', authRoutes(auth, 'http://localhost:3000', hook));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const root = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const call = (
    action: string,
    options: {
      method?: string;
      body?: unknown;
      token?: string;
      origin?: string;
      contentType?: string;
    } = {},
  ) =>
    fetch(root + '/api/auth/admin/users/' + source.id + action, {
      method: options.method ?? 'GET',
      headers: {
        Cookie: COOKIE_NAME + '=' + (options.token ?? adminSession.token),
        Origin: options.origin ?? 'http://localhost:3000',
        'Content-Type': options.contentType ?? 'application/json',
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  const preview = async () => {
    const response = await call('/transfer-preview');
    expect(response.status).toBe(200);
    return (await response.json()) as TransferPreview;
  };
  return {
    db,
    auth,
    workspace,
    operator,
    source,
    target,
    doc,
    admin,
    hook,
    call,
    preview,
    memberSession,
  };
}

test('recovery endpoints conceal metadata, require Origin/JSON and expose no item identities', async () => {
  const f = await fixture();
  for (const token of ['', f.memberSession.token, 'guest:opaque'])
    for (const action of ['/transfer-preview', '/transfer', '/reactivate'])
      expect(
        (
          await f.call(action, {
            token,
            ...(action === '/transfer-preview' ? {} : { method: 'POST', body: {} }),
          })
        ).status,
      ).toBe(404);
  const response = await f.call('/transfer-preview');
  expect(response.headers.get('cache-control')).toBe('no-store');
  const preview = (await response.json()) as TransferPreview;
  expect(preview).toEqual({
    source: { id: f.source.id, name: f.source.name },
    recipients: [{ id: f.target.id, name: f.target.name }],
    counts: { items: 1, folders: 0, links: 0 },
    confirmation: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(JSON.stringify(preview)).not.toContain(f.doc.id);
  expect(JSON.stringify(preview)).not.toContain(f.doc.name);
  const body = { targetId: f.target.id, confirmation: preview.confirmation };
  for (const action of ['/transfer', '/reactivate']) {
    expect(
      (await f.call(action, { method: 'POST', body, origin: 'https://wrong.example' })).status,
    ).toBe(403);
    expect((await f.call(action, { method: 'POST', body, contentType: 'text/plain' })).status).toBe(
      403,
    );
    expect(
      (await f.call(action, { method: 'POST', body: { ...body, owner_id: f.operator.id } })).status,
    ).toBe(400);
  }
  expect(f.hook).not.toHaveBeenCalled();
  expect(
    f.db.prepare('SELECT owner_id FROM workspace_items WHERE id=?').get(f.doc.id)?.owner_id,
  ).toBe(f.source.id);
});

test('confirmation and target eligibility are current, and the successful transfer awaits live revalidation', async () => {
  const f = await fixture(),
    preview = await f.preview();
  expect(
    (
      await f.call('/transfer', {
        method: 'POST',
        body: { targetId: f.target.id, confirmation: 'old' },
      })
    ).status,
  ).toBe(409);
  f.admin.disable(f.operator.id, f.target.id);
  expect(
    (
      await f.call('/transfer', {
        method: 'POST',
        body: { targetId: f.target.id, confirmation: preview.confirmation },
      })
    ).status,
  ).toBe(400);
  f.admin.reactivate(f.operator.id, f.target.id);
  let unblock!: () => void;
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.hook.mockImplementationOnce(async () => {
    expect(
      f.db.prepare('SELECT owner_id FROM workspace_items WHERE id=?').get(f.doc.id)?.owner_id,
    ).toBe(f.target.id);
    entered();
    await blocked;
  });
  let finished = false;
  const pending = f
    .call('/transfer', {
      method: 'POST',
      body: { targetId: f.target.id, confirmation: preview.confirmation },
    })
    .then((response) => {
      finished = true;
      return response;
    });
  await started;
  expect(finished).toBe(false);
  unblock();
  const response = await pending;
  expect(response.status).toBe(204);
  expect(await response.text()).toBe('');
  expect(f.hook).toHaveBeenCalledTimes(1);
});

test('post-commit hook failures explicitly report committed transfer/reactivation and retries cannot duplicate ownership', async () => {
  const f = await fixture(),
    preview = await f.preview();
  f.hook.mockRejectedValueOnce(new Error('Connection fixture failure'));
  const body = { targetId: f.target.id, confirmation: preview.confirmation };
  const transfer = await f.call('/transfer', { method: 'POST', body });
  expect(transfer.status).toBe(503);
  expect(await transfer.json()).toEqual({
    error:
      'Ownership transferred, but open connections could not refresh. Refresh accounts to see the result.',
  });
  expect(f.workspace.get(f.target.id, f.doc.id, 'owner').access).toBe('owner');
  const beforeRetry = f.db.prepare('SELECT * FROM workspace_items ORDER BY id').all();
  expect((await f.preview()).counts).toEqual({ items: 0, folders: 0, links: 0 });
  expect((await f.call('/transfer', { method: 'POST', body })).status).toBe(409);
  expect(f.db.prepare('SELECT * FROM workspace_items ORDER BY id').all()).toEqual(beforeRetry);
  f.hook.mockRejectedValueOnce(new Error('Second connection fixture failure'));
  const reactivate = await f.call('/reactivate', { method: 'POST', body: {} });
  expect(reactivate.status).toBe(503);
  expect(await reactivate.json()).toEqual({
    error:
      'Account reactivated, but open connections could not refresh. Refresh accounts to see the result.',
  });
  expect(f.auth.user(f.source.id)?.disabled).toBe(0);
  expect(() => f.workspace.get(f.source.id, f.doc.id)).toThrow('not available');
  expect((await f.call('/reactivate', { method: 'POST', body: {} })).status).toBe(409);
});
