import { afterEach, expect, test } from 'vitest';
import sharp from 'sharp';
import { DatabaseSync } from '../../../server/database.ts';
import { AuthStore } from '../auth/store.ts';
import { WorkspaceStore } from '../workspace/store.ts';
import { SpaceStore } from '../workspace/spaces.ts';
import { migrateSpaceSchema } from '../workspace/space-schema.ts';
import { TrashStore } from '../workspace/trash.ts';
import { AppearanceStore } from './store.ts';
import { UnsplashProvider } from './unsplash.ts';
import { filenameEmoji, validIdentityIcon } from '../../shared/appearance.ts';
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function fixture(provider?: UnsplashProvider) {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  migrateSpaceSchema(db);
  const owner = auth.createUser('Owner'),
    other = auth.createUser('Collaborator');
  const actor = (userId = owner.id, spaceId?: string, id?: string) => ({
    userId,
    customData: {
      sessionHash: auth.createSession(userId).session.token_hash,
      ...(spaceId ? { spaceId, spaceItem: id ?? spaceId } : {}),
    },
  });
  const item = workspace.create(owner.id, { name: 'Notes', kind: 'doc', parentId: null });
  return {
    db,
    auth,
    workspace,
    owner,
    other,
    actor,
    item,
    store: new AppearanceStore(workspace, provider),
    spaces: new SpaceStore(workspace),
  };
}
const image = async () => ({
  data: (
    await sharp({ create: { width: 16, height: 16, channels: 3, background: '#ca3970' } })
      .png()
      .toBuffer()
  ).toString('base64'),
});
test('custom creation icons are atomic, remain through rename and lists, and reset to a name hash', async () => {
  const f = fixture();
  const doc = f.workspace.create(f.owner.id, {
    name: 'Custom',
    kind: 'doc',
    parentId: null,
    icon: '🌷',
  });
  expect(f.workspace.list(f.owner.id).find((item) => item.id === doc.id)?.appearance?.icon).toBe(
    '🌷',
  );
  f.workspace.update(f.owner.id, doc.id, { name: 'Renamed' });
  expect(f.store.get(f.actor(), doc.id).appearance.icon).toBe('🌷');
  await f.store.update(f.actor(), doc.id, { revision: 1, icon: null });
  expect(f.workspace.get(f.owner.id, doc.id).appearance?.icon).toBeNull();
  expect(filenameEmoji('e\u0301')).toBe(filenameEmoji('é'));
  expect(filenameEmoji('Renamed')).toBeTruthy();
  const before = f.workspace.list(f.owner.id).length;
  expect(() =>
    f.workspace.create(f.owner.id, {
      name: 'Invalid',
      kind: 'doc',
      parentId: null,
      icon: 'missing',
    }),
  ).toThrow();
  expect(f.workspace.list(f.owner.id)).toHaveLength(before);
  for (const value of ['🌷', '👩🏽‍💻', '🇨🇦', 'lucide:folder'])
    expect(validIdentityIcon(value)).toBe(true);
  for (const value of ['', '🌷🌷', 'abc', 'lucide:missing', '<svg>'])
    expect(validIdentityIcon(value)).toBe(false);
});
test('ordinary editors cannot change identity; Space editors can edit exact children but not root identity', async () => {
  const f = fixture();
  f.workspace.share(f.owner.id, f.item.id, f.other.id, 'editor');
  expect(f.store.get(f.actor(f.other.id), f.item.id).canEdit).toBe(false);
  await expect(
    f.store.update(f.actor(f.other.id), f.item.id, { revision: 0, icon: '🌷' }),
  ).rejects.toMatchObject({ status: 403 });
  const root = f.spaces.createRoot(f.owner.id, { name: 'Space', parentId: null }).space;
  const child = f.spaces.createChild(f.owner.id, root.id, {
    name: 'Page',
    kind: 'doc',
    parentId: root.id,
    icon: '🍋',
  }).item;
  f.spaces.share(f.owner.id, root.id, f.other.id, 'editor');
  await f.store.update(f.actor(f.other.id, root.id, child.id), child.id, {
    revision: 1,
    icon: '🌷',
  });
  expect(f.spaces.list(f.other.id, root.id).items[0].appearance?.icon).toBe('🌷');
  await expect(
    f.store.update(f.actor(f.other.id, root.id), root.id, { revision: 0, accent: 'ruby' }),
  ).rejects.toMatchObject({ status: 403 });
  const otherRoot = f.spaces.createRoot(f.owner.id, { name: 'Other', parentId: null }).space;
  expect(() => f.store.get(f.actor(f.owner.id, otherRoot.id, child.id), child.id)).toThrow();
  expect(() => f.store.get(f.actor(), child.id)).toThrow();
});
test('cover upload is normalized, private, preserved on failure, retained in trash and cleaned on replacement', async () => {
  const f = fixture(),
    actor = f.actor();
  const saved = await f.store.update(actor, f.item.id, {
    revision: 0,
    cover: { source: 'upload', images: { shared: await image() }, position: 42 },
  });
  expect(saved.appearance.cover?.source).toBe('upload');
  const hash = f.db.prepare('SELECT id FROM cover_assets').get()!.id as string;
  expect((await sharp(f.store.asset(actor, f.item.id, hash)).metadata()).format).toBe('webp');
  expect(() => f.store.asset(f.actor(f.other.id), f.item.id, hash)).toThrow();
  await expect(
    f.store.update(actor, f.item.id, {
      revision: 1,
      cover: { source: 'upload', images: { shared: { data: 'broken' } }, position: 50 },
    }),
  ).rejects.toThrow();
  expect(f.store.get(actor, f.item.id)).toEqual(saved);
  expect(f.store.asset(actor, f.item.id, hash).length).toBeGreaterThan(0);
  const trash = new TrashStore(f.workspace);
  trash.trash(f.owner.id, f.item.id);
  expect(() => f.store.asset(actor, f.item.id, hash)).toThrow();
  trash.restore(f.owner.id, f.item.id);
  expect(f.store.asset(actor, f.item.id, hash).length).toBeGreaterThan(0);
  await f.store.update(actor, f.item.id, { revision: 1, cover: { source: 'gem', gem: 'spinel' } });
  expect(f.db.prepare('SELECT count(*) AS n FROM cover_assets').get()!.n).toBe(0);
  expect(() => f.store.asset(actor, f.item.id, hash)).toThrow();
});
test('stale revisions, invalid colors and invalid paired variants leave all appearance unchanged', async () => {
  const f = fixture(),
    actor = f.actor();
  await f.store.update(actor, f.item.id, {
    revision: 0,
    cover: { source: 'gem', gem: 'ruby' },
  });
  await expect(f.store.update(actor, f.item.id, { revision: 0, icon: '🍋' })).rejects.toMatchObject(
    { status: 409 },
  );
  for (const cover of [
    { source: 'upload', images: { light: await image() }, position: 50 },
    { source: 'upload', images: { shared: await image(), dark: await image() }, position: 50 },
    { source: 'gem', gem: 'missing' },
    // Gem artwork always follows the active theme; only photo sources offer variants.
    { source: 'gem', gem: 'ruby', mode: 'light' },
  ])
    await expect(f.store.update(actor, f.item.id, { revision: 1, cover })).rejects.toThrow();
  expect(f.store.get(actor, f.item.id).appearance.cover).toEqual({
    source: 'gem',
    gem: 'ruby',
  });
  const folder = f.workspace.create(f.owner.id, { name: 'Folder', kind: 'folder', parentId: null });
  await expect(
    f.store.update(actor, folder.id, { revision: 0, iconColor: '#fff' }),
  ).rejects.toThrow();
  await f.store.update(actor, folder.id, { revision: 0, iconColor: 'primary-soft' });
  expect(
    f.workspace.list(f.owner.id).find((item) => item.id === folder.id)?.appearance?.iconColor,
  ).toBe('primary-soft');
});
test('access revoked while Unsplash awaits prevents publication and preserves prior cover', async () => {
  let release!: (photo: import('../../shared/appearance.ts').UnsplashPhoto) => void;
  const provider = new UnsplashProvider();
  provider.choose = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const f = fixture(provider),
    actor = f.actor();
  await f.store.update(actor, f.item.id, { revision: 0, cover: { source: 'gem', gem: 'ruby' } });
  const saving = f.store.update(actor, f.item.id, {
    revision: 1,
    cover: { source: 'unsplash', images: { shared: 'photo' }, position: 50 },
  });
  f.db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(actor.customData.sessionHash);
  release({
    id: 'photo',
    url: 'https://images.unsplash.com/photo',
    photographer: 'Person',
    profile: 'https://unsplash.com/@person',
    page: 'https://unsplash.com/photos/photo',
  });
  await expect(saving).rejects.toMatchObject({ status: 401 });
  expect(f.store.get(f.actor(), f.item.id).appearance.cover).toEqual({
    source: 'gem',
    gem: 'ruby',
  });
});
test('over-quota owners may remove covers and permanent deletion cascades metadata and assets', async () => {
  const f = fixture(),
    actor = f.actor();
  await f.store.update(actor, f.item.id, {
    revision: 0,
    cover: { source: 'upload', images: { shared: await image() }, position: 50 },
  });
  const extra = f.workspace.create(f.owner.id, {
    name: 'Transferred',
    kind: 'doc',
    parentId: null,
  });
  // Ownership handover can put a recipient above its quota; removal must still work.
  f.db
    .prepare('INSERT INTO cover_assets(item_id,id,data) VALUES(?,?,zeroblob(?))')
    .run(extra.id, 'fixture', 101 * 1024 * 1024);
  await f.store.update(actor, f.item.id, { revision: 1, cover: null });
  expect(f.store.get(actor, f.item.id).appearance.cover).toBeNull();
  f.db.prepare('DELETE FROM workspace_items WHERE id=?').run(f.item.id);
  expect(
    f.db.prepare('SELECT * FROM item_appearance WHERE item_id=?').get(f.item.id),
  ).toBeUndefined();
});
test('Unsplash integration preserves hotlink parameters, attributes and reports selection', async () => {
  const calls: string[] = [];
  const photo = {
    id: 'photo',
    urls: { regular: 'https://images.unsplash.com/photo?ixid=retain' },
    user: { name: 'A Photographer', links: { html: 'https://unsplash.com/@person' } },
    links: {
      html: 'https://unsplash.com/photos/photo',
      download_location: 'https://api.unsplash.com/photos/photo/download?ixid=retain',
    },
  };
  const provider = new UnsplashProvider('configured', async (input) => {
    calls.push(String(input));
    return new Response(
      JSON.stringify(
        String(input).includes('/search/')
          ? { results: [photo] }
          : String(input).includes('/download')
            ? {}
            : photo,
      ),
    );
  });
  const results = await provider.search('mountains');
  expect(results[0].url).toContain('ixid=retain');
  expect(results[0].profile).toContain('utm_source=spinel');
  await provider.choose('photo');
  expect(calls.some((url) => url.includes('/photos/photo/download?ixid=retain'))).toBe(true);
  await expect(new UnsplashProvider('').search('mountains')).rejects.toMatchObject({ status: 503 });
});

