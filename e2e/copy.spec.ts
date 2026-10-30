import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { APIResponse, Page, TestInfo } from '@playwright/test';
import {
  createParagraphId,
  createSectionId,
  DocumentFlavor,
  getDocsEmptySnapshot,
  LocaleType,
  validateDocumentStructure,
} from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import sharp from 'sharp';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { DocumentStore } from '../src/server/workspace/documents.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import type { WorkspaceItem } from '../src/shared/workspace.ts';
import { sheetImageFixture } from './sheet-image-fixture.ts';
import { syncNetwork } from './sync-network.ts';
import type { NativeWrite } from './sync-network.ts';

const saved = (page: Page) =>
  expect(page.getByRole('status', { name: 'Save status', exact: true })).toHaveText(
    'All changes saved.',
    { timeout: 30_000 },
  );

async function editCell(page: Page, address: string, text: string) {
  const box = page.locator('.univer-container [data-u-comp="defined-name"] input');
  await box.fill(address);
  await box.press('Enter');
  await page.keyboard.insertText(text);
  await page.keyboard.press('Enter');
}

async function openNativeCopy(page: Page, mobile = false, info?: TestInfo) {
  if (mobile) {
    // The actual native More control must remain reachable for a Doc viewer.
    await page.locator('.univer-container [data-u-comp="mobile-more-trigger"]').tap();
    const action = page
      .locator('[data-u-comp="mobile-more-menu"]')
      .getByRole('button', { name: 'Make a copy', exact: true });
    await expect(action).toBeVisible();
    if (info) await capture(page, info, 'native-doc-viewer-menu-phone', ['light']);
    await action.tap();
  } else {
    const toolbar = page.locator('.univer-container [data-u-comp="ribbon-toolbar"]');
    await expect(toolbar).toBeVisible();
    const inline = toolbar.getByRole('button', { name: 'Make a copy', exact: true });
    if (!(await inline.isVisible())) {
      // The pinned native classic ribbon collapses trailing items into this
      // dropdown at desktop widths. Its overflow trigger has no accessible name.
      const overflow = toolbar.locator(':scope > div > button[aria-haspopup="dialog"]');
      await expect(overflow).toHaveCount(1);
      await overflow.click();
    }
    const action = page.locator('[data-u-command="spinel.command.make-copy"]:visible');
    await expect(action).toHaveAccessibleName('Make a copy');
    await action.click();
  }
  const dialog = page.getByRole('dialog').filter({
    has: page.getByRole('form', { name: 'Make a copy', exact: true }),
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toBeVisible();
  return dialog;
}

async function capture(
  page: Page,
  info: TestInfo,
  name: string,
  themes: readonly ('light' | 'dark')[] = ['light', 'dark'],
) {
  if (process.env.SPINEL_CAPTURE_SCREENSHOTS !== '1') return;
  await mkdir('test-results/theme-screenshots', { recursive: true });
  for (const theme of themes) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `test-results/theme-screenshots/spn-065-${name}-${theme}-${info.project.name}.png`,
      animations: 'disabled',
    });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

const imageUrls = (snapshot: IWorkbookData) =>
  [
    ...new Set(
      JSON.stringify(snapshot).match(/\/api\/items\/[a-f0-9-]{36}\/images\/[a-f0-9]{64}/g) ?? [],
    ),
  ].sort();

async function imagePixels(page: Page) {
  const { data, info } = await sharp(await page.locator('.univer-container').screenshot())
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let orange = 0;
  for (let offset = 0; offset < data.length; offset += info.channels)
    if (data[offset] > 245 && Math.abs(data[offset + 1] - 153) < 10 && data[offset + 2] < 10)
      orange++;
  return orange;
}

async function dismissNativeCopyDrawer(page: Page) {
  const drawer = page.locator('[data-u-comp="mobile-dialog-drawer"]');
  await expect(drawer).toHaveAttribute('data-snap', 'expanded');
  const handle = drawer.getByRole('button', { name: 'Resize sidebar', exact: true });
  const bounds = (await handle.boundingBox())!;
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const endY = page.viewportSize()!.height - 8;
  const touch = await page.context().newCDPSession(page);
  try {
    // Complete one actual touch drag without browser fling inertia consuming
    // the next deliberate tap after the drawer unmounts on pointer release.
    await touch.send('Input.synthesizeScrollGesture', {
      x: start.x,
      y: start.y,
      yDistance: endY - start.y,
      gestureSourceType: 'touch',
      preventFling: true,
      speed: 800,
    });
  } finally {
    await touch.detach();
  }
  // The drawer coordinator hides a closing layer before its native content
  // unmounts. A new tap must wait until the old touch/focus layer is detached.
  await expect(drawer).toHaveCount(0);
  await expect(page.locator('[data-u-comp="mobile-dialog"]')).toHaveCount(0);
}

test('native Sheet copying waits for saved online content, keeps images, and edits an independent same-folder copy', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.setTimeout(150_000);
  page.setDefaultTimeout(10_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth);
  const owner = auth.createUser(`Copy budget owner ${info.testId}`);
  const reader = auth.createUser(`Copy budget reader ${info.testId}`);
  const folder = workspace.create(owner.id, {
    name: 'Monthly budgets',
    kind: 'folder',
    parentId: null,
  });
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: auth.createSession(owner.id).token,
      url: baseURL!.replace('http:', 'https:'),
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  const network = await syncNetwork(context);
  const errors: string[] = [];
  const copyPosts: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/copy'))
      copyPosts.push(request.url());
  });
  const held: NativeWrite[] = [];
  let stage = 'import source';
  let failureUI: string | undefined;
  const read = async (id: string) => {
    const response = await context.request.get(`/api/items/${id}/sheet`);
    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()) as { revision: number; snapshot: IWorkbookData };
  };
  try {
    const imported = await context.request.post('/api/items/import', {
      headers: { Origin: baseURL! },
      data: {
        filename: 'October budget.univer.json',
        parentId: folder.id,
        snapshot: { ...(await sheetImageFixture()), name: 'October budget' },
      },
    });
    expect(imported.status(), await imported.text()).toBe(201);
    const { item: source } = (await imported.json()) as { item: WorkspaceItem };
    let publishedCopy: { status: number; body: string; item: WorkspaceItem } | undefined;
    await page.route(`**/api/items/${source.id}/copy`, async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      publishedCopy = { status: response.status(), body, item: JSON.parse(body).item };
      // Capture the actual server response before automatic navigation discards
      // Chromium's network response body. The request still publishes only once.
      await route.fulfill({ response, body });
    });
    workspace.share(owner.id, source.id, reader.id, 'viewer');
    const link = workspace.links.begin(source.id, 'viewer');
    workspace.links.finish(source.id, link.epoch, true);
    await page.goto(`/?item=${source.id}`);
    await saved(page);
    await expect.poll(() => imagePixels(page), { timeout: 20_000 }).toBeGreaterThan(1000);
    await editCell(page, 'D1', 'October source 314');
    await saved(page);

    stage = 'pending native mutation blocks copying';
    network.interceptWrites((write) => {
      held.push(write);
    });
    await editCell(page, 'E1', 'Awaiting acknowledgment 628');
    await expect.poll(() => held.length).toBeGreaterThan(0);
    const dialog = await openNativeCopy(page);
    const submit = dialog.getByRole('button', { name: 'Make a copy', exact: true });
    await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'October budget (copy)',
    );
    await expect(dialog.getByRole('combobox', { name: 'Folder', exact: true })).toHaveValue(
      folder.id,
    );
    await expect(submit).toBeDisabled();
    expect(copyPosts).toHaveLength(0);
    await network.drainWrites();
    network.interceptWrites(undefined);
    for (const write of held.splice(0)) expect(write.forward()).toBe(true);
    await saved(page);
    await expect(submit).toBeEnabled();

    stage = 'offline copy refusal and reconnection';
    await network.setOffline(true);
    await expect(page.getByRole('status', { name: 'Connection status', exact: true })).toHaveText(
      'Offline',
    );
    await expect(submit).toBeDisabled();
    expect(copyPosts).toHaveLength(0);
    await network.setOffline(false);
    await saved(page);
    await expect(submit).toBeEnabled();
    const before = await read(source.id);
    const sourceSheet = before.snapshot.sheets[before.snapshot.sheetOrder[0]];
    expect(sourceSheet.cellData?.[0]?.[3]?.v).toBe('October source 314');
    expect(sourceSheet.cellData?.[0]?.[4]?.v).toBe('Awaiting acknowledgment 628');
    await capture(page, info, 'native-sheet-dialog-desktop');

    stage = 'publish and open copy';
    const response = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/items/${source.id}/copy`,
    );
    await submit.click();
    const created = await response;
    expect(created.status(), publishedCopy?.body).toBe(201);
    expect(publishedCopy?.status).toBe(201);
    const copy = publishedCopy!.item;
    expect(copy.id).not.toBe(source.id);
    expect(copy).toMatchObject({
      name: 'October budget (copy)',
      parentId: folder.id,
      access: 'owner',
    });
    await expect(page).toHaveURL(new RegExp(`item=${copy.id}$`));
    await saved(page);
    const copied = await read(copy.id);
    expect(copied.snapshot.id).not.toBe(before.snapshot.id);
    const copiedImages = imageUrls(copied.snapshot);
    const sourceImages = imageUrls(before.snapshot);
    expect(sourceImages).toHaveLength(3);
    expect(copiedImages).toEqual(
      sourceImages.map((url) => url.replace(`/items/${source.id}/`, `/items/${copy.id}/`)).sort(),
    );
    for (const url of copiedImages) {
      const copiedImage = await context.request.get(url);
      const sourceImage = await context.request.get(
        url.replace(`/items/${copy.id}/`, `/items/${source.id}/`),
      );
      expect(copiedImage.status()).toBe(200);
      expect(await copiedImage.body()).toEqual(await sourceImage.body());
    }
    await expect.poll(() => imagePixels(page), { timeout: 20_000 }).toBeGreaterThan(1000);
    expect(() => workspace.get(reader.id, copy.id)).toThrow('This item is not available.');
    expect(workspace.links.metadata(copy.id).enabled).toBe(false);

    stage = 'independent native edit';
    await editCell(page, 'D1', 'November copy 271');
    await saved(page);
    await expect
      .poll(async () => {
        const { snapshot } = await read(copy.id);
        return snapshot.sheets[snapshot.sheetOrder[0]].cellData?.[0]?.[3]?.v;
      })
      .toBe('November copy 271');
    expect(await read(source.id)).toEqual(before);
    expect(copyPosts).toHaveLength(1);
    expect(errors).toEqual([]);
    stage = 'completed';
  } catch (error) {
    await Promise.allSettled([
      page.screenshot({ path: info.outputPath('test-failed-native-copy.png'), timeout: 5_000 }),
      page
        .locator('body')
        .ariaSnapshot({ timeout: 5_000 })
        .then((snapshot) => {
          failureUI = snapshot;
        }),
    ]);
    throw error;
  } finally {
    network.interceptWrites(undefined);
    for (const write of held.splice(0)) write.forward();
    await network.setOffline(false);
    await writeFile(
      info.outputPath('sync-diagnostics.json'),
      JSON.stringify({
        stage,
        errors,
        copyPosts,
        failureUI,
        outgoing: network.outgoing,
        incoming: network.incoming,
      }),
    );
    await page.goto('/sign-in').catch(() => {});
    db.close();
  }
});

test('a phone Doc viewer retains a copy after dismissing its busy native drawer and losing source access', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db);
  const workspace = new WorkspaceStore(auth);
  const owner = auth.createUser(`Recipe owner ${info.testId}`);
  const viewer = auth.createUser(`Recipe viewer ${info.testId}`);
  const other = auth.createUser(`Recipe other reader ${info.testId}`);
  const folder = workspace.create(owner.id, {
    name: 'Private recipes',
    kind: 'folder',
    parentId: null,
  });
  const source = workspace.create(owner.id, {
    name: 'Shared recipe',
    kind: 'doc',
    parentId: folder.id,
  });
  const text = 'A recipe shared with a viewer. Keep this editable text in an independent copy.';
  const snapshot = getDocsEmptySnapshot(
    source.id,
    LocaleType.EN_US,
    source.name,
    DocumentFlavor.MODERN,
  );
  snapshot.body = {
    ...snapshot.body,
    dataStream: `${text}\r\n`,
    paragraphs: [{ startIndex: text.length, paragraphId: createParagraphId(new Set()) }],
    sectionBreaks: [{ startIndex: text.length + 1, sectionId: createSectionId(new Set()) }],
  };
  expect(validateDocumentStructure(snapshot)).toEqual([]);
  new DocumentStore(workspace).save(owner.id, source.id, {
    snapshot,
    revision: 0,
    writeId: randomUUID(),
  });
  workspace.share(owner.id, source.id, viewer.id, 'viewer');
  workspace.share(owner.id, source.id, other.id, 'editor');
  const link = workspace.links.begin(source.id, 'viewer');
  workspace.links.finish(source.id, link.epoch, true);
  const phone = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  await phone.addCookies([
    {
      name: COOKIE_NAME,
      value: auth.createSession(viewer.id).token,
      url: baseURL!.replace('http:', 'https:'),
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  const page = await phone.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let copyPosts = 0;
  let publishedResponse: APIResponse | undefined;
  let releaseCopy = () => {};
  const heldResponse = new Promise<void>((resolve) => {
    releaseCopy = resolve;
  });
  await page.route(`**/api/items/${source.id}/copy`, async (route) => {
    copyPosts++;
    // The real server publishes once. Delay only delivery of that successful
    // response so the native drawer can unmount while the request is pending.
    const response = await route.fetch();
    publishedResponse = response;
    await heldResponse;
    await route.fulfill({ response });
  });
  try {
    await page.goto(`/?item=${source.id}`);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    await expect(page.getByRole('status', { name: 'Save status', exact: true })).toHaveText(
      'View only — reload after your access changes.',
      { timeout: 30_000 },
    );
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    const dialog = await openNativeCopy(page, true, info);
    await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'Shared recipe (copy)',
    );
    await expect(dialog.getByRole('combobox', { name: 'Folder', exact: true })).toHaveValue('');
    await expect(dialog).not.toContainText(folder.name);
    const submit = dialog.getByRole('button', { name: 'Make a copy', exact: true });
    await expect(submit).toBeEnabled();
    await capture(page, info, 'native-doc-viewer-dialog-phone');
    await submit.tap();
    await expect.poll(() => publishedResponse?.status()).toBe(201);
    const { item: copy } = (await publishedResponse!.json()) as { item: WorkspaceItem };
    await expect(
      dialog.getByRole('button', { name: 'Making a copy…', exact: true }),
    ).toBeDisabled();
    expect(workspace.fileOwner(copy.id)).toBe(viewer.id);
    await dismissNativeCopyDrawer(page);
    await expect(page).toHaveURL(new RegExp(`item=${source.id}$`));
    const nativeMore = page.locator('.univer-container [data-u-comp="mobile-more-trigger"]');
    await expect(nativeMore).toHaveAttribute('aria-expanded', 'false');
    await nativeMore.tap();
    await expect(nativeMore).toHaveAttribute('aria-expanded', 'true');
    const copyMenu = page
      .locator('[data-u-comp="mobile-more-menu"]')
      .getByRole('button', { name: 'Make a copy', exact: true });
    await expect(copyMenu).toBeDisabled();
    expect(copyPosts).toBe(1);
    const delivered = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/items/${source.id}/copy`,
    );
    releaseCopy();
    const created = await delivered;
    expect(created.status(), await publishedResponse!.text()).toBe(201);
    await expect(page.getByText(`Created ${copy.name}.`, { exact: true })).toBeVisible();
    await expect(copyMenu).toBeEnabled();
    // Dismissal cannot silently navigate or turn another tap into a second copy.
    await expect(page).toHaveURL(new RegExp(`item=${source.id}$`));
    await copyMenu.tap();
    const result = page.getByRole('dialog').filter({
      has: page.getByRole('form', { name: 'Make a copy', exact: true }),
    });
    await expect(result.getByRole('status')).toHaveText(`Created ${copy.name}.`);
    await expect(result.getByRole('textbox', { name: 'Name', exact: true })).toHaveCount(0);
    expect(copyPosts).toBe(1);
    expect(workspace.list(viewer.id).filter((item) => item.name === copy.name)).toHaveLength(1);
    await capture(page, info, 'native-doc-copy-result-phone');
    expect(copy).toMatchObject({ name: 'Shared recipe (copy)', parentId: null, access: 'owner' });
    expect(copy.id).not.toBe(source.id);
    expect(workspace.fileOwner(copy.id)).toBe(viewer.id);
    for (const account of [owner, other])
      expect(() => workspace.get(account.id, copy.id)).toThrow('This item is not available.');
    expect(workspace.links.metadata(copy.id).enabled).toBe(false);
    await result.getByRole('button', { name: 'Open copy', exact: true }).tap();
    await expect(page).toHaveURL(new RegExp(`item=${copy.id}$`));
    await saved(page);

    workspace.share(owner.id, source.id, viewer.id, null);
    expect((await phone.request.get(`/api/items/${source.id}/doc`)).status()).toBe(404);
    await page.reload();
    await saved(page);
    const copied = await phone.request.get(`/api/items/${copy.id}/doc`);
    expect(copied.status(), await copied.text()).toBe(200);
    const body = (await copied.json()) as { snapshot: IDocumentData };
    expect(body.snapshot.body?.dataStream).toBe(`${text}\r\n`);
    expect(body.snapshot.id).not.toBe(snapshot.id);
    expect(errors).toEqual([]);
  } catch (error) {
    await Promise.allSettled([
      page.screenshot({ path: info.outputPath('test-failed-native-copy.png'), timeout: 5_000 }),
      page
        .locator('body')
        .ariaSnapshot({ timeout: 5_000 })
        .then((snapshot) =>
          writeFile(
            info.outputPath('sync-diagnostics.json'),
            JSON.stringify({ errors, copyPosts, sourceId: source.id, failureUI: snapshot }),
          ),
        ),
    ]);
    throw error;
  } finally {
    releaseCopy();
    await page.unrouteAll({ behavior: 'wait' });
    await phone.close();
    db.close();
  }
});
