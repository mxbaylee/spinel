import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { inspectPdf } from './pdfEvidence.ts';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

for (const kind of ['sheet', 'doc'] as const) {
  test(`${kind} downloads current native content, imports by folder drop and opens its direct PDF download`, async ({
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
    let phase = 'open source editor';
    page.on('pageerror', (error) => errors.push(`${phase}: ${error.stack ?? error.message}`));
    await context.addInitScript(() => {
      window.print = () => {
        throw new Error('Browser print must not be called.');
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
      await page.getByRole('button', { name: 'Document actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download Univer file', exact: true }).click();
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
      phase = 'download complete PDF';
      const pdfDownload = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export as PDF', exact: true }).click();
      await inspectPdf(await pdfDownload, info, kind, {
        text: ['Portable proof 314'],
        forbidden: [user.name, 'Your workspace'],
        image: kind === 'doc',
      });
      await expect(page.getByRole('dialog', { name: 'Export', exact: true })).toContainText(
        'PDF download started.',
      );
      phase = 'leave source editor and import';
      await page.goto(`/?item=${folder.id}`);
      await page.getByRole('button', { name: 'New', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Import file…', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Choose file', exact: true })).toBeVisible();
      await expect(page.getByLabel('Univer file or archive', { exact: true })).toBeHidden();
      await page
        .getByRole('dialog', { name: 'Import file', exact: true })
        .getByRole('button', { name: 'Close dialog', exact: true })
        .click();
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
      await drop('section.dashboard-content', 'not-a-univer.pdf', '%PDF-');
      await expect(page.getByRole('alert')).toContainText(
        'Choose a Univer JSON file or Spinel ZIP archive',
      );
      await page
        .getByRole('dialog', { name: 'Import file', exact: true })
        .getByRole('button', { name: 'Close dialog', exact: true })
        .click();
      await drop(
        '[role="list"][aria-label="Folder contents"]',
        download.suggestedFilename(),
        bytes.toString(),
      );
      const imported = page
        .getByRole('list', { name: 'Folder contents', exact: true })
        .getByRole('listitem')
        .filter({ hasText: `Portable ${kind}` });
      await expect(imported).toHaveCount(1);
      const copies = workspace.list(user.id).filter((entry) => entry.parentId === folder.id);
      expect(copies).toHaveLength(1);
      expect(copies[0].id).not.toBe(item.id);
      phase = 'open imported editor';
      await page.goto(`/?item=${copies[0].id}`);
      await saved();
      phase = 'reload imported editor';
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
