import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Locator, Page, TestInfo } from '@playwright/test';
import {
  createParagraphId,
  createSectionId,
  DocumentFlavor,
  getDocsEmptySnapshot,
  LocaleType,
  NamedStyleType,
  PresetListType,
  validateDocumentStructure,
} from '@univerjs/core';
import type { ICustomRange, IDocumentData } from '@univerjs/core';
import { formulaBody } from '@spinel/doc-formulas';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { DocumentStore } from '../src/server/workspace/documents.ts';
import { recordNativeSnapshots } from './sync-snapshot.ts';

const tableExpression = `={${Array.from({ length: 30 }, (_, row) => `${row + 1},${row + 101},${row + 201}`).join(';')}}`;
const saved = (page: Page) =>
  expect(page.getByRole('status', { name: 'Save status' })).toHaveText('All changes saved.', {
    timeout: 30_000,
  });
const input = (page: Page) => page.locator('[contenteditable="true"][data-u-comp="editor"]');

interface DocSelectionEvidence {
  unitId: string;
  start?: number;
  end?: number;
  hasAnchor: boolean;
  editing: boolean;
  bounds?: { left: number; right: number; top: number; bottom: number };
  scroll: number;
  text: string;
}

// The renderer caches glyphs on offscreen canvases, so fillText interception
// cannot locate their final screen positions. Find the first real text line in
// the visible raster instead. The fixture starts with "Phone journal"; its
// neutral, high-contrast ink identifies the document text.
async function textPoint(page: Page) {
  const canvas = page
    .getByRole('region', { name: 'Doc document', exact: true })
    .getByLabel('Document canvas', { exact: true });
  const read = async () => {
    const box = await canvas.boundingBox();
    if (!box || box.width <= 0 || box.height <= 0) return null;
    const { data, info } = await sharp(await canvas.screenshot())
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let light = 0,
      dark = 0;
    for (let y = 8; y < info.height - 8; y += 8)
      for (let x = 8; x < info.width - 8; x += 8) {
        const at = (y * info.width + x) * info.channels;
        const value = (data[at]! + data[at + 1]! + data[at + 2]!) / 3;
        if (value > 192) light++;
        if (value < 64) dark++;
      }
    const darkPaper = dark > light;
    const ink = (x: number, y: number) => {
      const at = (y * info.width + x) * info.channels;
      const low = Math.min(data[at]!, data[at + 1]!, data[at + 2]!);
      const high = Math.max(data[at]!, data[at + 1]!, data[at + 2]!);
      return high - low < 60 && (darkPaper ? low > 170 : high < 115);
    };
    const inset = Math.max(8, Math.round((info.width / box.width) * 8));
    const bottom = Math.min(info.height - inset, Math.floor(info.height * 0.65));
    for (let y = inset; y < bottom; y++) {
      const top = y;
      let pixels = 0,
        left = info.width,
        right = -1;
      while (y < bottom) {
        let rowPixels = 0;
        for (let x = inset; x < info.width - inset; x++)
          if (ink(x, y)) {
            rowPixels++;
            left = Math.min(left, x);
            right = Math.max(right, x);
          }
        if (rowPixels < 2) break;
        pixels += rowPixels;
        y++;
      }
      // Reject a border, a blinking caret or a few incidental antialiased pixels.
      const lineHeight = y - top;
      if (lineHeight < 4 || pixels < 24 || right - left < 12) continue;
      let glyphRight = left;
      while (glyphRight <= right) {
        let occupied = false;
        for (let row = top; row < y; row++) occupied ||= ink(glyphRight, row);
        if (!occupied) break;
        glyphRight++;
      }
      if (glyphRight - left < 2) continue;
      const point = {
        // The leading edge of P selects the start of the first paragraph.
        x: box.x + ((left + 0.2) / info.width) * box.width,
        y: box.y + ((top + lineHeight / 2) / info.height) * box.height,
      };
      const hit = await canvas.evaluate((node, point) => {
        const target = document.elementFromPoint(point.x, point.y);
        // Native layers may use a sibling interaction canvas above the paint.
        return target === node || Boolean(target && node.parentElement?.contains(target));
      }, point);
      if (hit)
        return {
          ...point,
          centerX: box.x + ((left + glyphRight) / 2 / info.width) * box.width,
          glyphWidth: glyphRight - left,
          lineHeight,
          pixels,
        };
    }
    return null;
  };
  await expect.poll(read).not.toBeNull();
  const point = (await read())!;
  expect(point.glyphWidth).toBeGreaterThanOrEqual(2);
  expect(point.lineHeight).toBeGreaterThanOrEqual(4);
  expect(point.pixels).toBeGreaterThanOrEqual(24);
  return point;
}

async function beginWriting(page: Page) {
  const point = await textPoint(page);
  await page.touchscreen.tap(point.x, point.y);
  await page.touchscreen.tap(point.x, point.y);
  await expect(input(page)).toBeFocused();
}

