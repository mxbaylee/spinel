import express from 'express';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, test, vi } from 'vitest';
import { DatabaseSync } from '../../../server/database.ts';
import type {
  FeedbackCollection,
  FeedbackPair,
  FeedbackPreparation,
  FeedbackSubmission,
} from '../../shared/feedback.ts';
import { FEEDBACK_LIMITS } from '../../shared/feedback.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { DiagnosticsStore } from './store.ts';
import { diagnosticsRoutes } from './routes.ts';

async function fixture(beforeRoutes?: (app: express.Express) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-feedback-http-'));
  const db = new DatabaseSync(join(directory, 'application.sqlite'));
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Owner private name'),
    other = auth.createUser('Collaborator'),
    admin = auth.createUser('Operator', true);
  const item = workspace.create(owner.id, {
    name: 'PRIVATE DOCUMENT TITLE',
    kind: 'doc',
    parentId: null,
  });
  const diagnostics = new DiagnosticsStore({
    path: join(directory, 'diagnostics.sqlite'),
    build: 'test-build',
  });
  const origin = 'https://spinel.example';
  const app = express();
  beforeRoutes?.(app);
  app.use('/api', diagnosticsRoutes(workspace, diagnostics, origin));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const ownerToken = auth.createSession(owner.id).token;
  const cookie = `${COOKIE_NAME}=${ownerToken}`;
  const otherCookie = `${COOKIE_NAME}=${auth.createSession(other.id).token}`;
  const adminCookie = `${COOKIE_NAME}=${auth.createSession(admin.id).token}`;
  const get = (path: string, credentials = cookie, actorId = owner.id) =>
    fetch(`${root}${path}`, {
      headers: { Cookie: credentials, 'X-Spinel-Diagnostic-Account': actorId },
    });
  const post = (
    path: string,
    body: unknown,
    credentials = cookie,
    actorId = owner.id,
    extra: Record<string, string> = {},
  ) =>
    fetch(`${root}${path}`, {
      method: 'POST',
      headers: {
        Cookie: credentials,
        'X-Spinel-Diagnostic-Account': actorId,
        Origin: origin,
        'Content-Type': 'application/json',
        ...extra,
      },
      body: JSON.stringify(body),
    });
  const boundary = async (credentials = cookie, actorId = owner.id) =>
    (await (
      await get('/diagnostics/feedback-context', credentials, actorId)
    ).json()) as FeedbackCollection;
  const initial = await boundary();
  const submission = (message = 'This is my explicit feedback'): FeedbackSubmission => ({
    id: randomUUID(),
    generation: initial.generation,
    binding: initial.binding,
    message,
    context: { route: '/files/:id', fileId: item.id, runId: randomUUID() },
  });
  const prepare = () =>
    post('/admin/diagnostics/feedback/prepare', { actorId: owner.id }, adminCookie);
  const download = (id: string, scope: string, credentials = adminCookie) =>
    post(`/admin/diagnostics/feedback/${id}/download`, { scope }, credentials);
  const decode = async (response: Response) => {
    const path = join(directory, `download-${randomUUID()}.sqlite`);
    writeFileSync(path, Buffer.from(await response.arrayBuffer()));
    const downloaded = new DatabaseSync(path, { readOnly: true });
    try {
      return {
        rows: downloaded.prepare('SELECT * FROM events ORDER BY id').all(),
        manifest: JSON.parse(
          String(downloaded.prepare('SELECT details FROM export_manifest').get()!.details),
        ),
      };
    } finally {
      downloaded.close();
    }
  };
  return {
    directory,
    db,
    auth,
    workspace,
    diagnostics,
    owner,
    other,
    admin,
    item,
    cookie,
    otherCookie,
    adminCookie,
    ownerToken,
    get,
    post,
    boundary,
    submission,
    initial,
    prepare,
    download,
    decode,
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await diagnostics.close();
      db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test('everyday feedback derives identity, verifies live file access, rejects raw context and retains only deliberately submitted content', async () => {
  const f = await fixture();
  try {
    const input = f.submission();
    const response = await f.post('/diagnostics/feedback', input);
    expect(response.status).toBe(200);
    const receipt = await response.json();
    expect(receipt).toMatchObject({ id: input.id, generation: input.generation });
    expect(await (await f.post('/diagnostics/feedback', input)).json()).toEqual(receipt);
    expect(
      (await f.post('/diagnostics/feedback', { ...input, id: randomUUID(), actorId: f.other.id }))
        .status,
    ).toBe(400);
    expect(
      (
        await f.post('/diagnostics/feedback', {
          ...input,
          context: { ...input.context, title: 'PRIVATE TITLE' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.post('/diagnostics/feedback', {
          ...input,
          context: { route: 'https://spinel.example/files/private?q=secret' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.post('/diagnostics/feedback', input, f.cookie, f.owner.id, {
          Origin: 'https://evil.example',
        })
      ).status,
    ).toBe(403);
    expect((await f.post('/diagnostics/feedback', input, '')).status).toBe(401);
    expect((await f.post('/diagnostics/feedback', input, f.adminCookie, f.admin.id)).status).toBe(
      404,
    );
    expect((await f.get('/diagnostics/feedback-context', f.adminCookie, f.admin.id)).status).toBe(
      404,
    );
    expect((await f.get('/admin/diagnostics/feedback')).status).toBe(404);
    const otherBoundary = await f.boundary(f.otherCookie, f.other.id);
    const otherInput = { ...input, id: randomUUID(), binding: otherBoundary.binding };
    expect(
      (await f.post('/diagnostics/feedback', otherInput, f.otherCookie, f.other.id)).status,
    ).toBe(404);
    f.workspace.share(f.owner.id, f.item.id, f.other.id, 'viewer');
    expect(
      (await f.post('/diagnostics/feedback', otherInput, f.otherCookie, f.other.id)).status,
    ).toBe(200);
    f.workspace.share(f.owner.id, f.item.id, f.other.id, null);
    expect(
      (
        await f.post(
          '/diagnostics/feedback',
          { ...otherInput, id: randomUUID() },
          f.otherCookie,
          f.other.id,
        )
      ).status,
    ).toBe(404);
    const stored = new DatabaseSync(f.diagnostics.path, { readOnly: true });
    try {
      const rows = stored.prepare('SELECT * FROM events ORDER BY actor_id').all();
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.actor_id))).toEqual(new Set([f.owner.id, f.other.id]));
      expect(
        rows.every(
          (row) =>
            row.file_id === f.item.id && row.source === 'frontend' && row.name === 'feedback',
        ),
      ).toBe(true);
      const text = JSON.stringify(rows);
      for (const secret of [
        f.owner.name,
        'PRIVATE DOCUMENT TITLE',
        input.binding,
        f.ownerToken,
        'https://spinel.example',
      ])
        expect(text).not.toContain(secret);
      expect(text).toContain(input.message);
    } finally {
      stored.close();
    }
    const flags = await (await f.get('/admin/diagnostics/feedback', f.adminCookie)).json();
    expect(flags).toEqual({
      generation: f.initial.generation,
      actors: [f.owner.id, f.other.id].sort(),
    });
    expect(JSON.stringify(flags)).not.toContain(input.message);
  } finally {
    await f.close();
  }
});

test('submission admission bounds message/rate, duplicate retries bypass rate and replaced sessions cannot reassign an attempted report', async () => {
  const f = await fixture();
  try {
    expect(
      (
        await f.post(
          '/diagnostics/feedback',
          f.submission('x'.repeat(FEEDBACK_LIMITS.messageLength + 1)),
        )
      ).status,
    ).toBe(400);
    const input = f.submission();
    expect((await f.post('/diagnostics/feedback', input)).status).toBe(200);
    for (let i = 1; i < FEEDBACK_LIMITS.perMinute; i++)
      expect((await f.post('/diagnostics/feedback', f.submission())).status).toBe(200);
    expect((await f.post('/diagnostics/feedback', f.submission())).status).toBe(429);
    expect((await f.post('/diagnostics/feedback', input)).status).toBe(200);
    expect(f.diagnostics.status().recordCount).toBe(FEEDBACK_LIMITS.perMinute);
    expect((await f.post('/diagnostics/feedback', input, f.otherCookie)).status).toBe(403);
    expect((await f.post('/diagnostics/feedback', input, f.otherCookie, f.other.id)).status).toBe(
      409,
    );
    f.auth.revokeSession(f.auth.session(f.ownerToken)!.token_hash);
    const replacement = `${COOKIE_NAME}=${f.auth.createSession(f.owner.id).token}`;
    expect((await f.post('/diagnostics/feedback', input, replacement)).status).toBe(409);
  } finally {
    await f.close();
  }
});

test('Operator can download both immutable scopes, with all other credentials denied and disabled account feedback preserved', async () => {
  const f = await fixture();
  try {
    const input = f.submission();
    await f.post('/diagnostics/feedback', input);
    // Disabling a sender does not erase their stored reports or hide the flag.
    f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
    expect((await f.get('/admin/diagnostics/feedback', f.adminCookie)).status).toBe(200);
    expect(
      (
        await f.post(
          '/admin/diagnostics/feedback/prepare',
          { actorId: f.owner.id },
          f.otherCookie,
          f.other.id,
        )
      ).status,
    ).toBe(404);
    const response = await f.prepare();
    expect(response.status).toBe(200);
    const pair = (await response.json()) as FeedbackPair;
    expect(pair.state).toBe('ready');
    expect((await f.download(pair.id, 'user', f.otherCookie)).status).toBe(404);
    expect((await f.download(pair.id, 'user', '')).status).toBe(401);
    const secondOperator = `${COOKIE_NAME}=${f.auth.createSession(f.admin.id).token}`;
    expect((await f.download(pair.id, 'user', secondOperator)).status).toBe(404);
    const userResponse = await f.download(pair.id, 'user');
    expect(userResponse.status).toBe(200);
    expect(userResponse.headers.get('content-type')).toBe('application/vnd.sqlite3');
    expect(userResponse.headers.get('content-disposition')).toContain(
      'spinel-feedback-user.sqlite',
    );
    expect(userResponse.headers.get('x-content-type-options')).toBe('nosniff');
    expect(userResponse.headers.get('cache-control')).toBe('no-store');
    const user = await f.decode(userResponse);
    const systemResponse = await f.download(pair.id, 'system');
    expect(systemResponse.status).toBe(200);
    const system = await f.decode(systemResponse);
    expect(user.rows.map((row) => row.id)).toEqual([input.id]);
    expect(system.rows).toEqual(user.rows);
    expect(user.manifest.snapshotId).toBe(system.manifest.snapshotId);
    expect(user.manifest.window).toEqual(system.manifest.window);
    expect(
      (await f.post(`/admin/diagnostics/feedback/${pair.id}/cancel`, {}, f.adminCookie)).status,
    ).toBe(204);
    expect((await f.download(pair.id, 'system')).status).toBe(410);
    expect(
      readdirSync(f.directory).filter((name) => name.startsWith('.diagnostics-feedback-')),
    ).toEqual([]);
  } finally {
    await f.close();
  }
});

test('confirmed truncate invalidates ready pairs and attempted submissions; fresh intentional reports restore flags', async () => {
  const f = await fixture();
  try {
    const input = f.submission();
    await f.post('/diagnostics/feedback', input);
    const pair = (await (await f.prepare()).json()) as FeedbackPair;
    expect(
      (await f.post('/admin/diagnostics/truncate', { generation: input.generation }, f.adminCookie))
        .status,
    ).toBe(400);
    expect(f.diagnostics.feedbackFlags().actors).toEqual([f.owner.id]);
    const cleared = await f.post(
      '/admin/diagnostics/truncate',
      { generation: input.generation, confirm: true },
      f.adminCookie,
    );
    expect(cleared.status).toBe(200);
    expect((await f.download(pair.id, 'user')).status).toBe(410);
    expect((await f.post('/diagnostics/feedback', input)).status).toBe(409);
    expect(f.diagnostics.feedbackFlags().actors).toEqual([]);
    const next = await f.boundary();
    // A retry cannot transplant an old signed body into a new collection generation.
    expect(
      (await f.post('/diagnostics/feedback', { ...input, generation: next.generation })).status,
    ).toBe(409);
    expect(f.diagnostics.feedbackFlags().actors).toEqual([]);
    expect(
      (
        await f.post('/diagnostics/feedback', {
          ...f.submission(),
          generation: next.generation,
          binding: next.binding,
        })
      ).status,
    ).toBe(200);
    expect(f.diagnostics.feedbackFlags().actors).toEqual([f.owner.id]);
  } finally {
    await f.close();
  }
});

test.each(['session', 'role', 'truncate'] as const)(
  'late %s change after real pair preparation denies response and cleans both private artifacts',
  async (change) => {
    const f = await fixture();
    const ready = Promise.withResolvers<FeedbackPreparation>();
    const release = Promise.withResolvers<void>();
    const prepare = f.diagnostics.prepareFeedback.bind(f.diagnostics);
    const intercepted = vi
      .spyOn(f.diagnostics, 'prepareFeedback')
      .mockImplementation(async (...args) => {
        const result = await prepare(...args);
        ready.resolve(result);
        await release.promise;
        return result;
      });
    let pending: Promise<Response> | undefined;
    try {
      await f.post('/diagnostics/feedback', f.submission());
      pending = f.prepare();
      const result = await ready.promise;
      expect(result.state).toBe('ready');
      if (change === 'session') {
        const token = f.adminCookie.slice(COOKIE_NAME.length + 1);
        f.auth.revokeSession(f.auth.session(token)!.token_hash);
      } else if (change === 'role')
        f.db.prepare('UPDATE auth_users SET is_admin=0 WHERE id=?').run(f.admin.id);
      else f.diagnostics.truncate();
      release.resolve();
      const response = await pending;
      expect(response.status).toBe(change === 'session' ? 401 : change === 'role' ? 404 : 410);
      await expect
        .poll(() =>
          readdirSync(f.directory).filter((name) => name.startsWith('.diagnostics-feedback-')),
        )
        .toEqual([]);
    } finally {
      release.resolve();
      if (pending) await pending.catch(() => {});
      intercepted.mockRestore();
      await f.close();
    }
  },
);

test('the same persisted session and submission retry survive router/process binding restart after a lost acknowledgment', async () => {
  const f = await fixture();
  let restarted: ReturnType<typeof express.application.listen> | undefined;
  try {
    const input = f.submission();
    const first = await (await f.post('/diagnostics/feedback', input)).json();
    // Recreate every route-local key as a new server process would. Persisted
    // store/session state is unchanged; the intentionally retried ID stays fixed.
    const app = express();
    app.use('/api', diagnosticsRoutes(f.workspace, f.diagnostics, 'https://spinel.example'));
    restarted = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => restarted!.once('listening', resolve));
    const response = await fetch(
      `http://127.0.0.1:${(restarted.address() as AddressInfo).port}/api/diagnostics/feedback`,
      {
        method: 'POST',
        headers: {
          Cookie: f.cookie,
          Origin: 'https://spinel.example',
          'Content-Type': 'application/json',
          'X-Spinel-Diagnostic-Account': f.owner.id,
        },
        body: JSON.stringify(input),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(first);
    expect(f.diagnostics.status().recordCount).toBe(1);
  } finally {
    if (restarted)
      await new Promise<void>((resolve, reject) =>
        restarted!.close((error) => (error ? reject(error) : resolve())),
      );
    await f.close();
  }
});

test('disconnecting a prepared JSON response before writableFinished removes the unknown pair', async () => {
  const held = Promise.withResolvers<express.Response>();
  const f = await fixture((app) => {
    app.use('/api/admin/diagnostics/feedback/prepare', (_request, response, next) => {
      // The real worker, route and JSON serialization finish, but the destination
      // has not delivered the ready acknowledgment when the peer disconnects.
      response.end = (() => {
        held.resolve(response);
        return response;
      }) as typeof response.end;
      next();
    });
  });
  let pending: Promise<Response> | undefined;
  try {
    await f.post('/diagnostics/feedback', f.submission());
    pending = f.prepare();
    const disconnected = expect(pending).rejects.toThrow();
    const response = await held.promise;
    expect(response.writableFinished).toBe(false);
    expect(
      readdirSync(f.directory).filter((name) => name.startsWith('.diagnostics-feedback-')),
    ).toHaveLength(1);
    response.destroy();
    await disconnected;
    await expect
      .poll(() =>
        readdirSync(f.directory).filter((name) => name.startsWith('.diagnostics-feedback-')),
      )
      .toEqual([]);
  } finally {
    if (pending) await pending.catch(() => {});
    await f.close();
  }
});
