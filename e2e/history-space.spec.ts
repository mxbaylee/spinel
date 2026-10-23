import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import sharp from 'sharp';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { snapshotIdentity } from '../src/server/collaboration/snapshotIdentity.ts';
import { imageSources } from '../src/server/workspace/imageSources.ts';
import { SpaceStore } from '../src/server/workspace/spaces.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { sheetImageFixture } from './sheet-image-fixture.ts';

for (const kind of ['doc', 'sheet'] as const) {
  test(`Space ${kind} history restores images and preserves the exact child and generation boundary`, async ({
    page, context, browser, baseURL,
  }, info) => {
    test.setTimeout(150_000);
    page.setDefaultTimeout(15_000);
    await page.setViewportSize({ width: 1440, height: 1100 });
    const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
    const auth = new AuthStore(db);
    const workspace = new WorkspaceStore(auth, { spacesEnabled: true });
    const spaces = new SpaceStore(workspace);
    const owner = auth.createUser(`History Space owner ${info.testId}`);
    const viewer = auth.createUser(`History Space viewer ${info.testId}`);
    const root = spaces.createRoot(owner.id, { name: 'Recovery notebook', parentId: null }).space;
    const child = spaces.createChild(owner.id, root.id, {
      name: 'Image recovery', kind, parentId: root.id,
    }).item;
    const sibling = spaces.createChild(owner.id, root.id, {
      name: 'Other page', kind, parentId: root.id,
    }).item;
    spaces.share(owner.id, root.id, viewer.id, 'viewer');
    const cookie = (id: string) => ({
      name: COOKIE_NAME, value: auth.createSession(id).token,
      url: baseURL!.replace('http:', 'https:'), secure: true, httpOnly: true,
      sameSite: 'Strict' as const,
    });
    await context.addCookies([cookie(owner.id)]);
    const viewerContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1100 } });
    await viewerContext.addCookies([cookie(viewer.id)]);
    const prefix = `/api/spaces/${root.id}/items/${child.id}`;
    const liveHref = `/spaces/${root.id}?item=${child.id}`;
    const headers = { Origin: baseURL! };
    const saved = () => expect(page.getByRole('status', { name: 'Save status', exact: true }))
      .toHaveText('All changes saved.', { timeout: 30_000 });
    const exported = async () => {
      const response = await context.request.get(`${prefix}/export`);
      expect(response.status(), await response.text()).toBe(200);
      return await response.json();
    };
    const imageVisible = async (target: Page) => {
      // The blue image is shared by the Doc fixture and the Sheet image cell.
      // Measuring native canvas pixels catches an image URL retained but not rendered.
      await expect.poll(async () => {
        const { data, info: pixels } = await sharp(await target.locator('.univer-container').screenshot())
          .removeAlpha().raw().toBuffer({ resolveWithObject: true });
        let blue = 0;
        for (let offset = 0; offset < data.length; offset += pixels.channels)
          if (Math.abs(data[offset] - 34) < 12 && Math.abs(data[offset + 1] - 85) < 12 && Math.abs(data[offset + 2] - 238) < 12) blue++;
        return blue;
      }, { timeout: 30_000 }).toBeGreaterThan(1000);
    };
    try {
      const sheet = await sheetImageFixture();
      const embedded = sheet.sheets.tab.cellData[1][0].p;
      const text = '\bOriginal\r\n';
      const seed = kind === 'sheet' ? sheet : {
        id: embedded.id, title: child.name,
        body: { dataStream: text, paragraphs: [{ startIndex: text.length - 2 }], customBlocks: [{ startIndex: 0, blockId: 'cell' }] },
        drawingsOrder: embedded.drawingsOrder, drawings: embedded.drawings,
        documentStyle: { pageSize: { width: 595, height: 842 }, marginTop: 40, marginBottom: 40, marginLeft: 40, marginRight: 40 },
      };
      if (kind === 'sheet') Object.assign(sheet.sheets.tab.cellData, { 0: { 0: { v: 'Original' } } });
      const native = snapshotIdentity(seed as unknown as IDocumentData | IWorkbookData, child.id);
      // Seed application-owned pre-collaboration snapshots, then use the real native
      // engine, history API and restore transaction for every observed transition.
      imageSources(native, (source) => {
        const bytes = Buffer.from(source.split(',')[1], 'base64');
        const hash = createHash('sha256').update(bytes).digest('hex');
        db.prepare('INSERT OR IGNORE INTO doc_images VALUES(?,?,?,?)').run(child.id, hash, 'image/png', bytes);
        return `/api/items/${child.id}/images/${hash}`;
      });
      db.prepare(`INSERT INTO ${kind === 'doc' ? 'doc_snapshots' : 'sheet_snapshots'} VALUES(?,?,?,?)`)
        .run(child.id, JSON.stringify(native), 1, randomUUID());
      await page.goto(liveHref);
      await saved();
      await imageVisible(page);
      const named = await context.request.post(`${prefix}/history`, { headers, data: { name: 'Original with image' } });
      expect(named.status(), await named.text()).toBe(201);
      const checkpoint = (await named.json()).version.id as string;
      const original = await exported();
      const previewHref = `/preview?item=${child.id}&space=${root.id}&version=${checkpoint}`;
      const originalResponse = await context.request.get(`${prefix}/history/${checkpoint}`);
      expect(originalResponse.status()).toBe(200);
      const originalUnit = (await originalResponse.json()).unitId as string;
      const region = page.getByRole('region', { name: kind === 'doc' ? 'Doc document' : 'Sheet document', exact: true });
      if (kind === 'sheet') {
        const address = region.locator('[data-u-comp="defined-name"]').getByRole('textbox');
        await address.fill('C4');
        await address.press('Enter');
      } else {
        await region.locator('.univer-container').click({ position: { x: 130, y: 200 } });
        await page.keyboard.press('Control+End');
      }
      await page.keyboard.type('Latest accepted change');
      if (kind === 'sheet') await page.keyboard.press('Enter');
      await expect.poll(async () => JSON.stringify(await exported())).toContain('Latest accepted change');
      await saved();
      const latest = await exported();
      await page.goto(previewHref);
      await expect(page.getByRole('button', { name: 'Restore this version', exact: true })).toBeEnabled({ timeout: 30_000 });
      await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
      await expect(page.getByRole('region', { name: 'Version preview', exact: true })
        .getByRole('link', { name: 'Back to live document', exact: true })).toHaveAttribute('href', liveHref);
      await imageVisible(page);
      expect(await exported()).toEqual(latest);

      const readOnly = await viewerContext.newPage();
      await readOnly.goto(previewHref);
      await expect(readOnly.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled({ timeout: 30_000 });
      await imageVisible(readOnly);
      await expect(readOnly.getByRole('button', { name: 'Restore this version', exact: true })).toHaveCount(0);
      await expect(readOnly.getByRole('button', { name: 'Name current version…', exact: true })).toHaveCount(0);
      const forbidden = await viewerContext.request.post(`${prefix}/history/${checkpoint}/restore`, {
        headers, data: { unitId: originalUnit, requestId: randomUUID() },
      });
      expect(forbidden.status()).toBe(403);
      await readOnly.close();
      await page.bringToFront();

      await page.getByRole('button', { name: 'Restore this version', exact: true }).click();
      const confirmation = page.getByRole('dialog', { name: /Restore .*Original with image.*for everyone\?/ });
      await expect(confirmation).toContainText('Before restore');
      // Cancelling leaves the selected checkpoint and live data intact.
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Restore this version', exact: true })).toBeFocused();
      expect(await exported()).toEqual(latest);
      await page.getByRole('button', { name: 'Restore this version', exact: true }).click();
      const restoredResponse = page.waitForResponse((response) => response.url().endsWith(`${prefix}/history/${checkpoint}/restore`) && response.request().method() === 'POST');
      await confirmation.getByRole('button', { name: 'Restore version', exact: true }).click();
      const response = await restoredResponse;
      expect(response.status(), await response.text()).toBe(200);
      expect(response.request().postDataJSON()).toMatchObject({ unitId: originalUnit });
      const nextUnit = (await response.json()).unitId as string;
      expect(nextUnit).not.toBe(originalUnit);
      await expect(page).toHaveURL(baseURL! + liveHref);
      await saved();
      await imageVisible(page);
      const restored = await exported();
      expect(JSON.stringify(restored)).toContain('Original');
      expect(JSON.stringify(restored)).not.toContain('Latest accepted change');
      const imageList = (snapshot: IDocumentData | IWorkbookData) => {
        const result: string[] = [];
        imageSources(snapshot, (source) => { result.push(source); return source; });
        return result.sort();
      };
      expect(imageList(restored)).toEqual(imageList(original));

      // An old preview must never replace edits in the new generation.
      const stale = await context.request.post(`${prefix}/history/${checkpoint}/restore`, {
        headers, data: { unitId: originalUnit, requestId: randomUUID() },
      });
      expect(stale.status()).toBe(409);
      expect(await exported()).toEqual(restored);
      const history = await context.request.get(`${prefix}/history`);
      expect(history.status()).toBe(200);
      const before = ((await history.json()).versions as { id: string; beforeRestore: boolean }[])
        .find((version) => version.beforeRestore);
      expect(before).toBeDefined();
      const preserved = await context.request.get(`${prefix}/history/${before!.id}`);
      expect(preserved.status()).toBe(200);
      const beforeSnapshot = (await preserved.json()).snapshot;
      expect(JSON.stringify(beforeSnapshot)).toContain('Latest accepted change');
      expect(imageList(beforeSnapshot)).toHaveLength(imageList(original).length);
      // Scope is exact: another child and the ordinary route cannot read this checkpoint.
      expect((await context.request.get(`/api/spaces/${root.id}/items/${sibling.id}/history/${checkpoint}`)).status()).toBe(404);
      expect((await context.request.get(`/api/items/${child.id}/history/${checkpoint}`)).status()).toBe(404);
      await page.goto(`/preview?item=${child.id}&space=${root.id}&version=${before!.id}`);
      await expect(page.getByRole('button', { name: 'Restore this version', exact: true })).toBeEnabled({ timeout: 30_000 });
      await imageVisible(page);
      await expect(page.getByRole('status').filter({ hasText: 'Selected' })).toContainText('Before restore');
    } finally {
      await viewerContext.close();
      db.close();
    }
  });
}
