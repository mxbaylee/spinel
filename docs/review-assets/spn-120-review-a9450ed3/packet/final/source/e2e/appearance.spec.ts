import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { SheetStore } from '../src/server/workspace/sheets.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { ColorKit, invertColorByMatrix } from '@univerjs/core';
import type { IWorkbookData } from '@univerjs/core';
import { editorNeutrals } from '../src/ui/palette.ts';
import { presetStyle } from '../src/ui/presetStyles.ts';
import { defaultProfile } from '../src/profile/profile.ts';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { resolvedWorkbook } from './workbook-state.ts';
import { expectNativeSheetValue } from './native-sheet-value.ts';

test('themes persist, follow the system, and recolour sheet presets without editing documents', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(10_000);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db),
    store = new WorkspaceStore(auth);
  const user = auth.createUser(`Theme ${info.testId}`);
  const sheet = store.create(user.id, { name: 'Theme budget', kind: 'sheet', parentId: null });
  const doc = store.create(user.id, { name: 'Theme journal', kind: 'doc', parentId: null });
  const richForeground = presetStyle('primary-soft', 'light').cl!;
  const richCell = {
    p: {
      id: 'rich-text',
      documentStyle: { textStyle: { cl: richForeground } },
      body: {
        dataStream: 'Rich text\r\n',
        textRuns: [
          { st: 0, ed: 4, ts: { bl: 1, cl: richForeground } },
          { st: 5, ed: 9, ts: { it: 1, cl: richForeground } },
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
          // Legacy stored pairs must retain their appearance after the preset entry point is removed.
          cellData: {
            0: {
              0: { s: presetStyle('warning-strong', 'light') },
              1: { s: presetStyle('warning-strong', 'light') },
            },
            2: { 0: { ...richCell, s: presetStyle('primary-soft', 'light') } },
            4: { 0: { v: 'Plain text' } },
          },
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
  const syncFrames: object[] = [];
  const resyncs: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', (socket) => {
    if (!socket.url().includes('/sync-api/')) return;
    const record =
      (direction: string) =>
      ({ payload }: { payload: string | Buffer }) => {
        try {
          const frame = JSON.parse(String(payload));
          if (frame.type === 'resync') resyncs.push(frame.reason);
          syncFrames.push({
            direction,
            type: frame.type,
            revision: frame.revision,
            baseRevision: frame.baseRevision,
            mutationId: frame.mutationId,
            hash: frame.hash,
            reason: frame.reason,
            mutations: frame.mutations?.map((mutation: { id: string }) => mutation.id),
          });
          if (syncFrames.length > 200) syncFrames.shift();
        } catch {
          syncFrames.push({ direction, malformed: true });
        }
      };
    socket.on('framesent', record('sent'));
    socket.on('framereceived', record('received'));
  });
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
  const colouredPixels = async (rgb: number[], target = sheetCanvas) =>
    target.evaluateAll((canvases, colour) => {
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
  const surfaceFraction = async (scheme: 'light' | 'dark', target = sheetCanvas) => {
    // Empty Sheet cells are transparent over the SDK's dark CSS surface.
    // Inspect the composited canvas region, not an assumed opaque black fill.
    const image = await loadImage(await target.screenshot());
    const canvas = createCanvas(image.width, image.height);
    const drawing = canvas.getContext('2d');
    drawing.drawImage(image, 0, 0);
    const { data } = drawing.getImageData(0, 0, image.width, image.height);
    let matching = 0;
    for (let i = 0; i < data.length; i += 4)
      if (
        data[i + 3] === 255 &&
        (scheme === 'dark'
          ? Math.max(data[i], data[i + 1], data[i + 2]) < 96
          : Math.min(data[i], data[i + 1], data[i + 2]) > 192)
      )
        matching++;
    return matching / (image.width * image.height);
  };
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'My files', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Theme budget/ })).toBeVisible();
    await mode('light');
    await capture('dashboard-light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await mode('dark');
    await capture('dashboard-dark');
    await page.getByRole('link', { name: 'Your profile', exact: true }).click();
    await page.locator('header').getByRole('radio', { name: 'Light', exact: true }).click();
    await page.reload();
    await mode('light');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await mode('light');
    await page.locator('header').getByRole('radio', { name: 'Follow system', exact: true }).click();
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
    await expect(page.getByText('Cell fill presets', { exact: true })).toHaveCount(0);
    await expect
      .poll(async () => {
        const { snapshot } = await read();
        const style = snapshot.sheets.first.cellData?.[0]?.[0]?.s;
        return (typeof style === 'string' ? snapshot.styles[style] : style)?.bg?.rgb;
      })
      .toBe('#f2a93b');
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
    await expectNativeSheetValue(page, 'B1', '24');
    const style = cells[0]!.s;
    const resolved = typeof style === 'string' ? before.snapshot.styles[style] : style;
    expect(resolved?.bl).toBe(1);
    expect(resolved?.bg?.rgb).toBe('#f2a93b');
    await select('C3');
    await expect(sheetCanvas).toBeVisible();
    await expect.poll(() => colouredPixels([242, 169, 59])).toBeGreaterThan(100);
    await capture('sheet-light');
    const container = await sheetCanvas.elementHandle();
    await page.emulateMedia({ colorScheme: 'dark' });
    await mode('dark');
    await expect.poll(() => colouredPixels([255, 181, 71])).toBeGreaterThan(100);
    expect(await container!.evaluate((node) => node.isConnected)).toBe(true);
    // The native renderer changes the paper itself, not only surrounding chrome.
    await expect(sheetCanvas).not.toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect.poll(() => surfaceFraction('dark')).toBeGreaterThan(0.8);
    expect((await read()).snapshot.sheets.first.cellData?.[4]?.[0]?.v).toBe('Plain text');
    await expect.poll(() => colouredPixels([255, 255, 255])).toBeGreaterThan(5);
    await expect.poll(() => colouredPixels([255, 156, 198])).toBeGreaterThan(5);
    await expectNativeSheetValue(page, 'B1', '24');
    await select('C3');
    await page.getByRole('button', { name: 'People in this document', exact: true }).click();
    const people = page.getByRole('dialog', { name: 'People in this document', exact: true });
    const badge = people.locator('.collaborator-badge').first();
    await expect(badge.locator('[data-profile-icon]')).toBeVisible();
    await expect(badge).toHaveCSS('border-radius', '8px');
    await badge.focus();
    const personForeground = presetStyle(defaultProfile(user.name).color, 'dark').cl!.rgb!;
    const foregroundRgb = [1, 3, 5].map((index) =>
      parseInt(personForeground.slice(index, index + 2), 16),
    );
    await expect(badge).toHaveCSS('color', `rgb(${foregroundRgb.join(', ')})`);
    await expect(people.getByText(user.name, { exact: true })).toBeVisible();
    await people.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(people).toHaveCount(0);
    await capture('sheet-dark');
    expect((await read()).revision).toBe(before.revision);
    expect(resolvedWorkbook((await read()).snapshot)).toEqual(resolvedWorkbook(before.snapshot));
    await page.reload();
    await saved();
    await expect.poll(() => colouredPixels([255, 181, 71])).toBeGreaterThan(100);
    await expectNativeSheetValue(page, 'B1', '24');
    expect((await read()).revision).toBe(before.revision);
    expect(resolvedWorkbook((await read()).snapshot)).toEqual(resolvedWorkbook(before.snapshot));
    await select('A3');
    await page.keyboard.press('F2');
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await page.keyboard.press('Enter');
    await saved();
    const edited = await read();
    const rich = edited.snapshot.sheets[edited.snapshot.sheetOrder[0]].cellData![2]![0]!;
    expect(rich.p?.body?.dataStream).toContain('Rich text!');
    expect(rich.p?.body?.textRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ts: expect.objectContaining({ bl: 1, cl: richForeground }) }),
        expect.objectContaining({ ts: expect.objectContaining({ it: 1, cl: richForeground }) }),
      ]),
    );
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
    const docCanvases = docEditor.locator('canvas');
    await expect.poll(() => surfaceFraction('dark', docCanvases.first())).toBeGreaterThan(0.8);
    // Native Docs types with gray.900, not literal black. Its dark-mode foreground
    // is the public renderer's transformed neutral (currently RGB 217,207,233).
    const { r, g, b } = new ColorKit(editorNeutrals[900]).toRgb();
    const docText: [number, number, number] = [r, g, b];
    await expect
      .poll(() => colouredPixels(invertColorByMatrix(docText), docCanvases))
      .toBeGreaterThan(5);
    const readDoc = async () => (await context.request.get(`/api/items/${doc.id}/doc`)).json();
    const docBeforeTheme = await readDoc();
    const docCanvas = await docCanvases.first().elementHandle();
    await capture('doc-dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await mode('light');
    await expect(page.locator('.editor-help')).toHaveCSS('color', 'rgb(74, 30, 51)');
    await expect.poll(() => surfaceFraction('light', docCanvases.first())).toBeGreaterThan(0.8);
    await expect.poll(() => colouredPixels(docText, docCanvases)).toBeGreaterThan(5);
    expect(await docCanvas!.evaluate((node) => node.isConnected)).toBe(true);
    const docAfterTheme = await readDoc();
    expect(docAfterTheme.revision).toBe(docBeforeTheme.revision);
    expect(docAfterTheme.snapshot).toEqual(docBeforeTheme.snapshot);
    await capture('doc-light');
    expect(errors).toEqual([]);
    expect(resyncs).toEqual([]);
  } catch (error) {
    await writeFile(
      info.outputPath('sync-diagnostics.json'),
      JSON.stringify({ errors, syncFrames }),
    );
    throw error;
  } finally {
    db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(user.id);
    db.prepare('DELETE FROM auth_users WHERE id=?').run(user.id);
    db.close();
  }
});
