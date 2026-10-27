import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import type { NativeSnapshot } from '@spinel/sync-client';
import type { OfflineCreationRequest } from '../src/shared/offlineCreation.ts';
import {
  attention,
  copy,
  edit,
  fixture,
  matchesServer,
  nativeInput,
  pending,
  savedLocally,
  stored,
  synced,
  usableCanvas,
} from './offline-fixture.ts';
import type { Kind, OfflineFixture, Stored } from './offline-fixture.ts';
import { nativeTheme } from './native-theme.ts';

type CreationStored = Stored & {
  createdFileRevision?: number;
  creation?: {
    request: OfflineCreationRequest;
    createdAt: number;
    problem?: string;
    canRelocate?: boolean;
  };
};
const endpoint = '**/api/items/offline-create';

async function deviceCreation(f: OfflineFixture, id: string): Promise<CreationStored | undefined> {
  return stored(f.page, f.actor.id, id);
}

async function deviceCatalog(f: OfflineFixture) {
  return f.page.evaluate(
    (accountId) =>
      new Promise<{ creationRevision?: number; items: { id: string }[] }>((resolve, reject) => {
        const opening = indexedDB.open(`spinel-offline-${accountId}`);
        opening.onerror = () => reject(opening.error);
        opening.onupgradeneeded = () => {
          opening.transaction?.abort();
          reject(new Error('The prepared catalog is missing.'));
        };
        opening.onsuccess = () => {
          const database = opening.result;
          const read = database.transaction('meta').objectStore('meta').get('catalog');
          read.onerror = () => {
            database.close();
            reject(read.error);
          };
          read.onsuccess = () => {
            database.close();
            resolve(read.result);
          };
        };
      }),
    f.actor.id,
  );
}

async function newDocument(page: Page, kind: Kind, name: string) {
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText(['Sheet', 'Doc']);
  await menu
    .getByRole('menuitem', { name: kind === 'sheet' ? 'Sheet' : 'Doc', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: `New ${kind}`, exact: true });
  await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
  await expect(dialog.getByRole('option')).toHaveText(['Sheet', 'Doc']);
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\?item=[a-f\d-]{36}$/);
  await usableCanvas(page);
  await savedLocally(page);
  const id = new URL(page.url()).searchParams.get('item')!;
  expect(id).toMatch(/^[a-f\d-]{36}$/);
  return id;
}

function uploaded(f: OfflineFixture, id: string) {
  return f.db.prepare('SELECT * FROM workspace_items WHERE id=?').get(id);
}

function receipts(f: OfflineFixture) {
  return f.db
    .prepare('SELECT * FROM workspace_offline_creations WHERE user_id=? ORDER BY item_id')
    .all(f.actor.id);
}

async function readCreated(f: OfflineFixture, id: string, unitId: string) {
  const response = await f.control.request.get(
    `/sync-api/items/${id}/snapshot?unitId=${encodeURIComponent(unitId)}`,
  );
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as { revision: number; snapshot: NativeSnapshot };
}

function content(snapshot: NativeSnapshot, kind: Kind, text: string) {
  if (kind === 'sheet') {
    if (!('sheets' in snapshot)) throw new Error('Expected a Sheet snapshot.');
    expect(snapshot.sheets[snapshot.sheetOrder[0]].cellData?.[0]?.[3]?.v).toBe(Number(text));
  } else {
    if ('sheets' in snapshot) throw new Error('Expected a Doc snapshot.');
    expect(snapshot.body?.dataStream.split(text)).toHaveLength(2);
  }
}