async function selectFirstWord(page: Page) {
  const point = await textPoint(page);
  const touch = await page.context().newCDPSession(page);
  try {
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: point.centerX, y: point.y }],
    });
    // A genuine held touch crosses the native long-press threshold; do not
    // substitute a programmatic text range for this selection interaction.
    await page.waitForTimeout(650);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await touch.detach();
  }
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

async function fixture(
  browser: Browser,
  baseURL: string,
  info: TestInfo,
  formulas = false,
  flavor = DocumentFlavor.MODERN,
  zoomRatio = 1,
) {
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Private mobile Doc owner');
  const item = workspace.create(owner.id, {
    name: 'Phone journal',
    kind: 'doc',
    parentId: null,
  });
  const snapshot = getDocsEmptySnapshot(item.id, LocaleType.EN_US, item.name, flavor);
  snapshot.settings = { ...snapshot.settings, zoomRatio };
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
  const paragraphIds = new Set<string>();
  snapshot.body = {
    ...snapshot.body,
    dataStream: stream + '\n',
    customRanges: ranges,
    paragraphs: Array.from(stream.matchAll(/\r/g), (match) => ({
      startIndex: match.index!,
      paragraphId: createParagraphId(paragraphIds),
    })),
    sectionBreaks: [{ startIndex: stream.length, sectionId: createSectionId(new Set()) }],
  };
  // Import accepts some malformed fixtures that fail only when the first edit
  // reaches native mutation validation. Fail at setup with the actual issues.
  expect(validateDocumentStructure(snapshot)).toEqual([]);
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
    await recordNativeSnapshots(context);
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
    return context;
  };
  const account = await phone(true),
    page = await account.newPage();
  const errors: string[] = [];
  const diagnostics: unknown[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) =>
    diagnostics.push({
      path: new URL(request.url()).pathname,
      failure: request.failure()?.errorText,
    }),
  );
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push({ console: message.text().slice(0, 800) });
  });
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      try {
        const frame = JSON.parse(String(payload));
        if (['ack', 'edit', 'resume', 'resync'].includes(frame.type))
          diagnostics.push({ received: JSON.stringify(frame).slice(0, 6000) });
      } catch {
        // Other sockets may use binary payloads.
      }
    });
    socket.on('framesent', ({ payload }) => {
      try {
        const frame = JSON.parse(String(payload));
        // Observe native persistence traffic, excluding authentication frames.
        if (frame.type === 'submit' || frame.type === 'verify')
          diagnostics.push({ sent: JSON.stringify(frame).slice(0, 6000) });
      } catch {
        // Other sockets may use binary payloads.
      }
    });
    socket.on('socketerror', (error) => diagnostics.push({ socketError: error }));
  });
  page.on('response', async (response) => {
    if (response.status() < 400) return;
    const path = new URL(response.url()).pathname;
    diagnostics.push({
      path,
      status: response.status(),
      body: (await response.text().catch(() => '')).slice(0, 1000),
    });
  });
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
      const observed = await Promise.allSettled(
        contexts
          .flatMap((context) => context.pages())
          .map((target) =>
            target.evaluate(() => ({
              save: document.querySelector('[role="status"][aria-label="Save status"]')
                ?.textContent,
              connection: document.querySelector('[role="status"][aria-label="Connection status"]')
                ?.textContent,
              native: (window as Window & { nativeSyncEvidence?: unknown }).nativeSyncEvidence,
            })),
          ),
      );
      const persisted = await read().catch((error) => ({ error: String(error) }));
      await writeFile(
        info.outputPath('sync-diagnostics.json'),
        JSON.stringify({ errors, diagnostics, observed, persisted }, null, 2),
      );
      for (const context of contexts) await context.close();
      db.close();
    },
  };
}

