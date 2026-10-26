import { expect, test } from 'vitest';
import WebSocket from 'ws';
import { Profiles } from '../auth/profile.ts';
import { transportFixture } from './transport.fixture.ts';

test('guest native HTTP and socket identities stay scoped and link transitions revoke readers, writers and unused tickets', async () => {
  const f = await transportFixture();
  const id = f.sheet.id;
  await f.prepare();
  const base = `/sync-api/guest/${id}`;
  const link = async (role: 'editor' | 'viewer' | null) => {
    const response = await f.send(`/api/items/${id}/link`, f.cookie(), { role }, 'PUT');
    expect(response.status).toBe(200);
    return response.json() as Promise<{ url: string | null }>;
  };
  const exchange = async (url: string) => {
    const response = await f.send(`/api/guest/${id}/session`, '', { token: new URL(url).hash.slice(1) });
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    return response.headers.get('set-cookie')!.split(';')[0];
  };
  new Profiles(f.auth).save(f.owner.id, { name: f.owner.name, icon: 'lucide:flower', color: 'info-strong' });
  const personal = await f.connect();
  const unusedAccount = await f.ticket();
  const credential = await exchange((await link('editor')).url!);
  await expect.poll(() => personal.socket.readyState).toBe(WebSocket.CLOSED);
  expect((await f.open({ ticket: unusedAccount })).status).toBe(403);
  expect((await f.send(`/api/guest/${id}/collaboration`, credential, {})).status).toBe(200);
  const metadata = await (await f.send(`/api/guest/${id}`, credential)).json();
  expect(Object.keys(metadata.item).sort()).toEqual(['access', 'id', 'kind', 'name']);
  for (const path of [
    '/api/items', '/api/auth/session', `/api/items/${id}/history`, `/api/items/${id}/sharing`,
    `/api/items/${id}/export`, `/api/guest/${f.doc.id}`, `${base}/snapshot?unitId=${f.doc.id}`,
  ]) expect((await f.send(path, credential)).status, path).toBeGreaterThanOrEqual(400);
  const account = await f.connect();
  const guest = await f.connect({ prefix: base, credential });
  expect(JSON.stringify(guest.messages)).not.toContain(f.owner.name);
  expect(JSON.stringify(guest.messages)).not.toContain('/profile-avatar/');
  await expect.poll(() => JSON.stringify(account.messages)).toContain('Guest');
  guest.socket.send(JSON.stringify({ type: 'cursor', selection: 'first!B2' }));
  await expect.poll(() => JSON.stringify(account.messages)).toContain('first!B2');
  guest.socket.send(JSON.stringify({ type: 'cursor', selection: 'secret@example.com' }));
  await expect.poll(() => guest.socket.readyState).toBe(WebSocket.CLOSED);
  expect(JSON.stringify(account.messages)).not.toContain('secret@example.com');
  const editGuest = await f.connect({ prefix: base, credential });
  editGuest.socket.send(JSON.stringify({ type: 'cursor', selection: 'first!D4' }));
  await expect.poll(() => JSON.stringify(account.messages)).toContain('first!D4');
  expect((await f.submit(editGuest, 'Guest editor positive control'))?.type).toBe('ack');
  const saved = await (await f.snapshot()).json();
  expect(saved.snapshot.sheets.first.cellData[0][0].v).toBe('Guest editor positive control');
  const unusedGuest = await f.ticket({ prefix: base, credential });
  const viewerCookie = await exchange((await link('viewer')).url!);
  for (const client of [account, editGuest]) await expect.poll(() => client.socket.readyState).toBe(WebSocket.CLOSED);
  expect((await f.open({ prefix: base, credential, ticket: unusedGuest })).status).toBe(403);
  // Namespace-selected guest credentials cannot borrow a privileged account cookie.
  expect((await f.send(`${base}/snapshot?unitId=${id}`, credential + '; ' + f.cookie())).status).toBe(403);
  const viewer = await f.connect({ prefix: base, credential: viewerCookie });
  expect((await f.submit(viewer, 'Viewer cannot edit', 2))?.type).toBe('resync');
  expect((await f.submit(viewer, 'Forged owner write', 2, id, { userID: f.owner.id }))?.type).toBe('resync');
  expect(await (await f.snapshot()).json()).toEqual(saved);
  expect((await f.snapshot(id, viewerCookie, id, base)).status).toBe(200);
  const resumed = await f.connect({ prefix: base, credential: viewerCookie, afterRevision: 1 });
  const resume = resumed.messages.find(frame => frame.type === 'resume');
  expect(resume).toMatchObject({ fromRevision: 1, revision: 2, edits: [expect.objectContaining({ revision: 2 })] });
  const unusedViewer = await f.ticket({ prefix: base, credential: viewerCookie });
  await link(null);
  for (const client of [viewer, resumed]) await expect.poll(() => client.socket.readyState).toBe(WebSocket.CLOSED);
  expect((await f.send(`/api/guest/${id}`, credential)).status).toBe(404);
  expect((await f.snapshot(id, viewerCookie, id, base)).status).toBe(403);
  expect((await f.open({ prefix: base, credential: viewerCookie, ticket: unusedViewer })).status).toBe(403);
  expect(await (await f.snapshot()).json()).toEqual(saved);
}, 60_000);