async function capture(page: Page, info: TestInfo, state: string, phone = false) {
  await mkdir('test-results/theme-screenshots', { recursive: true });
  const original = page.viewportSize()!;
  const views = phone
    ? ([
        ['light', 390],
        ['dark', 390],
      ] as const)
    : ([
        ['light', 1440],
        ['dark', 1440],
        ['light', 390],
      ] as const);
  for (const [theme, width] of views) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    if (phone)
      await nativeTheme(
        page,
        page
          .getByRole('region', { name: 'Doc document', exact: true })
          .getByLabel('Document canvas', { exact: true }),
        theme,
      );
    await page.screenshot({
      path: `test-results/theme-screenshots/spn-051-${state}-${theme}-${width}-${info.project.name}.png`,
      animations: 'disabled',
    });
  }
  await page.setViewportSize(original);
  await page.emulateMedia({ colorScheme: 'light' });
}

test.describe('documents created offline', () => {
  test.setTimeout(180_000);

  for (const kind of ['sheet', 'doc'] as const)
    test(`${kind}: create in a cached folder, edit, reload twice offline and upload once`, async ({
      browser,
      baseURL,
    }, info) => {
      const f = await fixture(browser, baseURL!, info, kind);
      let disconnected = false;
      const setDisconnected = async (value: boolean) => {
        disconnected = value;
        await f.network.setOffline(value);
      };
      try {
        // Keep an explicit creation HTTP outage across cached-shell reloads,
        // alongside syncNetwork's socket outage. Online uses the real route.
        await f.context.route(endpoint, (route) =>
          disconnected ? route.abort('internetdisconnected') : route.fallback(),
        );
        const folder = f.workspace.create(f.actor.id, {
          name: 'Prepared destination',
          kind: 'folder',
          parentId: null,
        });
        const movedTo =
          kind === 'sheet'
            ? f.workspace.create(f.actor.id, {
                name: 'Later destination',
                kind: 'folder',
                parentId: null,
              })
            : undefined;
        await f.download();
        await f.page.goto('/');
        await f.page.getByRole('button', { name: `${folder.name} Folder`, exact: true }).click();
        await expect(f.page.getByRole('heading', { name: folder.name, exact: true })).toBeVisible();
        await setDisconnected(true);
        // A warm disconnected dashboard and a cold offline dashboard must both create.
        if (kind === 'doc') await f.page.reload();
        await expect(
          f.page.getByRole('button', { name: 'Offline — not connected to Spinel' }),
        ).toBeVisible();
        const name = `New offline ${kind}`;
        const id = await newDocument(f.page, kind, name);
        expect(uploaded(f, id)).toBeUndefined();
        const blank = (await deviceCreation(f, id))!;
        expect(blank.creation?.request).toMatchObject({
          itemId: id,
          parentId: folder.id,
          kind,
          name,
        });
        expect(blank.outbox).toMatchObject({ account: f.actor.id, item: id });
        const text = kind === 'sheet' ? '851' : 'Written before the connection returned 851';
        await edit(f.page, kind, text);
        await savedLocally(f.page);
        const before = (await deviceCreation(f, id))!;
        expect(pending(before.outbox?.checkpoint)).toBe(true);
        for (let reload = 0; reload < 2; reload++) {
          await f.page.reload();
          await expect.poll(() => f.page.evaluate(() => navigator.onLine)).toBe(false);
          await usableCanvas(f.page);
          await savedLocally(f.page);
          expect(await copy(f.page, kind)).toContain(text);
          const restored = (await deviceCreation(f, id))!;
          expect(restored.creation).toEqual(before.creation);
          expect(restored.outbox!.checkpoint).toEqual(before.outbox!.checkpoint);
          expect(uploaded(f, id)).toBeUndefined();
        }
        await f.page.getByRole('button', { name: 'Back to files', exact: true }).click();
        const row = f.page.getByRole('listitem').filter({
          has: f.page.getByRole('button', {
            name: `${name} ${kind === 'sheet' ? 'Sheet' : 'Doc'}`,
            exact: true,
          }),
        });
        await expect(row.getByText(/\bNot synced yet$/)).toBeVisible();
        if (kind === 'doc') {
          await capture(f.page, info, 'pending-file');
          await setDisconnected(false);
          await f.page.reload();
          await expect(row.getByText(/\bNot synced yet$/)).toBeVisible();
          await expect(
            row.getByText('Saved on this device. Open to upload when connected.', { exact: true }),
          ).toBeVisible();
          expect(uploaded(f, id)).toBeUndefined();
          expect((await deviceCreation(f, id))!.outbox!.checkpoint).toEqual(
            before.outbox!.checkpoint,
          );
        }
        await row
          .getByRole('button', {
            name: `${name} ${kind === 'sheet' ? 'Sheet' : 'Doc'}`,
            exact: true,
          })
          .click();
        await usableCanvas(f.page);
        if (kind === 'sheet') {
          await savedLocally(f.page);
          const canvas = await f.page.locator('.univer-container canvas').first().elementHandle();
          await setDisconnected(false);
          await synced(f.page);
          // Removing the pending-create marker cannot remount the native editor.
          expect(
            await f.page
              .locator('.univer-container canvas')
              .first()
              .evaluate((node, previous) => node === previous, canvas!),
          ).toBe(true);
        } else await synced(f.page);
        expect(uploaded(f, id)).toMatchObject({
          id,
          parent_id: folder.id,
          owner_id: f.actor.id,
          kind,
          name,
        });
        expect(receipts(f)).toHaveLength(1);
        expect(receipts(f)[0]).toMatchObject({
          item_id: id,
          unit_id: before.creation!.request.unitId,
        });
        const result = await readCreated(f, id, before.creation!.request.unitId);
        content(result.snapshot, kind, text);
        await matchesServer(f.page, result);
        expect((await deviceCreation(f, id))?.creation).toBeUndefined();
        expect(pending((await deviceCreation(f, id))!.outbox?.checkpoint)).toBe(false);
        await setDisconnected(true);
        await setDisconnected(false);
        await synced(f.page);
        expect(await readCreated(f, id, before.creation!.request.unitId)).toEqual(result);
        if (movedTo)
          // Keep the last accepted device metadata through a failed background
          // refresh; later live folder placement must still take precedence.
          await f.context.route(`**/api/items/${id}/offline-bundle`, (route) =>
            route.abort('failed'),
          );
        await f.page.reload();
        await synced(f.page);
        await matchesServer(f.page, result);
        if (movedTo) {
          const acceptedRevision = (await deviceCreation(f, id))?.createdFileRevision;
          expect(acceptedRevision).toEqual(expect.any(Number));
          await f.page.getByRole('button', { name: 'Back to files', exact: true }).click();
          await expect(
            f.page.getByRole('heading', { name: folder.name, exact: true }),
          ).toBeVisible();
          await f.page
            .getByRole('button', { name: `More actions for ${name}`, exact: true })
            .click();
          await f.page.getByRole('menuitem', { name: 'Move…', exact: true }).click();
          const dialog = f.page.getByRole('dialog', { name: `Move ${name}`, exact: true });
          await dialog.getByRole('combobox', { name: 'Destination' }).selectOption(movedTo.id);
          await dialog.getByRole('button', { name: 'Save', exact: true }).click();
          await expect(dialog).toBeHidden();
          await expect(
            f.page.getByRole('button', { name: `${name} Sheet`, exact: true }),
          ).toHaveCount(0);
          await f.page
            .getByRole('navigation', { name: 'Breadcrumb', exact: true })
            .getByRole('button', { name: 'My files', exact: true })
            .click();
          await f.page.getByRole('button', { name: `${movedTo.name} Folder`, exact: true }).click();
          await expect(
            f.page.getByRole('button', { name: `${name} Sheet`, exact: true }),
          ).toHaveCount(1);
          expect(uploaded(f, id)?.parent_id).toBe(movedTo.id);
          expect(await readCreated(f, id, before.creation!.request.unitId)).toEqual(result);
          await f.page
            .getByRole('button', { name: `More actions for ${name}`, exact: true })
            .click();
          await f.page.getByRole('menuitem', { name: 'Move to Trash', exact: true }).click();
          await expect(
            f.page.getByRole('button', { name: `${name} Sheet`, exact: true }),
          ).toHaveCount(0);
          expect(uploaded(f, id)?.trashed_at).toEqual(expect.any(Number));
          await f.page.reload();
          await expect(
            f.page.getByRole('heading', { name: movedTo.name, exact: true }),
          ).toBeVisible();
          await expect(
            f.page.getByRole('button', { name: `${name} Sheet`, exact: true }),
          ).toHaveCount(0);
          await expect
            .poll(async () => {
              const catalog = await deviceCatalog(f);
              return (
                (catalog.creationRevision ?? 0) >= acceptedRevision! &&
                !catalog.items.some((item) => item.id === id)
              );
            })
            .toBe(true);
          await setDisconnected(true);
          await f.page.reload();
          await expect(
            f.page.getByRole('heading', { name: movedTo.name, exact: true }),
          ).toBeVisible();
          await expect(
            f.page.getByRole('button', { name: `${name} Sheet`, exact: true }),
          ).toHaveCount(0);
        }
        expect(receipts(f)).toHaveLength(1);
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    });

  test('a warm upload keeps its renamed title and tags after removing the device copy', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'sheet');
    try {
      await f.download();
      await f.page.goto('/');
      await expect(
        f.page.getByRole('button', { name: `${f.item.name} Sheet`, exact: true }),
      ).toBeVisible();
      let catalogReads = 0;
      f.page.on('request', (request) => {
        if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/items')
          catalogReads++;
      });
      await f.network.setOffline(true);
      const name = 'Warm offline budget';
      const renamed = 'Budget ready to share';
      const id = await newDocument(f.page, 'sheet', name);
      await edit(f.page, 'sheet', '624');
      await savedLocally(f.page);
      const before = (await deviceCreation(f, id))!;
      await f.network.setOffline(false);
      await synced(f.page);
      const result = await readCreated(f, id, before.creation!.request.unitId);
      content(result.snapshot, 'sheet', '624');
      await matchesServer(f.page, result);

      // Stay in this warm Dashboard: a full list reload would hide a missing
      // ordinary catalog entry behind the server's already updated metadata.
      await f.page.getByRole('button', { name: `Rename ${name}`, exact: true }).click();
      const form = f.page.getByRole('form', { name: 'Rename document', exact: true });
      await form.getByRole('textbox', { name: 'Document name', exact: true }).fill(renamed);
      await form.getByRole('button', { name: 'Save name', exact: true }).click();
      await expect(f.page.getByRole('heading', { name: renamed, exact: true })).toBeVisible();
      await f.page.getByRole('button', { name: 'Back to files', exact: true }).click();
      await expect(f.page.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
      const row = f.page.getByRole('listitem').filter({
        has: f.page.getByRole('button', { name: `${renamed} Sheet`, exact: true }),
      });
      await expect(row).toHaveCount(1);
      await expect(f.page.getByRole('button', { name: `${name} Sheet`, exact: true })).toHaveCount(
        0,
      );
      await row.getByRole('button', { name: `More actions for ${renamed}`, exact: true }).click();
      await f.page.getByRole('menuitem', { name: 'Tags…', exact: true }).click();
      const tags = f.page.getByRole('dialog', { name: `Tags for ${renamed}`, exact: true });
      await tags.getByLabel('Tag', { exact: true }).fill('planning');
      await tags.getByRole('button', { name: 'Add tag', exact: true }).click();
      await expect(
        tags.getByRole('button', { name: 'Remove #planning', exact: true }),
      ).toBeVisible();
      await tags.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(row.getByText('#planning', { exact: true })).toBeVisible();

      await row.getByRole('button', { name: `More actions for ${renamed}`, exact: true }).click();
      await f.page.getByRole('menuitem', { name: 'Remove from device', exact: true }).click();
      await expect(
        f.page.getByRole('status').filter({ hasText: `${renamed} was removed from this device.` }),
      ).toHaveText(`${renamed} was removed from this device.`);
      await expect(row).toHaveCount(1);
      await expect(row.getByText('#planning', { exact: true })).toBeVisible();
      expect(await deviceCreation(f, id)).toBeUndefined();
      expect(uploaded(f, id)).toMatchObject({ name: renamed, parent_id: null, trashed_at: null });
      expect(await readCreated(f, id, before.creation!.request.unitId)).toEqual(result);
      expect(catalogReads).toBe(0);
      expect(receipts(f)).toHaveLength(1);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  test('a lost creation acknowledgement replays the same request after an offline reload', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'doc');
    try {
      await f.download();
      await f.page.goto('/');
      await f.network.setOffline(true);
      await f.page.reload();
      const id = await newDocument(f.page, 'doc', 'One document after a lost reply');
      const text = 'Exactly one offline draft 917';
      await edit(f.page, 'doc', text);
      await savedLocally(f.page);
      const before = (await deviceCreation(f, id))!;
      const requests: OfflineCreationRequest[] = [];
      let lose = true;
      await f.context.route(endpoint, async (route) => {
        requests.push(route.request().postDataJSON());
        const response = await route.fetch();
        if (lose) {
          lose = false;
          expect(response.status()).toBe(201);
          await f.network.setOffline(true);
          await route.abort('failed');
        } else await route.fulfill({ response });
      });
      await f.network.setOffline(false);
      await expect.poll(() => receipts(f).length).toBe(1);
      await expect.poll(() => f.page.evaluate(() => navigator.onLine)).toBe(false);
      expect((await deviceCreation(f, id))!.creation).toEqual(before.creation);
      expect(uploaded(f, id)?.id).toBe(id);
      await f.page.reload();
      await usableCanvas(f.page);
      await savedLocally(f.page);
      expect(await copy(f.page, 'doc')).toContain(text);
      await f.network.setOffline(false);
      await synced(f.page);
      expect(requests.length).toBeGreaterThanOrEqual(2);
      for (const request of requests) expect(request).toEqual(before.creation!.request);
      const result = await readCreated(f, id, before.creation!.request.unitId);
      content(result.snapshot, 'doc', text);
      await matchesServer(f.page, result);
      expect(receipts(f)).toHaveLength(1);
      const duplicate = await f.control.request.post('/api/items/offline-create', {
        headers: { Origin: baseURL!, 'X-Spinel-Offline-Account': f.actor.id },
        data: before.creation!.request,
      });
      expect(duplicate.status(), await duplicate.text()).toBe(201);
      expect(await readCreated(f, id, before.creation!.request.unitId)).toEqual(result);
      expect(receipts(f)).toHaveLength(1);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  test('a phone Doc starts offline, accepts native text and retains it through a cold reload', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'doc', { phone: true });
    try {
      await f.download();
      await f.page.goto('/');
      await f.network.setOffline(true);
      await f.page.reload();
      const id = await newDocument(f.page, 'doc', 'Phone notes without a connection');
      const region = f.page.getByRole('region', { name: 'Doc document', exact: true });
      await expect(region).toHaveAttribute('data-mobile', 'true');
      await region.getByRole('button', { name: 'Edit', exact: true }).tap();
      const canvas = region.getByLabel('Document canvas', { exact: true });
      // A blank first paragraph has no text pixels to locate. The phone's
      // actual touch handler resolves this point to its empty insertion line.
      await canvas.tap({ position: { x: 32, y: 32 } });
      await canvas.tap({ position: { x: 32, y: 32 } });
      await expect(nativeInput(f.page)).toBeFocused();
      const text = 'An offline phone note 328';
      await f.page.keyboard.type(text);
      await savedLocally(f.page);
      const before = (await deviceCreation(f, id))!;
      expect(pending(before.outbox?.checkpoint)).toBe(true);
      await f.page.reload();
      await usableCanvas(f.page);
      await savedLocally(f.page);
      expect((await deviceCreation(f, id))?.outbox?.checkpoint).toEqual(before.outbox?.checkpoint);
      await capture(f.page, info, 'phone-doc-offline', true);
      await f.network.setOffline(false);
      await synced(f.page);
      const result = await readCreated(f, id, before.creation!.request.unitId);
      content(result.snapshot, 'doc', text);
      await matchesServer(f.page, result);
      expect(receipts(f)).toHaveLength(1);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  test('a deleted destination retains the draft until another own folder is chosen', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'sheet');
    try {
      const folder = f.workspace.create(f.actor.id, {
        name: 'Original folder',
        kind: 'folder',
        parentId: null,
      });
      const replacement = f.workspace.create(f.actor.id, {
        name: 'Replacement folder',
        kind: 'folder',
        parentId: null,
      });
      await f.download();
      await f.page.goto('/');
      await f.page.getByRole('button', { name: `${folder.name} Folder`, exact: true }).click();
      await expect(f.page.getByRole('heading', { name: folder.name, exact: true })).toBeVisible();
      await f.network.setOffline(true);
      await f.page.reload();
      const name = 'Retained budget';
      const id = await newDocument(f.page, 'sheet', name);
      await edit(f.page, 'sheet', '513');
      await savedLocally(f.page);
      const before = (await deviceCreation(f, id))!;
      const removed = await f.control.request.post(`/api/items/${folder.id}/trash`, {
        headers: { Origin: baseURL! },
        data: {},
      });
      expect(removed.status(), await removed.text()).toBe(200);
      let conflictingCopies = 0;
      f.page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/items/offline-recovery') conflictingCopies++;
      });
      await f.network.setOffline(false);
      await attention(f.page);
      await expect
        .poll(async () => (await deviceCreation(f, id))?.creation?.canRelocate)
        .toBe(true);
      expect(uploaded(f, id)).toBeUndefined();
      expect(receipts(f)).toEqual([]);
      expect(conflictingCopies).toBe(0);
      await f.page
        .getByRole('button', { name: 'Save details: Needs attention', exact: true })
        .click();
      const details = f.page.getByRole('dialog', { name: 'Save details', exact: true });
      await expect(
        details.getByText(
          /Use Back to files, then choose another folder from this document’s menu\./,
        ),
      ).toBeVisible();
      await details.getByRole('button', { name: 'Close save details', exact: true }).click();
      await expect(
        f.page.getByRole('button', { name: 'Document actions', exact: true }),
      ).toHaveCount(0);
      await expect(
        f.page.getByRole('menuitem', { name: 'Choose another folder…', exact: true }),
      ).toHaveCount(0);
      await f.page.getByRole('button', { name: 'Back to files', exact: true }).click();
      await expect(
        f.page.getByRole('button', { name: `${name} Sheet`, exact: true }),
      ).toBeVisible();
      // An online cold start has no server item or parent; the retained row remains reachable.
      await f.page.goto('/');
      const row = f.page
        .getByRole('listitem')
        .filter({ has: f.page.getByRole('button', { name: `${name} Sheet`, exact: true }) });
      await expect(row.getByText(/\bNeeds attention$/)).toBeVisible();
      await capture(f.page, info, 'folder-unavailable');
      await row.getByRole('button', { name: `More actions for ${name}`, exact: true }).click();
      await f.page.getByRole('menuitem', { name: 'Choose another folder…', exact: true }).click();
      const dialog = f.page.getByRole('dialog', { name: 'Choose another folder', exact: true });
      await expect(dialog.getByRole('option', { name: folder.name, exact: true })).toHaveCount(0);
      await dialog.getByRole('combobox', { name: 'Destination' }).selectOption(replacement.id);
      await capture(f.page, info, 'choose-folder');
      await dialog.getByRole('button', { name: 'Choose folder', exact: true }).click();
      await expect(dialog).toBeHidden();
      await f.page.getByRole('button', { name: `${replacement.name} Folder`, exact: true }).click();
      await f.page.getByRole('button', { name: `${name} Sheet`, exact: true }).click();
      await synced(f.page);
      expect(uploaded(f, id)).toMatchObject({
        id,
        parent_id: replacement.id,
        owner_id: f.actor.id,
      });
      expect(receipts(f)).toHaveLength(1);
      const result = await readCreated(f, id, before.creation!.request.unitId);
      content(result.snapshot, 'sheet', '513');
      await matchesServer(f.page, result);
      expect(conflictingCopies).toBe(0);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  test('switching accounts hides a new offline document and retains it only for its original account', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'doc');
    try {
      await f.download();
      await f.page.goto('/');
      await f.network.setOffline(true);
      await f.page.reload();
      const name = 'Private offline creation';
      const id = await newDocument(f.page, 'doc', name);
      const text = 'Belongs only to the original account 662';
      await edit(f.page, 'doc', text);
      await savedLocally(f.page);
      const before = (await deviceCreation(f, id))!;
      await f.page.getByRole('button', { name: 'Back to files', exact: true }).click();
      await f.context.addCookies([f.cookie(f.editor.id)]);
      await f.network.setOffline(false);
      await f.page.reload();
      await expect(f.page.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
      await expect(f.page.getByText(name, { exact: true })).toHaveCount(0);
      await f.page.goto(`/?item=${id}`);
      await expect(
        f.page.getByRole('heading', { name: "This item isn't available", exact: true }),
      ).toBeVisible();
      await expect(f.page.getByText(name, { exact: true })).toHaveCount(0);
      await expect(f.page.getByText(text, { exact: false })).toHaveCount(0);
      expect(await deviceCreation(f, id)).toEqual(before);
      expect(uploaded(f, id)).toBeUndefined();
      expect(receipts(f)).toEqual([]);
      await f.context.addCookies([f.cookie(f.owner.id)]);
      await f.page.goto(`/?item=${id}`);
      await synced(f.page);
      const result = await readCreated(f, id, before.creation!.request.unitId);
      content(result.snapshot, 'doc', text);
      expect(uploaded(f, id)?.owner_id).toBe(f.owner.id);
      expect(receipts(f)).toHaveLength(1);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

  test('a failed local creation stays in the form without claiming a saved document', async ({
    browser,
    baseURL,
  }, info) => {
    const f = await fixture(browser, baseURL!, info, 'sheet');
    try {
      await f.download();
      await f.page.goto('/');
      await f.network.setOffline(true);
      await f.page.reload();
      await f.page.evaluate(() => {
        const add = IDBObjectStore.prototype.add;
        IDBObjectStore.prototype.add = function (value, key) {
          if (
            this.name === 'items' &&
            value?.creation &&
            sessionStorage.getItem('fail-create') === 'yes'
          )
            throw new DOMException('The device storage is full.', 'QuotaExceededError');
          return key === undefined ? add.call(this, value) : add.call(this, value, key);
        };
        sessionStorage.setItem('fail-create', 'yes');
      });
      await f.page.getByRole('button', { name: 'New', exact: true }).click();
      await f.page.getByRole('menuitem', { name: 'Sheet', exact: true }).click();
      const dialog = f.page.getByRole('dialog', { name: 'New sheet', exact: true });
      await dialog.getByRole('textbox', { name: 'Name' }).fill('Retry this device save');
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(dialog.getByRole('alert')).toContainText(/storage|space|save/i);
      await expect(dialog).toBeVisible();
      await expect(f.page).toHaveURL(new URL('/', baseURL!).href);
      await expect(f.page.getByText(/\bNot synced yet$/)).toHaveCount(0);
      expect(receipts(f)).toEqual([]);
      await f.page.evaluate(() => sessionStorage.removeItem('fail-create'));
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await savedLocally(f.page);
      const id = new URL(f.page.url()).searchParams.get('item')!;
      expect((await deviceCreation(f, id))?.creation?.request.name).toBe('Retry this device save');
      expect(uploaded(f, id)).toBeUndefined();
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
});
