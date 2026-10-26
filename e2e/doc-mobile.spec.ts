import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Locator, Page, TestInfo } from '@playwright/test';
import { getDocsEmptySnapshot, NamedStyleType } from '@univerjs/core';
import type { ICustomRange, IDocumentData } from '@univerjs/core';
import { formulaBody } from '@spinel/doc-formulas';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { DocumentStore } from '../src/server/workspace/documents.ts';

type Paint = {
  canvas: HTMLCanvasElement;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const tableExpression = `={${Array.from({ length: 30 }, (_, row) => `${row + 1},${row + 101},${row + 201}`).join(';')}}`;
const saved = (page: Page) =>
  expect(page.getByRole('status', { name: 'Save status' })).toHaveText('All changes saved.', {
    timeout: 30_000,
  });
const input = (page: Page) => page.locator('[contenteditable="true"][data-u-comp="editor"]');

// Observe real canvas output without adding an editor reference or a mutation
// endpoint to the app. Coordinates are used only to touch actually painted text.
async function recordPaint(context: BrowserContext) {
  await context.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    const paints: Paint[] = [];
    Object.assign(window, { docMobilePaints: paints });
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      const transform = this.getTransform();
      const metrics = this.measureText(text);
      paints.push({
        canvas: this.canvas,
        text,
        x: transform.a * x + transform.c * y + transform.e,
        y: transform.b * x + transform.d * y + transform.f,
        width: metrics.width * Math.hypot(transform.a, transform.b),
        height:
          (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) *
          Math.hypot(transform.c, transform.d),
      });
      if (paints.length > 20_000) paints.splice(0, 10_000);
      return original.call(this, text, x, y, maxWidth);
    };
  });
}

async function textPoint(page: Page, first = 'P') {
  const read = () =>
    page.evaluate((first) => {
      const paints = (window as unknown as { docMobilePaints: Paint[] }).docMobilePaints;
      for (const paint of [...paints].reverse()) {
        if (
          !paint.canvas.isConnected ||
          paint.canvas.getAttribute('aria-label') !== 'Document canvas' ||
          !paint.text.startsWith(first)
        )
          continue;
        const box = paint.canvas.getBoundingClientRect();
        const x =
          box.x + ((paint.x + Math.min(paint.width * 0.15, 2)) / paint.canvas.width) * box.width;
        const y = box.y + ((paint.y - paint.height / 2) / paint.canvas.height) * box.height;
        if (
          x >= box.left &&
          x < box.right &&
          y >= box.top &&
          y < box.bottom &&
          document.elementFromPoint(x, y) === paint.canvas
        )
          return { x, y };
      }
      return null;
    }, first);
  await expect.poll(read).not.toBeNull();
  return (await read())!;
}

async function beginWriting(page: Page) {
  const point = await textPoint(page);
  await page.touchscreen.tap(point.x, point.y);
  await page.touchscreen.tap(point.x, point.y);
  await expect(input(page)).toBeFocused();
}

// Chromium desktop automation does not open an OS keyboard. Drive the browser
// visual-viewport event contract explicitly; physical iOS/Android checks remain
// separate. This exercises the native toolbar response, not an actual keyboard.
async function keyboardOcclusion(page: Page, height: number) {
  await page.evaluate((height) => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error('Visual viewport is unavailable.');
    Reflect.deleteProperty(viewport, 'height');
    const available = viewport.height;
    if (height)
      Object.defineProperty(viewport, 'height', {
        configurable: true,
        get: () => available - height,
      });
    viewport.dispatchEvent(new Event('resize'));
  }, height);
}

async function capture(page: Page, info: TestInfo, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir('test-results/theme-screenshots', { recursive: true });
  await page.screenshot({
    path: `test-results/theme-screenshots/spn-072-${name}-${info.project.name}.png`,
    fullPage: true,
    animations: 'disabled',
  });
}

