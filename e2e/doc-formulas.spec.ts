import { mkdir, writeFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { LocaleType } from '@univerjs/core';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { SheetStore } from '../src/server/workspace/sheets.ts';

type FormulaCanvasPaint = { text: string; width: number; height: number };

test('native Doc formulas render live cells, tables and cross-document totals without sharing source access', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth),
    sheets = new SheetStore(workspace);
  const owner = auth.createUser('Formula owner');
  const friend = auth.createUser('Formula friend');
  const host = workspace.create(owner.id, { name: 'Live report', kind: 'doc', parentId: null });
  const budget = workspace.create(owner.id, { name: 'Budget', kind: 'sheet', parentId: null });
  const forecast = workspace.create(owner.id, { name: 'Forecast', kind: 'sheet', parentId: null });
  for (const [item, amount] of [
    [budget, 314159],
    [forecast, 7],
  ] as const) {
    sheets.save(owner.id, item.id, {
      snapshot: {
        id: item.id,
        name: item.name,
        appVersion: '1.1.0',
        locale: LocaleType.EN_US,
        styles: {},
        sheetOrder: ['summary'],
        sheets: {
          summary: {
            id: 'summary',
            name: 'Summary',
            rowCount: 100,
            columnCount: 10,
            cellData: Object.fromEntries(
              Array.from({ length: 30 }, (_, row) => [
                row,
                { 0: { v: row ? row + 1 : amount }, 1: { v: row + 101 }, 2: { v: row + 201 } },
              ]),
            ),
          },
        },
      },
      revision: 0,
      writeId: crypto.randomUUID(),
    });
  }
  workspace.share(owner.id, host.id, friend.id, 'editor');
  const cookie = (user: string) => ({
    name: COOKIE_NAME,
    value: auth.createSession(user).token,
    url: baseURL!.replace('http:', 'https:'),
    secure: true,
    httpOnly: true,
    sameSite: 'Strict' as const,
  });
  await context.addCookies([cookie(owner.id)]);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const second = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await second.addCookies([cookie(friend.id)]);
  const other = await second.newPage();
  const errors: string[] = [];
  let printHtml = '';
  await context.exposeBinding('captureFormulaPrint', (_source, html: string) => {
    printHtml = html;
  });
  for (const target of [page, other]) target.on('pageerror', (error) => errors.push(error.message));
  // Observe actual native canvas text, not just the accessible Formula panel.
  await context.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    const originalRect = CanvasRenderingContext2D.prototype.fillRect;
    const lastRect = new WeakMap<CanvasRenderingContext2D, { width: number; height: number }>();
    const geometry: FormulaCanvasPaint[] = [];
    const painted: string[] = [];
    Object.assign(window, { formulaPaintedText: painted, formulaPaintedGeometry: geometry });
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, width, height) {
      lastRect.set(this, { width, height });
      return originalRect.call(this, x, y, width, height);
    };
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      painted.push(text);
      const rect = lastRect.get(this);
      if (rect && (text === '314159' || text === '…')) {
        geometry.push({ text, ...rect });
        if (geometry.length > 1000) geometry.splice(0, 500);
      }
      if (painted.length > 20000) painted.splice(0, 10000);
      return original.call(this, text, ...args);
    };
    window.print = () => {
      // Match the browser event order used by the existing portable-export check.
      window.dispatchEvent(new Event('beforeprint'));
      const clone = document.documentElement.cloneNode(true) as HTMLElement;
      const originalCanvases = [...document.querySelectorAll('canvas')];
      clone.querySelectorAll('canvas').forEach((canvas, index) => {
        const image = document.createElement('img');
        image.src = originalCanvases[index].toDataURL();
        image.style.cssText = canvas.style.cssText;
        image.width = originalCanvases[index].width;
        image.height = originalCanvases[index].height;
        canvas.replaceWith(image);
      });
      clone.querySelectorAll('script').forEach((script) => script.remove());
      const base = document.createElement('base');
      base.href = document.baseURI;
      clone.querySelector('head')!.prepend(base);
      void (
        window as unknown as { captureFormulaPrint: (html: string) => Promise<void> }
      ).captureFormulaPrint(clone.outerHTML);
      window.dispatchEvent(new Event('afterprint'));
    };
  });
  const saved = (target: Page) =>
    expect(target.getByRole('status', { name: 'Save status' })).toHaveText('All changes saved.', {
      timeout: 30_000,
    });
  const read = async () =>
    (await (await context.request.get(`/api/items/${host.id}/doc`)).json()).snapshot;
  const formulaPanel = (target: Page) =>
    target.getByRole('dialog', { name: 'Formulas', exact: true });
  const openPanel = async (target: Page) => {
    const panel = formulaPanel(target);
    if (!(await panel.isVisible())) {
      await target.getByRole('button', { name: 'Document actions', exact: true }).click();
      await target.getByRole('menuitem', { name: 'Formulas', exact: true }).click();
    }
    return panel;
  };
  const nativeInput = () => page.locator('[contenteditable="true"][data-u-comp="editor"]');
  const insert = async (expression: string) => {
    if (await formulaPanel(page).isVisible())
      await formulaPanel(page).getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(formulaPanel(page)).toHaveCount(0);
    const paragraphsBefore = (await read()).body.dataStream.split('\r').length;
    if (!(await read()).body.customRanges?.length)
      await page.locator('.univer-container').click({ position: { x: 130, y: 200 } });
    await nativeInput().focus();
    await expect(nativeInput()).toBeFocused();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await expect
      .poll(async () => (await read()).body.dataStream.split('\r').length)
      .toBe(paragraphsBefore + 1);
    await page.getByRole('button', { name: 'Document actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Insert formula', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Insert formula', exact: true });
    await dialog.getByLabel('Formula', { exact: true }).fill(expression);
    await dialog.getByRole('button', { name: 'Insert formula', exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 20_000 });
    await expect(nativeInput()).toBeFocused();
    await saved(page);
    await expect.poll(async () => JSON.stringify(await read())).toContain(expression);
    const panel = await openPanel(page);
    return panel
      .getByRole('listitem')
      .filter({ has: page.getByRole('button', { name: expression, exact: true }) });
  };
  const screenshots = async (name: string, target: Page = page) => {
    await target.bringToFront();
    const panel = formulaPanel(target);
    const closePanel = name !== 'editing' && (await panel.isVisible());
    if (closePanel) {
      await expect(panel.getByText('Calculating…', { exact: true })).toHaveCount(0, {
        timeout: 20_000,
      });
      await panel.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await expect(panel).toHaveCount(0);
    }
    await mkdir('test-results/theme-screenshots', { recursive: true });
    for (const [theme, width] of [
      ['light', 1440],
      ['dark', 1440],
      ['light', 390],
    ] as const) {
      await target.emulateMedia({ colorScheme: theme });
      await target.setViewportSize({ width, height: 1100 });
      if (name !== 'editing') {
        await openPanel(target);
        await expect(panel.getByText('Calculating…', { exact: true })).toHaveCount(0, {
          timeout: 20_000,
        });
        await panel.getByRole('button', { name: 'Close dialog', exact: true }).click();
        await expect(panel).toHaveCount(0);
        await target.locator('[contenteditable="true"][data-u-comp="editor"]').focus();
        await expect(
          target.locator('[contenteditable="true"][data-u-comp="editor"]'),
        ).toBeFocused();
        await target.keyboard.press('Control+Home');
      }
      await target.screenshot({
        path: `test-results/theme-screenshots/formulas-${info.project.name}-${name}-${theme}-${width}.png`,
        fullPage: true,
        animations: 'disabled',
      });
      if (name === 'results') {
        await openPanel(target);
        await expect(panel.getByText('Calculating…', { exact: true })).toHaveCount(0, {
          timeout: 20_000,
        });
        await panel.getByRole('button', { name: 'Close dialog', exact: true }).click();
        await expect(panel).toHaveCount(0);
        await target.locator('[contenteditable="true"][data-u-comp="editor"]').focus();
        await expect(
          target.locator('[contenteditable="true"][data-u-comp="editor"]'),
        ).toBeFocused();
        await target.keyboard.press('Control+End');
        await target.screenshot({
          path: `test-results/theme-screenshots/formulas-${info.project.name}-${name}-end-${theme}-${width}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
      if (width === 390)
        console.log(
          'Formula phone overflow:',
          await target.evaluate(() => ({
            viewport: innerWidth,
            document: document.documentElement.scrollWidth,
            overflow: [...document.querySelectorAll('body *')]
              .filter((element) => {
                const box = element.getBoundingClientRect();
                return (
                  box.width > 0 &&
                  box.right > innerWidth + 1 &&
                  getComputedStyle(element).position !== 'fixed'
                );
              })
              .slice(0, 12)
              .map((element) => ({
                tag: element.tagName,
                classes: element.className,
                right: element.getBoundingClientRect().right,
              })),
          })),
        );
    }
    await target.emulateMedia({ colorScheme: 'light' });
    await target.setViewportSize({ width: 1440, height: 1100 });
    if (closePanel) await openPanel(target);
  };
  try {
    await page.goto(`/?item=${host.id}`);
    await saved(page);
    const scalar = await insert('=Budget.Summary.A1');
    await expect(scalar).toContainText('314159', { timeout: 20_000 });
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { formulaPaintedText: string[] }).formulaPaintedText.some((text) =>
            text.includes('314159'),
          ),
        ),
      )
      .toBe(true);

    const total = await insert('=SUM(Budget.Summary.A1,Forecast.Summary.A1)');
    await expect(total).toContainText('314166', { timeout: 20_000 });
    const array = await insert('={1,2;3,4}');
    await expect(array).toContainText('4', { timeout: 20_000 });
    const table = await insert('=Budget.Summary.A1:C30');
    await expect(table).toContainText('230', { timeout: 20_000 });
    // Hold fresh evaluations while inspecting the real native glyph's loading footprint.
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as unknown as { formulaPaintedGeometry: FormulaCanvasPaint[] }
          ).formulaPaintedGeometry.some((paint) => paint.text === '314159' && paint.height > 300),
        ),
      )
      .toBe(true);
    const tableFootprint = await page.evaluate(() =>
      (
        window as unknown as { formulaPaintedGeometry: FormulaCanvasPaint[] }
      ).formulaPaintedGeometry.findLast((paint) => paint.text === '314159' && paint.height > 300)!,
    );
    let releaseEvaluation!: () => void;
    const evaluationGate = new Promise<void>((resolve) => {
      releaseEvaluation = resolve;
    });
    const evaluationPath = `**/api/items/${host.id}/formulas/evaluate`;
    let evaluationHeld = false;
    await page.route(evaluationPath, async (route) => {
      const response = await route.fetch();
      evaluationHeld = true;
      await evaluationGate;
      await route.fulfill({ response });
    });
    try {
      await page.evaluate(() => {
        (
          window as unknown as { formulaPaintedGeometry: FormulaCanvasPaint[] }
        ).formulaPaintedGeometry.length = 0;
      });
      await formulaPanel(page)
        .getByRole('button', { name: 'Refresh formulas', exact: true })
        .click();
      await expect.poll(() => evaluationHeld, { timeout: 15_000 }).toBe(true);
      await expect(table).toContainText('Calculating');
      await expect(table).not.toContainText('314159');
      await expect(table).not.toContainText('230');
      await expect
        .poll(() =>
          page.evaluate(
            (expected) =>
              (
                window as unknown as { formulaPaintedGeometry: FormulaCanvasPaint[] }
              ).formulaPaintedGeometry.some(
                (paint) =>
                  paint.text === '…' &&
                  Math.abs(paint.width - expected.width) < 0.01 &&
                  Math.abs(paint.height - expected.height) < 0.01,
              ),
            tableFootprint,
          ),
        )
        .toBe(true);
    } finally {
      releaseEvaluation();
      await page.unrouteAll({ behavior: 'wait' });
    }
    await expect(table).toContainText('230', { timeout: 20_000 });
    await screenshots('results');
    await formulaPanel(page).getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'Document actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
    await page.getByRole('button', { name: 'Print / save PDF', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Export', exact: true })).not.toBeVisible();
    await expect.poll(() => printHtml.includes('<img'), { timeout: 20_000 }).toBe(true);
    const printed = await context.newPage();
    try {
      await printed.emulateMedia({ media: 'print' });
      await printed.setContent(printHtml, { waitUntil: 'networkidle' });
      await printed.evaluate(() =>
        Promise.all([...document.images].map((image) => image.decode().catch(() => {}))),
      );
      console.log(
        'Formula print surface:',
        await printed.evaluate(() =>
          [...document.images].map((image) => ({
            width: image.naturalWidth,
            height: image.naturalHeight,
            bounds: image.getBoundingClientRect().toJSON(),
            display: getComputedStyle(image).display,
            ancestors: [image.parentElement, image.parentElement?.parentElement].map((node) =>
              node
                ? {
                    tag: node.tagName,
                    className: node.className,
                    display: getComputedStyle(node).display,
                    visibility: getComputedStyle(node).visibility,
                  }
                : null,
            ),
          })),
        ),
      );
      const pdf = await printed.pdf({
        path: info.outputPath('formulas-export.pdf'),
        printBackground: true,
        preferCSSPageSize: true,
      });
      const loading = getDocument({ data: new Uint8Array(pdf), useSystemFonts: true });
      const reopened = await loading.promise;
      try {
        expect(reopened.numPages).toBeGreaterThan(0);
        let ink = 0;
        for (let number = 1; number <= reopened.numPages; number++) {
          const sheet = await reopened.getPage(number);
          const viewport = sheet.getViewport({ scale: 1 });
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          await sheet.render({
            canvas: canvas as unknown as HTMLCanvasElement,
            canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
            viewport,
          }).promise;
          const pixels = canvas
            .getContext('2d')
            .getImageData(0, 0, canvas.width, canvas.height).data;
          for (let index = 0; index < pixels.length; index += 4)
            if (
              pixels[index + 3] &&
              Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) < 240
            )
              ink++;
          await writeFile(
            info.outputPath(`formulas-page-${number}-export-opened.png`),
            await canvas.encode('png'),
          );
        }
        expect(
          ink,
          'The prepared PDF must have visible content for privacy review',
        ).toBeGreaterThan(50);
      } finally {
        await loading.destroy();
      }
    } finally {
      await printed.close();
      await page.bringToFront();
    }
    await openPanel(page);
    await expect(formulaPanel(page)).toContainText('314159', { timeout: 20_000 });

    const snapshot = await read();
    expect(
      snapshot.body.customRanges.filter(
        (range: { properties?: { spinelFormula?: unknown } }) => range.properties?.spinelFormula,
      ),
    ).toHaveLength(4);
    // Source values are sensitive; native snapshots carry expressions and bindings only.
    expect(JSON.stringify(snapshot)).not.toContain('314159');
    expect(JSON.stringify(snapshot)).not.toContain('314166');
    await formulaPanel(page).getByRole('button', { name: '={1,2;3,4}', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Edit formula', exact: true });
    await edit.getByLabel('Formula', { exact: true }).fill('={5,6;7,8}');
    await screenshots('editing');
    await edit.getByRole('button', { name: 'Save formula', exact: true }).click();
    await expect(edit).not.toBeVisible({ timeout: 20_000 });
    await saved(page);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => JSON.stringify(await read())).toContain('={1,2;3,4}');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(async () => JSON.stringify(await read())).toContain('={5,6;7,8}');
    await openPanel(page);

    const checkpointResponse = await context.request.post(`/api/items/${budget.id}/history`, {
      headers: { Origin: baseURL! },
      data: { name: 'Before source edit' },
    });
    expect(checkpointResponse.status()).toBe(201);
    const checkpoint = (await checkpointResponse.json()).version;
    const sourcePage = await context.newPage();
    try {
      await sourcePage.goto(`/?item=${budget.id}`);
      await saved(sourcePage);
      const cell = sourcePage
        .getByRole('region', { name: 'Sheet document', exact: true })
        .getByRole('textbox')
        .nth(2);
      await cell.fill('A1');
      await cell.press('Enter');
      await sourcePage.keyboard.type('271828');
      await sourcePage.keyboard.press('Enter');
      await saved(sourcePage);
      await page.bringToFront();
      await formulaPanel(page)
        .getByRole('button', { name: 'Refresh formulas', exact: true })
        .click();
      await expect(scalar).toContainText('271828', { timeout: 20_000 });
      await expect(total).toContainText('271835', { timeout: 20_000 });
      const sourceState = await (await context.request.get(`/api/items/${budget.id}/sheet`)).json();
      const restored = await context.request.post(
        `/api/items/${budget.id}/history/${checkpoint.id}/restore`,
        {
          headers: { Origin: baseURL! },
          data: { requestId: crypto.randomUUID(), unitId: sourceState.snapshot.id },
        },
      );
      expect(restored.status()).toBe(200);
      expect((await restored.json()).unitId).not.toBe(sourceState.snapshot.id);
      await formulaPanel(page)
        .getByRole('button', { name: 'Refresh formulas', exact: true })
        .click();
      await expect(scalar).toContainText('314159', { timeout: 20_000 });
      await expect(total).toContainText('314166', { timeout: 20_000 });
    } finally {
      await sourcePage.close();
    }

    await other.goto(`${baseURL}/?item=${host.id}`);
    await saved(other);
    const otherPanel = await openPanel(other);
    await expect(otherPanel).toContainText('access', { timeout: 20_000 });
    await expect(otherPanel).not.toContainText('314159');
    await expect(otherPanel).not.toContainText('314166');
    await screenshots('private-source', other);
    await otherPanel.getByRole('button', { name: '={5,6;7,8}', exact: true }).click();
    const collaboratorEdit = other.getByRole('dialog', { name: 'Edit formula', exact: true });
    await collaboratorEdit.getByLabel('Formula', { exact: true }).fill('={9,10;11,12}');
    await collaboratorEdit.getByRole('button', { name: 'Save formula', exact: true }).click();
    await expect(collaboratorEdit).not.toBeVisible({ timeout: 20_000 });
    await saved(other);
    await openPanel(other);
    await expect(
      formulaPanel(page).getByRole('button', { name: '={9,10;11,12}', exact: true }),
    ).toBeVisible();
    workspace.share(owner.id, budget.id, friend.id, 'viewer');
    await otherPanel.getByRole('button', { name: 'Refresh formulas', exact: true }).click();
    const otherScalar = otherPanel
      .getByRole('listitem')
      .filter({ has: other.getByRole('button', { name: '=Budget.Summary.A1', exact: true }) });
    await expect(otherScalar).toContainText('314159', { timeout: 20_000 });
    const otherTotal = otherPanel.getByRole('listitem').filter({
      has: other.getByRole('button', {
        name: '=SUM(Budget.Summary.A1,Forecast.Summary.A1)',
        exact: true,
      }),
    });
    await expect(otherTotal).not.toContainText('314166');
    workspace.share(owner.id, forecast.id, friend.id, 'viewer');
    await otherPanel.getByRole('button', { name: 'Refresh formulas', exact: true }).click();
    await expect(otherTotal).toContainText('314166', { timeout: 20_000 });
    workspace.update(owner.id, budget.id, { name: 'Renamed budget' });
    await formulaPanel(page).getByRole('button', { name: 'Refresh formulas', exact: true }).click();
    await expect(scalar).toContainText('314159', { timeout: 20_000 });
    workspace.share(owner.id, budget.id, friend.id, null);
    await otherPanel.getByRole('button', { name: 'Refresh formulas', exact: true }).click();
    await expect(otherScalar).toContainText('access', { timeout: 20_000 });
    await expect(otherTotal).not.toContainText('314166');
    await page.reload();
    await saved(page);
    await openPanel(page);
    await expect(formulaPanel(page)).toContainText('314159', { timeout: 20_000 });
    expect(JSON.stringify(await read())).not.toContain('314159');
    expect(errors).toEqual([]);
  } catch (error) {
    await mkdir('test-results/theme-screenshots', { recursive: true });
    await page
      .screenshot({
        path: `test-results/theme-screenshots/formulas-${info.project.name}-failure.png`,
        fullPage: true,
      })
      .catch(() => {});
    console.log(
      'Formula canvas diagnostics:',
      await page
        .evaluate(() =>
          (window as unknown as { formulaPaintedText?: string[] }).formulaPaintedText?.slice(-100),
        )
        .catch(() => []),
    );
    throw error;
  } finally {
    await second.close();
    await page.goto('/sign-in').catch(() => {});
    db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(owner.id);
    for (const user of [owner, friend])
      db.prepare('DELETE FROM auth_users WHERE id=?').run(user.id);
    db.close();
  }
});

test('rich clipboard creates independent native Formula objects and plain text keeps the expression', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.setTimeout(60_000);
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  const owner = auth.createUser(`Formula clipboard ${info.testId}`);
  const host = workspace.create(owner.id, {
    name: 'Formula clipboard',
    kind: 'doc',
    parentId: null,
  });
  const expression = '={1,2;3,4}';
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
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 1100 });
  let clipboardHtml = '';
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => {
    if (browserErrors.length < 20) browserErrors.push(`pageerror: ${error.message.slice(0, 2000)}`);
  });
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type()) && browserErrors.length < 20)
      browserErrors.push(`${message.type()}: ${message.text().slice(0, 2000)}`);
  });
  const readSnapshot = async () =>
    (await (await context.request.get(`/api/items/${host.id}/doc`)).json()).snapshot;
  const readRanges = async () => {
    const saved = await readSnapshot();
    return (saved.body.customRanges ?? []).filter(
      (range: { properties?: { spinelFormula?: unknown } }) => range.properties?.spinelFormula,
    ) as { rangeId: string; startIndex: number; properties: { spinelFormula: unknown } }[];
  };
  try {
    await page.goto(`/?item=${host.id}`);
    await expect(page.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
      { timeout: 30_000 },
    );
    await page.locator('.univer-container').click({ position: { x: 130, y: 200 } });
    const input = page.locator('[contenteditable="true"][data-u-comp="editor"]');
    await input.focus();
    await expect(input).toBeFocused();
    // Create through the real UI, but retain the start-of-document boundary that
    // a hand-built fixture exercised. Reload then verifies activation of saved objects.
    await page.keyboard.press('Control+Home');
    await page.getByRole('button', { name: 'Document actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Insert formula', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Insert formula', exact: true });
    await dialog.getByLabel('Formula', { exact: true }).fill(expression);
    await dialog.getByRole('button', { name: 'Insert formula', exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 20_000 });
    await expect(input).toBeFocused();
    await expect.poll(async () => (await readRanges()).length).toBe(1);
    expect((await readRanges())[0].startIndex).toBe(0);
    expect((await readSnapshot()).body.dataStream).toBe(expression + '\r\n');
    await page.reload();
    await expect(page.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
      { timeout: 30_000 },
    );
    await page.locator('.univer-container').click({ position: { x: 130, y: 200 } });
    const editDialog = page.getByRole('dialog', { name: 'Edit formula' });
    if (await editDialog.isVisible())
      await editDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(editDialog).toHaveCount(0);
    await input.focus();
    await expect(input).toBeFocused();
    const originalFormula = (await readRanges())[0];
    const paragraphsBeforePaste = (await readSnapshot()).body.paragraphs.length;
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+c');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain(expression);
    clipboardHtml = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      const html = items.find((item) => item.types.includes('text/html'));
      return html ? (await html.getType('text/html')).text() : '';
    });
    await info.attach('formula-clipboard.html', { body: clipboardHtml, contentType: 'text/html' });
    // Chromium sanitizes HTML comments. The SDK's same-page rich clipboard uses
    // this retained ID to retrieve the original body, including formula metadata.
    // The persisted ranges below verify that fallback rather than requiring a
    // browser-specific representation of the embedded clipboard fragment.
    expect(clipboardHtml).toMatch(/data-copy-id="[^"]+"/u);
    expect(clipboardHtml).toContain(expression);
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    // Enter updates native selection asynchronously. Wait for its persisted mutation
    // before paste, which deliberately cancels when the selection changes mid-read.
    await expect
      .poll(async () => (await readSnapshot()).body.paragraphs.length)
      .toBe(paragraphsBeforePaste + 1);
    await expect(input).toBeFocused();
    await page.keyboard.press('Control+v');
    await expect.poll(async () => (await readRanges()).length).toBe(2);
    const ranges = await readRanges();
    expect(new Set(ranges.map((range) => range.rangeId)).size).toBe(2);
    expect(ranges.some((range) => range.rangeId === originalFormula.rangeId)).toBe(true);
    for (const range of ranges)
      expect(range.properties.spinelFormula).toEqual(originalFormula.properties.spinelFormula);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await readRanges()).length).toBe(1);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(async () => (await readRanges()).length).toBe(2);
  } catch (error) {
    const failedSnapshot = await readSnapshot();
    // CI retains the job log even when Playwright's arbitrary attachments are omitted.
    console.error(
      'Formula clipboard failure',
      JSON.stringify({
        browserErrors,
        html: clipboardHtml.slice(0, 12000),
        body: failedSnapshot.body,
        focused: await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 500)),
      }),
    );
    await info.attach('formula-clipboard-snapshot.json', {
      body: JSON.stringify(failedSnapshot, null, 2),
      contentType: 'application/json',
    });
    await page.screenshot({
      path: info.outputPath('formula-clipboard-failure.png'),
      fullPage: true,
    });
    throw error;
  } finally {
    await page.goto('/sign-in').catch(() => {});
    db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(owner.id);
    db.prepare('DELETE FROM auth_users WHERE id=?').run(owner.id);
    db.close();
  }
});
