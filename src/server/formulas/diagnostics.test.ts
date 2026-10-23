import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import type { DiagnosticEvent, DiagnosticContext } from '@spinel/diagnostics';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthError, AuthStore, COOKIE_NAME } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { documentIdentity } from '../collaboration/identity.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import { resolveDocument } from '../workspace/document-access.ts';
import { guestCookieName } from '../workspace/links.ts';
import { DocFormulas } from './service.ts';
import { formulaRoutes } from './routes.ts';

async function fixture() {
  const database = new DatabaseSync(':memory:');
  const auth = new AuthStore(database), workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Private owner'), viewer = auth.createUser('Private viewer');
  const host = workspace.create(owner.id, { name: 'Private report', kind: 'doc', parentId: null });
  workspace.share(owner.id, host.id, viewer.id, 'viewer');
  const session = auth.createSession(viewer.id);
  const observations: { event: DiagnosticEvent; context: DiagnosticContext; actorId: string }[] = [];
  const sink = (event: DiagnosticEvent, context: DiagnosticContext, actorId: string) => { observations.push({ event, context, actorId }); };
  const app = express();
  const collaboration = {} as CollaborationStore;
  app.use('/api/items/:id/formulas', formulaRoutes(workspace, collaboration, (request) => documentIdentity(workspace, request.headers), false, 'id', sink));
  // Even if a caller supplies a sink to a guest router, no guest observation escapes.
  app.use('/api/guest/:id/formulas', formulaRoutes(workspace, collaboration, (request) => documentIdentity(workspace, request.headers, String(request.params.id)), true, 'id', sink));
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    response.status(error instanceof AuthError ? error.status : 500).json({ error: 'Unavailable' });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (runId: string, cookie = `${COOKIE_NAME}=${session.token}`, guest = false) => fetch(`${root}/api/${guest ? 'guest' : 'items'}/${host.id}/formulas/evaluate`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Spinel-Diagnostic-Run': runId },
    body: JSON.stringify({ definition: { version: 1, expression: '=1+2', references: [] } }),
  });
  return { database, auth, workspace, owner, viewer, host, session, observations, post,
    async close() { await new Promise<void>((resolve) => server.close(() => resolve())); database.close(); } };
}

test('formula request correlation uses current server actor and ignores arbitrary header text without changing results', async () => {
  const f = await fixture();
  const evaluate = vi.spyOn(DocFormulas.prototype, 'evaluate').mockResolvedValue({ ok: true, kind: 'scalar', value: 3 });
  try {
    const runId = randomUUID();
    const response = await f.post(runId);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, kind: 'scalar', value: 3 });
    expect(f.observations).toHaveLength(3);
    expect(f.observations.every((value) => value.actorId === f.viewer.id && value.context.fileId === f.host.id && value.context.runId === runId)).toBe(true);
    expect(JSON.stringify(f.observations)).not.toContain('Private report');
    expect(JSON.stringify(f.observations)).not.toContain('=1+2');
    f.observations.length = 0;
    expect((await f.post('SECRET-URL-OR-TOKEN')).status).toBe(200);
    expect(f.observations).toHaveLength(3);
    expect(JSON.stringify(f.observations)).not.toContain('SECRET-URL-OR-TOKEN');
  } finally { evaluate.mockRestore(); await f.close(); }
});

test.each(['session', 'grant'] as const)('a %s lost during evaluation emits no stale attributed diagnostic', async (loss) => {
  const f = await fixture();
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const evaluate = vi.spyOn(DocFormulas.prototype, 'evaluate').mockImplementation(async (user, id, _input, verify, _guest, customData = {}) => {
    entered(); await waiting;
    // Isolate the post-work boundary without a native worker. These are the same
    // public credential/host checks made by the actual service after calculation.
    verify(); resolveDocument(f.workspace, user, id, 'read', customData);
    return { ok: true, kind: 'scalar', value: 3 };
  });
  try {
    const pending = f.post(randomUUID()); await started;
    if (loss === 'session') f.auth.revokeSession(f.session.session.token_hash);
    else f.workspace.share(f.owner.id, f.host.id, f.viewer.id, null);
    release();
    expect((await pending).status).toBe(loss === 'session' ? 401 : 404);
    expect(f.observations).toEqual([]);
  } finally { release(); evaluate.mockRestore(); await f.close(); }
});

test('guest evaluation never emits diagnostics even with a supplied correlation header', async () => {
  const f = await fixture();
  const evaluate = vi.spyOn(DocFormulas.prototype, 'evaluate').mockResolvedValue({ ok: true, kind: 'scalar', value: 3 });
  try {
    const change = f.workspace.links.begin(f.host.id, 'viewer');
    f.workspace.links.finish(f.host.id, change.epoch, true);
    const guest = f.workspace.links.exchange(f.host.id, change.token!);
    expect((await f.post(randomUUID(), `${guestCookieName(f.host.id)}=${guest.token}`, true)).status).toBe(200);
    expect(f.observations).toEqual([]);
  } finally { evaluate.mockRestore(); await f.close(); }
});
