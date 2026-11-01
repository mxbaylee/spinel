import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  createParagraphId,
  createSectionId,
  DocumentFlavor,
  getDocsEmptySnapshot,
  LocaleType,
  validateDocumentStructure,
} from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import type { WorkspaceItem } from '../src/shared/workspace.ts';
import { syncNetwork } from './sync-network.ts';

for (const kind of ['doc', 'sheet'] as const)
  test(`${kind} viewer gains editing at the same native position, then ${kind === 'doc' ? 'downgrade' : 'revocation'} still locks it`, async ({
    page,
    context,
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const database = openDatabase(`test-results/${info.project.name}/app.sqlite`);
    const auth = new AuthStore(database);
    const owner = auth.createUser(`Upgrade owner ${info.testId}`);
    const viewer = auth.createUser(`Upgrade viewer ${info.testId}`);
    const cookie = (userId: string) => ({
      name: COOKIE_NAME,
      value: auth.createSession(userId).token,
      url: baseURL!.replace('http:', 'https:'),
      secure: true,
      httpOnly: true,
      sameSite: 'Strict' as const,
    });
    await context.addCookies([cookie(viewer.id)]);
    const control = await browser.newContext({ baseURL });
    await control.addCookies([cookie(owner.id)]);
    const network = await syncNetwork(context);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let navigations = 0;
    let navigationCount: number | undefined;
    let upgradedInMs: number | undefined;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations++;
    });
    const headers = { Origin: baseURL! };
    const create = async (
      kind: 'doc' | 'sheet' | 'folder',
      name: string,
      parentId: string | null,
    ) => {
      const response = await control.request.post('/api/items', {
        headers,
        data: { kind, name, parentId },
      });
      expect(response.status(), await response.text()).toBe(201);
      return (await response.json()).item as WorkspaceItem;
    };
    try {
      const folder = await create('folder', 'Upgrade plans', null);
      const item = await create(kind, `Shared ${kind}`, folder.id);
      const grant = async (role: 'viewer' | 'editor' | null) => {
        const response = await control.request.put(`/api/items/${folder.id}/sharing`, {
          headers,
          data: { userId: viewer.id, role },
        });
        expect(response.status(), await response.text()).toBe(200);
      };
      const contentPath = `/api/items/${item.id}/${kind}`;
      const read = async () => {
        const response = await control.request.get(contentPath);
        expect(response.status(), await response.text()).toBe(200);
        return (await response.json()) as {
          revision: number;
          snapshot: IDocumentData & IWorkbookData;
        };
      };
      if (kind === 'doc') {
        const text = 'Alpha Beta Gamma';
        const snapshot = getDocsEmptySnapshot(
          item.id,
          LocaleType.EN_US,
          item.name,
          DocumentFlavor.MODERN,
        );
        snapshot.body = {
          ...snapshot.body,
          dataStream: text + '\r\n',
          paragraphs: [{ startIndex: text.length, paragraphId: createParagraphId(new Set()) }],
          sectionBreaks: [{ startIndex: text.length + 1, sectionId: createSectionId(new Set()) }],
        };
        expect(validateDocumentStructure(snapshot)).toEqual([]);
        const seeded = await control.request.put(contentPath, {
          headers,
          data: { snapshot, revision: 0, writeId: randomUUID() },
        });
        expect(seeded.status(), await seeded.text()).toBe(200);
      }
      await grant('viewer');
      await page.goto(`/?item=${item.id}`);
      const region = page.getByRole('region', {
        name: kind === 'doc' ? 'Doc document' : 'Sheet document',
        exact: true,
      });
      const status = region.getByRole('status', { name: 'Save status', exact: true });
      await expect(status).toHaveText('View only.', { timeout: 30_000 });
      await expect(region.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
      const canvas =
        kind === 'doc'
          ? region.getByLabel('Document canvas', { exact: true })
          : region.locator('canvas[id^="univer-sheet-main-canvas_"]');
      await expect(canvas).toBeVisible();
      const mounted = (await canvas.elementHandle())!;
      const input = page.locator('[contenteditable="true"][data-u-comp="editor"]');
      const nameBox = region.locator('[data-u-comp="defined-name"] input');
      if (kind === 'doc') {
        await page.locator('.univer-container').click({ position: { x: 130, y: 200 } });
        await input.focus();
        await page.keyboard.press('Control+Home');
        for (let step = 0; step < 6; step++) await page.keyboard.press('ArrowRight');
        for (let step = 0; step < 4; step++) await page.keyboard.press('Shift+ArrowRight');
        await page.evaluate(() => navigator.clipboard.writeText('not-the-selection'));
        await page.keyboard.press('Control+c');
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Beta');
      } else {
        await nameBox.fill('D8');
        await nameBox.press('Enter');
        await expect(nameBox).toHaveValue('D8');
      }
      const focused = await page.evaluateHandle(() => document.activeElement);
      const before = await read();
      navigationCount = navigations;
      const start = Date.now();
      await grant('editor');
      // The access scan is already running. Cold startup is excluded from the
      // ticket's requirement that an open viewer picks up a role in a few seconds.
      await expect(status).toHaveText('All changes saved.', { timeout: 5_000 });
      upgradedInMs = Date.now() - start;
      expect(await canvas.evaluate((node, original) => node === original, mounted)).toBe(true);
      expect(navigations).toBe(navigationCount);
      expect(await page.evaluate((previous) => document.activeElement === previous, focused)).toBe(
        true,
      );
      await expect(region.getByRole('button', { name: 'Bold', exact: true })).toBeEnabled();
      if (kind === 'sheet') await expect(nameBox).toHaveValue('D8');
      // Do not reselect, refocus or click after the grant. The existing selection
      // must decide where the first newly authorized native input is applied.
      await page.keyboard.insertText(kind === 'doc' ? 'Delta' : '7301');
      if (kind === 'sheet') await page.keyboard.press('Enter');
      await expect
        .poll(async () => {
          const { snapshot } = await read();
          return kind === 'doc'
            ? snapshot.body!.dataStream
            : snapshot.sheets[snapshot.sheetOrder[0]].cellData?.[7]?.[3]?.v;
        })
        .toBe(kind === 'doc' ? 'Alpha Delta Gamma\r\n' : 7301);
      await expect(status).toHaveText('All changes saved.');
      const committed = await read();
      expect(committed.revision).toBeGreaterThan(before.revision);
      if (kind === 'sheet')
        expect(
          committed.snapshot.sheets[committed.snapshot.sheetOrder[0]].cellData?.[0]?.[0],
        ).toBeUndefined();

      await grant(kind === 'doc' ? 'viewer' : null);
      await expect(status).toContainText('Access changed', { timeout: 10_000 });
      await expect(region.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
      await page.keyboard.insertText('Rejected after access loss');
      await page.keyboard.press('Enter');
      const refused = await context.request.put(contentPath, {
        headers,
        data: { snapshot: committed.snapshot, revision: committed.revision, writeId: randomUUID() },
      });
      expect(refused.status()).toBe(kind === 'doc' ? 403 : 404);
      expect((await context.request.get(contentPath)).status()).toBe(kind === 'doc' ? 200 : 404);
      expect(await read()).toEqual(committed);
      expect(await canvas.evaluate((node, original) => node === original, mounted)).toBe(true);
      expect(navigations).toBe(navigationCount);
      expect(errors).toEqual([]);
    } finally {
      try {
        const observed = await page
          .evaluate(() => ({
            status: document.querySelector('[aria-label="Save status"]')?.textContent,
            focus: document.activeElement?.outerHTML,
            selection: window.getSelection()?.toString(),
          }))
          .catch((error) => ({ error: String(error) }));
        await writeFile(
          info.outputPath('sync-diagnostics.json'),
          JSON.stringify(
            {
              kind,
              upgradedInMs,
              navigationCount,
              navigations,
              errors,
              observed,
              outgoing: network.outgoing,
              incoming: network.incoming,
            },
            null,
            2,
          ),
        );
      } finally {
        await control.close();
        database.close();
      }
    }
  });
