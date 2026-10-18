import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { SheetStore } from '../src/server/workspace/sheets.ts';
import { mkdir } from 'node:fs/promises';
import type { IWorkbookData } from '@univerjs/core';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

test('themes persist, follow the system, and recolour sheet presets without editing documents', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(10_000);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db),
    store = new WorkspaceStore(auth);
  const user = auth.createUser(`Theme ${info.testId}`);
  const sheet = store.create(user.id, { name: 'Theme budget', kind: 'sheet', parentId: null });
  const doc = store.create(user.id, { name: 'Theme journal', kind: 'doc', parentId: null });
  const richCell = {
    p: {
      id: 'rich-text',
      documentStyle: {},
      body: {
        dataStream: 'Rich text\r\n',
        textRuns: [
          { st: 0, ed: 4, ts: { bl: 1 } },
          { st: 5, ed: 9, ts: { it: 1 } },
        ],
      },
    },
  };
  new SheetStore(store).save(user.id, sheet.id, {
    revision: 0,
    writeId: randomUUID(),
    snapshot: {
      id: sheet.id,
      name: 'Theme budget',
      appVersion: '1.1.0',
      locale: 'enUS',
      styles: {},
      sheetOrder: ['first'],
      sheets: {
        first: {
          id: 'first',
          name: 'Sheet1',
          rowCount: 100,
          columnCount: 26,
          cellData: { 2: { 0: richCell }, 4: { 0: { v: 'Plain text' } } },
        },
      },
    },
  });
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: auth.createSession(user.id).token,
      url: baseURL!.replace('http:', 'https:'),
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const saved = () =>
    expect(page.getByRole('status', { name: 'Save status' })).toHaveText('All changes saved.', {
      timeout: 20000,
    });
  const read = async () =>
    (await (await context.request.get(`/api/items/${sheet.id}/sheet`)).json()) as {
      snapshot: IWorkbookData;
      revision: number;
    };
  const capture = async (name: string) => {
    await mkdir('test-results/theme-screenshots', { recursive: true });
    await page.screenshot({
      animations: 'disabled',
      path: `test-results/theme-screenshots/${info.project.name}-${name}.png`,
    });
  };
  const mode = (value: string) => expect(page.locator('html')).toHaveAttribute('data-theme', value);
  const select = async (address: string) => {
    const box = page
      .getByRole('region', { name: 'Sheet document', exact: true })
      .getByRole('textbox')
      .nth(2);
    await box.fill(address);
    await box.press('Enter');
  };
  const sheetCanvas = page.locator(`#univer-sheet-main-canvas_${sheet.id}`);
  const colouredPixels = async (rgb: number[]) =>
    sheetCanvas.evaluateAll((canvases, colour) => {
      let count = 0;
      for (const canvas of canvases as HTMLCanvasElement[]) {
        if (!canvas.width || !canvas.height) continue;
        const pixels = canvas
          .getContext('2d')
          ?.getImageData(0, 0, canvas.width, canvas.height).data;
        if (pixels)
          for (let i = 0; i < pixels.length; i += 4)
            if (
              pixels[i] === colour[0] &&
              pixels[i + 1] === colour[1] &&
              pixels[i + 2] === colour[2] &&
              pixels[i + 3] === 255
            )
              count++;
      }
      return count;
    }, rgb);
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Theme budget/ })).toBeVisible();
    await mode('light');
    await capture('dashboard-light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await mode('dark');
    await capture('dashboard-dark');
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('light');
    await page.reload();
    await mode('light');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await mode('light');
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('system');
    await mode('dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(`/?item=${sheet.id}`);
    await saved();
    await select('A1');
    await page.keyboard.type('12');
    await page.keyboard.press('Enter');
    await saved();
    await select('B1');
    await page.keyboard.type('=A1*2');
    await page.keyboard.press('Enter');
    await saved();
    await select('A1');
    await page.getByRole('button', { name: 'Bold', exact: true }).click();
    await saved();
    await select('A1:B1');
    await page.getByText('Cell fill presets', { exact: true }).click();
    await page.getByRole('button', { name: 'Apply Warning, strong fill', exact: true }).click();
    await saved();
    await select('A3');
    await page.getByRole('button', { name: 'Apply Primary, soft fill', exact: true }).click();
    await saved();
    // The previous Saved label can remain briefly while a new command is queued.
    // Establish the baseline only after the last fill is durable on the server.
    await expect
      .poll(async () => {
        const { snapshot } = await read();
        const style = snapshot.sheets.first.cellData?.[2]?.[0]?.s;
        return (typeof style === 'string' ? snapshot.styles[style] : style)?.bg?.rgb;
      })
      .toBe('#ffdde6');
    await saved();
    const before = await read();
    const cells = before.snapshot.sheets[before.snapshot.sheetOrder[0]].cellData![0]!;
    expect(cells[0]?.v).toBe(12);
    expect(cells[1]?.f).toBe('=A1*2');
    expect(cells[1]?.v).toBe(24);
    const style = cells[0]!.s;
    const resolved = typeof style === 'string' ? before.snapshot.styles[style] : style;
    expect(resolved?.bl).toBe(1);
    expect(resolved?.bg?.rgb).toBe('#f2a93b');
    await page.getByText('Cell fill presets', { exact: true }).click();
    await select('C3');
    await expect(sheetCanvas).toBeVisible();
    await expect.poll(() => colouredPixels([242, 169, 59])).toBeGreaterThan(100);
    await capture('sheet-light');
    const container = await sheetCanvas.elementHandle();
    await page.emulateMedia({ colorScheme: 'dark' });
    await mode('dark');
    await expect.poll(() => colouredPixels([255, 181, 71])).toBeGreaterThan(100);
    expect(await container!.evaluate((node) => node.isConnected)).toBe(true);
    await expect(sheetCanvas).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    expect((await read()).snapshot.sheets.first.cellData?.[4]?.[0]?.v).toBe('Plain text');
    await expect.poll(() => colouredPixels([0, 0, 0])).toBeGreaterThan(5);
    await expect.poll(() => colouredPixels([255, 156, 198])).toBeGreaterThan(5);
    const badge = page
      .getByRole('group', { name: 'People in this document' })
      .getByRole('button')
      .first();
    await expect(badge).toHaveCSS('color', 'rgb(255, 255, 255)');
    await badge.focus();
    await expect(badge.locator('.collaborator-name')).toHaveCSS('color', 'rgb(26, 18, 37)');
    await capture('sheet-dark');
    expect((await read()).revision).toBe(before.revision);
    await page.reload();
    await saved();
    await expect.poll(() => colouredPixels([255, 181, 71])).toBeGreaterThan(100);
    expect((await read()).revision).toBe(before.revision);
    await select('A3');
    await page.keyboard.press('F2');
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await page.keyboard.press('Enter');
    await saved();
    const edited = await read();
    const rich = edited.snapshot.sheets[edited.snapshot.sheetOrder[0]].cellData![2]![0]!;
    expect(rich.p?.body?.dataStream).toContain('Rich text!');
    expect(rich.p?.body?.textRuns?.some((run) => run.ts?.bl === 1)).toBe(true);
    expect(rich.p?.body?.textRuns?.some((run) => run.ts?.it === 1)).toBe(true);
    for (const run of rich.p?.body?.textRuns ?? [])
      if (run.ts?.cl) expect(run.ts.cl.rgb).toBe('#8a1d3f');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => colouredPixels([138, 29, 63])).toBeGreaterThan(5);
    expect((await read()).revision).toBe(edited.revision);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`/?item=${doc.id}`);
    await saved();
    await expect(
      page.getByText('Click the page to write. Type / for commands.', { exact: true }),
    ).toBeVisible();
    const docEditor = page.getByRole('region', { name: 'Doc document', exact: true });
    await expect(docEditor.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
    await docEditor.locator('.univer-container').click({ position: { x: 130, y: 200 } });
    await page.keyboard.type('Paper stays readable');
    await expect
      .poll(async () => {
        const data = await (await context.request.get(`/api/items/${doc.id}/doc`)).json();
        return data.snapshot?.body?.dataStream;
      })
      .toContain('Paper stays readable');
    await saved();
    await expect(page.locator('.editor-help')).toHaveCSS('color', 'rgb(236, 226, 247)');
    await capture('doc-dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await mode('light');
    await expect(page.locator('.editor-help')).toHaveCSS('color', 'rgb(74, 30, 51)');
    await capture('doc-light');
    expect(errors).toEqual([]);
  } finally {
    db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(user.id);
    db.prepare('DELETE FROM auth_users WHERE id=?').run(user.id);
    db.close();
  }
});
