import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Dialog, Locator, Page, TestInfo } from '@playwright/test';
import { JSONX } from '@univerjs/core';
import type { IDocumentData, JSONXActions } from '@univerjs/core';
import { ErrorCode } from '@univerjs/protocol';
import type { IGetUnitOnRevResponse } from '@univerjs/protocol';
import { quoteFormulaName } from '@spinel/doc-formulas';
import { startApp } from './app-process.ts';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { SpaceStore } from '../src/server/workspace/spaces.ts';
import { SpaceRecoveryStore } from '../src/server/workspace/space-recovery.ts';
import { SpaceLifecycleStore } from '../src/server/workspace/space-lifecycle.ts';
import type { SpaceNode, SpaceRoot, SpaceTreeData } from '../src/shared/spaces.ts';
import type { SpaceFile } from '../src/shared/workspace.ts';

// The server/Pro SDK stays in startApp's child process. The collector uses the
// public core JSONX operation reader only to verify persisted native Doc data.
async function fixture(browser: Browser, info: TestInfo) {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-spaces-e2e-'));
  const databasePath = join(directory, 'app.sqlite');
  const origin = `http://localhost:${info.project.name === 'development' ? 3196 : 3197}`;
  const app = await startApp({
    databasePath,
    origin,
    development: info.project.name === 'development',
  });
  const db = openDatabase(databasePath),
    auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth, { spacesEnabled: true }),
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
const normalHref = (spaceId: string, itemId?: string) =>
  `/spaces/${spaceId}${itemId ? '?item=' + itemId : ''}`;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const saved = async (page: Page) => {
  await expect(page.getByRole('status', { name: 'Save status', exact: true })).toHaveText(
    'All changes saved.',
    { timeout: 30_000 },
  );
  await expect(
    page.getByRole('button', { name: 'Save details: Saved', exact: true }),
  ).toBeVisible();
};
const pageLink = (page: Page, spaceId: string, itemId: string) =>
  page
    .locator(
      `a.space-page-link[href="${href(spaceId, itemId)}"], a.space-page-link[href="${normalHref(spaceId, itemId)}"]`,
    )
    .filter({ visible: true });

