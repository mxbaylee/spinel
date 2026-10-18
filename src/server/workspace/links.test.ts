import { test, expect } from 'vitest';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { DocumentStore } from './documents.ts';
import { guestCookieName, GUEST_TTL } from './links.ts';
import { safeGuestRoomPresence } from '../collaboration/guestPresence.ts';
import sharp from 'sharp';

function fixture() {
  const db = openDatabase(':memory:');
  let now = 1_000_000;
  const auth = new AuthStore(db, () => now),
    workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Private owner'),
    outsider = auth.createUser('Other person');
  const item = workspace.create(owner.id, { kind: 'doc', name: 'Shared recipe', parentId: null });
  const other = workspace.create(owner.id, {
    kind: 'doc',
    name: 'Private journal',
    parentId: null,
  });
  const links = workspace.links;
  const enable = (role: 'viewer' | 'editor' = 'viewer') => {
    const change = links.begin(item.id, role);
    links.finish(item.id, change.epoch, true);
    return change.token!;
  };
  return {
    db,
    auth,
    workspace,
    owner,
    outsider,
    item,
    other,
    links,
    enable,
    advance() {
      now += GUEST_TTL + 1;
    },
  };
}

test('guest capabilities stay scoped, hash secrets, expire, and cannot manage or enumerate an account workspace', () => {
  const f = fixture();
  try {
    const secret = f.enable(),
      session = f.links.exchange(f.item.id, secret);
    expect(secret).toHaveLength(43);
    expect(f.links.exchange(f.item.id, secret, session.token)).toEqual(session);
    expect(() => f.links.exchange(f.item.id, 'x'.repeat(43), session.token)).toThrow();
    expect(f.db.prepare('SELECT count(*) AS n FROM workspace_guest_sessions').get()?.n).toBe(1);
    const headers = { cookie: `${guestCookieName(f.item.id)}=${session.token}` };
    const principal = f.links.principal(headers, f.item.id);
    expect(principal.userId).toBe(session.userId);
    expect(f.workspace.get(session.userId, f.item.id)).toMatchObject({
      name: 'Shared recipe',
      access: 'viewer',
      parentId: null,
      tags: [],
    });
    expect(() => f.workspace.get(session.userId, f.item.id, 'edit')).toThrow('viewing only');
    expect(() => f.workspace.get(session.userId, f.item.id, 'owner')).toThrow();
    expect(() => f.workspace.get(session.userId, f.other.id)).toThrow('no longer works');
    expect(() => f.workspace.list(session.userId)).toThrow();
    expect(() =>
      f.workspace.create(session.userId, { kind: 'doc', name: 'No', parentId: null }),
    ).toThrow();
    expect(() => f.links.principal(headers, f.other.id)).toThrow();
    expect(() =>
      f.links.principal({ cookie: headers.cookie + ';' + headers.cookie }, f.item.id),
    ).toThrow();
    expect(() => f.links.session(session.userId, 'wrong')).toThrow();
    expect(JSON.stringify(f.db.prepare('SELECT * FROM workspace_links').all())).not.toContain(
      secret,
    );
    expect(
      JSON.stringify(f.db.prepare('SELECT * FROM workspace_guest_sessions').all()),
    ).not.toContain(session.token);
    expect(f.db.prepare('SELECT count(*) AS n FROM auth_users').get()?.n).toBe(2);
    f.advance();
    expect(() => f.links.principal(headers, f.item.id)).toThrow('no longer works');
  } finally {
    f.db.close();
  }
});

test('link transitions revoke immediately, fence admission, preserve epoch, and recover fail-closed', () => {
  const f = fixture();
  try {
    const old = f.enable('editor'),
      session = f.links.exchange(f.item.id, old);
    expect(f.workspace.get(session.userId, f.item.id, 'edit').access).toBe('editor');
    const prior = f.links.epoch(f.item.id),
      replacement = f.links.begin(f.item.id, 'viewer');
    expect(() => f.workspace.get(session.userId, f.item.id)).toThrow();
    expect(() => f.links.assertEpoch(f.item.id, prior)).toThrow();
    expect(() => f.links.assertEpoch(f.item.id, replacement.epoch)).toThrow();
    expect(() => f.links.exchange(f.item.id, replacement.token)).toThrow();
    expect(() => f.links.begin(f.item.id, 'editor')).toThrow('Sharing is changing');
    f.links.finish(f.item.id, replacement.epoch, true);
    expect(() => f.links.exchange(f.item.id, old)).toThrow();
    const current = f.links.exchange(f.item.id, replacement.token);
    expect(f.workspace.get(current.userId, f.item.id).access).toBe('viewer');
    f.links.begin(f.item.id, null);
    f.links.recover();
    expect(f.links.state(f.item.id)?.state).toBe('off');
    expect(() => f.links.exchange(f.item.id, replacement.token)).toThrow();
  } finally {
    f.db.close();
  }
});

test('guest images use the same document grant and recheck after asynchronous decode', async () => {
  const f = fixture();
  try {
    const docs = new DocumentStore(f.workspace),
      secret = f.enable('editor');
    const session = f.links.exchange(f.item.id, secret);
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#ff9900' },
    })
      .png()
      .toBuffer();
    const saved = await docs.upload(session.userId, f.item.id, bytes, 'image/png');
    expect(docs.image(session.userId, f.item.id, saved.id).mime).toBe('image/png');
    expect(() => docs.image(session.userId, f.other.id, saved.id)).toThrow();
    const inFlight = docs.upload(session.userId, f.item.id, bytes, 'image/png');
    const change = f.links.begin(f.item.id, null);
    await expect(inFlight).rejects.toThrow('no longer works');
    f.links.finish(f.item.id, change.epoch, false);
    expect(() => docs.image(session.userId, f.item.id, saved.id)).toThrow();
    const next = f.enable();
    const viewer = f.links.exchange(f.item.id, next);
    await expect(docs.upload(viewer.userId, f.item.id, bytes, 'image/png')).rejects.toThrow(
      'viewing only',
    );
    f.db.prepare('UPDATE workspace_items SET trashed_at=1 WHERE id=?').run(f.item.id);
    expect(() => f.links.exchange(f.item.id, next)).toThrow();
  } finally {
    f.db.close();
  }
});

test('link-room presence accepts only bounded native cursor messages with trusted identity', () => {
  const data = { unitID: 'unit', memberID: 'member', selection: 'sheet123!A1:B2' };
  expect(safeGuestRoomPresence({ eventID: 'update_cursor', data }, 'unit', 'member')).toBe(true);
  expect(
    safeGuestRoomPresence(
      { eventID: 'update_cursor', updateCursorEvent: { ...data, selection: '0:1:0:TEXT::-1' } },
      'unit',
      'member',
    ),
  ).toBe(true);
  for (const payload of [
    { eventID: 'update_cursor', data: { ...data, name: 'Private owner' } },
    { eventID: 'update_cursor', data: { ...data, memberID: 'someoneelse' } },
    { eventID: 'update_cursor', data: { ...data, selection: 'secret@example.com' } },
    { eventID: 'update_cursor', data, avatar: 'https://private.example' },
    { eventID: 'users_enter', joinEvent: { name: 'Owner', avatar: 'secret' } },
    { eventID: 'update_collaborator', data: { name: 'Owner' } },
  ])
    expect(safeGuestRoomPresence(payload, 'unit', 'member')).toBe(false);
});