test('icon colors persist atomically for Docs, folders and Space children, and legacy folder colors remain readable', async () => {
  const f = fixture();
  for (const kind of ['doc', 'folder'] as const) {
    const item = f.workspace.create(f.owner.id, {
      name: `Colored ${kind}`,
      kind,
      parentId: null,
      icon: 'lucide:book-open',
      iconColor: 'info-strong',
    });
    expect(f.store.get(f.actor(), item.id).appearance).toMatchObject({
      icon: 'lucide:book-open',
      iconColor: 'info-strong',
    });
    await f.store.update(f.actor(), item.id, { revision: 1, iconColor: 'success-strong' });
    f.workspace.update(f.owner.id, item.id, { name: 'Renamed' });
    expect(
      f.workspace.list(f.owner.id).find((entry) => entry.id === item.id)?.appearance?.iconColor,
    ).toBe('success-strong');
    await expect(
      f.store.update(f.actor(), item.id, { revision: 2, iconColor: '#ff0000' }),
    ).rejects.toMatchObject({ status: 400 });
    await f.store.update(f.actor(), item.id, { revision: 2, iconColor: null });
    expect(f.store.get(f.actor(), item.id).appearance.iconColor).toBeNull();
  }
  const before = f.workspace.list(f.owner.id).length;
  expect(() =>
    f.workspace.create(f.owner.id, {
      name: 'Invalid color',
      kind: 'doc',
      parentId: null,
      icon: 'lucide:book-open',
      iconColor: 'missing',
    }),
  ).toThrow('Choose an icon color');
  expect(f.workspace.list(f.owner.id)).toHaveLength(before);
  const root = f.spaces.createRoot(f.owner.id, {
    name: 'Colored Space',
    parentId: null,
    icon: 'lucide:folder',
    iconColor: 'info-strong',
  }).space;
  expect(f.store.get(f.actor(f.owner.id, root.id), root.id).appearance.iconColor).toBe(
    'info-strong',
  );
  const child = f.spaces.createChild(f.owner.id, root.id, {
    name: 'Child',
    kind: 'doc',
    parentId: root.id,
    icon: 'lucide:book-open',
    iconColor: 'secondary-strong',
  }).item;
  expect(f.store.get(f.actor(f.owner.id, root.id, child.id), child.id).appearance.iconColor).toBe(
    'secondary-strong',
  );
  const folder = f.workspace.create(f.owner.id, {
    name: 'Legacy folder',
    kind: 'folder',
    parentId: null,
  });
  f.db.prepare('INSERT INTO item_appearance(item_id,revision,value) VALUES(?,1,?)').run(
    folder.id,
    JSON.stringify({
      revision: 1,
      icon: null,
      folderColor: 'success-strong',
      accent: null,
      cover: null,
    }),
  );
  expect(f.store.get(f.actor(), folder.id).appearance.iconColor).toBe('success-strong');
  expect(
    f.workspace.list(f.owner.id).find((entry) => entry.id === folder.id)?.appearance?.iconColor,
  ).toBe('success-strong');
  await f.store.update(f.actor(), folder.id, { revision: 1, iconColor: null });
  expect(f.store.get(f.actor(), folder.id).appearance.iconColor).toBeNull();
});
