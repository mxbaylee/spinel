import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Dialog, Locator, Page, TestInfo } from '@playwright/test';
import { startApp } from './app-process.ts';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { SpaceStore } from '../src/server/workspace/spaces.ts';
import { SpaceRecoveryStore } from '../src/server/workspace/space-recovery.ts';
import type { SpaceNode, SpaceRoot, SpaceTreeData } from '../src/shared/spaces.ts';

// The server SDK stays in startApp's child process. The collector imports only
// application storage/types; all native editing evidence comes from the browser.
async function fixture(browser: Browser, info: TestInfo) {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-spaces-e2e-'));
  const databasePath = join(directory, 'app.sqlite');
  const origin = `http://localhost:${info.project.name === 'development' ? 3196 : 3197}`;
  const app = await startApp({
    databasePath,
    origin,
    development: info.project.name === 'development',
    spaceReview: true,
  });
  const db = openDatabase(databasePath),
    auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth),
    spaces = new SpaceStore(workspace);
  const owner = auth.createUser('Space owner'),
    editor = auth.createUser('Space editor'),
    viewer = auth.createUser('Space viewer');
  const folder = workspace.create(owner.id, {
    name: 'Project files',
    kind: 'folder',
    parentId: null,
  });
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  const session = (id: string) => ({
    name: COOKIE_NAME,
    value: auth.createSession(id).token,
    url: origin.replace('http:', 'https:'),
    secure: true,
    httpOnly: true,
    sameSite: 'Strict' as const,
  });
  const open = async (id = owner.id, phone = false) => {
    const context = await browser.newContext({
      baseURL: origin,
      viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1100 },
      hasTouch: phone,
      isMobile: phone,
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    contexts.push(context);
    await context.addCookies([session(id)]);
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    return { context, page };
  };
  const { context, page } = await open();
  const tree = async (spaceId: string) => {
    const response = await context.request.get(`/api/spaces/${spaceId}`);
    expect(response.ok()).toBe(true);
    return (await response.json()) as SpaceTreeData;
  };
  const close = async () => {
    // A timed-out browser action must not leave this fixture's server bound for
    // the next attempt. Start its shutdown before awaiting browser cleanup.
    const results = await Promise.allSettled([
      app.close(),
      ...contexts.toReversed().map((context) => context.close()),
    ]);
    try {
      db.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        'Could not close the Space fixture.',
      );
  };
  return {
    db,
    auth,
    workspace,
    spaces,
    owner,
    editor,
    viewer,
    folder,
    origin,
    context,
    page,
    tree,
    open,
    close,
    errors,
  };
}

const href = (spaceId: string, itemId?: string) =>
  `/review/spaces/${spaceId}${itemId ? '?item=' + itemId : ''}`;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const saved = (page: Page) =>
  expect(page.getByRole('status', { name: 'Save status', exact: true })).toHaveText(
    'All changes saved.',
    { timeout: 30_000 },
  );
const pageLink = (page: Page, spaceId: string, itemId: string) =>
  page.locator(`a.space-page-link[href="${href(spaceId, itemId)}"]`).filter({ visible: true });

async function pages(page: Page) {
  const navigation = page.getByRole('navigation', { name: 'Pages', exact: true });
  if (!(await navigation.isVisible()))
    await page.getByRole('button', { name: 'Open Space contents', exact: true }).click();
  await expect(navigation).toBeVisible();
  return navigation;
}

async function choice(page: Page, dialog: Locator, label: string, option: string) {
  await dialog.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: new RegExp('^' + escape(option) + '(?:$| ·)') }).click();
}

