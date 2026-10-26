import { expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { transportFixture } from './transport.fixture.ts';

test('native ingress authenticates independently and binds one-use tickets to origin, session and exact document', async () => {
  const f = await transportFixture();
  await f.prepare();
  await f.prepare(f.doc.id);
  const path = `${f.base()}/ticket?unitId=${f.sheet.id}`;
  for (const credential of ['', f.cookie(f.operator.id), f.cookie(f.outsider.id)]) {
    expect((await f.send(path, credential, {})).status).toBe(403);
    const denied = await f.snapshot(f.sheet.id, credential);
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain(f.sheet.name);
  }
  expect((await f.send(path, f.cookie(), {}, 'POST', 'https://hostile.example')).status).toBe(403);
  const token = await f.ticket();
  for (const settings of [
    { origin: 'https://hostile.example' },
    { credential: '' },
    { credential: f.cookie(f.viewer.id) },
    { id: f.doc.id },
    { unitId: '' },
  ]) {
    const rejected = await f.open({ ...settings, ticket: token });
    expect(rejected.status).toBe(403);
    expect(rejected.messages).toEqual([]);
  }
  const connected = await f.connect({ ticket: token });
  expect(connected.status).toBe(101);
  expect((await f.open({ ticket: token })).status).toBe(403);
  const stale = await f.ticket();
  f.auth.revokeSession(f.sessions.get(f.owner.id)!.session.token_hash);
  expect((await f.open({ ticket: stale })).status).toBe(403);
  expect((await f.send(path, f.cookie(), {})).status).toBe(403);
}, 30_000);

test('legacy SDK HTTP routes and sockets cannot remain a second read or write path after cutover', async () => {
  const f = await transportFixture();
  await f.prepare();
  for (const [path, body] of [
    [`/universer-api/user/session-ticket?unitID=${f.sheet.id}`, undefined],
    [`/universer-api/snapshot/2/unit/${f.sheet.id}/rev/0`, undefined],
    ['/universer-api/authz/-/object/-/batch_allowed', { requests: [] }],
    [`/universer-api/comb/2/unit/${f.sheet.id}/new_changes`, {}],
    [`/guest-api/${f.sheet.id}/universer-api/snapshot/2/unit/${f.sheet.id}/rev/0`, undefined],
  ] as const) {
    const response = await f.send(path, f.cookie(), body);
    expect(response.status, path).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toContain(f.sheet.name);
  }
  const token = await f.ticket();
  expect((await f.open({ ticket: token, prefix: '/universer-api/comb/connect' })).status).toBe(403);
  const client = await f.connect({ ticket: token });
  expect((await f.submit(client, 'Only the native path commits'))?.type).toBe('ack');
  expect((await (await f.snapshot()).json()).snapshot.sheets.first.cellData[0][0].v).toBe('Only the native path commits');
}, 30_000);

test('native sockets reject viewer and revoked writes, audit without content, and cannot join a second document', async () => {
  const f = await transportFixture();
  const audit = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await f.prepare();
  await f.prepare(f.doc.id);
  const baseline = await (await f.snapshot()).json();
  const viewer = await f.connect({ credential: f.cookie(f.viewer.id) });
  expect((await f.submit(viewer, 'never persist this payload'))?.type).toBe('resync');
  expect(await (await f.snapshot()).json()).toEqual(baseline);
  const events = audit.mock.calls.filter(call => String(call[0]).includes('collaboration.edit_denied')).map(call => JSON.parse(String(call[0])));
  expect(events[0]).toMatchObject({ userID: f.viewer.id, unitID: f.sheet.id, stage: 'submitChangeset' });
  expect(JSON.stringify(audit.mock.calls)).not.toContain('never persist this payload');
  expect(JSON.stringify(audit.mock.calls)).not.toContain(f.sessions.get(f.viewer.id)!.token);
  expect(JSON.stringify(audit.mock.calls)).not.toContain(f.sessions.get(f.viewer.id)!.session.token_hash);
  viewer.socket.send(JSON.stringify({ type: 'join', unitId: f.doc.id }));
  await expect.poll(() => viewer.messages.some(frame => frame.type === 'resync' && frame.reason === 'malformed')).toBe(true);
  expect(JSON.stringify(viewer.messages)).not.toContain(f.doc.name);
  const editor = await f.connect({ credential: f.cookie(f.editor.id) });
  expect((await f.submit(editor, 'authorized raw edit'))?.type).toBe('ack');
  const saved = await (await f.snapshot()).json();
  expect(saved.revision).toBe(2);
  expect(saved.snapshot.sheets.first.cellData[0][0].v).toBe('authorized raw edit');
  for (const role of ['viewer', null] as const) {
    f.workspace.share(f.owner.id, f.sheet.id, f.editor.id, 'editor');
    const client = await f.connect({ credential: f.cookie(f.editor.id) });
    f.workspace.share(f.owner.id, f.sheet.id, f.editor.id, role);
    await f.submit(client, 'denied after access change', 2);
    await expect.poll(() => client.socket.readyState).toBe(WebSocket.CLOSED);
    expect(await (await f.snapshot()).json()).toEqual(saved);
    expect(JSON.stringify(client.messages)).not.toContain('denied after access change');
  }
  f.workspace.share(f.owner.id, f.sheet.id, f.editor.id, 'editor');
  const pending = await f.ticket({ credential: f.cookie(f.editor.id) });
  f.workspace.share(f.owner.id, f.sheet.id, f.editor.id, null);
  expect((await f.open({ credential: f.cookie(f.editor.id), ticket: pending })).status).toBe(403);
}, 40_000);
