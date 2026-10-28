import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Page,
  TestInfo,
} from '@playwright/test';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import {
  createParagraphId,
  createSectionId,
  DocumentFlavor,
  getDocsEmptySnapshot,
  LocaleType,
  validateDocumentStructure,
} from '@univerjs/core';
import type { ClientCheckpoint, NativeSnapshot } from '@spinel/sync-client';
import {
  canonical,
  inlineSnapshotCell,
  normalizedCell,
  normalizedDocBody,
} from '@spinel/sync-transform';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { DocumentStore } from '../src/server/workspace/documents.ts';
import { SpaceStore } from '../src/server/workspace/spaces.ts';
import { PortableFiles } from '../src/server/workspace/portable.ts';
import type { OfflineBundle } from '../src/shared/offlineBundle.ts';
import { sheetImageFixture } from './sheet-image-fixture.ts';
import { recordNativeSnapshots } from './sync-snapshot.ts';
import { syncNetwork } from './sync-network.ts';
import type { CreationTransportPost } from './offline-creation-network.ts';

export type Kind = 'sheet' | 'doc';
export type Stored = {
  bundle: OfflineBundle;
  recovery?: {
    recoveryId: string;
    filename: string;
    snapshot: NativeSnapshot;
    possibleReplayCrash: boolean;
  };
  outbox?: {
    account: string;
    item: string;
    spaceId?: string;
    unitId: string;
    checkpoint: ClientCheckpoint;
  };
};
export const saveStatus = (page: Page) =>
  page.getByRole('status', { name: 'Save status', exact: true });
export const nativeInput = (page: Page) =>
  page.locator('[contenteditable="true"][data-u-comp="editor"]');
export const savedLocally = (page: Page) =>
  expect(saveStatus(page)).toHaveText('Saved on this device — waiting to sync.', {
    timeout: 30_000,
  });
export const synced = (page: Page) =>
  expect(saveStatus(page)).toHaveText(
    'Synced. All changes are saved on the server and this device.',
    { timeout: 30_000 },
  );
export const attention = (page: Page) =>
  expect(saveStatus(page)).toContainText('Needs attention.', { timeout: 30_000 });
export const pending = (checkpoint?: ClientCheckpoint) =>
  Boolean(checkpoint?.sent || checkpoint?.buffer.length || checkpoint?.failure);

export async function usableCanvas(page: Page) {
  await expect
    .poll(
      () =>
        page.locator('.univer-container canvas').evaluateAll((canvases) =>
          // Sheets also renders its short formula-bar input as a canvas. Check
          // the document surface, independent of those auxiliary canvas nodes.
          Math.max(0, ...canvases.map((canvas) => canvas.getBoundingClientRect().height)),
        ),
      {
        message: 'The restored native canvas must have a visible layout height.',
        timeout: 15_000,
      },
    )
    .toBeGreaterThan(100);
}

export async function stored(page: Page, accountId: string, itemId: string) {
  return page.evaluate(
    async ({ accountId, itemId }) => {
      const name = `spinel-offline-${accountId}`;
      if (!(await indexedDB.databases()).some((database) => database.name === name)) return;
      return new Promise<Stored | undefined>((resolve, reject) => {
        const opening = indexedDB.open(`spinel-offline-${accountId}`);
        opening.onerror = () => reject(opening.error);
        opening.onupgradeneeded = () => {
          opening.transaction?.abort();
          reject(new Error('The device database was removed during observation.'));
        };
        opening.onsuccess = () => {
          const database = opening.result;
          if (!database.objectStoreNames.contains('items')) {
            database.close();
            resolve(undefined);
            return;
          }
          const read = database.transaction('items').objectStore('items').get(itemId);
          read.onerror = () => {
            database.close();
            reject(read.error);
          };
          read.onsuccess = () => {
            database.close();
            resolve(read.result);
          };
        };
      });
    },
    { accountId, itemId },
  );
}

export async function selectCell(page: Page, address: string) {
  const name = page
    .getByRole('region', { name: 'Sheet document', exact: true })
    .locator('[data-u-comp="defined-name"] input');
  await name.fill(address);
  await name.press('Enter');
}

export async function edit(page: Page, kind: Kind, text: string, address = 'D1') {
  if (kind === 'sheet') await selectCell(page, address);
  else {
    await page.locator('.univer-container').click({ position: { x: 130, y: 200 } });
    await nativeInput(page).focus();
    await page.keyboard.press('Control+Home');
  }
  // insertText goes through the real native input/composition path and commits
  // one user insertion; tests never invoke a writable editor/debug global.
  await page.keyboard.insertText(text);
  if (kind === 'sheet') await page.keyboard.press('Enter');
}

