import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { getDocsEmptySnapshot, LocaleType } from '@univerjs/core';
import { formulaBody } from '@spinel/doc-formulas';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { SheetStore } from '../src/server/workspace/sheets.ts';
import { DocumentStore } from '../src/server/workspace/documents.ts';

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
  const owner = auth.createUser(`Formula owner ${info.testId}`);
  const friend = auth.createUser(`Formula friend ${info.testId}`);
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
  let printedText: string[] | undefined;
  await context.exposeBinding('captureFormulaPrint', (_source, text: string[]) => {
    printedText = text;
  });
  for (const target of [page, other]) target.on('pageerror', (error) => errors.push(error.message));
  // Observe actual native canvas text, not just the accessible Formula panel.
  await context.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    const painted: string[] = [];
    Object.assign(window, { formulaPaintedText: painted });
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      painted.push(text);
      if (painted.length > 20000) painted.splice(0, 10000);
      return original.call(this, text, ...args);
    };
    window.print = () => {
      painted.length = 0;
      window.dispatchEvent(new Event('beforeprint'));
      void new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ).then(async () => {
        await (
          window as unknown as { captureFormulaPrint: (text: string[]) => Promise<void> }
        ).captureFormulaPrint([...painted]);
        window.dispatchEvent(new Event('afterprint'));
      });
    };
  });
  const saved = (target: Page) =>
    expect(target.getByRole('status', { name: 'Save status' })).toHaveText('All changes saved.', {
      timeout: 30_000,
    });
  const read = async () =>
    (await (await context.request.get(`/api/items/${host.id}/doc`)).json()).snapshot;
  const formulaPanel = (target: Page) => target.locator('details.doc-formulas');
  const openPanel = async (target: Page) => {
    const panel = formulaPanel(target);
    if (!(await panel.evaluate((node) => (node as HTMLDetailsElement).open)))
      await panel.locator('summary').click();
    return panel;
  };
  const insert = async (expression: string) => {
    await page.locator('.univer-container').click({ position: { x: 130, y: 200 } });
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    const panel = await openPanel(page);
    await panel.getByRole('button', { name: 'Insert formula', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Insert formula', exact: true });
    await dialog.getByLabel('Formula', { exact: true }).fill(expression);
    await dialog.getByRole('button', { name: 'Insert formula', exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 20_000 });
    await saved(page);
    await expect.poll(async () => JSON.stringify(await read())).toContain(expression);
    return panel
      .getByRole('listitem')
      .filter({ has: page.getByRole('button', { name: expression, exact: true }) });
  };
  const screenshots = async (name: string) => {
    await mkdir('test-results/theme-screenshots', { recursive: true });
    for (const [theme, width] of [
      ['light', 1440],
      ['dark', 1440],
      ['light', 390],
    ] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width, height: 1100 });
      await page.screenshot({
        path: `test-results/theme-screenshots/formulas-${info.project.name}-${name}-${theme}-${width}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1440, height: 1100 });
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
    await screenshots('results');
    await page.locator('.file-exports summary').click();
    await page.getByRole('button', { name: 'Print / save PDF', exact: true }).click();
    await expect.poll(() => printedText, { timeout: 20_000 }).toBeDefined();
    expect(
      printedText!.some((text) => /unavailable|Budget\.Summary|Forecast\.Summary/.test(text)),
    ).toBe(true);
    expect(printedText!.join(' ')).not.toContain('314159');
    expect(printedText!.join(' ')).not.toContain('314166');
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
    await expect(edit).not.toBeVisible();
    await saved(page);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => JSON.stringify(await read())).toContain('={1,2;3,4}');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(async () => JSON.stringify(await read())).toContain('={5,6;7,8}');

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
    await otherPanel.getByRole('button', { name: '={5,6;7,8}', exact: true }).click();
    const collaboratorEdit = other.getByRole('dialog', { name: 'Edit formula', exact: true });
    await collaboratorEdit.getByLabel('Formula', { exact: true }).fill('={9,10;11,12}');
    await collaboratorEdit.getByRole('button', { name: 'Save formula', exact: true }).click();
    await expect(collaboratorEdit).not.toBeVisible();
    await saved(other);
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
  const body = formulaBody('original-formula', { version: 1, expression, references: [] });
  const snapshot = getDocsEmptySnapshot(host.id);
  snapshot.body = {
    ...snapshot.body,
    ...body,
    dataStream: expression + '\r\n',
    paragraphs: [{ startIndex: expression.length, paragraphId: 'formula-paragraph' }],
  };
  new DocumentStore(workspace).save(owner.id, host.id, {
    snapshot,
    revision: 0,
    writeId: crypto.randomUUID(),
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
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const readRanges = async () => {
    const saved = (await (await context.request.get(`/api/items/${host.id}/doc`)).json()).snapshot;
    return (saved.body.customRanges ?? []).filter(
      (range: { properties?: { spinelFormula?: unknown } }) => range.properties?.spinelFormula,
    ) as { rangeId: string }[];
  };
  try {
    await page.goto(`/?item=${host.id}`);
    await expect(page.getByRole('status', { name: 'Save status' })).toHaveText(
      'All changes saved.',
      { timeout: 30_000 },
    );
    await page.locator('.univer-container').click({ position: { x: 130, y: 200 } });
    // If activation opens the edit dialog, dismiss it before native text selection.
    const dialog = page.getByRole('dialog', { name: 'Edit formula' });
    if (await dialog.isVisible())
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+c');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain(expression);
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+v');
    await expect.poll(async () => (await readRanges()).length).toBe(2);
    const ranges = await readRanges();
    expect(new Set(ranges.map((range) => range.rangeId)).size).toBe(2);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => (await readRanges()).length).toBe(1);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(async () => (await readRanges()).length).toBe(2);
  } finally {
    await page.goto('/sign-in').catch(() => {});
    db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(owner.id);
    db.prepare('DELETE FROM auth_users WHERE id=?').run(owner.id);
    db.close();
  }
});
