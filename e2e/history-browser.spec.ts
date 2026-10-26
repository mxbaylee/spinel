import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

test('touch history timeline and calendar preview retained choices without changing live content', async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`),
    auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('History browser owner'),
    viewer = auth.createUser(`History viewer ${owner.id}`);
  const item = workspace.create(owner.id, { name: 'History journal', kind: 'doc', parentId: null });
  workspace.share(owner.id, item.id, viewer.id, 'viewer');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    baseURL,
  });
  const cookie = (id: string) => ({
    name: COOKIE_NAME,
    value: auth.createSession(id).token,
    url: baseURL!.replace('http:', 'https:'),
    secure: true,
    httpOnly: true,
    sameSite: 'Strict' as const,
  });
  await context.addCookies([cookie(owner.id)]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const checkpoints: string[] = [];
    for (let revision = 0; revision < 5; revision++) {
      const saved = await context.request.put(`/api/items/${item.id}/doc`, {
        headers: { Origin: baseURL! },
        data: {
          revision,
          writeId: randomUUID(),
          snapshot: {
            id: item.id,
            title: item.name,
            documentStyle: {},
            body: {
              dataStream: `Checkpoint ${revision + 1}\r\n`,
              paragraphs: [{ startIndex: 12, paragraphStyle: {} }],
            },
          },
        },
      });
      expect(saved.ok()).toBe(true);
      const named = await context.request.post(`/api/items/${item.id}/history`, {
        headers: { Origin: baseURL! },
        data: { name: `Saved ${revision + 1}` },
      });
      expect(named.ok()).toBe(true);
      checkpoints.push((await named.json()).version.id);
    }
    // One shared UTC date avoids a midnight race and always crosses a month boundary.
    // Let Date advance normally while the real editor initializes and is replaced.
    const fixtureTime = new Date('2026-10-02T15:00:00Z');
    await page.clock.setSystemTime(fixtureTime);
    const midnight = new Date(fixtureTime);
    midnight.setUTCHours(0, 0, 0, 0);
    const start = midnight.getTime(),
      yesterday = new Date(start - 86400000).toISOString().slice(0, 10),
      earlier = new Date(start - 2 * 86400000).toISOString().slice(0, 10);
    // Any preserved unnamed baseline belongs to another day in this fixture.
    db.prepare(
      `UPDATE history_checkpoints SET captured_at=? WHERE item_id=? AND id NOT IN (${checkpoints.map(() => '?').join(',')})`,
    ).run(start - 3 * 86400000, item.id, ...checkpoints);
    for (let index = 0; index < 5; index++)
      db.prepare('UPDATE history_checkpoints SET captured_at=? WHERE id=?').run(
        start + (index === 0 ? -2 * 86400000 : index < 3 ? -86400000 : 0) + (index + 9) * 3600000,
        checkpoints[index],
      );
    // Seed the permanent label for navigation coverage; restore semantics have their own E2E.
    db.prepare('INSERT OR IGNORE INTO history_restore_labels(checkpoint_id) VALUES(?)').run(
      checkpoints[2],
    );
    const live = await (await context.request.get(`/api/items/${item.id}/doc`)).json();
    await page.goto(`/preview?item=${item.id}&version=${checkpoints[3]}`);
    const ready = async () => {
      await expect(
        page.getByRole('button', { name: 'Restore this version', exact: true }),
      ).toBeEnabled({
        timeout: 30_000,
      });
      // Every replacement must be read-only, including the initial preview.
      await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
    };
    await ready();
    const chooser = page.getByRole('button', { name: /^Choose version/ });
    await expect(chooser).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('status').filter({ hasText: 'Selected' })).toContainText('Saved 4');
    await chooser.tap();
    const slider = page.getByRole('slider', { name: 'Snapshot timeline', exact: true });
    await slider.scrollIntoViewIfNeeded();
    const box = (await slider.boundingBox())!;
    let releasePreview!: () => void;
    const heldPreview = new Promise<void>((resolve) => {
      releasePreview = resolve;
    });
    const selectedRoute = `**/history/${checkpoints[4]}`;
    await page.route(selectedRoute, async (route) => {
      await heldPreview;
      await route.continue();
    });
    const nextResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/history/${checkpoints[4]}`) &&
        response.request().method() === 'GET',
    );
    await page.touchscreen.tap(box.x + box.width - 3, box.y + box.height / 2);
    // The header portal must not retain the old preview's restore action while
    // the newly selected checkpoint is waiting for its authorized snapshot.
    await expect(page.getByRole('status').filter({ hasText: 'Selected' })).toContainText('Saved 5');
    await expect(
      page.getByRole('button', { name: 'Restore this version', exact: true }),
    ).toHaveCount(0);
    releasePreview();
    expect((await (await nextResponse).json()).snapshot.body.dataStream).toContain('Checkpoint 5');
    await page.unroute(selectedRoute);
    await ready();
    await expect(page.getByRole('status').filter({ hasText: 'Selected' })).toContainText('Saved 5');
    await slider.focus();
    const firstResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/history/${checkpoints[3]}`) &&
        response.request().method() === 'GET',
    );
    await page.keyboard.press('Home');
    expect((await (await firstResponse).json()).snapshot.body.dataStream).toContain('Checkpoint 4');
    await ready();
    await page.getByRole('button', { name: 'Older days', exact: true }).tap();
    await expect(
      page.getByRole('button', { name: `${yesterday}, named versions`, exact: true }),
    ).toBeEnabled();
    await ready();
    await page.getByRole('button', { name: 'Previous month', exact: true }).tap();
    const calendarResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/history/${checkpoints[0]}`) &&
        response.request().method() === 'GET',
    );
    await page.getByRole('button', { name: `${earlier}, named versions`, exact: true }).tap();
    expect((await (await calendarResponse).json()).snapshot.body.dataStream).toContain(
      'Checkpoint 1',
    );
    await ready();
    await page.getByRole('button', { name: 'Next month', exact: true }).tap();
    await page.getByRole('button', { name: `${yesterday}, named versions`, exact: true }).tap();
    await ready();
    const versions = page.getByRole('combobox', { name: `Version on ${yesterday}`, exact: true });
    await expect(versions.locator('option')).toHaveCount(2);
    await expect(versions.locator('option').filter({ hasText: 'Before restore' })).toHaveCount(1);
    const olderResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/history/${checkpoints[1]}`) &&
        response.request().method() === 'GET',
    );
    await versions.selectOption(checkpoints[1]);
    expect((await (await olderResponse).json()).snapshot.body.dataStream).toContain('Checkpoint 2');
    await ready();
    await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
    await page.screenshot({
      path: `test-results/theme-screenshots/history-calendar-${info.project.name}.png`,
      fullPage: true,
    });
    const versionActions = page.getByRole('button', { name: /Version actions for .*Saved 2/ });
    await versionActions.click();
    await page.getByRole('menuitem', { name: 'Rename version…', exact: true }).click();
    const naming = page.getByRole('dialog', { name: 'Name saved version', exact: true });
    await naming.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(versionActions).toBeFocused();
    await versionActions.click();
    await page.getByRole('menuitem', { name: 'Rename version…', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(naming).not.toBeVisible();
    await expect(versionActions).toBeFocused();
    await versionActions.click();
    await page.getByRole('menuitem', { name: 'Rename version…', exact: true }).click();
    await naming
      .getByRole('textbox', { name: 'Version name', exact: true })
      .fill('Chosen older checkpoint');
    await naming.getByRole('button', { name: 'Save version name', exact: true }).click();
    await expect(naming).not.toBeVisible();
    await ready();
    await expect(page.getByRole('status').filter({ hasText: 'Selected' })).toContainText(
      'Chosen older checkpoint',
    );
    await expect(
      page.getByRole('button', { name: /Version actions for .*Chosen older checkpoint/ }),
    ).toBeFocused();
    await page
      .getByRole('button', { name: /Version actions for .*Chosen older checkpoint/ })
      .click();
    await page.getByRole('menuitem', { name: 'Remove name', exact: true }).click();
    await ready();
    await expect(page.getByRole('status').filter({ hasText: 'Selected' })).toContainText(
      'Unnamed version',
    );
    await expect(versions.locator('option')).toHaveCount(2);
    await page.getByRole('button', { name: 'Name current version…', exact: true }).click();
    const currentName = page.getByRole('dialog', { name: 'Name current version', exact: true });
    await expect(currentName).toContainText('Unsaved edits in another tab are not included.');
    await currentName
      .getByRole('textbox', { name: 'Version name', exact: true })
      .fill('Current confirmed content');
    await currentName.getByRole('button', { name: 'Save version name', exact: true }).click();
    await expect(currentName).not.toBeVisible();
    await ready();
    await expect(page.getByRole('status').filter({ hasText: 'Selected' })).toContainText(
      'Current confirmed content',
    );
    const namedHistory = await (await context.request.get(`/api/items/${item.id}/history`)).json();
    const namedCurrent = namedHistory.versions.find(
      (version: { name: string | null }) => version.name === 'Current confirmed content',
    );
    expect(new URL(page.url()).searchParams.get('version')).toBe(namedCurrent.id);
    await page.reload();
    await ready();
    await expect(page.getByRole('status').filter({ hasText: 'Selected' })).toContainText(
      'Current confirmed content',
    );
    expect(await (await context.request.get(`/api/items/${item.id}/doc`)).json()).toEqual(live);
    await context.clearCookies();
    await context.addCookies([cookie(viewer.id)]);
    await page.goto(`/preview?item=${item.id}&version=${checkpoints[1]}`);
    await expect(page.getByRole('heading', { name: 'Preview — History journal' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: 'Bold', exact: true })).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Restore this version', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Name current version…', exact: true }),
    ).toHaveCount(0);
    await chooser.tap();
    await expect(
      page.getByRole('combobox', { name: `Version on ${yesterday}`, exact: true }),
    ).toHaveValue(checkpoints[1]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    db.close();
  }
});