export async function copy(page: Page, kind: Kind, address = 'D1') {
  if (kind === 'sheet') await selectCell(page, address);
  else {
    await page.locator('.univer-container').click({ position: { x: 130, y: 200 } });
    await nativeInput(page).focus();
    await page.keyboard.press('Control+a');
  }
  const sentinel = `not-copied-${randomUUID()}`;
  await page.evaluate((text) => navigator.clipboard.writeText(text), sentinel);
  await page.keyboard.press('Control+c');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).not.toBe(sentinel);
  return page.evaluate(() => navigator.clipboard.readText());
}

/** Same documented defaults as existing native acceptance; every field remains compared. */
export function comparable(snapshot: NativeSnapshot) {
  if (!('sheets' in snapshot))
    return JSON.parse(
      canonical({ ...snapshot, rev: undefined, body: normalizedDocBody(snapshot.body) }),
    );
  const sheets = Object.fromEntries(
    Object.entries(snapshot.sheets).map(([sheetId, sheet]) => [
      sheetId,
      {
        ...sheet,
        cellData: Object.fromEntries(
          Object.entries(sheet.cellData ?? {})
            .map(([row, columns]) => [
              row,
              Object.fromEntries(
                Object.keys(columns ?? {}).flatMap((column) => {
                  const value = normalizedCell(
                    inlineSnapshotCell(snapshot, {
                      sheetId,
                      row: Number(row),
                      column: Number(column),
                    }),
                  );
                  return value ? [[column, value]] : [];
                }),
              ),
            ])
            .filter(([, row]) => Object.keys(row as object).length),
        ),
      },
    ]),
  );
  return JSON.parse(
    canonical({
      ...snapshot,
      rev: undefined,
      styles: {},
      sheets,
      // The drawing resource is serialized JSON. Compare its complete graph,
      // including all geometry and anchor fields, independent of object key order.
      // DefinedNameDataController writes '' before its empty map is loaded and
      // '{}' afterward. Normalize only that sentinel; retain populated payloads.
      resources: snapshot.resources?.map((resource) =>
        resource.name === 'SHEET_DRAWING_PLUGIN'
          ? { ...resource, data: JSON.parse(resource.data) }
          : resource.name === 'SHEET_DEFINED_NAME_PLUGIN' && resource.data === ''
            ? { ...resource, data: '{}' }
            : resource,
      ),
    }),
  );
}

export async function matchesServer(
  page: Page,
  expected: { revision: number; snapshot: NativeSnapshot },
) {
  const read = () =>
    page.evaluate(
      (id) =>
        (
          window as Window & {
            nativeSyncEvidence?: Record<string, { revision: number; snapshot: NativeSnapshot }>;
          }
        ).nativeSyncEvidence?.[id],
      expected.snapshot.id,
    );
  await expect.poll(async () => (await read())?.revision).toBe(expected.revision);
  expect(comparable((await read())!.snapshot)).toEqual(comparable(expected.snapshot));
}

export async function offlineSheetImages() {
  const snapshot = await sheetImageFixture();
  const resource = snapshot.resources[0];
  const drawings = JSON.parse(resource.data);
  const floating = drawings.tab.data.floating;
  const transformDefaults = { flipY: false, flipX: false, angle: 0, skewX: 0, skewY: 0 };
  // The pinned native renderer derives this rectangle from the existing cell
  // anchors: 46 + 2*100, 20 + 4*24 + 80, one column, and three 24px rows.
  // Seed a consistent imported fixture so strict equality tests sync behavior.
  floating.transform = {
    ...transformDefaults,
    left: 246,
    top: 196,
    width: 100,
    height: 72,
  };
  floating.axisAlignSheetTransform = {
    ...transformDefaults,
    ...floating.axisAlignSheetTransform,
  };
  resource.data = JSON.stringify(drawings);
  const cell = snapshot.sheets.tab.cellData[1][0].p;
  // Native cell images fit the 100x80 cell's 2px inset, preserving 4:3.
  cell.drawings.cell.transform.width = 98;
  cell.drawings.cell.transform.height = 73.5;
  cell.drawings.cell.docTransform.size = { width: 98, height: 73.5 };
  // Native cell-image layout uses an unbounded document page; its exported
  // JSON represents these Infinity values as null, just as this import does.
  cell.documentStyle.pageSize = {
    width: Number.POSITIVE_INFINITY,
    height: Number.POSITIVE_INFINITY,
  };
  return snapshot;
}

