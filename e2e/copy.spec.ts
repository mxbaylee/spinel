import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import sharp from 'sharp';
import { docFormulas, formulaBody, parseFormula } from '@spinel/doc-formulas';
import { getDocsEmptySnapshot, LocaleType } from '@univerjs/core';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { DocumentStore } from '../src/server/workspace/documents.ts';
import { SheetStore } from '../src/server/workspace/sheets.ts';
import { SpaceStore } from '../src/server/workspace/spaces.ts';
import { imageSources } from '../src/server/workspace/imageSources.ts';
import { sheetImageFixture } from './sheet-image-fixture.ts';

function fixture(info: TestInfo) {
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  const owner = auth.createUser(`Copy owner ${info.testId}-${info.retry}`);
  const viewer = auth.createUser(`Copy viewer ${info.testId}-${info.retry}`);
  const docs = new DocumentStore(workspace),
    sheets = new SheetStore(workspace);
  const login = async (context: BrowserContext, baseURL: string, id = owner.id) =>
    context.addCookies([
      {
        name: COOKIE_NAME,
        value: auth.createSession(id).token,
        url: baseURL.replace('http:', 'https:'),
        secure: true,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
  const count = () =>
    Number(
      db
        .prepare('SELECT count(*) AS n FROM workspace_items WHERE owner_id IN (?,?)')
        .get(owner.id, viewer.id)!.n,
    );
  return { db, auth, workspace, owner, viewer, docs, sheets, login, count };
}
const saved = (page: Page) =>
  expect(page.getByRole('status', { name: 'Save status' })).toHaveText('All changes saved.', {
    timeout: 30_000,
  });
async function editorDuplicate(page: Page) {
  const trigger = page.getByRole('button', { name: 'Document actions', exact: true });
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Duplicate…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Duplicate file', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Loading destinations…', { exact: true })).toHaveCount(0);
  return { dialog, trigger };
}
async function capture(page: Page, info: TestInfo, state: string) {
  await mkdir('test-results/theme-screenshots', { recursive: true });
  for (const [theme, width] of [
    ['light', 1440],
    ['dark', 1440],
    ['light', 390],
  ] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `test-results/theme-screenshots/spn-065-${state}-${theme}-${width}-${info.project.name}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'light' });
}
async function imagePixels(page: Page) {
  const { data, info } = await sharp(await page.locator('.univer-container').screenshot())
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const counts = [0, 0, 0],
    colors = [
      [255, 153, 0],
      [34, 85, 238],
      [34, 187, 102],
    ];
  for (let offset = 0; offset < data.length; offset += info.channels)
    colors.forEach((color, index) => {
      if (color.every((value, channel) => Math.abs(data[offset + channel] - value) < 12))
        counts[index]++;
    });
  return counts;
}
async function typeCell(page: Page, value: string) {
  const address = page
    .getByRole('region', { name: 'Sheet document', exact: true })
    .getByRole('textbox')
    .nth(2);
  await address.fill('A1');
  await address.press('Enter');
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
}

test('owned Sheet copy waits for saved edits, keeps all images and inherited folder access, and edits independently', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.setTimeout(150_000);
  const f = fixture(info);
  let release = () => {};
  try {
    await f.login(context, baseURL!);
    const folder = f.workspace.create(f.owner.id, {
      kind: 'folder',
      name: 'Budgets',
      parentId: null,
    });
    f.workspace.share(f.owner.id, folder.id, f.viewer.id, 'viewer');
    const imported = await context.request.post('/api/items/import', {
      headers: { Origin: baseURL! },
      data: {
        filename: 'Images.univer.json',
        parentId: folder.id,
        snapshot: await sheetImageFixture(),
      },
    });
    expect(imported.status()).toBe(201);
    const { item: source } = await imported.json();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/');
    await page.getByRole('button', { name: 'More actions for Budgets', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Duplicate…', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.goto(`/?item=${source.id}`);
    await saved(page);
    await expect
      .poll(async () => (await imagePixels(page)).every((value) => value > 1000), {
        timeout: 25_000,
      })
      .toBe(true);
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let writes = 0;
    await page.route('**/universer-api/comb/**/new_changes', async (route) => {
      writes++;
      await held;
      await route.continue();
    });
    await typeCell(page, 'Original 314');
    await expect.poll(() => writes).toBeGreaterThan(0);
    const first = await editorDuplicate(page);
    await expect(
      first.dialog.getByRole('button', { name: 'Duplicate', exact: true }),
    ).toBeDisabled();
    await expect(first.dialog).toContainText('Wait for the original’s changes to be saved');
    await capture(page, info, 'dirty-original');
    await first.dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(first.trigger).toBeFocused();
    release();
    await page.unrouteAll({ behavior: 'wait' });
    await saved(page);
    const original = await (await context.request.get(`/api/items/${source.id}/sheet`)).json();
    const { dialog } = await editorDuplicate(page);
    await expect(dialog.getByLabel('Destination')).toHaveValue(folder.id);
    await expect(dialog).toContainText(
      'People with access to the destination folder may also have access.',
    );
    await capture(page, info, 'owned-sheet');
    const response = page.waitForResponse(
      (reply) =>
        reply.url().endsWith(`/api/items/${source.id}/copy`) && reply.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Duplicate', exact: true }).click();
    const reply = await response;
    expect(reply.status()).toBe(201);
    const { item: copy } = await reply.json();
    expect(copy.id).not.toBe(source.id);
    expect(copy.parentId).toBe(folder.id);
    await expect(page).toHaveURL(new RegExp(`item=${copy.id}`));
    await saved(page);
    await expect
      .poll(async () => (await imagePixels(page)).every((value) => value > 1000), {
        timeout: 25_000,
      })
      .toBe(true);
    const copyData = await (await context.request.get(`/api/items/${copy.id}/sheet`)).json();
    const originalUrls: string[] = [],
      copiedUrls: string[] = [];
    imageSources(original.snapshot, (url) => {
      originalUrls.push(url);
      return url;
    });
    imageSources(copyData.snapshot, (url) => {
      copiedUrls.push(url);
      return url;
    });
    expect(copiedUrls).toHaveLength(originalUrls.length);
    expect(copiedUrls.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < copiedUrls.length; i++) {
      expect(copiedUrls[i]).toContain(`/api/items/${copy.id}/images/`);
      expect(await (await context.request.get(copiedUrls[i])).body()).toEqual(
        await (await context.request.get(originalUrls[i])).body(),
      );
    }
    expect(f.workspace.get(f.viewer.id, copy.id).access).toBe('viewer');
    expect(
      f.db.prepare('SELECT count(*) AS n FROM workspace_grants WHERE item_id=?').get(copy.id)!.n,
    ).toBe(0);
    await typeCell(page, 'Copy changed');
    await saved(page);
    await expect
      .poll(async () =>
        JSON.stringify(
          (await (await context.request.get(`/api/items/${copy.id}/sheet`)).json()).snapshot,
        ),
      )
      .toContain('Copy changed');
    const unchanged = (await (await context.request.get(`/api/items/${source.id}/sheet`)).json())
      .snapshot;
    expect(unchanged.sheets.tab.cellData[0][0].v).toBe('Original 314');
    expect(JSON.stringify(unchanged)).not.toContain('Copy changed');
    f.db.prepare('DELETE FROM doc_images WHERE item_id=?').run(source.id);
    for (const url of copiedUrls) expect((await context.request.get(url)).status()).toBe(200);
    await capture(page, info, 'copied-sheet-images');
  } finally {
    release();
    try {
      await page.goto('/sign-in').catch(() => {});
      if (!page.isClosed()) await page.unrouteAll({ behavior: 'wait' });
    } finally {
      f.db.close();
    }
  }
});

test('a shared Doc viewer receives an owned copy with Formula bindings but no source grants or guest link', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const f = fixture(info);
  try {
    const secret = f.workspace.create(f.owner.id, {
      name: 'PrivateBudget',
      kind: 'sheet',
      parentId: null,
    });
    f.sheets.save(f.owner.id, secret.id, {
      snapshot: {
        id: secret.id,
        name: secret.name,
        appVersion: '1.1.0',
        locale: LocaleType.EN_US,
        sheetOrder: ['summary'],
        styles: {},
        sheets: {
          summary: {
            id: 'summary',
            name: 'Summary',
            rowCount: 100,
            columnCount: 10,
            cellData: { 0: { 0: { v: 987654321 } } },
          },
        },
      },
      revision: 0,
      writeId: crypto.randomUUID(),
    });
    const source = f.workspace.create(f.owner.id, {
      name: 'Shared formula notes',
      kind: 'doc',
      parentId: null,
    });
    const expression = '=PrivateBudget.Summary.A1',
      parsed = parseFormula(expression)[0]!;
    const definition = {
      version: 1 as const,
      expression,
      references: [
        {
          start: parsed.start,
          end: parsed.end,
          itemId: secret.id,
          sheetId: 'summary',
          range: parsed.range,
        },
      ],
    };
    const body = formulaBody('formula', definition);
    body.dataStream += '\r\n';
    const originalDoc = getDocsEmptySnapshot(source.id);
    originalDoc.body = {
      ...originalDoc.body,
      ...body,
      paragraphs: [{ startIndex: body.dataStream.length - 2, paragraphId: 'copy-source' }],
      sectionBreaks: [{ startIndex: body.dataStream.length - 2, sectionId: 'copy-section' }],
    };
    f.docs.save(f.owner.id, source.id, {
      snapshot: originalDoc,
      revision: 0,
      writeId: crypto.randomUUID(),
    });
    f.workspace.share(f.owner.id, source.id, f.viewer.id, 'viewer');
    const link = f.workspace.links.begin(source.id, 'viewer');
    f.workspace.links.finish(source.id, link.epoch, true);
    await f.login(context, baseURL!, f.viewer.id);
    await page.goto(`/?item=${source.id}`);
    await expect(page.getByRole('status', { name: 'Save status' })).toContainText('View only', {
      timeout: 30_000,
    });
    const { dialog } = await editorDuplicate(page);
    await expect(dialog.getByLabel('Destination')).toHaveValue('');
    await expect(dialog.getByRole('button', { name: 'Duplicate', exact: true })).toBeEnabled();
    await capture(page, info, 'viewer-doc');
    const response = page.waitForResponse((reply) =>
      reply.url().endsWith(`/api/items/${source.id}/copy`),
    );
    await dialog.getByRole('button', { name: 'Duplicate', exact: true }).click();
    const reply = await response;
    expect(reply.status()).toBe(201);
    const { item: copy } = await reply.json();
    await expect(page).toHaveURL(new RegExp(`item=${copy.id}`));
    await saved(page);
    expect(f.workspace.fileOwner(copy.id)).toBe(f.viewer.id);
    expect(copy.parentId).toBeNull();
    expect(copy.tags).toEqual([]);
    expect(
      f.db.prepare('SELECT count(*) AS n FROM workspace_grants WHERE item_id=?').get(copy.id)!.n,
    ).toBe(0);
    expect(
      f.db.prepare('SELECT count(*) AS n FROM workspace_links WHERE item_id=?').get(copy.id)!.n,
    ).toBe(0);
    expect(() => f.workspace.get(f.owner.id, copy.id)).toThrow();
    const snapshot = (await (await context.request.get(`/api/items/${copy.id}/doc`)).json())
      .snapshot;
    expect(docFormulas(snapshot.body).map((entry) => entry.definition)).toEqual([definition]);
    expect(JSON.stringify(snapshot)).not.toContain('987654321');
    expect((await context.request.get(`/api/items/${secret.id}`)).status()).toBe(404);
    const evaluated = await context.request.post(`/api/items/${copy.id}/formulas/evaluate`, {
      headers: { Origin: baseURL! },
      data: { definition },
    });
    expect(await evaluated.json()).toEqual({ ok: false, reason: 'private-source' });
    f.workspace.share(f.owner.id, source.id, f.viewer.id, null);
    await page.locator('.univer-container').click({ position: { x: 130, y: 200 } });
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Independent copy text');
    await saved(page);
    await expect
      .poll(async () =>
        JSON.stringify(
          (await (await context.request.get(`/api/items/${copy.id}/doc`)).json()).snapshot,
        ),
      )
      .toContain('Independent copy text');
    expect(f.docs.load(f.owner.id, source.id).snapshot!.body!.dataStream).not.toContain(
      'Independent copy text',
    );
  } finally {
    try {
      await page.goto('/sign-in').catch(() => {});
    } finally {
      f.db.close();
    }
  }
});

test('a committed copy with a lost response remains uncertain and never silently repeats the POST', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  const f = fixture(info);
  let writes = 0;
  let copiedId = '';
  try {
    await f.login(context, baseURL!);
    const source = f.workspace.create(f.owner.id, {
      name: 'Response loss notes',
      kind: 'doc',
      parentId: null,
    });
    f.docs.save(f.owner.id, source.id, {
      snapshot: { id: source.id, body: { dataStream: 'Confirmed original\r\n' } },
      revision: 0,
      writeId: crypto.randomUUID(),
    });
    const before = f.count();
    await page.route(`**/api/items/${source.id}/copy`, async (route) => {
      writes++;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      copiedId = (await response.json()).item.id;
      await route.abort('failed');
    });
    await page.goto('/');
    const trigger = page.getByRole('button', {
      name: `More actions for ${source.name}`,
      exact: true,
    });
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Duplicate…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Duplicate file', exact: true });
    await expect(dialog.getByRole('button', { name: 'Duplicate', exact: true })).toBeEnabled();
    await dialog.locator('form').evaluate((form) => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await expect(dialog.getByRole('alert')).toContainText(
      'Could not confirm whether the copy was created.',
    );
    expect(writes).toBe(1);
    expect(f.count()).toBe(before + 1);
    await expect(dialog.getByRole('button', { name: 'Duplicate', exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel('Name')).toBeDisabled();
    await capture(page, info, 'uncertain-created');
    expect(writes).toBe(1);
    expect(f.count()).toBe(before + 1);
    await dialog.getByRole('button', { name: 'Check destination', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Response loss notes (copy) Doc', exact: true }),
    ).toBeVisible();
    expect(f.workspace.get(f.owner.id, copiedId).name).toBe('Response loss notes (copy)');
  } finally {
    try {
      await page.goto('/sign-in').catch(() => {});
      if (!page.isClosed()) await page.unrouteAll({ behavior: 'wait' });
    } finally {
      f.db.close();
    }
  }
});

test('a readable Space page duplicates as a standalone owned file using its exact scoped endpoint', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const f = fixture(info);
  try {
    const spaces = new SpaceStore(f.workspace);
    const root = spaces.createRoot(f.owner.id, { name: 'Original Space', parentId: null }).space;
    const child = spaces.createChild(f.owner.id, root.id, {
      name: 'Space notes',
      kind: 'doc',
      parentId: root.id,
    }).item;
    const other = spaces.createRoot(f.owner.id, { name: 'Other Space', parentId: null }).space;
    await f.login(context, baseURL!);
    await page.goto(`/spaces/${root.id}?item=${child.id}`);
    await saved(page);
    await page.locator('.univer-container').click({ position: { x: 130, y: 200 } });
    await page.keyboard.type('Exact Space child');
    await saved(page);
    await expect
      .poll(async () =>
        JSON.stringify(
          (await (await context.request.get(`/api/spaces/${root.id}/items/${child.id}/doc`)).json())
            .snapshot,
        ),
      )
      .toContain('Exact Space child');
    const headers = { Origin: baseURL! };
    expect(
      (await context.request.post(`/api/items/${child.id}/copy`, { headers, data: {} })).status(),
    ).toBe(404);
    expect(
      (
        await context.request.post(`/api/spaces/${other.id}/items/${child.id}/copy`, {
          headers,
          data: {},
        })
      ).status(),
    ).toBe(404);
    const { dialog, trigger } = await editorDuplicate(page);
    await expect(dialog.getByLabel('Destination')).toHaveValue('');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(trigger).toBeFocused();
    await editorDuplicate(page);
    await capture(page, info, 'space-page');
    const response = page.waitForResponse((reply) =>
      reply.url().endsWith(`/api/spaces/${root.id}/items/${child.id}/copy`),
    );
    await dialog.getByRole('button', { name: 'Duplicate', exact: true }).click();
    const reply = await response;
    expect(reply.status()).toBe(201);
    const { item: copy } = await reply.json();
    await expect(page).toHaveURL(new RegExp(`item=${copy.id}`));
    await saved(page);
    expect(copy.kind).toBe('doc');
    expect(copy.parentId).toBeNull();
    const snapshot = (await (await context.request.get(`/api/items/${copy.id}/doc`)).json())
      .snapshot;
    expect(snapshot.body.dataStream).toContain('Exact Space child');
    expect(spaces.list(f.owner.id, root.id).items.some((item) => item.id === copy.id)).toBe(false);
    expect(spaces.list(f.owner.id, root.id).items.some((item) => item.id === child.id)).toBe(true);
  } finally {
    try {
      await page.goto('/sign-in').catch(() => {});
    } finally {
      f.db.close();
    }
  }
});