async function newSpace(page: Page, folderName = 'Project files') {
  await page.goto('/review/spaces');
  await expect(page.getByRole('heading', { name: 'Your first Space', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New Space', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Space', exact: true });
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Launch notebook');
  await choice(page, dialog, 'Folder', folderName);
  const response = page.waitForResponse(
    (response) => response.url().endsWith('/api/spaces') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(201);
  const space = (await result.json()).space as SpaceRoot;
  await expect(page).toHaveURL(new RegExp(escape(href(space.id)) + '$'));
  await expect(
    page.getByRole('heading', { name: 'This Space is empty', exact: true }),
  ).toBeVisible();
  return space;
}

async function add(
  page: Page,
  spaceId: string,
  kind: 'Doc' | 'Sheet' | 'Folder',
  name: string,
  parent?: string,
) {
  const navigation = await pages(page);
  await navigation.getByRole('button', { name: 'Add page', exact: true }).click();
  await page.getByRole('menuitem', { name: kind, exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: `New ${kind === 'Folder' ? 'folder' : kind}`,
    exact: true,
  });
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  if (parent) await choice(page, dialog, 'Parent page or folder', parent);
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/spaces/${spaceId}/items`) &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(201);
  const item = (await result.json()).item as SpaceNode;
  await expect(dialog).not.toBeVisible();
  if (kind !== 'Folder') {
    await expect(page).toHaveURL(new RegExp(escape(href(spaceId, item.id)) + '$'));
    await saved(page);
  }
  return item;
}

async function action(
  page: Page,
  name: string,
  actionName: 'Rename' | 'Move or reorder' | 'Trash',
) {
  const navigation = await pages(page);
  await navigation.getByRole('button', { name: `More actions for ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: actionName, exact: true }).click();
  return page.getByRole('dialog', { name: `${actionName} ${name}`, exact: true });
}

