import { afterEach, expect, test } from 'vitest';
import sharp from 'sharp';
import { openDatabase } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from './store.ts';
import { GuestLinks } from './guest-links.ts';
import { LinkAccess, guestCookieName, linkExpiryDays } from './links.ts';
import { migrateSpaceSchema } from './space-schema.ts';
import { SpaceStore } from './spaces.ts';
import { DocumentStore } from './documents.ts';

const DAY = 86_400_000;
const cleanup: (() => void)[] = [];
afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((close) => close()),
);

function fixture() {
  const db = openDatabase(':memory:');
  cleanup.push(() => db.close());
  let now = 1_800_000_000_000;
  const auth = new AuthStore(db, () => now);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const owner = auth.createUser('Owner');
  const other = auth.createUser('Other owner');
  const operator = auth.createUser('Operator', true);
  const inventory = new GuestLinks(workspace);
  const spaces = new SpaceStore(workspace);
  const doc = workspace.create(owner.id, { kind: 'doc', name: 'Private recipe', parentId: null });
  const enable = (id = doc.id, role: 'viewer' | 'editor' = 'editor') => {
    const change = workspace.links.begin(id, role);
    workspace.links.finish(id, change.epoch, true);
    return change;
  };
  return {
    db,
    auth,
    workspace,
    owner,
    other,
    operator,
    inventory,
    spaces,
    doc,
    enable,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

test('legacy expiry migration preserves capabilities, role, epoch and sessions with an honestly unknown enable date', () => {
  const f = fixture();
  const link = f.enable();
  const session = f.workspace.links.exchange(f.doc.id, link.token);
  const before = f.db
    .prepare('SELECT epoch,role,token_hash,preview_hash FROM workspace_links')
    .get();
  f.db.exec(
    'DROP INDEX workspace_links_expiry; ALTER TABLE workspace_links DROP COLUMN enabled_at; ALTER TABLE workspace_links DROP COLUMN expires_at',
  );
  const upgraded = new LinkAccess(f.auth, true);
  expect(
    f.db.prepare('SELECT epoch,role,token_hash,preview_hash FROM workspace_links').get(),
  ).toEqual(before);
  expect(upgraded.metadata(f.doc.id)).toMatchObject({
    enabled: true,
    role: 'editor',
    epoch: link.epoch,
    enabledAt: null,
    expiresAt: null,
    expired: false,
  });
  expect(upgraded.exchange(f.doc.id, link.token, session.token)).toEqual(session);
  expect(upgraded.preview(f.doc.id, link.previewToken)).toEqual({ name: f.doc.name, kind: 'doc' });
  const later = f.auth.now() + 7 * DAY;
  upgraded.changeExpiry(f.doc.id, link.epoch, 7);
  expect(upgraded.metadata(f.doc.id)).toMatchObject({ enabledAt: null, expiresAt: later });
});

test('inventory lists only owned live roots, retains expired roles, excludes hidden Spaces and exposes no capability or account identity', () => {
  const f = fixture();
  const docLink = f.enable();
  const sheet = f.workspace.create(f.owner.id, { kind: 'sheet', name: 'Budget', parentId: null });
  f.enable(sheet.id, 'viewer');
  const space = f.spaces.createRoot(f.owner.id, { name: 'Trip', parentId: null }).space;
  const child = f.spaces.createChild(f.owner.id, space.id, {
    name: 'Hidden child',
    kind: 'doc',
    parentId: space.id,
  }).item;
  f.enable(space.id);
  const shared = f.workspace.create(f.other.id, {
    kind: 'doc',
    name: 'Other private file',
    parentId: null,
  });
  f.enable(shared.id);
  f.workspace.share(f.other.id, shared.id, f.owner.id, 'admin');
  const folder = f.workspace.create(f.owner.id, {
    kind: 'folder',
    name: 'Trash parent',
    parentId: null,
  });
  const trashedChild = f.workspace.create(f.owner.id, {
    kind: 'doc',
    name: 'Trashed ancestor child',
    parentId: folder.id,
  });
  f.enable(trashedChild.id);
  f.db.prepare('UPDATE workspace_items SET trashed_at=? WHERE id=?').run(f.auth.now(), folder.id);
  f.db
    .prepare('UPDATE workspace_links SET expires_at=? WHERE item_id=?')
    .run(f.auth.now(), sheet.id);
  const items = f.inventory.list(f.owner.id);
  expect(items.map((item) => item.id).sort()).toEqual([f.doc.id, sheet.id, space.id].sort());
  expect(items.find((item) => item.id === sheet.id)).toMatchObject({
    status: 'expired',
    role: 'viewer',
  });
  expect(items.find((item) => item.id === space.id)).toMatchObject({
    kind: 'space',
    status: 'active',
  });
  for (const forbidden of [
    child.name,
    shared.name,
    f.owner.id,
    docLink.token!,
    docLink.previewToken!,
    'token_hash',
    'preview_hash',
    'url',
  ])
    expect(JSON.stringify(items)).not.toContain(forbidden);
  expect(() => f.inventory.list(f.operator.id)).toThrow('everyday account');
  expect(() =>
    f.inventory.changeExpiry(f.owner.id, shared.id, f.workspace.links.epoch(shared.id), null, 1),
  ).toThrow();
  const hidden = new GuestLinks(new WorkspaceStore(f.auth));
  expect(
    hidden
      .list(f.owner.id)
      .map((item) => item.id)
      .sort(),
  ).toEqual([f.doc.id, sheet.id].sort());
});

test('active expiry changes keep the exact address and guest session, enforce the deadline before cleanup and cannot resurrect an expired link', () => {
  const f = fixture();
  const link = f.enable();
  const session = f.workspace.links.exchange(f.doc.id, link.token);
  const before = f.db
    .prepare('SELECT epoch,role,token_hash,preview_hash,enabled_at FROM workspace_links')
    .get();
  let expectedExpiresAt: number | null = null;
  for (const days of [1, 7, 30, null] as const) {
    const changed = f.inventory.changeExpiry(
      f.owner.id,
      f.doc.id,
      link.epoch,
      expectedExpiresAt,
      days,
    );
    expect(changed).toMatchObject({
      status: 'active',
      role: 'editor',
      epoch: link.epoch,
      expiresAt: days === null ? null : f.auth.now() + days * DAY,
    });
    expectedExpiresAt = changed.expiresAt;
    expect(
      f.db
        .prepare('SELECT epoch,role,token_hash,preview_hash,enabled_at FROM workspace_links')
        .get(),
    ).toEqual(before);
    expect(f.workspace.links.exchange(f.doc.id, link.token, session.token)).toEqual(session);
  }
  for (const value of [0, -1, 2, '7', undefined, {}, 7.5])
    expect(() => linkExpiryDays(value)).toThrow();
  const deadline = f.auth.now() + DAY;
  f.inventory.changeExpiry(f.owner.id, f.doc.id, link.epoch, null, 1);
  expect(() => f.inventory.changeExpiry(f.owner.id, f.doc.id, link.epoch, null, 30)).toThrow(
    'changed',
  );
  expect(() => f.workspace.links.begin(f.doc.id, null, null, link.epoch, null)).toThrow('changed');
  expect(f.workspace.links.metadata(f.doc.id).expiresAt).toBe(deadline);
  // A session issued near the deadline proves this is link expiry, not its 24-hour TTL.
  f.advance(DAY - 1);
  const freshSession = f.workspace.links.exchange(f.doc.id, link.token);
  const headers = { cookie: `${guestCookieName(f.doc.id)}=${freshSession.token}` };
  expect(f.workspace.links.principal(headers, f.doc.id).userId).toBe(freshSession.userId);
  expect(f.workspace.links.preview(f.doc.id, link.previewToken)).toBeTruthy();
  f.advance(1);
  expect(f.auth.now()).toBe(deadline);
  expect(f.db.prepare('SELECT state FROM workspace_links').get()?.state).toBe('active');
  expect(() => f.workspace.links.exchange(f.doc.id, link.token, freshSession.token)).toThrow(
    'no longer works',
  );
  expect(() => f.workspace.links.principal(headers, f.doc.id)).toThrow('no longer works');
  expect(() => f.workspace.get(freshSession.userId, f.doc.id, 'edit')).toThrow();
  expect(f.workspace.links.preview(f.doc.id, link.previewToken)).toBeUndefined();
  expect(f.inventory.list(f.owner.id)[0]).toMatchObject({ status: 'expired', expiresAt: deadline });
  expect(() => f.inventory.changeExpiry(f.owner.id, f.doc.id, link.epoch, deadline, null)).toThrow(
    'fresh link',
  );
});

test('automatic expiry uses the turn-off fence, survives an interrupted drain and never revives a replaced capability', () => {
  const f = fixture();
  const link = f.enable();
  const session = f.workspace.links.exchange(f.doc.id, link.token);
  f.db
    .prepare('UPDATE workspace_links SET expires_at=? WHERE item_id=?')
    .run(f.auth.now(), f.doc.id);
  expect(f.workspace.links.expiring()).toEqual([{ id: f.doc.id }]);
  const expired = f.workspace.links.beginExpiry(f.doc.id)!;
  expect(expired).toEqual({
    id: f.doc.id,
    epoch: link.epoch + 1,
  });
  expect(f.workspace.links.beginExpiry(f.doc.id)).toEqual(expired);
  expect(() => f.workspace.links.assertEpoch(f.doc.id, link.epoch)).toThrow();
  expect(f.workspace.links.access(session.userId)).toBeUndefined();
  expect(f.db.prepare('SELECT count(*) AS n FROM workspace_guest_sessions').get()?.n).toBe(0);
  f.workspace.links.recover();
  expect(f.workspace.links.expiring()).toEqual([]);
  expect(f.workspace.links.metadata(f.doc.id)).toMatchObject({
    enabled: false,
    expired: true,
    role: 'editor',
  });
  expect(f.db.prepare('SELECT token_hash,preview_hash FROM workspace_links').get()).toEqual({
    token_hash: null,
    preview_hash: null,
  });
  const replacement = f.enable(f.doc.id, 'viewer');
  expect(() => f.workspace.links.begin(f.doc.id, null, null, expired.epoch)).toThrow('changed');
  expect(() =>
    f.inventory.changeExpiry(f.owner.id, f.doc.id, expired.epoch, f.auth.now(), 7),
  ).toThrow('changed');
  expect(() => f.workspace.links.exchange(f.doc.id, link.token)).toThrow();
  expect(f.workspace.links.exchange(f.doc.id, replacement.token)).toBeTruthy();
  const off = f.workspace.links.begin(f.doc.id, null, null, replacement.epoch);
  f.workspace.links.finish(f.doc.id, off.epoch, false);
  expect(f.inventory.list(f.owner.id)).toEqual([]);
});

test.each(['failure', 'restart'] as const)(
  'an interrupted link creation after %s never later appears as a historically expired link',
  (outcome) => {
    const f = fixture();
    const pending = f.workspace.links.begin(f.doc.id, 'editor', 1);
    if (outcome === 'failure') f.workspace.links.finish(f.doc.id, pending.epoch, false);
    else f.workspace.links.recover();
    f.advance(DAY);
    expect(f.workspace.links.metadata(f.doc.id)).toMatchObject({
      enabled: false,
      expired: false,
      enabledAt: null,
      expiresAt: null,
    });
    expect(f.inventory.list(f.owner.id)).toEqual([]);
    expect(() => f.workspace.links.exchange(f.doc.id, pending.token)).toThrow();
  },
);

test('Space root expiry denies every internal item, images and in-flight decoding before the cleanup timer runs', async () => {
  const f = fixture();
  const space = f.spaces.createRoot(f.owner.id, { name: 'Private Space', parentId: null }).space;
  const children = ['doc', 'sheet'].map(
    (kind) =>
      f.spaces.createChild(f.owner.id, space.id, {
        name: kind,
        kind: kind as 'doc' | 'sheet',
        parentId: space.id,
      }).item,
  );
  const link = f.enable(space.id);
  const session = f.workspace.links.exchange(space.id, link.token);
  const access = f.workspace.links.access(session.userId)!;
  const custom = {
    guestHash: access.tokenHash,
    guestItem: space.id,
    spaceId: space.id,
    spaceItem: children[0].id,
  };
  const documents = new DocumentStore(f.workspace);
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#c33' } })
    .png()
    .toBuffer();
  const image = await documents.upload(session.userId, children[0].id, bytes, 'image/png', custom);
  expect(documents.image(session.userId, children[0].id, image.id, custom).mime).toBe('image/png');
  for (const child of children)
    expect(f.spaces.get(session.userId, space.id, child.id).access).toBe('editor');
  const pending = documents.upload(session.userId, children[0].id, bytes, 'image/png', custom);
  f.db
    .prepare('UPDATE workspace_links SET expires_at=? WHERE item_id=?')
    .run(f.auth.now(), space.id);
  await expect(pending).rejects.toThrow();
  for (const child of children)
    expect(() => f.spaces.get(session.userId, space.id, child.id)).toThrow();
  expect(() => documents.image(session.userId, children[0].id, image.id, custom)).toThrow();
  expect(f.workspace.links.preview(space.id, link.previewToken)).toBeUndefined();
  expect(f.workspace.get(f.owner.id, f.doc.id).name).toBe(f.doc.name);
});
