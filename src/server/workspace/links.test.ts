import { test, expect } from 'vitest';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { DocumentStore } from './documents.ts';
import { guestCookieName, GUEST_TTL, LinkAccess } from './links.ts';
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
    const principal = f.links.principal(
      { cookie: `${guestCookieName(f.item.id)}=${session.token}` },
      f.item.id,
    );
    const custom = { guestHash: principal.guestHash, guestItem: f.item.id };
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#ff9900' },
    })
      .png()
      .toBuffer();
    const saved = await docs.upload(session.userId, f.item.id, bytes, 'image/png', custom);
    expect(docs.image(session.userId, f.item.id, saved.id, custom).mime).toBe('image/png');
    expect(() => docs.image(session.userId, f.other.id, saved.id, custom)).toThrow();
    const inFlight = docs.upload(session.userId, f.item.id, bytes, 'image/png', custom);
    const change = f.links.begin(f.item.id, null);
    await expect(inFlight).rejects.toThrow('no longer works');
    f.links.finish(f.item.id, change.epoch, false);
    expect(() => docs.image(session.userId, f.item.id, saved.id, custom)).toThrow();
    const next = f.enable();
    const viewer = f.links.exchange(f.item.id, next);
    const viewerPrincipal = f.links.principal(
      { cookie: `${guestCookieName(f.item.id)}=${viewer.token}` },
      f.item.id,
    );
    await expect(
      docs.upload(viewer.userId, f.item.id, bytes, 'image/png', {
        guestHash: viewerPrincipal.guestHash,
        guestItem: f.item.id,
      }),
    ).rejects.toThrow('viewing only');
    f.db.prepare('UPDATE workspace_items SET trashed_at=1 WHERE id=?').run(f.item.id);
    expect(() => f.links.exchange(f.item.id, next)).toThrow();
  } finally {
    f.db.close();
  }
});

test('link-room presence accepts only bounded native cursor messages with trusted identity', () => {
  const data = { unitID: 'unit', memberID: 'member', selection: 'sheet123!A1:B2' };
  expect(safeGuestRoomPresence(data, 'unit', 'member')).toBe(true);
  expect(safeGuestRoomPresence({ ...data, selection: '0:1:0:TEXT::-1' }, 'unit', 'member')).toBe(
    true,
  );
  for (const payload of [
    { ...data, name: 'Private owner' },
    { ...data, memberID: 'someoneelse' },
    { ...data, unitID: 'another-document' },
    { ...data, selection: 'secret@example.com' },
    { ...data, avatar: 'https://private.example' },
    { eventID: 'update_cursor', data },
    { eventID: 'users_enter', joinEvent: { name: 'Owner', avatar: 'secret' } },
    { eventID: 'update_collaborator', data: { name: 'Owner' } },
  ])
    expect(safeGuestRoomPresence(payload, 'unit', 'member')).toBe(false);
});

test('preview capabilities disclose only current title/kind and never authorize document access', () => {
  const f = fixture();
  try {
    const change = f.links.begin(f.item.id, 'viewer');
    expect(f.links.preview(f.item.id, change.previewToken)).toBeUndefined();
    f.links.finish(f.item.id, change.epoch, true);
    expect(f.links.preview(f.item.id, change.previewToken)).toEqual({
      name: 'Shared recipe',
      kind: 'doc',
    });
    expect(f.links.preview(f.other.id, change.previewToken)).toBeUndefined();
    expect(f.links.preview(f.item.id, change.token)).toBeUndefined();
    expect(() => f.links.exchange(f.item.id, change.previewToken)).toThrow();
    expect(JSON.stringify(f.db.prepare('SELECT * FROM workspace_links').all())).not.toContain(
      change.previewToken,
    );
    f.db.prepare('UPDATE workspace_items SET trashed_at=1 WHERE id=?').run(f.item.id);
    expect(f.links.preview(f.item.id, change.previewToken)).toBeUndefined();
    f.db.prepare('UPDATE workspace_items SET trashed_at=NULL WHERE id=?').run(f.item.id);
    f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
    expect(f.links.preview(f.item.id, change.previewToken)).toBeUndefined();
    f.db.prepare('UPDATE auth_users SET disabled=0 WHERE id=?').run(f.owner.id);
    const replacement = f.links.begin(f.item.id, 'editor');
    expect(f.links.preview(f.item.id, change.previewToken)).toBeUndefined();
    f.links.finish(f.item.id, replacement.epoch, true);
    expect(f.links.preview(f.item.id, change.previewToken)).toBeUndefined();
    expect(f.links.preview(f.item.id, replacement.previewToken)?.kind).toBe('doc');
    f.links.begin(f.item.id, null);
    f.links.recover();
    expect(f.links.preview(f.item.id, replacement.previewToken)).toBeUndefined();
    expect(f.db.prepare('SELECT preview_hash FROM workspace_links').get()?.preview_hash).toBeNull();
  } finally {
    f.db.close();
  }
});

test('upgrading a link table keeps existing fragment links working without publishing new metadata', () => {
  const f = fixture();
  try {
    const secret = f.enable();
    const previous = f.links.state(f.item.id);
    f.db.exec('ALTER TABLE workspace_links DROP COLUMN preview_hash');
    const upgraded = new LinkAccess(f.auth);
    expect(upgraded.state(f.item.id)).toEqual(previous);
    expect(upgraded.exchange(f.item.id, secret).userId).toMatch(/^guest:/);
    expect(upgraded.preview(f.item.id, secret)).toBeUndefined();
    expect(f.db.prepare('SELECT preview_hash FROM workspace_links').get()?.preview_hash).toBeNull();
  } finally {
    f.db.close();
  }
});
