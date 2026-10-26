import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import sharp from 'sharp';
import { openDatabase } from '../server/database.ts';
import type { DatabaseSync } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { SpaceStore } from '../src/server/workspace/spaces.ts';
import { PortableFiles } from '../src/server/workspace/portable.ts';
import { TrashStore } from '../src/server/workspace/trash.ts';
import { startApp } from './app-process.ts';

type Item = {
  id: string;
  parentId: string | null;
  spaceId: string | null;
  position: number | null;
  kind: 'folder' | 'doc' | 'sheet' | 'space';
  name: string;
};

function ownedItems(db: DatabaseSync, owner: string): Item[] {
  return db
    .prepare(
      `SELECT id,parent_id AS parentId,space_id AS spaceId,space_position AS position,kind,name
       FROM workspace_items WHERE owner_id=? AND trashed_at IS NULL`,
    )
    .all(owner) as unknown as Item[];
}

function graph(items: Item[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const path = (id: string): string => {
    const item = byId.get(id)!;
    return `${item.parentId ? path(item.parentId) : ''}/${item.kind}:${item.name}`;
  };
  return items
    .map((item) => ({
      path: path(item.id),
      space: item.spaceId ? path(item.spaceId) : null,
      position: item.position,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function signIn(context: BrowserContext, auth: AuthStore, owner: string, origin: string) {
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: auth.createSession(owner).token,
      url: origin.replace('http:', 'https:'),
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
}

test('exports owned nested files and whole Spaces, then imports their contents into a fresh instance', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  const sourceDb = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const sourceAuth = new AuthStore(sourceDb);
  const source = new WorkspaceStore(sourceAuth, { spacesEnabled: true });
  const spaces = new SpaceStore(source);
  const portable = new PortableFiles(source);
  const owner = sourceAuth.createUser(`Archive owner ${info.testId}`);
  const other = sourceAuth.createUser(`Archive collaborator ${info.testId}`);
  const expected = new Map<string, { kind: 'doc' | 'sheet'; text: string; image: boolean }>();
  const png = await sharp({
    create: { width: 8, height: 5, channels: 3, background: '#b96788' },
  })
    .png()
    .toBuffer();
  const image = `data:image/png;base64,${png.toString('base64')}`;
  const seedNative = async (
    item: { id: string; kind: 'doc' | 'sheet'; name: string },
    text: string,
    withImage = false,
  ) => {
    const snapshot =
      item.kind === 'sheet'
        ? {
            id: 'source',
            name: item.name,
            sheetOrder: ['summary'],
            sheets: {
              summary: {
                id: 'summary',
                name: 'Summary',
                rowCount: 20,
                columnCount: 8,
                cellData: { 0: { 0: { v: text } } },
              },
            },
          }
        : {
            id: 'source',
            title: item.name,
            body: { dataStream: `${text}\r\n`, paragraphs: [{ startIndex: text.length }] },
            ...(withImage
              ? {
                  drawings: {
                    picture: {
                      source: image,
                      drawingType: 0,
                      imageSourceType: 'BASE64',
                      unitId: 'source',
                      subUnitId: 'source',
                    },
                  },
                }
              : {}),
          };
    const prepared = await portable.prepare({ filename: `${item.name}.json`, snapshot });
    const native = portable.materialize(prepared, item.id);
    for (const embedded of prepared.images.values())
      sourceDb
        .prepare('INSERT INTO doc_images VALUES(?,?,?,?)')
        .run(item.id, embedded.id, embedded.mime, embedded.data);
    const table = item.kind === 'sheet' ? 'sheet_snapshots' : 'doc_snapshots';
    // Seed valid native content before any collaboration unit opens. Space
    // children intentionally have no ordinary single-file save endpoint.
    sourceDb
      .prepare(`INSERT INTO ${table}(item_id,snapshot,revision,write_id) VALUES(?,?,1,?)`)
      .run(item.id, JSON.stringify(native), randomUUID());
    expected.set(item.name, { kind: item.kind, text, image: withImage });
  };
  const folder = source.create(owner.id, { name: 'Archive home', kind: 'folder', parentId: null });
  const nested = source.create(owner.id, {
    name: 'Plans 2026',
    kind: 'folder',
    parentId: folder.id,
  });
  source.create(owner.id, { name: 'Empty folder', kind: 'folder', parentId: nested.id });
  const budget = source.create(owner.id, {
    name: 'Archive budget',
    kind: 'sheet',
    parentId: nested.id,
  });
  await seedNative({ ...budget, kind: 'sheet' }, 'Archive cell 67');
  const note = source.create(owner.id, { name: 'Archive note', kind: 'doc', parentId: null });
  await seedNative({ ...note, kind: 'doc' }, 'Archive note with a portable image', true);
  const space = spaces.createRoot(owner.id, { name: 'Trip Space', parentId: folder.id }).space;
  const brief = spaces.createChild(owner.id, space.id, {
    name: 'Trip brief',
    kind: 'doc',
    parentId: space.id,
  }).item;
  await seedNative({ ...brief, kind: 'doc' }, 'A Doc can contain the trip costs');
  const costs = spaces.createChild(owner.id, space.id, {
    name: 'Trip costs',
    kind: 'sheet',
    parentId: brief.id,
  }).item;
  await seedNative({ ...costs, kind: 'sheet' }, 'Space worksheet content 67');
  spaces.createChild(owner.id, space.id, {
    name: 'Receipts',
    kind: 'folder',
    parentId: costs.id,
  });
  spaces.createChild(owner.id, space.id, {
    name: 'Reference',
    kind: 'folder',
    parentId: space.id,
  });
  source.share(owner.id, folder.id, other.id, 'editor');
  const shared = source.create(other.id, {
    name: 'Shared file excluded',
    kind: 'doc',
    parentId: null,
  });
  source.share(other.id, shared.id, owner.id, 'admin');
  source.place(owner.id, shared.id, null);
  const trashed = source.create(owner.id, {
    name: 'Trashed file excluded',
    kind: 'doc',
    parentId: folder.id,
  });
  new TrashStore(source).trash(owner.id, trashed.id);
  const original = ownedItems(sourceDb, owner.id);
  const originalIds = new Set(original.map((item) => item.id));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const directory = await mkdtemp(join(tmpdir(), 'spinel-archive-e2e-'));
  let destinationApp: Awaited<ReturnType<typeof startApp>> | undefined;
  let destinationContext: BrowserContext | undefined;
  let destinationDb: DatabaseSync | undefined;
  try {
    await signIn(context, sourceAuth, owner.id, baseURL!);
    await page.goto('/');
    await expect(
      page.getByRole('button', { name: 'Shared file excluded Doc', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'More actions for My files', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Export all my files', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Export all my files', exact: true });
    await expect(confirmation).toContainText(
      'Files shared with you, Trash, history and sharing settings are not included.',
    );
    const downloading = page.waitForEvent('download');
    await confirmation.getByRole('button', { name: 'Export files', exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
    const archivePath = info.outputPath('workspace-archive.zip');
    await download.saveAs(archivePath);
    expect(await download.failure()).toBeNull();
    expect((await readFile(archivePath)).subarray(0, 2).toString()).toBe('PK');
    await expect(confirmation.getByRole('status')).toHaveText(
      'Archive sent to your browser. Check your downloads.',
    );
    await confirmation.getByRole('button', { name: 'Done', exact: true }).click();

    const origin = `http://localhost:${info.project.name === 'development' ? 3186 : 3187}`;
    const databasePath = join(directory, 'destination.sqlite');
    destinationApp = await startApp({
      databasePath,
      origin,
      development: info.project.name === 'development',
    });
    destinationDb = openDatabase(databasePath);
    const destinationAuth = new AuthStore(destinationDb);
    const importer = destinationAuth.createUser('Archive importer');
    expect(ownedItems(destinationDb, importer.id)).toEqual([]);
    destinationContext = await browser.newContext({
      baseURL: origin,
      viewport: { width: 390, height: 844 },
    });
    await signIn(destinationContext, destinationAuth, importer.id, origin);
    const importedPage = await destinationContext.newPage();
    importedPage.setDefaultTimeout(15_000);
    importedPage.on('pageerror', (error) => errors.push(error.message));
    await importedPage.goto('/');
    await importedPage.getByRole('button', { name: 'New', exact: true }).click();
    await importedPage.getByRole('menuitem', { name: 'Import file…', exact: true }).click();
    const importing = importedPage.getByRole('dialog', { name: 'Import file', exact: true });
    await importing
      .getByLabel('Univer file or archive', { exact: true })
      .setInputFiles(archivePath);
    await expect(importing.getByRole('status')).toHaveText(
      'Imported 4 files, 5 folders and 1 Space into My files.',
      { timeout: 30_000 },
    );
    await importing.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(
      importedPage.getByRole('button', { name: 'Archive home Folder', exact: true }),
    ).toBeVisible();
    expect(
      await importedPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    const copies = ownedItems(destinationDb, importer.id);
    expect(graph(copies)).toEqual(graph(original));
    expect(copies.every((item) => !originalIds.has(item.id))).toBe(true);
    expect(
      destinationDb.prepare('SELECT count(*) AS total FROM workspace_grants').get()!.total,
    ).toBe(0);
    expect(copies.some((item) => /excluded/.test(item.name))).toBe(false);
    for (const item of copies) {
      const content = expected.get(item.name);
      if (!content) continue;
      const url = item.spaceId
        ? `/api/spaces/${item.spaceId}/items/${item.id}/export`
        : `/api/items/${item.id}/export`;
      const response = await destinationContext.request.get(url);
      expect(response.status()).toBe(200);
      const snapshot = await response.json();
      expect(
        content.kind === 'sheet'
          ? snapshot.sheets.summary.cellData[0][0].v
          : snapshot.body.dataStream,
      ).toContain(content.text);
      if (content.image) expect(JSON.stringify(snapshot)).toContain(image);
    }
    await importedPage.getByRole('button', { name: 'Archive home Folder', exact: true }).click();
    await expect(
      importedPage.getByRole('button', { name: 'Trip Space Space', exact: true }),
    ).toBeVisible();
    await importedPage.getByRole('button', { name: 'Plans 2026 Folder', exact: true }).click();
    await expect(
      importedPage.getByRole('button', { name: 'Empty folder Folder', exact: true }),
    ).toBeVisible();
    await expect(
      importedPage.getByRole('button', { name: 'Archive budget Sheet', exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled([destinationApp?.close(), destinationContext?.close()]);
    destinationDb?.close();
    sourceDb.close();
    await rm(directory, { recursive: true, force: true });
  }
});