async function touchTargets(target: Locator) {
  for (const button of await target.getByRole('button').all()) {
    if (!(await button.isVisible())) continue;
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
}

async function fixture(browser: Browser, baseURL: string, info: TestInfo, formulas = false) {
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Private mobile Doc owner');
  const item = workspace.create(owner.id, {
    name: 'Phone journal',
    kind: 'doc',
    parentId: null,
  });
  const snapshot = getDocsEmptySnapshot(item.id);
  const paragraphs = [
    'Phone journal',
    'A readable phone paragraph wraps onto several lines without shrinking its letters. ' +
      'Keep this whole sentence and the original saved page geometry when the screen rotates.',
    'Another paragraph keeps native touch navigation, selection and saved text observable.',
    'Final line.',
  ];
  let stream = paragraphs.join('\r') + '\r';
  const ranges: ICustomRange[] = [];
  if (formulas)
    for (const [id, expression] of [
      ['scalar', '=40+2'],
      ['table', tableExpression],
    ] as const) {
      const body = formulaBody(id, { version: 1, expression, references: [] });
      ranges.push(
        ...body.customRanges!.map((range) => ({
          ...range,
          startIndex: range.startIndex + stream.length,
          endIndex: range.endIndex + stream.length,
        })),
      );
      stream += expression + '\r';
    }
  snapshot.body = {
    ...snapshot.body,
    dataStream: stream + '\n',
    customRanges: ranges,
    paragraphs: Array.from(stream.matchAll(/\r/g), (match, index) => ({
      startIndex: match.index!,
      paragraphId: `phone-paragraph-${index}`,
    })),
    sectionBreaks: [{ startIndex: stream.length, sectionId: 'phone-section' }],
  };
  new DocumentStore(workspace).save(owner.id, item.id, {
    snapshot,
    revision: 0,
    writeId: crypto.randomUUID(),
  });
  const contexts: BrowserContext[] = [];
  const phone = async (account = false) => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      ignoreHTTPSErrors: true,
      colorScheme: 'light',
      reducedMotion: 'reduce',
    });
    contexts.push(context);
    if (account)
      await context.addCookies([
        {
          name: COOKIE_NAME,
          value: auth.createSession(owner.id).token,
          url: baseURL.replace('http:', 'https:'),
          secure: true,
          httpOnly: true,
          sameSite: 'Strict',
        },
      ]);
    await recordPaint(context);
    return context;
  };
  const account = await phone(true),
    page = await account.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const read = async () => {
    const response = await account.request.get(`/api/items/${item.id}/doc`);
    expect(response.ok()).toBe(true);
    return (await response.json()).snapshot as IDocumentData;
  };
  return {
    account,
    page,
    item,
    owner,
    errors,
    read,
    phone,
    async close() {
      for (const context of contexts) await context.close();
      db.close();
    },
  };
}