for (const zoomRatio of [1, 0.5, 2])
  test(`phone Docs at saved ${zoomRatio * 100}% zoom keep readable layout, touch formatting and saved settings`, async ({
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(150_000);
    const f = await fixture(browser, baseURL!, info, false, DocumentFlavor.MODERN, zoomRatio);
    const { page } = f;
    try {
      const original = await f.read();
      await page.goto(`/?item=${f.item.id}`);
      await saved(page);
      await expect(page.getByRole('status', { name: 'Connection status', exact: true })).toHaveText(
        'Online',
        { timeout: 30_000 },
      );
      const region = page.getByRole('region', { name: 'Doc document', exact: true });
      await expect(region).toHaveAttribute('data-mobile', 'true');
      const canvas = region.getByLabel('Document canvas', { exact: true });
      await expect(canvas).toBeVisible();
      const mounted = (await canvas.elementHandle())!;
      const opened = await f.read();
      expect(opened.body).toEqual(original.body);
      expect(opened.documentStyle).toEqual(original.documentStyle);
      expect(opened.settings).toEqual(original.settings);
      expect(original.body!.dataStream).toContain('A readable phone paragraph');
      await textPoint(page);
      await capture(page, info, `reading-light-zoom-${zoomRatio}`);
      await page.setViewportSize({ width: 844, height: 390 });
      await expect(region).toHaveAttribute('data-mobile', 'true');
      expect(await mounted.evaluate((node) => node.isConnected)).toBe(true);
      await capture(page, info, `reading-landscape-zoom-${zoomRatio}`);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await textPoint(page);
      await capture(page, info, `reading-dark-zoom-${zoomRatio}`);
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
      await expect(input(page)).not.toBeFocused();
      // Native drawers blur the input and await the OS viewport expansion to
      // finish their keyboard-hidden transition. Emulate both halves of it.
      await keyboardOcclusion(page, 0);
      await page.getByRole('button', { name: 'Bold', exact: true }).tap();
      await page.getByRole('button', { name: 'Show keyboard', exact: true }).tap();
      await expect(drawer).not.toBeVisible();
      await expect(input(page)).toBeFocused();
      await keyboardOcclusion(page, 320);
      const hideKeyboard = region.getByRole('button', { name: 'Hide keyboard', exact: true });
      await expect(hideKeyboard).toBeVisible();
      await expect(async () => {
        const layout = await hideKeyboard.evaluate((button) => {
          const toolbar = button.parentElement!.getBoundingClientRect();
          const viewport = window.visualViewport;
          return {
            top: toolbar.top,
            bottom: toolbar.bottom,
            viewportBottom: viewport ? viewport.offsetTop + viewport.height : undefined,
            focused: document.activeElement?.matches(
              '[contenteditable="true"][data-u-comp="editor"]',
            ),
          };
        });
        expect(layout.focused).toBe(true);
        expect(layout.top).toBeGreaterThanOrEqual(0);
        expect(layout.bottom).toBeGreaterThan(layout.top);
        expect(layout.viewportBottom).toBeDefined();
        expect(layout.bottom).toBeLessThanOrEqual(layout.viewportBottom! + 1);
      }).toPass({ timeout: 5_000 });
      await expect(input(page)).toBeFocused();
      await page.keyboard.type('Mobile ');
      await saved(page);
      // The two taps target the left edge of the first painted P. Formatting must
      // retain that exact insertion point, not move the edit to another paragraph.
      await expect
        .poll(async () => (await f.read()).body!.dataStream)
        .toBe('Mobile ' + original.body!.dataStream);
      const bold = await f.read();
      expect(bold.body!.dataStream).toBe('Mobile ' + original.body!.dataStream);
      expect(
        bold.body!.textRuns!.some(
          (run) =>
            run.ts?.bl === 1 && bold.body!.dataStream.slice(run.st, run.ed).includes('Mobile'),
        ),
      ).toBe(true);
      await selectFirstWord(page);
      const selectionDrawer = page.locator('[data-u-comp="mobile-menu-drawer"]');
      await expect(selectionDrawer).toBeVisible();
      await expect(input(page)).not.toBeFocused();
      // Held-touch selection dismisses the native input. Restore the emulated
      // keyboard viewport before interacting with the drawer.
      await keyboardOcclusion(page, 0);
      // The opening touch's release must not activate the new backdrop, while
      // a later deliberate backdrop tap must still dismiss the native drawer.
      await page
        .getByRole('button', { name: 'Cancel', exact: true })
        .first()
        .tap({ position: { x: 8, y: 8 } });
      await expect(selectionDrawer).not.toBeVisible();
      await selectFirstWord(page);
      await expect(selectionDrawer).toBeVisible();
      await selectionDrawer.getByRole('button', { name: 'More', exact: true }).tap();
      await expect(selectionDrawer).toHaveAttribute('data-snap', 'expanded');
      const selectedBold = selectionDrawer.getByRole('button', { name: 'Bold', exact: true });
      await expect(selectedBold).toBeEnabled();
      await expect(selectedBold).toBeInViewport({ ratio: 1 });
      const italic = selectionDrawer.getByRole('button', { name: 'Italic', exact: true });
      await expect(italic).toBeEnabled();
      await expect(italic).toBeInViewport({ ratio: 1 });
      await touchTargets(selectionDrawer);
      await capture(page, info, `selected-word-menu-zoom-${zoomRatio}`);
      await italic.tap();
      await expect(selectionDrawer).not.toBeVisible();
      await saved(page);
      await expect
        .poll(async () => {
          const selected = await f.read();
          return selected
            .body!.textRuns!.filter((run) => run.ts?.it === 1)
            .map((run) => selected.body!.dataStream.slice(run.st, run.ed));
        })
        .toEqual(['Mobile']);
      // Selection's context drawer has no keyboard action. Resume through a
      // real canvas gesture before emulating the OS viewport change again.
      await beginWriting(page);
      await keyboardOcclusion(page, 320);
      await page.getByRole('button', { name: 'Heading', exact: true }).tap();
      const quickMenu = page.locator('[data-u-comp="mobile-context-menu-bar"]');
      await expect(quickMenu).toBeVisible();
      await expect(
        quickMenu.getByRole('menuitem', { name: 'Unordered list', exact: true }),
      ).toHaveCount(0);
      await expect(
        quickMenu.getByRole('menuitem', { name: 'Ordered list', exact: true }),
      ).toHaveCount(0);
      await quickMenu.getByRole('menuitem', { name: 'Heading 1', exact: true }).tap();
      await saved(page);
      await expect
        .poll(async () => (await f.read()).body!.paragraphs![0]!.paragraphStyle?.namedStyleType)
        .toBe(NamedStyleType.HEADING_1);
      await page.getByRole('button', { name: 'More', exact: true }).tap();
      await expect(drawer).toBeVisible();
      await expect(input(page)).not.toBeFocused();
      await keyboardOcclusion(page, 0);
      await expect(drawer.getByRole('button', { name: 'Ordered list', exact: true })).toBeEnabled();
      const unordered = drawer.getByRole('button', { name: 'Unordered list', exact: true });
      await expect(unordered).toBeEnabled();
      await touchTargets(drawer);
      await unordered.tap();
      // The native custom picker labels styles visually; its first preview is
      // the standard bullet list. More supplies the required picker callback.
      const bullet = drawer
        .locator('[data-u-comp="mobile-custom-menu-option"] [data-u-comp="list-type-preview"]')
        .first();
      await expect(bullet).toBeVisible();
      await bullet.tap();
      await saved(page);
      await expect
        .poll(async () => (await f.read()).body!.paragraphs![0]!.bullet?.listType)
        .toBe(PresetListType.BULLET_LIST);
      await capture(page, info, `writing-toolbar-zoom-${zoomRatio}`);
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

test('phone Doc typing keeps the rendered caret above the emulated keyboard', async ({
  browser,
  baseURL,
}, info) => {
  test.skip(
    !['sync-development', 'sync-production'].includes(info.project.name),
    'Requires the VITE_SYNC_EVIDENCE read observer enabled by the native sync projects.',
  );
  test.setTimeout(150_000);
  const f = await fixture(browser, baseURL!, info);
  const { page } = f;
  try {
    const original = await f.read();
    await page.goto(`/?item=${f.item.id}`);
    await saved(page);
    await expect(page.getByRole('status', { name: 'Connection status', exact: true })).toHaveText(
      'Online',
      { timeout: 30_000 },
    );
    const region = page.getByRole('region', { name: 'Doc document', exact: true });
    await expect(region).toHaveAttribute('data-mobile', 'true');
    const canvas = region.getByLabel('Document canvas', { exact: true });
    await expect(canvas).toBeVisible();
    const mounted = (await canvas.elementHandle())!;
    await beginWriting(page);
    await keyboardOcclusion(page, 320);
    const hideKeyboard = region.getByRole('button', { name: 'Hide keyboard', exact: true });
    await expect(hideKeyboard).toBeVisible();
    await expect(input(page)).toBeFocused();
    const prefix = 'Keep the final sentence visible while writing on a phone. '.repeat(24);
    const expectedText = prefix + original.body!.dataStream;
    await page.keyboard.type(prefix);
    await saved(page);
    await expect.poll(async () => (await f.read()).body!.dataStream).toBe(expectedText);

    await expect(async () => {
      const observed = await hideKeyboard.evaluate(
        (button, { canvas, unitId }) => {
          const responses: DocSelectionEvidence[] = [];
          const receive = (event: Event) => {
            const evidence = (event as CustomEvent<DocSelectionEvidence>).detail;
            if (evidence.unitId === unitId) responses.push(evidence);
          };
          window.addEventListener('spinel-doc-selection-evidence', receive);
          try {
            // This event only reads the current native range. All selection and
            // text changes above came from real touch and keyboard input.
            window.dispatchEvent(new Event('spinel-doc-selection-read'));
          } finally {
            window.removeEventListener('spinel-doc-selection-evidence', receive);
          }
          const bounds = (element: Element) => {
            const { left, right, top, bottom } = element.getBoundingClientRect();
            return { left, right, top, bottom };
          };
          const viewport = window.visualViewport;
          return {
            selection: responses[0],
            canvas: bounds(canvas),
            toolbar: bounds(button.parentElement!),
            connected: canvas.isConnected,
            viewportBottom: viewport ? viewport.offsetTop + viewport.height : undefined,
          };
        },
        { canvas: mounted, unitId: original.id },
      );
      expect(observed.selection).toMatchObject({
        unitId: original.id,
        start: prefix.length,
        end: prefix.length,
        hasAnchor: true,
        editing: true,
        text: expectedText,
      });
      expect(observed.connected).toBe(true);
      expect(observed.selection!.scroll).toBeGreaterThan(0);
      const caret = observed.selection!.bounds;
      expect(caret).toBeDefined();
      expect(caret!.top).toBeGreaterThanOrEqual(observed.canvas.top - 1);
      expect(caret!.bottom).toBeLessThanOrEqual(observed.canvas.bottom + 1);
      expect(caret!.left).toBeGreaterThanOrEqual(observed.canvas.left - 1);
      expect(caret!.right).toBeLessThanOrEqual(observed.canvas.right + 1);
      expect(caret!.bottom).toBeGreaterThan(caret!.top);
      expect(caret!.bottom).toBeLessThanOrEqual(observed.toolbar.top + 1);
      expect(observed.viewportBottom).toBeDefined();
      expect(observed.toolbar.bottom).toBeLessThanOrEqual(observed.viewportBottom! + 1);
    }).toPass({ timeout: 20_000 });

    const written = await f.read();
    expect(written.body!.dataStream).toBe(expectedText);
    expect(validateDocumentStructure(written)).toEqual([]);
    expect(written.documentStyle).toEqual(original.documentStyle);
    expect(written.settings).toEqual(original.settings);
    await capture(page, info, 'keyboard-caret');
    expect(f.errors).toEqual([]);
  } finally {
    await keyboardOcclusion(page, 0).catch(() => undefined);
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
    await expect(input(page)).not.toBeFocused();
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

for (const role of ['owner', 'guest-editor'] as const) {
  test(`traditional phone Doc is locally read-only without revoking its ${role} grant`, async ({
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(120_000);
    const f = await fixture(browser, baseURL!, info, true, DocumentFlavor.TRADITIONAL);
    try {
      let page = f.page;
      let path = `/api/items/${f.item.id}`;
      if (role === 'guest-editor') {
        const link = await f.account.request.put(`/api/items/${f.item.id}/link`, {
          headers: { Origin: baseURL! },
          data: { role: 'editor' },
        });
        expect(link.ok()).toBe(true);
        await f.page.close();
        const guest = await f.phone();
        page = await guest.newPage();
        page.on('pageerror', (error) => f.errors.push(error.message));
        path = `/api/guest/${f.item.id}`;
        await page.goto((await link.json()).url);
      } else await page.goto(`/?item=${f.item.id}`);
      const region = page.getByRole('region', { name: 'Doc document', exact: true });
      const status = page.getByRole('status', { name: 'Save status', exact: true });
      const connection = page.getByRole('status', { name: 'Connection status', exact: true });
      const note = 'Edit on a larger screen. This Doc keeps its page layout.';
      const message = 'View only on this phone. Edit on a larger screen.';
      await expect(region).toHaveAttribute('data-mobile', 'true');
      await expect(status).toHaveText(message, { timeout: 30_000 });
      await expect(connection).toHaveText('Online');
      await expect(region.getByText(note, { exact: true })).toBeVisible();
      await expect(region.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
      await expect(region.getByRole('button', { name: 'Format', exact: true })).toHaveCount(0);
      const original = await f.read();
      expect(original.documentStyle.documentFlavor).toBe(DocumentFlavor.TRADITIONAL);

      const point = await textPoint(page);
      await page.touchscreen.tap(point.x, point.y);
      await page.touchscreen.tap(point.x, point.y);
      await expect(input(page)).not.toBeFocused();
      await page.keyboard.type('FORBIDDEN TRADITIONAL PHONE EDIT');
      await expect(status).toHaveText(message);
      const afterInput = await f.read();
      expect(afterInput.body).toEqual(original.body);
      expect(afterInput.documentStyle).toEqual(original.documentStyle);
      expect(afterInput.settings).toEqual(original.settings);

      if (role === 'owner') {
        await page.getByRole('button', { name: 'Document actions', exact: true }).tap();
        await expect(
          page.getByRole('menuitem', { name: 'Insert formula', exact: true }),
        ).toHaveCount(0);
        await page.getByRole('menuitem', { name: 'Formulas', exact: true }).tap();
      } else {
        await expect(page.getByRole('button', { name: 'Insert formula', exact: true })).toHaveCount(
          0,
        );
        await page.getByRole('button', { name: 'Formulas', exact: true }).tap();
      }
      const formulas = page.getByRole('dialog', { name: 'Formulas', exact: true });
      await expect(formulas.locator('output')).toHaveText('42', { timeout: 20_000 });
      await expect(formulas.locator('tbody tr')).toHaveCount(30);
      await expect(formulas.getByText('=40+2', { exact: true })).toBeVisible();
      await expect(formulas.getByRole('button', { name: '=40+2', exact: true })).toHaveCount(0);
      await expect(page.getByRole('dialog', { name: 'Edit formula', exact: true })).toHaveCount(0);
      await formulas.getByRole('button', { name: 'Close dialog', exact: true }).tap();

      // Wait for two real scheduled access checks, not a fixed sleep. The local
      // presentation fallback must not compare an invented viewer role against
      // the owner's/editor's real grant and mark a healthy room revoked/offline.
      for (let check = 0; check < 2; check++) {
        const response = await page.waitForResponse(
          (response) =>
            response.request().method() === 'GET' && new URL(response.url()).pathname === path,
          { timeout: 10_000 },
        );
        expect(response.status()).toBe(200);
        expect((await response.json()).item.access).toBe(role === 'owner' ? 'owner' : 'editor');
      }
      await expect(connection).toHaveText('Online');
      await expect(status).toHaveText(message);
      await expect(region.getByText(note, { exact: true })).toBeVisible();
      for (const theme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await capture(page, info, `traditional-${role}-${theme}`);
      }
      const unchanged = await f.read();
      expect(unchanged.body).toEqual(original.body);
      expect(unchanged.documentStyle).toEqual(original.documentStyle);
      expect(unchanged.settings).toEqual(original.settings);
      expect(f.errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
}

test('a peer-protocol page-layout change preserves queued phone writing and the owner grant', async ({
  browser,
  baseURL,
}, info) => {
  test.skip(
    !['sync-development', 'sync-production'].includes(info.project.name),
    'Requires the VITE_SYNC_EVIDENCE read observer enabled by the native sync projects.',
  );
  test.setTimeout(150_000);
  // There is no page-mode control in the app. This authenticated protocol peer
  // uses the same snapshot/ticket/socket contract as another live editor.
  const { JSONX } = await import('@univerjs/core');
  const { RichTextEditingMutation } = await import('@univerjs/docs');
  const { default: WebSocket } = await import('ws');
  const { syncNetwork } = await import('./sync-network.ts');
  const f = await fixture(browser, baseURL!, info, true);
  const network = await syncNetwork(f.account);
  const { page } = f;
  const region = page.getByRole('region', { name: 'Doc document', exact: true });
  const canvas = region.getByLabel('Document canvas', { exact: true });
  const status = page.getByRole('status', { name: 'Save status', exact: true });
  const connection = page.getByRole('status', { name: 'Connection status', exact: true });
  const note = 'This Doc’s page layout changed. Reopen it to continue.';
  const message = 'View only on this phone. Reopen after the page layout change.';
  const pending = 'Changes not saved yet — keep this tab open.';
  const prefixText = 'Pending ';
  const firstPrefix = prefixText.slice(0, 1);
  const peerFrames: {
    type: string;
    revision?: number;
    mutationId?: string;
    unitId?: string;
    fromRevision?: number;
    edits?: unknown[];
    reason?: string;
  }[] = [];
  const peerErrors: string[] = [];
  let peerSocket: InstanceType<typeof WebSocket> | undefined;
  let heldWrites = 0;
  const forwarded: boolean[] = [];
  let releaseFirstWrite = () => {};
  const firstGate = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve;
  });
  let releaseHeld = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseHeld = resolve;
  });
  const releaseWrites = async () => {
    network.interceptWrites(undefined);
    releaseFirstWrite();
    releaseHeld();
    await network.drainWrites();
  };
  try {
    await page.goto(`/?item=${f.item.id}`);
    await saved(page);
    await expect(connection).toHaveText('Online');
    await expect(region).toHaveAttribute('data-mobile', 'true');
    await expect(canvas).toBeVisible();
    const initialCanvas = (await canvas.elementHandle())!;

    // Connect before holding a phone write: the client's normal receipt retry
    // deadline must not depend on fixture setup or screenshot speed.
    const peer = await f.phone(true);
    const prepared = await peer.request.post(`/api/items/${f.item.id}/collaboration`, {
      headers: { Origin: baseURL! },
      data: {},
    });
    expect(prepared.ok(), await prepared.text()).toBe(true);
    const metadata = await prepared.json();
    expect(metadata.syncVersion).toBe(1);
    const unitId = metadata.unitId as string;
    const prefix = `/sync-api/items/${f.item.id}`;
    const snapshotResponse = await peer.request.get(
      `${prefix}/snapshot?unitId=${encodeURIComponent(unitId)}`,
    );
    expect(snapshotResponse.ok()).toBe(true);
    const head = (await snapshotResponse.json()) as {
      version: number;
      unitId: string;
      revision: number;
      snapshot: IDocumentData;
    };
    expect(head.version).toBe(1);
    expect(head.unitId).toBe(unitId);
    const original = head.snapshot;
    expect(original.id).toBe(unitId);
    expect(original.documentStyle.documentFlavor).toBe(DocumentFlavor.MODERN);
    const ticketResponse = await peer.request.post(
      `${prefix}/ticket?unitId=${encodeURIComponent(unitId)}`,
      { headers: { Origin: baseURL! } },
    );
    expect(ticketResponse.ok()).toBe(true);
    const ticket = (await ticketResponse.json()).ticket as string;
    const credential = (await peer.cookies()).find((cookie) => cookie.name === COOKIE_NAME);
    expect(credential).toBeDefined();
    const socketUrl = new URL(`${prefix}/socket`, baseURL);
    socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    socketUrl.search = new URLSearchParams({
      unitId,
      ticket,
      afterRevision: String(head.revision),
    }).toString();
    const socket = new WebSocket(socketUrl, {
      headers: { Cookie: `${COOKIE_NAME}=${credential!.value}`, Origin: baseURL! },
      // The mobile HTTPS project uses a local self-signed test certificate.
      rejectUnauthorized: false,
      handshakeTimeout: 10_000,
    });
    peerSocket = socket;
    socket.on('message', (data) => peerFrames.push(JSON.parse(data.toString())));
    socket.on('error', (error) => peerErrors.push(error.message));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    await expect
      .poll(() => peerFrames.find((frame) => frame.type === 'resume'))
      .toMatchObject({
        unitId,
        revision: head.revision,
        fromRevision: head.revision,
        edits: [],
      });
    const selection = () =>
      page.evaluate((id) => {
        let observed: DocSelectionEvidence | undefined;
        const receive = (event: Event) => {
          const evidence = (event as CustomEvent<DocSelectionEvidence>).detail;
          if (evidence.unitId === id) observed = evidence;
        };
        window.addEventListener('spinel-doc-selection-evidence', receive);
        try {
          // Read the current public native range/model only. The sync snapshot
          // observer intentionally waits until pending edits have settled.
          window.dispatchEvent(new Event('spinel-doc-selection-read'));
        } finally {
          window.removeEventListener('spinel-doc-selection-evidence', receive);
        }
        return observed;
      }, unitId);
    await beginWriting(page);
    network.interceptWrites(async (write) => {
      heldWrites++;
      await (heldWrites === 1 ? firstGate : gate);
      forwarded.push(write.forward());
    });
    // Establish an immutable inflight submit before creating the unsent suffix.
    // The client holds senderless peer edits until its own ack identifies them.
    await page.keyboard.type(firstPrefix);
    await expect.poll(() => heldWrites).toBe(1);
    await page.keyboard.type(prefixText.slice(firstPrefix.length));
    await expect(status).toHaveText(pending);
    await expect
      .poll(async () => (await selection())?.text)
      .toBe(prefixText + original.body!.dataStream);
    expect((await f.read()).body).toEqual(original.body);

    const mutationId = crypto.randomUUID();
    socket.send(
      JSON.stringify({
        type: 'submit',
        mutationId,
        baseRevision: head.revision,
        mutations: [
          {
            id: RichTextEditingMutation.id,
            params: {
              unitId,
              actions: new JSONX().replaceOp(
                ['documentStyle', 'documentFlavor'],
                DocumentFlavor.MODERN,
                DocumentFlavor.TRADITIONAL,
              ),
              textRanges: [],
            },
          },
        ],
      }),
    );
    await expect
      .poll(
        () => peerFrames.find((frame) => frame.type === 'ack' && frame.mutationId === mutationId),
        { timeout: 5_000 },
      )
      .toMatchObject({ revision: head.revision + 1 });
    // Resolve only the first submit. Its ack applies the earlier peer revision,
    // while a second gate keeps the already-written suffix pending throughout
    // the local page-layout fence and unchanged-canvas assertions.
    releaseFirstWrite();
    await expect.poll(() => heldWrites).toBeGreaterThan(1);
    await expect(region.getByText(note, { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(input(page)).not.toBeFocused();
    await expect(region.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await expect(region.getByRole('button', { name: 'Format', exact: true })).toHaveCount(0);
    await expect(connection).toHaveText('Online');
    // The local fallback must not replace an actual unsaved state with a clean
    // View only announcement, or recreate the canvas and its pending queue.
    await expect(status).toHaveText(pending);
    expect(await canvas.evaluate((current, initial) => current === initial, initialCanvas)).toBe(
      true,
    );
    expect(await selection()).toMatchObject({
      unitId,
      editing: false,
      text: prefixText + original.body!.dataStream,
    });
    const beforeRelease = await f.read();
    expect(beforeRelease.documentStyle.documentFlavor).toBe(DocumentFlavor.TRADITIONAL);
    expect(beforeRelease.body!.dataStream).toBe(firstPrefix + original.body!.dataStream);
    expect(beforeRelease.settings).toEqual(original.settings);
    expect(forwarded).toEqual([true]);
    await releaseWrites();
    expect(forwarded).toHaveLength(heldWrites);
    expect(forwarded.every(Boolean)).toBe(true);
    await expect(status).toHaveText(message, { timeout: 30_000 });
    await expect
      .poll(async () => (await f.read()).body?.dataStream)
      .toBe(prefixText + original.body!.dataStream);
    const committed = await f.read();
    expect(committed.id).toBe(unitId);
    expect(committed.documentStyle).toEqual({
      ...original.documentStyle,
      documentFlavor: DocumentFlavor.TRADITIONAL,
    });
    expect(committed.settings).toEqual(original.settings);
    expect(committed.body!.customRanges).toEqual(
      original.body!.customRanges!.map((range) => ({
        ...range,
        startIndex: range.startIndex + prefixText.length,
        endIndex: range.endIndex + prefixText.length,
      })),
    );

    // The preserved 960px page now fits as a tiny read-only fallback. Its
    // glyphs are below the editable-text raster helper's readability threshold.
    // Read the retained native caret to target real text without changing it.
    let fallbackPoint: { x: number; y: number } | undefined;
    await expect(async () => {
      const current = await selection();
      expect(current).toMatchObject({
        unitId,
        start: prefixText.length,
        end: prefixText.length,
        editing: false,
        text: prefixText + original.body!.dataStream,
      });
      const bounds = current!.bounds;
      expect(bounds).toBeDefined();
      expect(Object.values(bounds!).every(Number.isFinite)).toBe(true);
      expect(bounds!.bottom).toBeGreaterThan(bounds!.top);
      expect(bounds!.right).toBeGreaterThanOrEqual(bounds!.left);
      const point = { x: bounds!.left, y: (bounds!.top + bounds!.bottom) / 2 };
      expect(
        await canvas.evaluate(
          (node, { point, bounds }) => {
            const box = node.getBoundingClientRect();
            const target = document.elementFromPoint(point.x, point.y);
            return (
              bounds.left >= box.left &&
              bounds.right <= box.right &&
              bounds.top >= box.top &&
              bounds.bottom <= box.bottom &&
              (target === node || Boolean(target && node.parentElement?.contains(target)))
            );
          },
          { point, bounds: bounds! },
        ),
      ).toBe(true);
      fallbackPoint = point;
    }).toPass({ timeout: 5_000 });
    await page.touchscreen.tap(fallbackPoint!.x, fallbackPoint!.y);
    await page.touchscreen.tap(fallbackPoint!.x, fallbackPoint!.y);
    await expect(input(page)).not.toBeFocused();
    await page.keyboard.type('FORBIDDEN AFTER PAGE LAYOUT CHANGE');
    await page.getByRole('button', { name: 'Document actions', exact: true }).tap();
    await expect(page.getByRole('menuitem', { name: 'Insert formula', exact: true })).toHaveCount(
      0,
    );
    await page.getByRole('menuitem', { name: 'Formulas', exact: true }).tap();
    const formulas = page.getByRole('dialog', { name: 'Formulas', exact: true });
    await expect(formulas.locator('output')).toHaveText('42', { timeout: 20_000 });
    await expect(formulas.locator('tbody tr')).toHaveCount(30);
    await expect(formulas.getByText('=40+2', { exact: true })).toBeVisible();
    await expect(formulas.getByRole('button', { name: '=40+2', exact: true })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Edit formula', exact: true })).toHaveCount(0);
    await formulas.getByRole('button', { name: 'Close dialog', exact: true }).tap();
    for (let check = 0; check < 2; check++) {
      const response = await page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          new URL(response.url()).pathname === `/api/items/${f.item.id}`,
        { timeout: 10_000 },
      );
      expect(response.status()).toBe(200);
      expect((await response.json()).item.access).toBe('owner');
    }
    await expect(connection).toHaveText('Online');
    await expect(status).toHaveText(message);
    await expect(region.getByText(note, { exact: true })).toBeVisible();
    expect(await canvas.evaluate((current, initial) => current === initial, initialCanvas)).toBe(
      true,
    );
    const unchanged = await f.read();
    expect(unchanged.body).toEqual(committed.body);
    expect(unchanged.documentStyle).toEqual(committed.documentStyle);
    expect(unchanged.settings).toEqual(committed.settings);
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await capture(page, info, `live-layout-changed-${theme}`);
    }
    expect(peerErrors).toEqual([]);
    expect(f.errors).toEqual([]);
  } finally {
    try {
      await releaseWrites();
    } finally {
      try {
        await mkdir(info.outputPath('peer-protocol'), { recursive: true });
        await writeFile(
          info.outputPath('peer-protocol', 'sync-diagnostics.json'),
          JSON.stringify(
            {
              heldWrites,
              forwarded,
              peerErrors,
              peerFrames,
              outgoing: network.outgoing,
              incoming: network.incoming,
            },
            null,
            2,
          ),
        );
      } finally {
        peerSocket?.terminate();
        await f.close();
      }
    }
  }
});
