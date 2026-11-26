import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { downloadPdf, inspectPdf } from './pdfEvidence.ts';
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
      const pdfDownload = await downloadPdf(
        page,
        page.getByRole('button', { name: 'Export as PDF', exact: true }),
      );
      await inspectPdf(pdfDownload, info, kind, {
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
      await expect(
        page.getByLabel('Univer, CSV or TSV file or archive', { exact: true }),
      ).toBeHidden();
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
        'Choose a Univer JSON, CSV or TSV file or a Spinel ZIP archive',
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

// SPN-093. Parser cases live in delimited.test.ts; the browser proves only that the exact
// cells reach the native editor, survive an edit and reload, and that a refused file adds nothing.
const TABLE = [
  ['id', 'note', 'code'],
  ['007', 'a,b', '=1+1'],
  ['', 'two\nlines', '2026-01-02'],
];
const delimited = (kind: 'csv' | 'tsv') => {
  const quote = (field: string) =>
    /[",\t\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
  return `﻿${TABLE.map((row) => row.map(quote).join(kind === 'csv' ? ',' : '\t')).join('\r\n')}\r\n`;
};

for (const [kind, how] of [
  ['csv', 'choose'],
  ['tsv', 'drop'],
] as const) {
  test(`${kind} file is ${how === 'choose' ? 'chosen' : 'dropped'} as a literal new Sheet that edits and reloads`, async ({
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
    // Each case owns its user and folder, so retries and projects never share imported items.
    const user = auth.createUser(`Table ${kind} ${info.testId}`);
    const folder = workspace.create(user.id, { name: 'Tables', kind: 'folder', parentId: null });
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
    page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
    const children = () => workspace.list(user.id).filter((entry) => entry.parentId === folder.id);
    const closeDialog = () =>
      page
        .getByRole('dialog', { name: 'Import file', exact: true })
        .getByRole('button', { name: 'Close dialog', exact: true })
        .click();
    try {
      await page.goto(`/?item=${folder.id}`);
      await page.getByRole('button', { name: 'New', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Import file…', exact: true }).click();
      const input = page.getByLabel('Univer, CSV or TSV file or archive', { exact: true });
      // Refusals first: each must explain itself and leave the folder empty.
      await input.setInputFiles({
        name: 'plain.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('a,b\n'),
      });
      await expect(page.getByRole('alert')).toContainText(
        'Choose a Univer JSON, CSV or TSV file or a Spinel ZIP archive',
      );
      await input.setInputFiles({
        name: 'latin1.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from([0x61, 0x2c, 0xff, 0xc3, 0x28]),
      });
      await expect(page.getByRole('alert')).toContainText('not UTF-8 text');
      await input.setInputFiles({
        name: 'broken.tsv',
        mimeType: 'text/tab-separated-values',
        buffer: Buffer.from('a\t"b\n'),
      });
      await expect(page.getByRole('alert')).toContainText('never closed');
      expect(children()).toHaveLength(0);
      const file = {
        name: `orders-${kind}.${kind}`,
        mimeType: kind === 'csv' ? 'text/csv' : 'text/tab-separated-values',
        buffer: Buffer.from(delimited(kind)),
      };
      if (how === 'choose') await input.setInputFiles(file);
      else {
        await closeDialog();
        const transfer = await page.evaluateHandle(
          ({ name, text }) => {
            const data = new DataTransfer();
            data.items.add(new File([text], name));
            return data;
          },
          { name: file.name, text: file.buffer.toString() },
        );
        try {
          await page
            .locator('section.dashboard-content')
            .dispatchEvent('drop', { dataTransfer: transfer });
        } finally {
          await transfer.dispose();
        }
      }
      await expect.poll(() => children().length).toBe(1);
      const [sheet] = children();
      expect(sheet).toMatchObject({ kind: 'sheet', name: `orders-${kind}` });
      const cells = async () => {
        const { snapshot } = await (
          await context.request.get(`/api/items/${sheet.id}/sheet`)
        ).json();
        expect(snapshot.sheetOrder).toHaveLength(1);
        return snapshot.sheets[snapshot.sheetOrder[0]].cellData;
      };
      const expectLiteral = async (edited: boolean) => {
        const data = await cells();
        const at = (row: number, column: number) => data[row]?.[column]?.v;
        expect([at(0, 0), at(0, 1), at(0, 2)]).toEqual([
          edited ? 'Edited by test' : 'id',
          'note',
          'code',
        ]);
        expect([at(1, 0), at(1, 1), at(1, 2)]).toEqual(['007', 'a,b', '=1+1']);
        expect([at(2, 0), at(2, 1), at(2, 2)]).toEqual([undefined, 'two\nlines', '2026-01-02']);
        expect(JSON.stringify(data)).not.toContain('"f"');
      };
      await expectLiteral(false);
      await page.goto(`/?item=${sheet.id}`);
      const region = page.getByRole('region', { name: 'Sheet document', exact: true });
      const saved = () =>
        expect(region.getByRole('status', { name: 'Save status' })).toHaveText(
          'All changes saved.',
          {
            timeout: 25_000,
          },
        );
      await saved();
      const box = region.getByRole('textbox').nth(2);
      await box.fill('A1');
      await box.press('Enter');
      await page.keyboard.type('Edited by test');
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await cells())[0]?.[0]?.v).toBe('Edited by test');
      await saved();
      await page.reload();
      await saved();
      await expectLiteral(true);
      expect(errors).toEqual([]);
    } finally {
      await page.goto('/sign-in').catch(() => {});
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