test('phone Docs keep native mobile layout while rotating, writing, formatting and saving', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(150_000);
  const f = await fixture(browser, baseURL!, info);
  const { page } = f;
  try {
    await page.goto(`/?item=${f.item.id}`);
    await saved(page);
    const region = page.getByRole('region', { name: 'Doc document', exact: true });
    await expect(region).toHaveAttribute('data-mobile', 'true');
    const canvas = region.getByLabel('Document canvas', { exact: true });
    await expect(canvas).toBeVisible();
    const mounted = (await canvas.elementHandle())!;
    const original = await f.read();
    expect(original.body!.dataStream).toContain('A readable phone paragraph');
    await textPoint(page);
    await capture(page, info, 'reading-light');
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(region).toHaveAttribute('data-mobile', 'true');
    expect(await mounted.evaluate((node) => node.isConnected)).toBe(true);
    await capture(page, info, 'reading-landscape');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await textPoint(page);
    await capture(page, info, 'reading-dark');
    const rotated = await f.read();
    expect(rotated.body).toEqual(original.body);
    expect(rotated.documentStyle).toEqual(original.documentStyle);
    expect(rotated.settings).toEqual(original.settings);
    await page.emulateMedia({ colorScheme: 'light' });
    await beginWriting(page);
    await keyboardOcclusion(page, 320);
    const format = page.getByRole('button', { name: 'Format', exact: true });
    await expect(format).toBeVisible();
    await format.tap();
    const drawer = page.locator('[data-u-comp="mobile-doc-toolbar-drawer"]');
    await expect(drawer).toBeVisible();
    await page.getByRole('button', { name: 'Bold', exact: true }).tap();
    await page.getByRole('button', { name: 'Show keyboard', exact: true }).tap();
    await expect(input(page)).toBeFocused();
    await page.keyboard.type('Mobile ');
    await saved(page);
    await expect.poll(async () => (await f.read()).body!.dataStream).toContain('Mobile ');
    const bold = await f.read();
    expect(bold.body!.dataStream.replace('Mobile ', '')).toBe(original.body!.dataStream);
    expect(
      bold.body!.textRuns!.some(
        (run) => run.ts?.bl === 1 && bold.body!.dataStream.slice(run.st, run.ed).includes('Mobile'),
      ),
    ).toBe(true);
    await page.getByRole('button', { name: 'Heading', exact: true }).tap();
    await page.getByText('Heading 1', { exact: true }).tap();
    await saved(page);
    await expect
      .poll(async () => (await f.read()).body!.paragraphs![0]!.paragraphStyle?.namedStyleType)
      .toBe(NamedStyleType.HEADING_1);
    await capture(page, info, 'writing-toolbar');
    await keyboardOcclusion(page, 0);
    const written = await f.read();
    expect(written.documentStyle).toEqual(original.documentStyle);
    expect(written.settings).toEqual(original.settings);
    await page.reload();
    await saved(page);
    await expect(region).toHaveAttribute('data-mobile', 'true');
    const reloaded = await f.read();
    expect(reloaded.body).toEqual(written.body);
    expect(reloaded.documentStyle).toEqual(original.documentStyle);
    expect(reloaded.settings).toEqual(original.settings);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('phone Doc formulas preserve scalar values, all table rows and usable edit dialogs', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(150_000);
  const f = await fixture(browser, baseURL!, info, true);
  const { page } = f;
  const panel = page.getByRole('dialog', { name: 'Formulas', exact: true });
  const openPanel = async () => {
    await page.getByRole('button', { name: 'Document actions', exact: true }).tap();
    await page.getByRole('menuitem', { name: 'Formulas', exact: true }).tap();
    await expect(panel.locator('output')).toHaveText('42', { timeout: 20_000 });
    await expect(panel.locator('tbody tr')).toHaveCount(30);
    await expect(panel.locator('tbody tr').last()).toHaveText('30130230');
  };
  try {
    await page.goto(`/?item=${f.item.id}`);
    await saved(page);
    await expect(page.getByRole('region', { name: 'Doc document', exact: true })).toHaveAttribute(
      'data-mobile',
      'true',
    );
    const original = await f.read();
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await openPanel();
      await touchTargets(panel);
      expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await capture(page, info, `formulas-${theme}`);
      await panel.getByRole('button', { name: '=40+2', exact: true }).tap();
      const dialog = page.getByRole('dialog', { name: 'Edit formula', exact: true });
      await expect(dialog.getByLabel('Formula', { exact: true })).toHaveValue('=40+2');
      await touchTargets(dialog);
      await capture(page, info, `formula-edit-${theme}`);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap();
      await expect(dialog).not.toBeVisible();
    }
    expect((await f.read()).body).toEqual(original.body);
    await beginWriting(page);
    await page.getByRole('button', { name: 'Document actions', exact: true }).tap();
    await page.getByRole('menuitem', { name: 'Insert formula', exact: true }).tap();
    const insert = page.getByRole('dialog', { name: 'Insert formula', exact: true });
    await insert.getByLabel('Formula', { exact: true }).fill('=20+3');
    await touchTargets(insert);
    await capture(page, info, 'formula-insert');
    await insert.getByRole('button', { name: 'Insert formula', exact: true }).tap();
    await expect(insert).not.toBeVisible({ timeout: 20_000 });
    await saved(page);
    await expect.poll(async () => (await f.read()).body!.customRanges!.length).toBe(3);
    const changed = await f.read();
    expect(changed.body!.dataStream).toContain('=20+3');
    expect(changed.documentStyle).toEqual(original.documentStyle);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('phone guest Doc reader cannot write and loses its document when the link is revoked', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const f = await fixture(browser, baseURL!, info, true);
  try {
    await f.page.goto(`/?item=${f.item.id}`);
    await saved(f.page);
    const original = await f.read();
    const link = await f.account.request.put(`/api/items/${f.item.id}/link`, {
      headers: { Origin: baseURL! },
      data: { role: 'viewer' },
    });
    expect(link.ok()).toBe(true);
    await f.page.close();
    const guest = await f.phone(),
      page = await guest.newPage();
    page.on('pageerror', (error) => f.errors.push(error.message));
    await page.goto((await link.json()).url);
    const region = page.getByRole('region', { name: 'Doc document', exact: true });
    await expect(region).toHaveAttribute('data-mobile', 'true');
    await expect(page.getByRole('status', { name: 'Save status' })).toContainText('View only', {
      timeout: 30_000,
    });
    await expect(region.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Insert formula', exact: true })).toHaveCount(0);
    const point = await textPoint(page);
    for (let tap = 0; tap < 2; tap++) await page.touchscreen.tap(point.x, point.y);
    await page.keyboard.type('FORBIDDEN PHONE EDIT');
    await expect(page.getByRole('status', { name: 'Save status' })).toContainText('View only');
    await page.getByRole('button', { name: 'Formulas', exact: true }).tap();
    const panel = page.getByRole('dialog', { name: 'Formulas', exact: true });
    await expect(panel.locator('output')).toHaveText('42', { timeout: 20_000 });
    await expect(panel.locator('tbody tr')).toHaveCount(30);
    await expect(panel.getByRole('button', { name: '=40+2', exact: true })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Close dialog', exact: true }).tap();
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await capture(page, info, `guest-reader-${theme}`);
    }
    const unchanged = await f.read();
    expect(unchanged.body).toEqual(original.body);
    expect(unchanged.documentStyle).toEqual(original.documentStyle);
    expect(unchanged.settings).toEqual(original.settings);
    for (const name of ['Document actions', 'Versions', 'My files'])
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Your profile', exact: true })).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain(f.owner.name);
    expect((await guest.request.get('/api/items')).status()).toBe(401);
    const revoked = await f.account.request.put(`/api/items/${f.item.id}/link`, {
      headers: { Origin: baseURL! },
      data: { role: null },
    });
    expect(revoked.ok()).toBe(true);
    await expect(page.getByText('This link no longer works.', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(region).toHaveCount(0);
    await expect(page.getByText(f.item.name, { exact: true })).toHaveCount(0);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});