async function change(
  page: Page,
  spaceId: string,
  item: SpaceNode,
  mode: 'Rename' | 'Move or reorder',
  value: { name?: string; parent?: string; position?: number },
) {
  const dialog = await action(page, item.name, mode);
  if (value.name) await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(value.name);
  if (value.parent) await choice(page, dialog, 'Parent page or folder', value.parent);
  if (value.position)
    await dialog
      .getByRole('spinbutton', { name: 'Position', exact: true })
      .fill(String(value.position));
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/spaces/${spaceId}/items/${item.id}`) &&
      response.request().method() === 'PATCH',
  );
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  await expect(dialog).not.toBeVisible();
  return (await result.json()).item as SpaceNode;
}

const focusDoc = (page: Page) =>
  page
    .getByRole('region', { name: 'Doc document', exact: true })
    .locator('.univer-container')
    .click({ position: { x: 130, y: 200 } });
async function copySelection(page: Page) {
  await page.bringToFront();
  const sentinel = 'not-copied-' + crypto.randomUUID();
  await page.evaluate((text) => navigator.clipboard.writeText(text), sentinel);
  await page.keyboard.press('Control+c');
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5000 })
    .not.toBe(sentinel);
  return (await page.evaluate(() => navigator.clipboard.readText())).trim();
}
async function copyDoc(page: Page) {
  await focusDoc(page);
  await page.keyboard.press('Control+a');
  return copySelection(page);
}
const cellAddress = (page: Page) =>
  page
    .getByRole('region', { name: 'Sheet document', exact: true })
    .locator('[data-u-comp="defined-name"]')
    .getByRole('textbox');
async function cell(page: Page, address: string) {
  const input = cellAddress(page);
  await expect(input).toBeEnabled();
  await input.fill(address);
  await input.press('Enter');
}
async function commitRetainedCell(page: Page, address: string) {
  await expect(page.getByRole('status', { name: 'Save status', exact: true })).toHaveText(
    'Editing cell — changes not saved yet.',
  );
  await expect(cellAddress(page)).toHaveValue(address);
  await expect(cellAddress(page)).toBeDisabled();
  // Cancelling a departure preserves the active native edit. Use the visible
  // formula-bar checkmark to commit it before requesting another cell address.
  // The public sheets-ui DOM orders these controls as cancel, confirm, formula.
  await page
    .getByRole('region', { name: 'Sheet document', exact: true })
    .locator('[data-u-comp="formula-bar-actions"] > span')
    .nth(1)
    .click();
  await saved(page);
}
async function writeCell(page: Page, address: string, text: string, commit = true) {
  await cell(page, address);
  await page.keyboard.type(text);
  if (commit) await page.keyboard.press('Enter');
}
async function copyCell(page: Page, address: string) {
  await cell(page, address);
  return copySelection(page);
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  await mkdir('test-results/theme-screenshots', { recursive: true });
  await page.screenshot({
    path: `test-results/theme-screenshots/spn-091-${name}-${info.project.name}.png`,
    fullPage: true,
  });
}
async function cancelDeparture(page: Page, leave: () => Promise<unknown>) {
  const messages: string[] = [];
  const dismiss = async (dialog: Dialog) => {
    messages.push(dialog.message());
    await dialog.dismiss();
  };
  page.on('dialog', dismiss);
  try {
    await leave();
    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toContain('not been saved');
  } finally {
    page.off('dialog', dismiss);
  }
}

function seed(f: Awaited<ReturnType<typeof fixture>>, name = 'Review notebook') {
  const space = f.spaces.createRoot(f.owner.id, { name, parentId: f.folder.id }).space as SpaceRoot;
  const child = (name: string, kind: 'doc' | 'sheet' | 'folder', parentId = space.id) =>
    f.spaces.createChild(f.owner.id, space.id, { name, kind, parentId }).item as SpaceNode;
  return { space, child };
}

async function deleted(page: Page, name: string) {
  const region = page.getByRole('region', { name: 'Deleted Space contents', exact: true });
  const row = region.getByRole('listitem', { name, exact: true });
  await expect(row).toBeVisible();
  return row;
}

async function deletePreview(page: Page, name: string) {
  const row = await deleted(page, name);
  await row.getByRole('button', { name: `Actions for deleted ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete permanently', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Delete ${name} permanently?`, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('an owner creates and edits a persistent Space tree with native Docs, Sheets and stable navigation', async ({
  browser,
}, info) => {
  test.setTimeout(180_000);
  const f = await fixture(browser, info);
  const { page } = f;
  try {
    const space = await newSpace(page);
    expect(space.parentId).toBe(f.folder.id);
    const folder = await add(page, space.id, 'Folder', 'Research');
    const doc = await add(page, space.id, 'Doc', 'Project notes');
    await focusDoc(page);
    await page.keyboard.type('Native notes in a Space.');
    await saved(page);
    expect(await copyDoc(page)).toBe('Native notes in a Space.');
    await page.getByRole('radio', { name: 'Light', exact: true }).click();
    // The earlier save proof preceded clipboard/theme interaction. Establish
    // the current native state before taking evidence and creating another page.
    await saved(page);
    await screenshot(page, info, 'doc-light');
    const sheet = await add(page, space.id, 'Sheet', 'Plan');
    await writeCell(page, 'A1', '41');
    await writeCell(page, 'A2', '1');
    await writeCell(page, 'A3', '=SUM(A1:A2)');
    await saved(page);
    expect(await copyCell(page, 'A3')).toBe('42');
    await page.getByRole('radio', { name: 'Dark', exact: true }).click();
    await saved(page);
    await screenshot(page, info, 'sheet-dark');
    await page.reload();
    await saved(page);
    expect(await copyCell(page, 'A1')).toBe('41');
    expect(await copyCell(page, 'A3')).toBe('42');
    const renamed = await change(page, space.id, doc, 'Rename', { name: 'Decisions' });
    await change(page, space.id, renamed, 'Move or reorder', { parent: 'Research', position: 1 });
    const movedSheet = await change(page, space.id, sheet, 'Move or reorder', {
      parent: 'Research / Decisions',
      position: 1,
    });
    const duplicateA = await add(page, space.id, 'Doc', 'Repeated title');
    const duplicateB = await add(page, space.id, 'Doc', 'Repeated title');
    expect(duplicateA.id).not.toBe(duplicateB.id);
    await expect(pageLink(page, space.id, duplicateA.id)).toBeVisible();
    await expect(pageLink(page, space.id, duplicateB.id)).toBeVisible();
    // Select the exact duplicate by stable link, then operate within its own row.
    const duplicateRow = pageLink(page, space.id, duplicateB.id).locator('..');
    await duplicateRow
      .getByRole('button', { name: 'More actions for Repeated title', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    const rename = page.getByRole('dialog', { name: 'Rename Repeated title', exact: true });
    await rename.getByRole('textbox', { name: 'Name', exact: true }).fill('Appendix');
    await rename.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(rename).not.toBeVisible();
    const appendix = (await f.tree(space.id)).items.find((item) => item.id === duplicateB.id)!;
    await change(page, space.id, appendix, 'Move or reorder', {
      parent: 'Research / Decisions / Plan',
      position: 1,
    });
    await change(page, space.id, duplicateA, 'Move or reorder', {
      parent: space.name,
      position: 1,
    });
    const ordered = await f.tree(space.id);
    expect(ordered.items.find((item) => item.id === folder.id)?.position).toBe(1);
    expect(ordered.items.find((item) => item.id === duplicateA.id)?.position).toBe(0);
    expect(ordered.items.find((item) => item.id === renamed.id)?.parentId).toBe(folder.id);
    expect(ordered.items.find((item) => item.id === movedSheet.id)?.parentId).toBe(renamed.id);
    expect(ordered.items.find((item) => item.id === appendix.id)?.parentId).toBe(sheet.id);
    await pageLink(page, space.id, renamed.id).click();
    await saved(page);
    expect(await copyDoc(page)).toBe('Native notes in a Space.');
    await pageLink(page, space.id, sheet.id).click();
    await saved(page);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(escape(href(space.id, renamed.id)) + '$'));
    await saved(page);
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(escape(href(space.id, sheet.id)) + '$'));
    await saved(page);
    await page.goto(href(space.id));
    await expect(page).toHaveURL(new RegExp(escape(href(space.id, sheet.id)) + '$'));
    await saved(page);
    expect(await copyCell(page, 'A3')).toBe('42');
    await page.goto(href(space.id, renamed.id));
    await saved(page);
    expect(await copyDoc(page)).toBe('Native notes in a Space.');
    for (const name of ['Print', 'Export', 'Insert formula'])
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Version names', exact: true })).toHaveCount(0);
    expect((await f.context.request.get(`/api/items/${sheet.id}/sheet`)).status()).toBe(404);
    expect((await f.context.request.get(`/api/items/${doc.id}/history`)).status()).toBe(404);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('pending edits survive cancelled navigation and whole-subtree Trash supports restore and owner-confirmed deletion', async ({
  browser,
}, info) => {
  test.setTimeout(180_000);
  const f = await fixture(browser, info);
  const { page } = f;
  try {
    const { space, child } = seed(f);
    const group = child('Archive group', 'folder');
    const doc = child('Retained notes', 'doc', group.id);
    const sheet = child('Retained numbers', 'sheet', doc.id);
    await page.goto(href(space.id, doc.id));
    await saved(page);
    await focusDoc(page);
    await page.keyboard.type('Keep this native document through recovery.');
    await saved(page);
    await page.getByRole('button', { name: `Expand ${doc.name}`, exact: true }).click();
    await pageLink(page, space.id, sheet.id).click();
    await saved(page);
    await writeCell(page, 'A1', '73');
    await saved(page);
    await writeCell(page, 'A2', 'pending-pointer-edit', false);
    await expect(page.getByRole('status', { name: 'Save status', exact: true })).not.toHaveText(
      'All changes saved.',
    );
    // A real pointer press blurs the cell editor before click. The guard must
    // still see the pending edit and cancellation must retain this native page.
    await cancelDeparture(page, () => pageLink(page, space.id, doc.id).click());
    await expect(page).toHaveURL(new RegExp(escape(href(space.id, sheet.id)) + '$'));
    await commitRetainedCell(page, 'A2');
    expect(await copyCell(page, 'A2')).toBe('pending-pointer-edit');
    await saved(page);
    await writeCell(page, 'A3', 'pending-history-edit', false);
    await cancelDeparture(page, () => page.goBack());
    await expect(page).toHaveURL(new RegExp(escape(href(space.id, sheet.id)) + '$'));
    await commitRetainedCell(page, 'A3');
    expect(await copyCell(page, 'A3')).toBe('pending-history-edit');
    await saved(page);

    const cancelledTrash = await action(page, group.name, 'Trash');
    await expect(cancelledTrash).toContainText('2 descendants');
    await cancelledTrash.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await f.tree(space.id)).items.map((item) => item.id)).toEqual([
      group.id,
      doc.id,
      sheet.id,
    ]);
    const trash = await action(page, group.name, 'Trash');
    await trash.getByRole('button', { name: 'Move to Trash', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(escape(href(space.id)) + '\\?trash=1$'));
    let row = await deleted(page, group.name);
    await expect(row).toContainText('2 descendants');
    expect((await f.tree(space.id)).items).toEqual([]);
    await page.reload();
    row = await deleted(page, group.name);
    const preview = await deletePreview(page, group.name);
    const affected = preview.getByRole('list', { name: 'Items to delete', exact: true });
    await expect(affected.getByRole('listitem')).toHaveCount(3);
    for (const name of [group.name, doc.name, sheet.name])
      await expect(affected).toContainText(name);
    await preview.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(row).toBeVisible();

    // This view has no live native socket. Taking it offline proves the actual
    // recovery controls refuse new writes without inventing local durability.
    await f.context.setOffline(true);
    await expect(
      row.getByRole('button', { name: `Restore ${group.name}`, exact: true }),
    ).toBeDisabled();
    await row
      .getByRole('button', { name: `Actions for deleted ${group.name}`, exact: true })
      .click();
    await expect(
      page.getByRole('menuitem', { name: 'Delete permanently', exact: true }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
    await f.context.setOffline(false);
    await expect(
      row.getByRole('button', { name: `Restore ${group.name}`, exact: true }),
    ).toBeEnabled();
    await screenshot(page, info, 'trash-light');
    await row.getByRole('button', { name: `Restore ${group.name}`, exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Space Trash is empty', exact: true }),
    ).toBeVisible();
    const restored = (await f.tree(space.id)).items;
    expect(restored.map((item) => [item.id, item.parentId, item.position])).toEqual([
      [group.id, space.id, 0],
      [doc.id, group.id, 0],
      [sheet.id, doc.id, 0],
    ]);
    await page.goto(href(space.id, doc.id));
    await saved(page);
    expect(await copyDoc(page)).toBe('Keep this native document through recovery.');
    await page.goto(href(space.id, sheet.id));
    await saved(page);
    expect(await copyCell(page, 'A1')).toBe('73');
    expect(await copyCell(page, 'A2')).toBe('pending-pointer-edit');
    expect(await copyCell(page, 'A3')).toBe('pending-history-edit');
    const secondTrash = await action(page, group.name, 'Trash');
    await secondTrash.getByRole('button', { name: 'Move to Trash', exact: true }).click();
    const finalPreview = await deletePreview(page, group.name);
    await finalPreview.getByRole('button', { name: 'Delete permanently', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Space Trash is empty', exact: true }),
    ).toBeVisible();
    for (const id of [group.id, doc.id, sheet.id]) {
      expect(f.db.prepare('SELECT id FROM workspace_items WHERE id=?').get(id)).toBeUndefined();
      expect((await f.context.request.get(`/api/spaces/${space.id}/items/${id}`)).status()).toBe(
        404,
      );
    }

    // Independent tombstones must not leak a no-longer-readable parent name.
    const hiddenParent = child('Unavailable private location', 'folder');
    const orphan = child('Separate recovery root', 'doc', hiddenParent.id);
    const recovery = new SpaceRecoveryStore(f.workspace);
    recovery.trash(f.owner.id, space.id, orphan.id);
    recovery.trash(f.owner.id, space.id, hiddenParent.id);
    await page.reload();
    const orphanRow = await deleted(page, orphan.name);
    await expect(orphanRow).toContainText('Original location unavailable.');
    await expect(orphanRow).not.toContainText(hiddenParent.name);
    await orphanRow.getByRole('button', { name: `Restore ${orphan.name}`, exact: true }).click();
    await expect(
      page.getByText(
        `${orphan.name} restored to the Space root because its original location is unavailable.`,
        { exact: true },
      ),
    ).toBeVisible();
    expect((await f.tree(space.id)).items.find((item) => item.id === orphan.id)?.parentId).toBe(
      space.id,
    );
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('Space viewer and editor controls follow live role changes, revocation and owner disablement', async ({
  browser,
}, info) => {
  test.setTimeout(150_000);
  const f = await fixture(browser, info);
  try {
    const { space, child } = seed(f, 'Shared review notebook');
    const doc = child('Shared native notes', 'doc');
    const deletedDoc = child('Recoverable notes', 'doc');
    new SpaceRecoveryStore(f.workspace).trash(f.owner.id, space.id, deletedDoc.id);
    f.spaces.share(f.owner.id, space.id, f.editor.id, 'editor');
    f.spaces.share(f.owner.id, space.id, f.viewer.id, 'viewer');

    const editor = await f.open(f.editor.id);
    await editor.page.goto(href(space.id, doc.id));
    await saved(editor.page);
    await focusDoc(editor.page);
    await editor.page.keyboard.type('A scoped editor can save these notes.');
    await saved(editor.page);
    await expect(editor.page.getByRole('button', { name: 'Add page', exact: true })).toBeVisible();
    await expect(
      editor.page.getByRole('button', { name: `More actions for ${doc.name}`, exact: true }),
    ).toBeVisible();
    await editor.page.getByRole('link', { name: 'Space Trash', exact: true }).click();
    const editorTrash = await deleted(editor.page, deletedDoc.name);
    await expect(
      editorTrash.getByRole('button', { name: `Restore ${deletedDoc.name}`, exact: true }),
    ).toBeEnabled();
    await expect(
      editorTrash.getByRole('button', {
        name: `Actions for deleted ${deletedDoc.name}`,
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      (
        await editor.context.request.get(
          `/api/spaces/${space.id}/trash/${deletedDoc.id}/delete-preview`,
        )
      ).status(),
    ).toBe(403);
    // Only one native editor is resident at a time; this is a role proof, not a
    // resource-heavy collaboration stress test.
    await editor.page.goto('about:blank');

    const viewer = await f.open(f.viewer.id);
    await viewer.page.goto(href(space.id, doc.id));
    await expect(viewer.page.getByRole('status', { name: 'Save status', exact: true })).toHaveText(
      'View only — reload after your access changes.',
      { timeout: 30_000 },
    );
    expect(await copyDoc(viewer.page)).toBe('A scoped editor can save these notes.');
    await expect(viewer.page.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
    await expect(viewer.page.getByRole('button', { name: 'Add page', exact: true })).toHaveCount(0);
    await expect(
      viewer.page.getByRole('button', { name: `More actions for ${doc.name}`, exact: true }),
    ).toHaveCount(0);
    await expect(viewer.page.getByRole('link', { name: 'Space Trash', exact: true })).toHaveCount(
      0,
    );
    expect(
      (
        await viewer.context.request.post(`/api/spaces/${space.id}/items`, {
          data: { name: 'Denied', kind: 'doc', parentId: space.id },
          headers: { Origin: f.origin },
        })
      ).status(),
    ).toBe(403);
    expect((await viewer.context.request.get(`/api/spaces/${space.id}/trash`)).status()).toBe(403);
    await screenshot(viewer.page, info, 'viewer');
    await viewer.page.goto('about:blank');

    await editor.page.goto(href(space.id, doc.id));
    await saved(editor.page);
    f.spaces.share(f.owner.id, space.id, f.editor.id, 'viewer');
    await expect(editor.page.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled({
      timeout: 10_000,
    });
    await expect(editor.page.getByRole('button', { name: 'Add page', exact: true })).toHaveCount(
      0,
      { timeout: 10_000 },
    );
    await expect(
      editor.page.getByRole('button', { name: `More actions for ${doc.name}`, exact: true }),
    ).toHaveCount(0);
    f.spaces.share(f.owner.id, space.id, f.editor.id, null);
    await expect(
      editor.page.getByRole('heading', { name: 'Space unavailable', exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      editor.page.getByRole('region', { name: 'Doc document', exact: true }),
    ).toHaveCount(0);
    await expect(editor.page.getByRole('region', { name: 'Space pages', exact: true })).toHaveCount(
      0,
    );
    expect(
      (await editor.context.request.get(`/api/spaces/${space.id}/items/${doc.id}`)).status(),
    ).toBe(404);
    f.spaces.share(f.owner.id, space.id, f.editor.id, 'editor');
    await editor.page.reload();
    await saved(editor.page);
    f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
    await expect(
      editor.page.getByRole('heading', { name: 'Space unavailable', exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      editor.page.getByRole('region', { name: 'Doc document', exact: true }),
    ).toHaveCount(0);
    expect((await editor.context.request.get(`/api/spaces/${space.id}`)).status()).toBe(404);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('Space navigation works on a touch phone and at 613px with a mouse, with real editor and Trash theme evidence', async ({
  browser,
}, info) => {
  test.setTimeout(150_000);
  const f = await fixture(browser, info);
  try {
    const { space, child } = seed(f, 'Pocket notebook');
    const parent = child('Planning notes', 'doc');
    const nested = child('Nested notes', 'doc', parent.id);
    const removed = child('Deleted draft', 'doc');
    new SpaceRecoveryStore(f.workspace).trash(f.owner.id, space.id, removed.id);
    const phone = await f.open(f.owner.id, true);
    await phone.page.goto(href(space.id, parent.id));
    await saved(phone.page);
    await focusDoc(phone.page);
    await phone.page.keyboard.type('A real Space document on a phone.');
    await saved(phone.page);
    await phone.page.getByRole('radio', { name: 'Light', exact: true }).tap();
    await screenshot(phone.page, info, 'phone-doc-light');
    const phonePages = phone.page.getByRole('button', { name: 'Open Space contents', exact: true });
    await phonePages.tap();
    const drawer = phone.page.getByRole('dialog', { name: 'Space contents', exact: true });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: `Expand ${parent.name}`, exact: true }).tap();
    await expect(phone.page).toHaveURL(new RegExp(escape(href(space.id, parent.id)) + '$'));
    await screenshot(phone.page, info, 'phone-pages-light');
    await pageLink(phone.page, space.id, nested.id).tap();
    await expect(drawer).not.toBeVisible();
    await saved(phone.page);
    await phone.page.getByRole('radio', { name: 'Dark', exact: true }).tap();
    await screenshot(phone.page, info, 'phone-doc-dark');
    await phonePages.tap();
    await expect(drawer).toBeVisible();
    await phone.page.keyboard.press('Escape');
    await expect(drawer).not.toBeVisible();
    await expect(phonePages).toBeFocused();
    await phonePages.tap();
    await drawer.getByRole('link', { name: 'Space Trash', exact: true }).tap();
    await deleted(phone.page, removed.name);
    await screenshot(phone.page, info, 'phone-trash-dark');
    await phone.page.goto('about:blank');

    await f.page.setViewportSize({ width: 613, height: 900 });
    expect(await f.page.evaluate(() => matchMedia('(pointer: fine)').matches)).toBe(true);
    await f.page.goto(href(space.id, parent.id));
    await saved(f.page);
    expect(await copyDoc(f.page)).toBe('A real Space document on a phone.');
    await expect(
      f.page.getByRole('complementary', { name: 'Space contents', exact: true }),
    ).not.toBeVisible();
    const mousePages = f.page.getByRole('button', { name: 'Open Space contents', exact: true });
    await mousePages.click();
    const mouseDrawer = f.page.getByRole('dialog', { name: 'Space contents', exact: true });
    await expect(mouseDrawer).toBeVisible();
    await mouseDrawer.getByRole('button', { name: `Expand ${parent.name}`, exact: true }).click();
    await pageLink(f.page, space.id, nested.id).click();
    await expect(mouseDrawer).not.toBeVisible();
    await saved(f.page);
    await screenshot(f.page, info, '613px-mouse-doc');
    await mousePages.click();
    await f.page.keyboard.press('Escape');
    await expect(mousePages).toBeFocused();
    await expect(f.page.getByRole('button', { name: 'My files', exact: true })).toBeVisible();
    await f.page.getByRole('button', { name: 'My files', exact: true }).click();
    await expect(f.page).not.toHaveURL(/\/review\/spaces/);
    await expect(f.page.getByText(space.name, { exact: true })).toHaveCount(0);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('an unsigned Space deep link returns to the exact child when an account session resumes', async ({
  browser,
}, info) => {
  test.setTimeout(90_000);
  const f = await fixture(browser, info);
  try {
    const { space, child } = seed(f, 'Sign-in destination');
    child('First page is not the destination', 'doc');
    const target = child('Requested stable child', 'doc');
    const ownerCookies = await f.context.cookies();
    await f.context.clearCookies();
    await f.page.goto(href(space.id, target.id));
    await expect(f.page).toHaveURL(`${f.origin}/sign-in?space=${space.id}&item=${target.id}`);
    await expect(
      f.page.getByRole('button', { name: 'Sign in with a passkey', exact: true }),
    ).toBeVisible();
    // Reuse a real current account session to isolate the return-route contract;
    // passkey registration/authentication is covered by the existing auth suite.
    await f.context.addCookies(ownerCookies);
    await f.page.reload();
    await expect(f.page).toHaveURL(f.origin + href(space.id, target.id));
    await saved(f.page);
    await expect(f.page.getByRole('heading', { name: target.name, exact: true })).toBeVisible();
    await expect(pageLink(f.page, space.id, target.id)).toHaveAttribute('aria-current', 'page');
    await f.page.goto('about:blank');
    await f.context.clearCookies();
    await f.page.goto('/review/spaces');
    await expect(f.page).toHaveURL(`${f.origin}/sign-in?space=index`);
    await f.context.addCookies(ownerCookies);
    await f.page.reload();
    await expect(f.page).toHaveURL(f.origin + '/review/spaces');
    await expect(f.page.getByRole('heading', { name: 'Spaces', exact: true })).toBeVisible();
    await expect(f.page.getByRole('list', { name: 'Your Spaces', exact: true })).toBeVisible();
    const operator = f.auth.createUser('Review operator', true);
    await f.context.clearCookies();
    await f.context.addCookies([
      {
        name: COOKIE_NAME,
        value: f.auth.createSession(operator.id).token,
        url: f.origin.replace('http:', 'https:'),
        secure: true,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    await f.page.goto(`/sign-in?space=${space.id}&item=${target.id}`);
    await expect(f.page).toHaveURL(f.origin + '/admin');
    expect((await f.context.request.get(href(space.id, target.id))).status()).toBe(404);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('revocation clears private Space navigation while retaining unsaved native text for copying and rejecting its write', async ({
  browser,
}, info) => {
  test.setTimeout(120_000);
  const f = await fixture(browser, info);
  let release = () => {};
  try {
    const { space, child } = seed(f, 'Private recovery notebook');
    const doc = child('Private native notes', 'doc');
    f.spaces.share(f.owner.id, space.id, f.editor.id, 'editor');
    const editor = await f.open(f.editor.id);
    await editor.page.goto(href(space.id, doc.id));
    await saved(editor.page);
    await focusDoc(editor.page);
    await editor.page.keyboard.type('Persisted baseline.');
    await saved(editor.page);
    await editor.page.reload();
    await saved(editor.page);
    expect(await copyDoc(editor.page)).toBe('Persisted baseline.');
    const metadata = await f.context.request.get(`/api/spaces/${space.id}/items/${doc.id}`);
    expect(metadata.ok()).toBe(true);
    const unitID = (await metadata.json()).live.unitId as string;
    const read = async () => {
      const response = await f.context.request.get(
        `/space-api/${space.id}/items/${doc.id}/universer-api/snapshot/1/unit/${unitID}/rev/0`,
      );
      expect(response.ok()).toBe(true);
      const { snapshot, changesets } = (await response.json()) as {
        snapshot: unknown;
        changesets: unknown[];
      };
      return { snapshot, changesets };
    };
    const before = await read();
    const held = new Promise<void>((done) => {
      release = done;
    });
    let heldChanges = 0;
    let returnedChanges = 0;
    await editor.context.route('**/universer-api/comb/**/new_changes', async (route) => {
      heldChanges++;
      await held;
      const response = await route.fetch();
      // The protocol may acknowledge receipt separately from commit. Compare
      // authoritative native snapshot/revisions below, not the receipt alone.
      returnedChanges++;
      await route.fulfill({ response });
    });
    await focusDoc(editor.page);
    await editor.page.keyboard.press('Control+End');
    await editor.page.keyboard.type(' Unsaved words to rescue.');
    await expect.poll(() => heldChanges).toBeGreaterThan(0);
    const status = editor.page.getByRole('status', { name: 'Save status', exact: true });
    await expect(status).toContainText('not saved');
    f.spaces.share(f.owner.id, space.id, f.editor.id, null);
    await expect(status).toContainText('Access changed', { timeout: 10_000 });
    await expect(
      editor.page.getByRole('heading', { name: 'Space unavailable', exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      editor.page.getByRole('region', { name: 'Doc document', exact: true }),
    ).toBeVisible();
    await expect(editor.page.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
    await expect(editor.page.getByRole('region', { name: 'Space pages', exact: true })).toHaveCount(
      0,
    );
    await expect(
      editor.page.getByRole('region', { name: 'Deleted Space contents', exact: true }),
    ).toHaveCount(0);
    await expect(editor.page.getByRole('button', { name: 'Add page', exact: true })).toHaveCount(0);
    const local = await copyDoc(editor.page);
    expect(local).toContain('Persisted baseline.');
    expect(local).toContain('Unsaved words to rescue.');
    await cancelDeparture(editor.page, () =>
      editor.page
        .getByRole('banner')
        .getByRole('button', { name: 'My files', exact: true })
        .click(),
    );
    await expect(editor.page).toHaveURL(f.origin + href(space.id, doc.id));
    expect(
      (await editor.context.request.get(`/api/spaces/${space.id}/items/${doc.id}`)).status(),
    ).toBe(404);
    const inFlight = heldChanges;
    release();
    await expect.poll(() => returnedChanges).toBeGreaterThanOrEqual(inFlight);
    expect(await read()).toEqual(before);
    await screenshot(editor.page, info, 'revoked-unsaved-recovery');
    editor.page.once('dialog', (dialog) => dialog.accept());
    await editor.page.goto('about:blank');
    // A separate account and native instance reload the persisted state after
    // every held write reached the server; the rescued draft never committed.
    await f.page.goto(href(space.id, doc.id));
    await saved(f.page);
    expect(await copyDoc(f.page)).toBe('Persisted baseline.');
    expect(f.errors).toEqual([]);
  } finally {
    release();
    await f.close();
  }
});