export async function fixture(
  browser: Browser,
  baseURL: string,
  info: TestInfo,
  kind: Kind,
  options: {
    databasePath?: string;
    space?: boolean;
    actor?: 'owner' | 'editor' | 'viewer';
    images?: boolean;
    seed?: NativeSnapshot;
    phone?: boolean;
    flavor?: DocumentFlavor;
    zoomRatio?: number;
    proxy?: BrowserContextOptions['proxy'];
  } = {},
) {
  const db = openDatabase(options.databasePath ?? `test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  const spaces = new SpaceStore(workspace);
  const owner = auth.createUser(`Offline owner ${info.testId}`);
  const editor = auth.createUser(`Offline editor ${info.testId}`);
  const viewer = auth.createUser(`Offline viewer ${info.testId}`);
  const users = { owner, editor, viewer };
  const actor = users[options.actor ?? 'owner'];
  const root = options.space
    ? spaces.createRoot(owner.id, { name: 'Offline project', parentId: null }).space
    : undefined;
  const contexts: BrowserContext[] = [];
  const cookie = (id: string) => ({
    name: COOKIE_NAME,
    value: auth.createSession(id).token,
    url: baseURL.replace('http:', 'https:'),
    secure: true,
    httpOnly: true,
    sameSite: 'Strict' as const,
  });
  const account = async (id: string, phone = false) => {
    const context = await browser.newContext({
      baseURL,
      proxy: options.proxy,
      viewport: { width: 1440, height: 1100 },
      permissions: ['clipboard-read', 'clipboard-write'],
      ...(phone
        ? {
            viewport: { width: 390, height: 844 },
            deviceScaleFactor: 1,
            isMobile: true,
            hasTouch: true,
            colorScheme: 'light' as const,
            reducedMotion: 'reduce' as const,
          }
        : {}),
    });
    contexts.push(context);
    await context.addCookies([cookie(id)]);
    return context;
  };
  const control = await account(owner.id);
  let item: { id: string; name: string };
  if (options.seed) {
    const files = new PortableFiles(workspace);
    const prepared = await files.prepare({
      filename: `Offline ${kind}.univer.json`,
      snapshot: options.seed,
    });
    if (root) {
      item = spaces.createChild(owner.id, root.id, {
        name: prepared.name,
        kind,
        parentId: root.id,
      }).item;
      // Seed a complete validated native fixture before its first collaboration
      // generation exists. Recovery itself must use the real browser/API path.
      const snapshot = files.materialize(prepared, item.id);
      auth.transaction(() => {
        for (const image of prepared.images.values())
          db.prepare('INSERT INTO doc_images VALUES(?,?,?,?)').run(
            item.id,
            image.id,
            image.mime,
            image.data,
          );
        db.prepare(
          `INSERT INTO ${kind === 'doc' ? 'doc_snapshots' : 'sheet_snapshots'} VALUES(?,?,?,?)`,
        ).run(item.id, JSON.stringify(snapshot), 1, randomUUID());
      });
    } else {
      item = await files.import(
        owner.id,
        { filename: `Offline ${kind}.univer.json`, parentId: null, snapshot: options.seed },
        () => {},
      );
    }
  } else if (options.images) {
    const snapshot = await offlineSheetImages();
    const response = await control.request.post('/api/items/import', {
      headers: { Origin: baseURL },
      data: {
        filename: 'Offline images.univer.json',
        parentId: null,
        snapshot,
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    item = (await response.json()).item;
  } else
    item = root
      ? spaces.createChild(owner.id, root.id, { name: `Offline ${kind}`, kind, parentId: root.id })
          .item
      : workspace.create(owner.id, { name: `Offline ${kind}`, kind, parentId: null });
  if (kind === 'doc' && options.flavor !== undefined) {
    // Visible, valid text lets a real touch choose the native insertion point.
    // Keep a non-default saved zoom to catch a phone view changing shared data.
    const snapshot = getDocsEmptySnapshot(item.id, LocaleType.EN_US, item.name, options.flavor);
    snapshot.settings = { ...snapshot.settings, zoomRatio: options.zoomRatio ?? 1 };
    const stream = 'Phone journal\rOffline writing keeps the whole saved document.\r';
    const paragraphIds = new Set<string>();
    snapshot.body = {
      ...snapshot.body,
      dataStream: stream + '\n',
      paragraphs: Array.from(stream.matchAll(/\r/g), (match) => ({
        startIndex: match.index!,
        paragraphId: createParagraphId(paragraphIds),
      })),
      sectionBreaks: [{ startIndex: stream.length, sectionId: createSectionId(new Set()) }],
    };
    expect(validateDocumentStructure(snapshot)).toEqual([]);
    new DocumentStore(workspace).save(owner.id, item.id, {
      snapshot,
      revision: 0,
      writeId: randomUUID(),
    });
  }
  for (const [user, role] of [
    [editor, 'editor'],
    [viewer, 'viewer'],
  ] as const)
    if (root) spaces.share(owner.id, root.id, user.id, role);
    else workspace.share(owner.id, item.id, user.id, role);
  const prefix = root ? `/api/spaces/${root.id}/items/${item.id}` : `/api/items/${item.id}`;
  const syncPrefix = root
    ? `/sync-api/spaces/${root.id}/items/${item.id}`
    : `/sync-api/items/${item.id}`;
  const href = root ? `/spaces/${root.id}?item=${item.id}` : `/?item=${item.id}`;
  const prepared = await control.request.post(`${prefix}/collaboration`, {
    headers: { Origin: baseURL },
    data: {},
  });
  expect(prepared.status(), await prepared.text()).toBe(200);
  const unitId = (await prepared.json()).unitId as string;
  const context = await account(actor.id, options.phone);
  await recordNativeSnapshots(context);
  const network = await syncNetwork(context);
  const page = await context.newPage();
  const errors: string[] = [];
  const consoleErrors: { page: string; message: string }[] = [];
  const observeErrors = (target: Page) => {
    target.on('pageerror', (error) => errors.push(error.message));
    target.on('console', (message) => {
      if (message.type() === 'error')
        consoleErrors.push({ page: target.url(), message: message.text() });
    });
  };
  context.on('page', observeErrors);
  observeErrors(page);
  const read = async (id = unitId) => {
    const response = await control.request.get(
      `${syncPrefix}/snapshot?unitId=${encodeURIComponent(id)}`,
    );
    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()) as { revision: number; snapshot: IWorkbookData & IDocumentData };
  };
  const download = async () => {
    await page.goto(href);
    const phoneReadOnly =
      options.flavor === DocumentFlavor.TRADITIONAL &&
      (await page.evaluate(() => matchMedia('(pointer: coarse) and (max-width: 900px)').matches));
    await expect(saveStatus(page)).toHaveText(
      phoneReadOnly
        ? 'View only on this phone. Edit on a larger screen.'
        : options.actor === 'viewer'
          ? 'View only — reload after your access changes.'
          : 'All changes saved.',
      { timeout: 30_000 },
    );
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
    const canvas = await page.locator('.univer-container canvas').first().elementHandle();
    await page.getByRole('button', { name: 'Document actions', exact: true }).click();
    if (root) {
      await page.getByRole('menuitem', { name: 'Offline copies', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Offline copies', exact: true });
      await dialog
        .getByRole('button', { name: `Make ${item.name} available offline on this device` })
        .click();
      await expect(dialog.getByRole('status')).toHaveText(
        `${item.name} is available offline on this device.`,
        { timeout: 120_000 },
      );
      await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    } else {
      await page
        .getByRole('menuitem', { name: 'Available offline on this device', exact: true })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Offline availability', exact: true });
      await expect(dialog.getByRole('status')).toHaveText(
        `${item.name} is available offline on this device.`,
        { timeout: 120_000 },
      );
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    }
    expect(
      await page
        .locator('.univer-container canvas')
        .first()
        .evaluate((node, original) => node === original, canvas!),
    ).toBe(true);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('spinel.offline.account')))
      .toBe(actor.id);
    if (options.actor !== 'viewer') await synced(page);
  };
  return {
    db,
    auth,
    workspace,
    spaces,
    owner,
    editor,
    viewer,
    actor,
    root,
    item,
    unitId,
    context,
    control,
    page,
    network,
    href,
    prefix,
    syncPrefix,
    errors,
    read,
    download,
    cookie,
    async close(creationTransport?: readonly CreationTransportPost[]) {
      try {
        const pages = context.pages();
        const observed = await Promise.allSettled(
          pages.map(async (target) => ({
            ...(await target.evaluate(() => ({
              url: location.href,
              online: navigator.onLine,
              preparedAccount: localStorage.getItem('spinel.offline.account'),
              native: (window as Window & { nativeSyncEvidence?: unknown }).nativeSyncEvidence,
              status: document.querySelector('[aria-label="Save status"]')?.textContent,
              focus: document.activeElement?.outerHTML,
              layout: [
                ...document.querySelectorAll(
                  '.editor-content, [aria-label="Offline copy"], .sheet-editor, .univer-container',
                ),
              ].map((node) => ({
                element: node.tagName,
                className: node.className,
                label: node.getAttribute('aria-label'),
                bounds: node.getBoundingClientRect().toJSON(),
                canvases: node.querySelectorAll('canvas').length,
              })),
            }))),
            stored: await stored(target, actor.id, item.id).catch((error) => ({
              error: String(error),
            })),
          })),
        );
        // The CI artifact glob retains this filename on both success and failure.
        // Attachments alone were absent from the archived browser diagnostics.
        await writeFile(
          info.outputPath('sync-diagnostics.json'),
          JSON.stringify(
            {
              observed,
              errors,
              consoleErrors,
              outgoing: network.outgoing,
              incoming: network.incoming,
              ...(creationTransport ? { creationTransport } : {}),
            },
            null,
            2,
          ),
        );
      } finally {
        try {
          await Promise.all(contexts.map((context) => context.close()));
        } finally {
          db.close();
        }
      }
    },
  };
}

export type OfflineFixture = Awaited<ReturnType<typeof fixture>>;
