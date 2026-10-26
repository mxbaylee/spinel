import express from 'express';
import { afterEach, expect, test, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { IDocumentData } from '@univerjs/core';
import { openDatabase } from '../../../server/database.ts';
import { createHttpServer } from '../../../server/http.ts';
import { AuthStore, COOKIE_NAME } from '../auth/store.ts';
import type { CollaborationStore } from '../collaboration/service.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { workspaceRoutes } from '../workspace/routes.ts';
import { guestRoutes } from '../workspace/guestRoutes.ts';
import { guestCookieName } from '../workspace/links.ts';
import { PdfExports } from './service.ts';
import { PdfError } from './limits.ts';

afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const db = openDatabase(':memory:');
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Private person');
  const viewer = auth.createUser('Viewer');
  const operator = auth.createUser('Operator', true);
  const doc = workspace.create(owner.id, { kind: 'doc', name: 'Public Report', parentId: null });
  workspace.share(owner.id, doc.id, viewer.id, 'viewer');
  const snapshot: IDocumentData = {
    id: doc.id,
    documentStyle: {},
    body: { dataStream: 'Readable content\r\n' },
  };
  const collaboration = {
    prepare: async () => {},
    load: async () => ({ snapshot, revision: 0, access: 'owner' }),
    generations: { active: (id: string) => ({ unitId: id }), restoring: () => false },
  } as unknown as CollaborationStore;
  const origin = 'http://localhost:3000';
  const app = express();
  const server = createHttpServer(app);
  app.use(guestRoutes(workspace, collaboration, origin, async () => {}));
  app.use('/api/items', workspaceRoutes(auth, origin, workspace, collaboration));
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = (user = owner.id) => ({
    Cookie: `${COOKIE_NAME}=${auth.createSession(user).token}`,
    Origin: origin,
    'Content-Type': 'application/json',
  });
  const post = (path = `/api/items/${doc.id}/pdf`, extra = headers(), body = '{}') =>
    fetch(`${root}${path}`, { method: 'POST', headers: extra, body });
  return {
    db,
    auth,
    workspace,
    owner,
    viewer,
    operator,
    doc,
    snapshot,
    root,
    headers,
    post,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    },
  };
}

test('account PDF routes require current ordinary access, CSRF and strict selection before generation', async () => {
  const f = await fixture();
  try {
    const exportPdf = vi.spyOn(PdfExports.prototype, 'export');
    for (const [headers, body, expected] of [
      [{ ...f.headers(), Cookie: '' }, '{}', 401],
      [f.headers(f.operator.id), '{}', 403],
      [{ ...f.headers(), Origin: 'https://other.example' }, '{}', 403],
      [f.headers(), '{"snapshot":{}}', 400],
      [f.headers(), '{"worksheetIds":[]}', 400],
    ] as const) {
      const response = await f.post(undefined, headers, body);
      expect(response.status).toBe(expected);
      expect(response.headers.get('content-type')).toContain('application/json');
    }
    expect(exportPdf).not.toHaveBeenCalled();
    const options = await fetch(`${f.root}/api/items/${f.doc.id}/pdf`, {
      headers: f.headers(f.viewer.id),
    });
    expect(options.status).toBe(200);
    expect(await options.json()).toEqual({ kind: 'doc' });
    expect(options.headers.get('cache-control')).toBe('no-store');
  } finally {
    await f.close();
  }
});

test('PDF publication occurs after final verification and failures have no attachment header or bytes', async () => {
  const f = await fixture();
  try {
    const verify = vi.fn();
    const bytes = Buffer.from('%PDF-all-pages');
    const exportPdf = vi.spyOn(PdfExports.prototype, 'export').mockResolvedValue({
      bytes,
      pages: 1,
      mediaBox: { width: 595, height: 842 },
      durationMs: 1,
      peakRssBytes: 1,
      filename: 'Public Report.pdf',
      verify,
    });
    const response = await f.post();
    expect(verify).toHaveBeenCalledOnce();
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toContain('Public Report.pdf');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    exportPdf.mockRejectedValueOnce(new PdfError('limit'));
    const failure = await f.post();
    expect(failure.status).toBe(413);
    expect(failure.headers.get('content-disposition')).toBeNull();
    expect(await failure.text()).not.toContain('%PDF');
    expect(failure.headers.get('cache-control')).toBe('no-store');
  } finally {
    await f.close();
  }
});

test('guest PDF is a scoped read capability and does not enable native export', async () => {
  const f = await fixture();
  try {
    const link = f.workspace.links.begin(f.doc.id, 'viewer');
    f.workspace.links.finish(f.doc.id, link.epoch, true);
    const session = f.workspace.links.exchange(f.doc.id, link.token!);
    const headers = { ...f.headers(), Cookie: `${guestCookieName(f.doc.id)}=${session.token}` };
    const options = await fetch(`${f.root}/api/guest/${f.doc.id}/pdf`, { headers });
    expect(options.status).toBe(200);
    expect(await options.json()).toEqual({ kind: 'doc' });
    const native = await fetch(`${f.root}/api/items/${f.doc.id}/export`, { headers });
    expect(native.status).toBe(401);
    const change = f.workspace.links.begin(f.doc.id, null);
    f.workspace.links.finish(f.doc.id, change.epoch, false);
    const revoked = await f.post(`/api/guest/${f.doc.id}/pdf`, headers);
    expect([401, 403, 404]).toContain(revoked.status);
    expect(await revoked.text()).not.toContain('Readable content');
  } finally {
    await f.close();
  }
});
