import { readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { createCanvas } from '@napi-rs/canvas';
import sharp from 'sharp';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

for (const kind of ['sheet', 'doc'] as const) {
  test(`${kind} downloads current native content, imports by folder drop and opens its printed PDF`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.setTimeout(120_000);
    page.setDefaultTimeout(10_000);
    await page.setViewportSize({ width: 1440, height: 1100 });
    const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
    const auth = new AuthStore(db),
      workspace = new WorkspaceStore(auth);
    const user = auth.createUser('Portable ' + info.testId);
    const item = workspace.create(user.id, { name: `Portable ${kind}`, kind, parentId: null });
    const folder = workspace.create(user.id, {
      name: 'Imported files',
      kind: 'folder',
      parentId: null,
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
    let printHtml = '';
    await context.exposeBinding('captureNativePrint', (_source, html: string) => {
      printHtml = html;
    });
    // Intercept only the browser's print entry point. Keep the plugin's licensed
    // rendering, page selection and watermarks intact; never inspect Pro internals.
    await context.addInitScript(() => {
      window.print = () => {
        window.dispatchEvent(new Event('beforeprint'));
        const clone = document.documentElement.cloneNode(true) as HTMLElement;
        const original = [...document.querySelectorAll('canvas')];
        clone.querySelectorAll('canvas').forEach((canvas, index) => {
          const image = document.createElement('img');
          image.src = original[index].toDataURL();
          image.style.cssText = canvas.style.cssText;
          image.width = original[index].width;
          image.height = original[index].height;
          canvas.replaceWith(image);
        });
        clone.querySelectorAll('script').forEach((script) => script.remove());
        const base = document.createElement('base');
        base.href = document.baseURI;
        clone.querySelector('head')!.prepend(base);
        void (
          window as unknown as { captureNativePrint: (html: string) => Promise<void> }
        ).captureNativePrint(clone.outerHTML);
        window.dispatchEvent(new Event('afterprint'));
      };
    });
    try {
      await page.goto(`/?item=${item.id}`);
      const region = page.getByRole('region', {
        name: kind === 'sheet' ? 'Sheet document' : 'Doc document',
        exact: true,
      });
      const saved = () =>
        expect(region.getByRole('status', { name: 'Save status' })).toHaveText(
          'All changes saved.',
          { timeout: 25_000 },
        );
      await saved();
      if (kind === 'sheet') {
        const box = region.getByRole('textbox').nth(2);
        await box.fill('A1');
        await box.press('Enter');
        await page.keyboard.type('Portable proof 314');
        await page.keyboard.press('Enter');
      } else {
        await region.locator('.univer-container').click({ position: { x: 130, y: 200 } });
        await page.keyboard.type('Portable proof 314');
      }
      const live = () =>
        context.request.get(`/api/items/${item.id}/${kind}`).then((response) => response.json());
      await expect
        .poll(async () => JSON.stringify((await live()).snapshot))
        .toContain('Portable proof 314');
      await saved();
      if (kind === 'doc') {
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await region.getByRole('tab', { name: 'Insert', exact: true }).click();
        const chooser = page.waitForEvent('filechooser');
        await region.getByRole('button', { name: 'Image', exact: true }).click();
        await (
          await chooser
        ).setFiles({
          name: 'portable-orange.png',
          mimeType: 'image/png',
          buffer: await sharp({
            create: { width: 40, height: 20, channels: 3, background: '#ff9900' },
          })
            .png()
            .toBuffer(),
        });
        await expect.poll(async () => (await live()).snapshot.drawingsOrder?.length).toBe(1);
        await saved();
      }
      await region.locator('.file-exports summary').click();
      const downloadPromise = page.waitForEvent('download');
      await region.getByRole('button', { name: 'Download Univer file', exact: true }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(`Portable ${kind}.univer.json`);
      const bytes = await readFile((await download.path())!);
      expect(bytes.toString()).toContain('Portable proof 314');
      const snapshot = JSON.parse(bytes.toString());
      if (kind === 'doc')
        expect(snapshot.drawings[snapshot.drawingsOrder[0]].source).toMatch(
          /^data:image\/png;base64,/,
        );
      expect(
        kind === 'sheet'
          ? snapshot.sheets[snapshot.sheetOrder[0]].cellData[0][0].v
          : snapshot.body.dataStream,
      ).toContain('Portable proof 314');
      // Exercise the actual app export control and plugin print UI.
      await region.getByRole('button', { name: 'Print / save PDF', exact: true }).click();
      await expect(region.getByRole('alert')).toHaveCount(0);
      if (kind === 'sheet') await page.getByRole('button', { name: /^next$/i }).click();
      await expect.poll(() => printHtml.includes('<img'), { timeout: 20_000 }).toBe(true);
      const printed = await context.newPage();
      try {
        await printed.emulateMedia({ media: 'print' });
        await printed.setContent(printHtml, { waitUntil: 'networkidle' });
        // Native printing retains the app DOM and hides it with @media print.
        // Assert printed visibility, not absence from the serialized HTML.
        await expect(printed.getByText('Your workspace', { exact: true })).toBeHidden();
        await printed.evaluate(() =>
          Promise.all([...document.images].map((image) => image.decode().catch(() => {}))),
        );
        const pdf = await printed.pdf({
          path: info.outputPath(`${kind}-export.pdf`),
          printBackground: true,
          preferCSSPageSize: true,
        });
        expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
        const loading = getDocument({ data: new Uint8Array(pdf), useSystemFonts: true });
        const reopened = await loading.promise;
        try {
          expect(reopened.numPages).toBeGreaterThan(0);
          const first = await reopened.getPage(1),
            viewport = first.getViewport({ scale: 1 });
          const text = (await first.getTextContent()).items
            .map((item) => ('str' in item ? item.str : ''))
            .join(' ');
          expect(text).not.toContain('Your workspace');
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          await first.render({
            canvas: canvas as unknown as HTMLCanvasElement,
            canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
            viewport,
          }).promise;
          const pixels = canvas
            .getContext('2d')
            .getImageData(0, 0, canvas.width, canvas.height).data;
          let ink = 0;
          for (let index = 0; index < pixels.length; index += 4)
            if (
              pixels[index + 3] &&
              Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) < 240
            )
              ink++;
          await writeFile(info.outputPath(`${kind}-export-opened.png`), await canvas.encode('png'));
          expect(ink, 'The reopened PDF must contain visible printed content').toBeGreaterThan(50);
          // An empty page would have no image painting operations for Univer's canvas output.
          expect(
            (await first.getOperatorList()).fnArray.some((operation) =>
              [
                OPS.paintImageXObject,
                OPS.paintInlineImageXObject,
                OPS.paintImageMaskXObject,
              ].includes(operation),
            ),
          ).toBe(true);
        } finally {
          await loading.destroy();
        }
      } finally {
        await printed.close();
      }
      await page.goto(`/?item=${folder.id}`);
      await expect(
        page.getByRole('button', { name: 'Import Univer file', exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel('Univer file', { exact: true })).toBeHidden();
      const drop = async (target: string, filename: string, text: string) => {
        const transfer = await page.evaluateHandle(
          ({ filename, text }) => {
            const data = new DataTransfer();
            data.items.add(new File([text], filename));
            return data;
          },
          { filename, text },
        );
        try {
          await page.locator(target).dispatchEvent('drop', { dataTransfer: transfer });
        } finally {
          await transfer.dispose();
        }
      };
      // The empty folder pane and sibling file list must both handle drops.
      await drop('section.files', 'not-a-univer.pdf', '%PDF-');
      await expect(page.getByRole('alert')).toContainText('Only Univer JSON files can be imported');
      await drop('ul.file-list', download.suggestedFilename(), bytes.toString());
      const imported = page.locator('.file-list li').filter({ hasText: `Portable ${kind}` });
      await expect(imported).toHaveCount(1);
      const copies = workspace.list(user.id).filter((entry) => entry.parentId === folder.id);
      expect(copies).toHaveLength(1);
      expect(copies[0].id).not.toBe(item.id);
      await page.goto(`/?item=${copies[0].id}`);
      await saved();
      await page.reload();
      await saved();
      const copy = await (await context.request.get(`/api/items/${copies[0].id}/${kind}`)).json();
      expect(JSON.stringify(copy.snapshot)).toContain('Portable proof 314');
      if (kind === 'doc') {
        const source = copy.snapshot.drawings[copy.snapshot.drawingsOrder[0]].source;
        expect(source).toContain(`/api/items/${copies[0].id}/images/`);
        const image = await context.request.get(source);
        expect(image.ok()).toBe(true);
        expect((await image.body()).toString('base64')).toBe(
          snapshot.drawings[snapshot.drawingsOrder[0]].source.split(',')[1],
        );
      }
      expect(errors).toEqual([]);
    } finally {
      await page.goto('/sign-in').catch(() => {});
      // Folder parents use RESTRICT; remove this fixture's children first.
      db.prepare('DELETE FROM workspace_items WHERE owner_id=? AND parent_id=?').run(
        user.id,
        folder.id,
      );
      db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(user.id);
      db.prepare('DELETE FROM auth_users WHERE id=?').run(user.id);
      db.close();
    }
  });
}