async function pages(page: Page) {
  const navigation = page.getByRole('navigation', { name: 'Pages', exact: true });
  const opener = page.getByRole('button', { name: 'Open Space contents', exact: true });
  // The URL can settle before the Space tree loads. Wait for the actual layout
  // before choosing between the inline tree and the collapsed/phone control.
  await expect(navigation.or(opener).filter({ visible: true }).first()).toBeVisible();
  if (!(await navigation.isVisible())) await opener.click();
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
async function nativeLayout(page: Page, kind: 'Doc' | 'Sheet', fitViewport = false) {
  const region = page.getByRole('region', { name: `${kind} document`, exact: true });
  await page.getByRole('button', { name: 'People in this document', exact: true }).click();
  const people = page.getByRole('dialog', { name: 'People in this document', exact: true });
  await expect(people.locator('.collaborator-badge').first()).toBeVisible();
  await people.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(people).toHaveCount(0);
  const bounds = await region.locator('.univer-container').evaluate((canvas) => {
    const rect = canvas.getBoundingClientRect();
    const style = getComputedStyle(canvas);
    const frame = canvas.closest('.editor-frame');
    const tree = frame?.querySelector('.space-desktop-tree');
    const heading = frame?.querySelector('.editor-name h1');
    return {
      width: innerWidth,
      height: innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      treeBottom:
        tree && getComputedStyle(tree).display !== 'none'
          ? tree.getBoundingClientRect().bottom
          : null,
      headerBottom: frame?.querySelector('.editor-header')?.getBoundingClientRect().bottom,
      titleFontSize: heading ? getComputedStyle(heading).fontSize : null,
      touch: matchMedia('(pointer: coarse)').matches,
      touchAction: style.touchAction,
      overscrollX: style.overscrollBehaviorX,
      overscrollY: style.overscrollBehaviorY,
    };
  });
  expect(bounds.documentWidth).toBeLessThanOrEqual(bounds.width + 1);
  expect(bounds.left).toBeGreaterThanOrEqual(-1);
  expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1);
  if (fitViewport) {
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.height + 1);
    if (bounds.treeBottom !== null)
      expect(bounds.treeBottom).toBeLessThanOrEqual(bounds.height + 1);
    expect(bounds.titleFontSize).toBe('16px');
    expect(bounds.documentHeight, JSON.stringify(bounds)).toBeLessThanOrEqual(bounds.height + 1);
  }
  if (kind === 'Sheet' && bounds.touch) {
    expect(bounds.touchAction).toBe('none');
    expect(bounds.overscrollX).toBe('contain');
    expect(bounds.overscrollY).toBe('contain');
  } else {
    expect(bounds.touchAction).not.toBe('none');
  }
}
async function nativeState(
  context: BrowserContext,
  spaceId: string,
  itemId: string,
  type: 1 | 2 = 1,
) {
  const metadata = await context.request.get(`/api/spaces/${spaceId}/items/${itemId}`);
  expect(metadata.ok()).toBe(true);
  const unitID = (await metadata.json()).live.unitId as string;
  const response = await context.request.get(
    `/space-api/${spaceId}/items/${itemId}/universer-api/snapshot/${type}/unit/${unitID}/rev/0`,
  );
  expect(response.ok()).toBe(true);
  const { snapshot, changesets, error } = (await response.json()) as IGetUnitOnRevResponse;
  // The public protocol returns an error envelope even on success: OK is 1.
  expect(error?.code).toBe(ErrorCode.OK);
  expect(snapshot).toMatchObject({ unitID, type });
  return { unitID, snapshot, changesets };
}
function nativeHead(state: Awaited<ReturnType<typeof nativeState>>) {
  // Automatic snapshots may compact the representation after acknowledgement;
  // the live unit and current revision remain the authoritative commit identity.
  return {
    unitID: state.unitID,
    revision: Math.max(state.snapshot!.rev, ...state.changesets.map((change) => change.revision)),
  };
}
function nativeDocText(state: Awaited<ReturnType<typeof nativeState>>) {
  // The public snapshot protocol carries the original document JSON as bytes;
  // HTTP JSON represents those bytes either as base64 or a numeric byte object.
  const meta = state.snapshot?.doc?.originalMeta as Uint8Array | string | undefined;
  expect(meta).toBeDefined();
  const bytes =
    typeof meta === 'string' ? Buffer.from(meta, 'base64') : Buffer.from(Object.values(meta!));
  let document = JSON.parse(bytes.toString('utf8')) as IDocumentData;
  for (const changeset of state.changesets) {
    for (const mutation of changeset.mutations) {
      expect(mutation.id).toBe('doc.mutation.rich-text-editing');
      const { unitId, actions } = JSON.parse(mutation.data) as {
        unitId: string;
        actions: JSONXActions;
      };
      expect(unitId).toBe(state.unitID);
      // JSONX.apply returns undefined for a no-op; a non-no-op must produce the
      // actual resulting document rather than falling back to its prior text.
      if (!JSONX.isNoop(actions)) {
        const replayed = JSONX.apply(document, actions);
        if (
          replayed === null ||
          typeof replayed !== 'object' ||
          Array.isArray(replayed) ||
          replayed.id !== document.id ||
          replayed.documentStyle === null ||
          typeof replayed.documentStyle !== 'object' ||
          Array.isArray(replayed.documentStyle)
        )
          throw new Error('Native Doc replay did not preserve document identity and structure.');
        document = replayed as unknown as IDocumentData;
      }
    }
  }
  return document.body?.dataStream.trim();
}
function nativeDocState(state: Awaited<ReturnType<typeof nativeState>>) {
  return { ...nativeHead(state), text: nativeDocText(state) };
}
function nativeDiagnostics(page: Page, phase: () => string) {
  const events: object[] = [];
  const record = (event: object) => {
    events.push({ phase: phase(), ...event });
    if (events.length > 100) events.shift();
  };
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (
      path.includes('/space-api/') ||
      /^\/api\/spaces\/[^/]+\/items\/[^/]+\/collaboration$/.test(path)
    )
      record({ http: path, method: response.request().method(), status: response.status() });
  });
  page.on('requestfailed', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.includes('/space-api/')) record({ http: path, failed: true });
  });
  page.on('websocket', (socket) => {
    if (!new URL(socket.url()).pathname.includes('/space-api/')) return;
    socket.on('framereceived', ({ payload }) => {
      try {
        const frame = JSON.parse(String(payload)) as { cmd?: unknown; code?: unknown };
        if (
          (typeof frame.cmd === 'string' || typeof frame.cmd === 'number') &&
          (typeof frame.code === 'string' || typeof frame.code === 'number')
        )
          record({ socket: 'response', command: frame.cmd, code: frame.code });
      } catch {
        // Keep diagnostics to public command/outcome codes, never payload data.
      }
    });
    socket.on('close', () => record({ socket: 'closed' }));
  });
  return events;
}
async function holdNativeWrites(context: BrowserContext) {
  let release = () => {};
  const held = new Promise<void>((done) => {
    release = done;
  });
  let received = 0;
  let returned = 0;
  await context.route('**/universer-api/comb/**/new_changes', async (route) => {
    received++;
    await held;
    const response = await route.fetch();
    // A transport receipt is not proof of a native commit. Callers compare the
    // authoritative snapshot after every held request has reached the server.
    await route.fulfill({ response });
    returned++;
  });
  return {
    release,
    received: () => received,
    returned: () => returned,
    // On the assertion path, call after the native page has left to include
    // retries in the persisted-state proof. Also drain on failure while the
    // server is still alive, so fixture shutdown cannot mask the first failure.
    drain: () => context.unrouteAll({ behavior: 'wait' }),
  };
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

test('ordinary My files creates and opens one Space root while preserving its previous folder view', async ({
  browser,
}, info) => {
  test.setTimeout(90_000);
  const f = await fixture(browser, info);
  const { page } = f;
  // Fail an unavailable control before the overall deadline closes the browser
  // and replaces the useful action call log with a fixture cleanup error.
  page.setDefaultTimeout(15_000);
  try {
    await page.goto(`/?item=${f.folder.id}`);
    await expect(page.getByRole('heading', { name: f.folder.name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Space', exact: true }).click();
    const form = page.getByRole('form', { name: 'New item', exact: true });
    await form.getByRole('combobox', { name: 'Type', exact: true }).selectOption('space');
    await form.getByLabel('Name', { exact: true }).fill('Outer research');
    const creating = page.waitForResponse(
      (response) => response.url().endsWith('/api/items') && response.request().method() === 'POST',
    );
    await form.getByRole('button', { name: 'Create', exact: true }).click();
    const created = await creating;
    expect(created.status()).toBe(201);
    // Creation navigates out of Dashboard, which releases Chromium's old-page
    // response body. Verify the persisted item through its opened stable URL.
    await expect(page).toHaveURL(new RegExp('^' + escape(f.origin) + '/spaces/[a-f\\d-]{36}$'));
    const openedId = new URL(page.url()).pathname.split('/').at(-1)!;
    const metadata = await f.context.request.get(`/api/items/${openedId}`);
    expect(metadata.status()).toBe(200);
    const { item } = (await metadata.json()) as { item: SpaceFile };
    expect(item).toMatchObject({ kind: 'space', parentId: f.folder.id, access: 'owner' });
    await expect(page).toHaveURL(f.origin + normalHref(item.id));
    await expect(
      page.getByRole('heading', { name: 'This Space is empty', exact: true }),
    ).toBeVisible();
    const member = await f.context.request.post(`/api/spaces/${item.id}/items`, {
      headers: { Origin: f.origin },
      data: { name: 'Internal research folder', kind: 'folder', parentId: item.id },
    });
    expect(member.status()).toBe(201);
    const child = (await member.json()).item as SpaceNode;
    const chooseRoot = async (name: string, rootName: string) => {
      await page
        .getByRole('button', { name: `Space actions for ${rootName}`, exact: true })
        .click();
      await page.getByRole('menuitem', { name, exact: true }).click();
    };
    await chooseRoot('Rename', item.name);
    const rename = page.getByRole('dialog', { name: 'Rename Space', exact: true });
    await rename.getByLabel('Name', { exact: true }).fill('Research collection');
    await rename.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(rename).not.toBeVisible();
    await chooseRoot('Move', 'Research collection');
    const move = page.getByRole('dialog', { name: 'Move Space', exact: true });
    await move.getByRole('combobox', { name: 'Destination', exact: true }).selectOption('');
    await move.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(move).not.toBeVisible();
    const moved = await f.tree(item.id);
    expect(moved.space).toMatchObject({ id: item.id, name: 'Research collection', parentId: null });
    expect(moved.items).toContainEqual(
      expect.objectContaining({ id: child.id, parentId: item.id }),
    );
    await page.getByRole('button', { name: 'My files', exact: true }).click();
    // Opening and moving the Space never replaced Dashboard's remembered folder.
    await expect(page).toHaveURL(`${f.origin}/?item=${f.folder.id}`);
    await expect(page.getByRole('heading', { name: f.folder.name, exact: true })).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Breadcrumb', exact: true })
      .getByRole('button', { name: 'My files', exact: true })
      .click();
    const files = page.getByRole('list', { name: 'Folder contents', exact: true });
    await expect(
      files.getByRole('button', { name: 'Research collection Space', exact: true }),
    ).toBeVisible();
    await expect(files.getByText(child.name, { exact: true })).toHaveCount(0);
    const listing = await f.context.request.get('/api/items');
    const rows = (await listing.json()).items as { id: string; kind: string }[];
    expect(rows).toContainEqual(expect.objectContaining({ id: item.id, kind: 'space' }));
    expect(rows.some((entry) => entry.id === child.id)).toBe(false);
    await files.getByRole('button', { name: 'Research collection Space', exact: true }).click();
    await expect(page).toHaveURL(f.origin + normalHref(item.id));
    await expect((await pages(page)).getByText(child.name, { exact: true })).toBeVisible();
    await chooseRoot('Share', 'Research collection');
    const sharing = page.getByRole('dialog', { name: 'Share Research collection', exact: true });
    const link = sharing.getByRole('region', { name: 'Guest link', exact: true });
    await expect(link).toContainText('every current and future page in this Space');
    await link.getByRole('button', { name: 'Create guest link', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Share the whole Space?', exact: true });
    await expect(confirmation).toContainText('Child pages cannot have separate guest access.');
    await confirmation.getByRole('button', { name: 'Create view link', exact: true }).click();
    await expect(confirmation).not.toBeVisible();
    await expect(link.getByLabel('Guest link address', { exact: true })).toHaveValue(
      new RegExp(escape(`${f.origin}/share/${item.id}`) + '\\?preview=.+#.+'),
    );
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('an owner creates and edits a persistent Space tree with native Docs, Sheets and stable navigation', async ({
  browser,
}, info) => {
  test.setTimeout(180_000);
  const f = await fixture(browser, info);
  const { page } = f;
  page.setDefaultTimeout(15_000);
  try {
    const space = await newSpace(page);
    await page.getByRole('radio', { name: 'Follow system', exact: true }).click();
    expect(space.parentId).toBe(f.folder.id);
    const folder = await add(page, space.id, 'Folder', 'Research');
    const doc = await add(page, space.id, 'Doc', 'Project notes');
    await focusDoc(page);
    await page.keyboard.type('Native notes in a Space.');
    await saved(page);
    expect(await copyDoc(page)).toBe('Native notes in a Space.');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // The earlier save proof preceded clipboard/theme interaction. Establish
    // the current native state before taking evidence and creating another page.
    await saved(page);
    await nativeLayout(page, 'Doc', true);
    await screenshot(page, info, 'doc-light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await saved(page);
    await screenshot(page, info, 'doc-dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await saved(page);
    const sheet = await add(page, space.id, 'Sheet', 'Plan');
    await writeCell(page, 'A1', '41');
    await writeCell(page, 'A2', '1');
    await writeCell(page, 'A3', '=SUM(A1:A2)');
    await saved(page);
    expect(await copyCell(page, 'A3')).toBe('42');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await saved(page);
    await nativeLayout(page, 'Sheet', true);
    await screenshot(page, info, 'sheet-dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await saved(page);
    await screenshot(page, info, 'sheet-light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await saved(page);
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
    const prefix = `/api/spaces/${space.id}/items/${doc.id}`;
    await page.getByRole('button', { name: 'Document actions', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Insert formula', exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');
    const sources = await f.context.request.get(`${prefix}/formulas/sources`);
    expect(sources.status()).toBe(200);
    expect((await sources.json()).sources).toContainEqual({ itemId: sheet.id, name: sheet.name });
    const worksheets = await f.context.request.get(`${prefix}/formulas/sources/${sheet.id}`);
    expect(worksheets.status()).toBe(200);
    const worksheet = (await worksheets.json()).sheets[0] as { sheetId: string; name: string };
    const resolved = await f.context.request.post(`${prefix}/formulas/resolve`, {
      headers: { Origin: f.origin },
      data: {
        expression: `=${quoteFormulaName(sheet.name)}.${quoteFormulaName(worksheet.name)}.A3`,
      },
    });
    expect(resolved.status()).toBe(200);
    const { definition } = await resolved.json();
    expect(definition.references[0]).toMatchObject({
      itemId: sheet.id,
      sheetId: worksheet.sheetId,
    });
    const evaluated = await f.context.request.post(`${prefix}/formulas/evaluate`, {
      headers: { Origin: f.origin },
      data: { definition },
    });
    expect(await evaluated.json()).toMatchObject({ ok: true, kind: 'scalar', value: 42 });

    // Canonical image URLs retain the exact child even outside the scoped upload route.
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 2;
      canvas.getContext('2d')!.fillRect(0, 0, 2, 2);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const upload = await f.context.request.post(`${prefix}/images`, {
      headers: { Origin: f.origin, 'Content-Type': 'image/png' },
      data: Buffer.from(png, 'base64'),
    });
    expect(upload.status()).toBe(201);
    const image = (await upload.json()) as { id: string; url: string };
    expect(image.url).toBe(`/api/items/${doc.id}/images/${image.id}`);
    expect((await f.context.request.get(image.url)).status()).toBe(200);

    await page.getByRole('button', { name: 'Document actions', exact: true }).click();

    await page.getByRole('menuitem', { name: 'Versions', exact: true }).click();
    const versions = page.getByRole('region', { name: 'Version names', exact: true });
    await expect(
      versions.getByRole('link', { name: 'Browse history', exact: true }),
    ).toHaveAttribute('href', `/preview?item=${doc.id}&space=${space.id}`);
    await versions.getByRole('button', { name: 'Name this version', exact: true }).click();
    await versions.getByLabel('Version name', { exact: true }).fill('Space integration checkpoint');
    await versions.getByRole('button', { name: 'Save version name', exact: true }).click();
    await expect(versions.getByText('Space integration checkpoint', { exact: true })).toBeVisible();
    await page
      .getByRole('dialog', { name: 'Versions', exact: true })
      .getByRole('button', { name: 'Close dialog', exact: true })
      .click();
    await page.getByRole('button', { name: 'Document actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
    const exportPanel = page.getByRole('dialog', { name: 'Export', exact: true });
    await expect(
      exportPanel.getByRole('button', { name: 'Print / save PDF', exact: true }),
    ).toBeEnabled();
    const download = page.waitForEvent('download');
    const exported = page.waitForResponse((response) =>
      response.url().endsWith(`${prefix}/export`),
    );
    await exportPanel.getByRole('button', { name: 'Download Univer file', exact: true }).click();
    const nativeFile = await download;
    expect(nativeFile.suggestedFilename()).toBe('Decisions.univer.json');
    expect((await exported).status()).toBe(200);
    expect(await nativeFile.failure()).toBeNull();
    // Verify the actual file delivered by the UI, as in portable.spec.ts,
    // including its native content after the response is handed off as a blob.
    const snapshot = JSON.parse(
      await readFile((await nativeFile.path())!, 'utf8'),
    ) as IDocumentData;
    expect(snapshot.id).toBe(doc.id);
    expect(snapshot.body?.dataStream).toContain('Native notes in a Space.');
    // Outer document services remain closed: activation never widens ordinary lookup.
    expect((await f.context.request.get(`/api/items/${sheet.id}/sheet`)).status()).toBe(404);
    expect((await f.context.request.get(`/api/items/${doc.id}/history`)).status()).toBe(404);

    // Replace the live editor with the actual scoped history viewer, keeping
    // one native browser editor resident and proving the root survives preview.
    const historyResponse = await f.context.request.get(`${prefix}/history`);
    expect(historyResponse.status()).toBe(200);
    const checkpoint = (
      (await historyResponse.json()).versions as { id: string; name: string | null }[]
    ).find((version) => version.name === 'Space integration checkpoint')!;
    expect(checkpoint).toBeDefined();
    // Follow system was selected before opening native content; media changes
    // exercise the same theme lifecycle without replacing the mounted editor.
    await exportPanel.getByRole('button', { name: 'Close dialog', exact: true }).click();
    expect(await page.evaluate(() => localStorage.getItem('spinel-theme'))).toBeNull();
    const liveBeforePreview = nativeDocState(await nativeState(f.context, space.id, doc.id));
    await page.goto(`/preview?item=${doc.id}&space=${space.id}&version=${checkpoint.id}`);
    const preview = page.getByRole('region', { name: 'Version preview', exact: true });
    await expect(
      page.getByRole('heading', { name: 'Document history', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Restore this version', exact: true }),
    ).toBeEnabled({ timeout: 30_000 });
    await expect(
      preview.getByRole('link', { name: 'Back to live document', exact: true }),
    ).toHaveAttribute('href', normalHref(space.id, doc.id));
    await preview.locator('.univer-container').click({ position: { x: 130, y: 200 } });
    await page.keyboard.press('Control+a');
    expect(await copySelection(page)).toBe('Native notes in a Space.');
    for (const [theme, width, variant] of [
      ['light', 1440, 'light'],
      ['dark', 1440, 'dark'],
      ['light', 390, 'phone'],
    ] as const) {
      await page.setViewportSize({ width, height: 1100 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(preview.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
      await screenshot(page, info, 'history-preview-' + variant);
    }
    expect(nativeDocState(await nativeState(f.context, space.id, doc.id))).toEqual(
      liveBeforePreview,
    );
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
  let phase = 'initial Doc load';
  const diagnostics = nativeDiagnostics(page, () => phase);
  try {
    const { space, child } = seed(f);
    const group = child('Archive group', 'folder');
    const doc = child('Retained notes', 'doc', group.id);
    const sheet = child('Retained numbers', 'sheet', doc.id);
    await page.clock.install();
    await page.goto(href(space.id, doc.id));
    await saved(page);
    await expect(page.getByRole('status', { name: 'Connection status', exact: true })).toHaveText(
      'Online',
    );
    await page.getByRole('button', { name: `Expand ${doc.name}`, exact: true }).click();
    const destination = pageLink(page, space.id, sheet.id);
    await expect(destination).toBeVisible();
    const target = await destination.boundingBox();
    expect(target).not.toBeNull();
    await focusDoc(page);
    await saved(page);
    phase = 'immediate native Doc edit and cancelled navigation';
    // Freeze the public browser clock before typing so even slow CI exercises
    // the native pre-collaboration batching window. The real pointer target was
    // resolved while clean; no actionability/RAF wait can drain the Doc queue.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    try {
      await page.keyboard.type('K');
      await cancelDeparture(page, () =>
        page.mouse.click(target!.x + target!.width / 2, target!.y + target!.height / 2),
      );
      await expect(page).toHaveURL(f.origin + href(space.id, doc.id));
      await expect(page.getByRole('region', { name: 'Doc document', exact: true })).toBeVisible();
    } finally {
      await page.clock.resume();
    }
    await saved(page);
    expect(nativeDocText(await nativeState(f.context, space.id, doc.id))).toBe('K');
    phase = 'original Doc persistence before departure';
    await focusDoc(page);
    await page.keyboard.press('Control+End');
    await page.keyboard.type('eep this native document through recovery.');
    await saved(page);
    expect(await copyDoc(page)).toBe('Keep this native document through recovery.');
    await saved(page);
    const docBeforeTrash = await nativeState(f.context, space.id, doc.id);
    expect(nativeDocText(docBeforeTrash)).toBe('Keep this native document through recovery.');
    phase = 'Sheet edits and pending navigation';
    await destination.click();
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
    const sheetBeforeTrash = await nativeState(f.context, space.id, sheet.id, 2);
    phase = 'whole-subtree Trash';

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
    await page.getByRole('radio', { name: 'Dark', exact: true }).click();
    await screenshot(page, info, 'trash-dark');
    await page.getByRole('radio', { name: 'Light', exact: true }).click();
    phase = 'subtree restore before native reopen';
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
    const restoredDoc = await nativeState(f.context, space.id, doc.id);
    expect(nativeHead(restoredDoc)).toEqual(nativeHead(docBeforeTrash));
    expect(nativeDocText(restoredDoc)).toBe('Keep this native document through recovery.');
    expect(nativeHead(await nativeState(f.context, space.id, sheet.id, 2))).toEqual(
      nativeHead(sheetBeforeTrash),
    );
    phase = 'restored Doc load and connection';
    await page.goto(href(space.id, doc.id));
    await saved(page);
    await expect(page.getByRole('status', { name: 'Connection status', exact: true })).toHaveText(
      'Online',
    );
    await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
    phase = 'restored Doc content';
    expect(await copyDoc(page)).toBe('Keep this native document through recovery.');
    await saved(page);
    phase = 'restored Sheet content';
    await page.goto(href(space.id, sheet.id));
    await saved(page);
    expect(await copyCell(page, 'A1')).toBe('73');
    expect(await copyCell(page, 'A2')).toBe('pending-pointer-edit');
    expect(await copyCell(page, 'A3')).toBe('pending-history-edit');
    phase = 'permanent deletion';
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
  } catch (error) {
    const evidence = JSON.stringify({ phase, events: diagnostics }, null, 2);
    console.error('Space native recovery diagnostics:', evidence);
    // The automatic failure image follows fixture shutdown, which can itself
    // show Offline. Capture the live failure before closing the app or page.
    await page
      .screenshot({
        path: info.outputPath('test-failed-native-recovery.png'),
        fullPage: true,
        timeout: 5000,
      })
      .catch(() => {
        console.error('Could not capture the Space native recovery failure before cleanup.');
      });
    await info
      .attach('native-recovery-diagnostics', {
        body: evidence,
        contentType: 'application/json',
      })
      .catch(() => {
        // The console retains bounded diagnostics if attachment itself fails;
        // preserve the actual test failure instead of masking it with that error.
        console.error('Could not attach Space native recovery diagnostics.');
      });
    throw error;
  } finally {
    await f.close();
  }
});

for (const role of ['editor', 'admin'] as const) {
  test(`Space viewer and ${role} controls follow live role changes, revocation and owner disablement`, async ({
    browser,
  }, info) => {
    test.setTimeout(150_000);
    const f = await fixture(browser, info);
    let editorPage: Page | undefined;
    let phase = 'editor and viewer controls';
    let diagnostics: object[] = [];
    try {
      const { space, child } = seed(f, 'Shared review notebook');
      const doc = child('Shared native notes', 'doc');
      const deletedDoc = child('Recoverable notes', 'doc');
      new SpaceRecoveryStore(f.workspace).trash(f.owner.id, space.id, deletedDoc.id);
      f.spaces.share(f.owner.id, space.id, f.editor.id, role);
      f.spaces.share(f.owner.id, space.id, f.viewer.id, 'viewer');

      const editor = await f.open(f.editor.id);
      editorPage = editor.page;
      diagnostics = nativeDiagnostics(editor.page, () => phase);
      await editor.page.goto(normalHref(space.id, doc.id));
      await saved(editor.page);
      await focusDoc(editor.page);
      await editor.page.keyboard.type('A scoped editor can save these notes.');
      await saved(editor.page);
      await expect(
        editor.page.getByRole('button', { name: 'Add page', exact: true }),
      ).toBeVisible();
      if (role === 'admin') {
        await expect(editor.page.locator('.space-access')).toHaveText('File admin');
        await editor.page
          .getByRole('button', { name: `More actions for ${doc.name}`, exact: true })
          .click();
        await expect(
          editor.page.getByRole('menuitem', { name: 'Rename', exact: true }),
        ).toBeVisible();
        await expect(editor.page.getByRole('menuitem', { name: /Share/ })).toHaveCount(0);
        await editor.page.keyboard.press('Escape');
        await screenshot(editor.page, info, 'file-admin-child');
      }
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
      await expect(
        viewer.page.getByRole('status', { name: 'Save status', exact: true }),
      ).toHaveText('View only — reload after your access changes.', { timeout: 30_000 });
      await expect(
        viewer.page.getByRole('button', { name: 'Save details: View only', exact: true }),
      ).toBeVisible();
      expect(await copyDoc(viewer.page)).toBe('A scoped editor can save these notes.');
      await expect(viewer.page.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
      await expect(viewer.page.getByRole('button', { name: 'Add page', exact: true })).toHaveCount(
        0,
      );
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
      expect((await viewer.context.request.get(`/api/spaces/${space.id}/trash`)).status()).toBe(
        403,
      );
      await screenshot(viewer.page, info, 'viewer');
      await viewer.page.goto('about:blank');

      phase = 'clean editor downgraded to viewer';
      await editor.page.goto(normalHref(space.id, doc.id));
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
      await expect(
        editor.page.getByRole('status', { name: 'Save status', exact: true }),
      ).toContainText('Access changed');
      // Evicting a clean connection for a role change must not create a local
      // draft. The separate held-write scenario proves genuinely dirty retention.
      await expect(
        editor.page.getByRole('button', { name: 'Retry saving', exact: true }),
      ).toHaveCount(0);
      phase = 'clean viewer grant revoked';
      f.spaces.share(f.owner.id, space.id, f.editor.id, null);
      await expect(
        editor.page.getByRole('heading', { name: 'Space unavailable', exact: true }),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        editor.page.getByRole('region', { name: 'Doc document', exact: true }),
      ).toHaveCount(0);
      await expect(
        editor.page.getByRole('region', { name: 'Space pages', exact: true }),
      ).toHaveCount(0);
      expect(
        (await editor.context.request.get(`/api/spaces/${space.id}/items/${doc.id}`)).status(),
      ).toBe(404);
      f.spaces.share(f.owner.id, space.id, f.editor.id, role);
      await editor.page.reload();
      await saved(editor.page);
      phase = 'clean editor loses the disabled owner';
      f.db.prepare('UPDATE auth_users SET disabled=1 WHERE id=?').run(f.owner.id);
      await expect(
        editor.page.getByRole('heading', { name: 'Space unavailable', exact: true }),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        editor.page.getByRole('region', { name: 'Doc document', exact: true }),
      ).toHaveCount(0);
      expect((await editor.context.request.get(`/api/spaces/${space.id}`)).status()).toBe(404);
      expect(f.errors).toEqual([]);
    } catch (error) {
      console.error(
        'Space role-change diagnostics:',
        JSON.stringify({ phase, events: diagnostics }),
      );
      await editorPage
        ?.screenshot({
          path: info.outputPath('test-failed-native-roles.png'),
          fullPage: true,
          timeout: 5000,
        })
        .catch(() => {
          console.error('Could not capture the Space role-change failure before cleanup.');
        });
      throw error;
    } finally {
      await f.close();
    }
  });
}

test('Space navigation works on a touch phone and at 613px with a mouse, with real editor and Trash theme evidence', async ({
  browser,
}, info) => {
  test.setTimeout(150_000);
  const f = await fixture(browser, info);
  try {
    const { space, child } = seed(f, 'Pocket notebook');
    const parent = child('Planning notes', 'doc');
    const nested = child('Nested notes', 'doc', parent.id);
    const sheet = child('Pocket numbers', 'sheet');
    const removed = child('Deleted draft', 'doc');
    new SpaceRecoveryStore(f.workspace).trash(f.owner.id, space.id, removed.id);
    const phone = await f.open(f.owner.id, true);
    await phone.page.goto(href(space.id, parent.id));
    await saved(phone.page);
    await focusDoc(phone.page);
    await phone.page.keyboard.type('A real Space document on a phone.');
    await saved(phone.page);
    await phone.page.emulateMedia({ colorScheme: 'light' });
    await expect(phone.page.locator('html')).toHaveAttribute('data-theme', 'light');
    await saved(phone.page);
    await nativeLayout(phone.page, 'Doc');
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
    await phone.page.emulateMedia({ colorScheme: 'dark' });
    await expect(phone.page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await saved(phone.page);
    await nativeLayout(phone.page, 'Doc');
    await screenshot(phone.page, info, 'phone-doc-dark');
    await phonePages.tap();
    await expect(drawer).toBeVisible();
    await phone.page.keyboard.press('Escape');
    await expect(drawer).not.toBeVisible();
    await expect(phonePages).toBeFocused();
    await phonePages.tap();
    await pageLink(phone.page, space.id, sheet.id).tap();
    await expect(drawer).not.toBeVisible();
    await saved(phone.page);
    await nativeLayout(phone.page, 'Sheet');
    await screenshot(phone.page, info, 'phone-sheet-dark');
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
    await nativeLayout(f.page, 'Doc');
    await screenshot(f.page, info, '613px-mouse-doc');
    await mousePages.click();
    await pageLink(f.page, space.id, sheet.id).click();
    await expect(mouseDrawer).not.toBeVisible();
    await saved(f.page);
    await nativeLayout(f.page, 'Sheet');
    await screenshot(f.page, info, '613px-mouse-sheet');
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
    await expect(f.page).toHaveURL(f.origin + normalHref(space.id, target.id));
    await saved(f.page);
    await expect(f.page.getByRole('heading', { name: target.name, exact: true })).toBeVisible();
    await expect(pageLink(f.page, space.id, target.id)).toHaveAttribute('aria-current', 'page');
    await f.page.goto('about:blank');
    await f.context.clearCookies();
    await f.page.goto('/review/spaces');
    await expect(f.page).toHaveURL(`${f.origin}/sign-in?space=index`);
    await f.context.addCookies(ownerCookies);
    await f.page.reload();
    await expect(f.page).toHaveURL(f.origin + '/spaces');
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
  let drain = async () => {};
  try {
    const { space, child } = seed(f, 'Private recovery notebook');
    const doc = child('Private native notes', 'doc');
    f.spaces.share(f.owner.id, space.id, f.editor.id, 'admin');
    const editor = await f.open(f.editor.id);
    await editor.page.goto(href(space.id, doc.id));
    await saved(editor.page);
    await focusDoc(editor.page);
    await editor.page.keyboard.type('Persisted baseline.');
    await saved(editor.page);
    await editor.page.reload();
    await saved(editor.page);
    expect(await copyDoc(editor.page)).toBe('Persisted baseline.');
    const before = await nativeState(f.context, space.id, doc.id);
    const held = await holdNativeWrites(editor.context);
    release = held.release;
    drain = held.drain;
    await focusDoc(editor.page);
    await editor.page.keyboard.press('Control+End');
    await editor.page.keyboard.type(' Unsaved words to rescue.');
    await expect.poll(held.received).toBeGreaterThan(0);
    const status = editor.page.getByRole('status', { name: 'Save status', exact: true });
    await expect(status).toContainText('not saved');
    await editor.page.getByRole('button', { name: 'Save details: Not saved', exact: true }).click();
    await expect(
      editor.page.getByRole('button', { name: 'Retry saving', exact: true }),
    ).toBeVisible();
    await editor.page.keyboard.press('Escape');
    // A File admin can have a private rename draft open when the grant disappears.
    await editor.page.getByRole('button', { name: `Rename ${doc.name}`, exact: true }).click();
    await expect(editor.page.getByRole('textbox', { name: 'Document name' })).toHaveValue(doc.name);
    f.spaces.share(f.owner.id, space.id, f.editor.id, null);
    await expect(status).toContainText('Access changed', { timeout: 10_000 });
    await expect(
      editor.page.getByRole('heading', { name: 'Space unavailable', exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    // A retained local draft must not restore revoked Space/page identity in chrome.
    await expect(editor.page.getByRole('heading', { name: doc.name, exact: true })).toHaveCount(0);
    await expect(editor.page.getByRole('textbox', { name: 'Document name' })).toHaveCount(0);
    await expect(editor.page.locator('.editor-header .editor-access')).toHaveText('Access changed');
    await expect(editor.page.getByText(`Space · ${space.name}`, { exact: true })).toHaveCount(0);
    await expect(editor.page).not.toHaveTitle(new RegExp(doc.name));
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
        .locator('.editor-header')
        .getByRole('button', { name: 'My files', exact: true })
        .click(),
    );
    await expect(editor.page).toHaveURL(f.origin + href(space.id, doc.id));
    expect(
      (await editor.context.request.get(`/api/spaces/${space.id}/items/${doc.id}`)).status(),
    ).toBe(404);
    const inFlight = held.received();
    release();
    await expect.poll(held.returned).toBeGreaterThanOrEqual(inFlight);
    expect(nativeDocState(await nativeState(f.context, space.id, doc.id))).toEqual(
      nativeDocState(before),
    );
    await screenshot(editor.page, info, 'revoked-unsaved-recovery');
    editor.page.once('dialog', (dialog) => dialog.accept());
    await editor.page.goto('about:blank');
    await held.drain();
    expect(nativeDocState(await nativeState(f.context, space.id, doc.id))).toEqual(
      nativeDocState(before),
    );
    // A separate account and native instance reload the persisted state after
    // every held write reached the server; the rescued draft never committed.
    await f.page.goto(href(space.id, doc.id));
    await saved(f.page);
    expect(await copyDoc(f.page)).toBe('Persisted baseline.');
    expect(f.errors).toEqual([]);
  } finally {
    release();
    try {
      await drain();
    } finally {
      await f.close();
    }
  }
});

test('external child, ancestor and whole-Space Trash invalidates open native editors while an unsaved draft stays recoverable', async ({
  browser,
}, info) => {
  test.setTimeout(150_000);
  const f = await fixture(browser, info);
  let release = () => {};
  let drain = async () => {};
  try {
    const { space, child } = seed(f, 'Externally changed notebook');
    const group = child('External branch', 'folder');
    const doc = child('Open native notes', 'doc', group.id);
    const sheet = child('Open native numbers', 'sheet', doc.id);
    const available = child('Still available', 'doc');
    const recovery = new SpaceRecoveryStore(f.workspace);
    const lifecycle = new SpaceLifecycleStore(f.workspace);
    const scenarios = [
      {
        selected: doc,
        wholeSpace: false,
        removed: [doc, sheet],
        trash: () => recovery.trash(f.owner.id, space.id, doc.id),
        restore: () => recovery.restore(f.owner.id, space.id, doc.id),
      },
      {
        selected: sheet,
        wholeSpace: false,
        removed: [group, doc, sheet],
        trash: () => recovery.trash(f.owner.id, space.id, group.id),
        restore: () => recovery.restore(f.owner.id, space.id, group.id),
      },
      {
        selected: doc,
        wholeSpace: true,
        removed: [group, doc, sheet, available],
        trash: () => lifecycle.trash(f.owner.id, space.id),
        restore: () => lifecycle.restore(f.owner.id, space.id),
      },
    ];
    for (const scenario of scenarios) {
      await f.page.goto(href(space.id, scenario.selected.id));
      await saved(f.page);
      // Existing stores change the same application database from outside the
      // active page. No reload or navigation may supply the invalidation proof.
      scenario.trash();
      if (scenario.wholeSpace) {
        await expect(
          f.page.getByRole('heading', { name: 'Space unavailable', exact: true }),
        ).toBeVisible({ timeout: 10_000 });
        await expect(f.page.getByRole('region', { name: 'Space pages', exact: true })).toHaveCount(
          0,
        );
      } else {
        await expect(
          f.page.getByRole('alert').filter({ hasText: 'This page is not available.' }),
        ).toBeVisible({ timeout: 10_000 });
        await expect(pageLink(f.page, space.id, available.id)).toBeVisible();
      }
      await expect(f.page).toHaveURL(f.origin + href(space.id, scenario.selected.id));
      await expect(f.page.getByRole('region', { name: /^(Doc|Sheet) document$/ })).toHaveCount(0);
      for (const item of scenario.removed)
        await expect(
          item.kind === 'folder'
            ? f.page.getByRole('button', { name: item.name, exact: true })
            : pageLink(f.page, space.id, item.id),
        ).toHaveCount(0);
      expect(
        (
          await f.context.request.get(`/api/spaces/${space.id}/items/${scenario.selected.id}`)
        ).status(),
      ).toBe(404);
      await f.page.goto('about:blank');
      scenario.restore();
    }

    // An internal ancestor disappears while this Doc has an actual pending
    // native request. Only its unavailable branch clears; the still-readable
    // Space remains navigable and cancellation must retain the local draft.
    await f.page.goto(href(space.id, doc.id));
    await saved(f.page);
    const before = await nativeState(f.context, space.id, doc.id);
    const held = await holdNativeWrites(f.context);
    release = held.release;
    drain = held.drain;
    await focusDoc(f.page);
    await f.page.keyboard.type('Rescue this draft after external Trash.');
    await expect.poll(held.received).toBeGreaterThan(0);
    recovery.trash(f.owner.id, space.id, group.id);
    const status = f.page.getByRole('status', { name: 'Save status', exact: true });
    await expect(status).toContainText('Access changed', { timeout: 10_000 });
    await expect(
      f.page.getByRole('alert').filter({ hasText: 'This page is not available.' }),
    ).toHaveText('This page is not available. Copy unsaved changes before leaving.', {
      timeout: 10_000,
    });
    await expect(f.page.getByRole('region', { name: 'Doc document', exact: true })).toBeVisible();
    await expect(f.page.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
    await expect(f.page.locator('.editor-header .editor-access')).toHaveText('Access changed');
    await expect(
      f.page.getByRole('button', { name: `Rename ${doc.name}`, exact: true }),
    ).toHaveCount(0);
    expect(await copyDoc(f.page)).toBe('Rescue this draft after external Trash.');
    await expect(pageLink(f.page, space.id, available.id)).toBeVisible();
    for (const item of [group, doc, sheet])
      await expect(
        item.kind === 'folder'
          ? f.page.getByRole('button', { name: item.name, exact: true })
          : pageLink(f.page, space.id, item.id),
      ).toHaveCount(0);
    await cancelDeparture(f.page, () => pageLink(f.page, space.id, available.id).click());
    await expect(f.page).toHaveURL(f.origin + href(space.id, doc.id));
    expect((await f.context.request.get(`/api/spaces/${space.id}/items/${doc.id}`)).status()).toBe(
      404,
    );
    const inFlight = held.received();
    release();
    await expect.poll(held.returned).toBeGreaterThanOrEqual(inFlight);
    f.page.once('dialog', (dialog) => dialog.accept());
    await f.page.goto('about:blank');
    await held.drain();
    recovery.restore(f.owner.id, space.id, group.id);
    expect(nativeDocState(await nativeState(f.context, space.id, doc.id))).toEqual(
      nativeDocState(before),
    );
    expect(f.errors).toEqual([]);
  } finally {
    release();
    try {
      await drain();
    } finally {
      await f.close();
    }
  }
});
