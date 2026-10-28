import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { SpaceStore } from '../src/server/workspace/spaces.ts';
import { syncNetwork } from './sync-network.ts';

test('owner guest-link inventory changes expiry without rotating and fences stale profile actions', async ({
  page,
  context,
  baseURL,
}, info) => {
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  const spaces = new SpaceStore(workspace);
  const owner = auth.createUser('Guest links owner'),
    other = auth.createUser('Different owner');
  const doc = workspace.create(owner.id, { kind: 'doc', name: 'Autumn plans', parentId: null });
  const sheet = workspace.create(owner.id, {
    kind: 'sheet',
    name: 'Household budget',
    parentId: null,
  });
  const expired = workspace.create(owner.id, {
    kind: 'doc',
    name: 'Summer recipes',
    parentId: null,
  });
  const space = spaces.createRoot(owner.id, { name: 'Winter trip', parentId: null }).space;
  const privateDoc = workspace.create(other.id, {
    kind: 'doc',
    name: 'Another owner private title',
    parentId: null,
  });
  for (const item of [doc, sheet, expired, space, privateDoc]) {
    const link = workspace.links.begin(item.id, 'editor');
    workspace.links.finish(item.id, link.epoch, true);
  }
  db.prepare('UPDATE workspace_links SET enabled_at=NULL WHERE item_id=?').run(sheet.id);
  db.prepare('UPDATE workspace_links SET expires_at=? WHERE item_id=?').run(
    Date.now() - 1000,
    expired.id,
  );
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
  const row = (name: string) =>
    page
      .getByRole('list', { name: 'Your guest links' })
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name, exact: true }) });
  const expiryDialog = async () => {
    await row(doc.name)
      .getByRole('button', { name: `More actions for ${doc.name}` })
      .click();
    await page.getByRole('menuitem', { name: 'Change expiry…' }).click();
    return page.getByRole('dialog', { name: 'Change link expiry' });
  };
  try {
    await page.goto('/profile#links');
    await expect(row(sheet.name)).toContainText('Enabled date unknown');
    await expect(row(expired.name)).toContainText('Expired');
    await expect(row(space.name)).toContainText('Every current and future page and folder');
    await expect(page.getByText(privateDoc.name, { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('list', { name: 'Your guest links' }).getByRole('listitem'),
    ).toHaveCount(4);
    await mkdir('test-results/theme-screenshots', { recursive: true });
    for (const [mode, width] of [
      ['light', 1280],
      ['dark', 1280],
      ['phone', 390],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page
        .getByRole('banner')
        .getByRole('radio', { name: mode === 'dark' ? 'Dark' : 'Light', exact: true })
        .click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `test-results/theme-screenshots/spn-066-profile-${mode}-${info.project.name}.png`,
        fullPage: true,
      });
    }
    const before = db
      .prepare('SELECT epoch,token_hash,preview_hash,role FROM workspace_links WHERE item_id=?')
      .get(doc.id);
    const dialog = await expiryDialog();
    await dialog.getByRole('combobox', { name: 'Expire link after' }).selectOption('1');
    await dialog.getByRole('button', { name: 'Save expiry' }).click();
    await expect(
      page.getByRole('region', { name: 'Guest links', exact: true }).getByRole('status'),
    ).toHaveText('Expiry updated. The link is unchanged.');
    expect(
      db
        .prepare('SELECT epoch,token_hash,preview_hash,role FROM workspace_links WHERE item_id=?')
        .get(doc.id),
    ).toEqual(before);
    const deadline = Number(
      db.prepare('SELECT expires_at FROM workspace_links WHERE item_id=?').get(doc.id)?.expires_at,
    );
    expect(deadline - Date.now()).toBeGreaterThan(86_390_000);

    const stale = await expiryDialog();
    const replacement = await context.request.put(`/api/items/${doc.id}/link`, {
      headers: { Origin: baseURL! },
      data: { role: 'viewer' },
    });
    expect(replacement.ok()).toBe(true);
    const newState = db
      .prepare('SELECT epoch,token_hash,expires_at FROM workspace_links WHERE item_id=?')
      .get(doc.id);
    await stale.getByRole('combobox', { name: 'Expire link after' }).selectOption('30');
    await stale.getByRole('button', { name: 'Save expiry' }).click();
    await expect(page.getByRole('alert')).toContainText('Review current guest links');
    expect(
      db
        .prepare('SELECT epoch,token_hash,expires_at FROM workspace_links WHERE item_id=?')
        .get(doc.id),
    ).toEqual(newState);
    await expect(row(doc.name)).toContainText('View only');
    await row(expired.name)
      .getByRole('button', { name: `More actions for ${expired.name}` })
      .click();
    await expect(page.getByRole('menuitem', { name: 'Change expiry…' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await row(space.name)
      .getByRole('button', { name: `More actions for ${space.name}` })
      .click();
    await page.getByRole('menuitem', { name: 'Turn off link' }).click();
    const off = page.getByRole('dialog', { name: 'Turn off this guest link?' });
    await expect(off).toContainText('Space and all its pages');
    await off.getByRole('button', { name: 'Turn off link' }).click();
    await expect(row(space.name)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Guest links', exact: true })).toBeFocused();
  } finally {
    await page.goto('/sign-in');
    for (const user of [owner, other]) {
      db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(user.id);
      db.prepare('DELETE FROM auth_users WHERE id=?').run(user.id);
    }
    db.close();
  }
});

for (const kind of ['doc', 'sheet'] as const) {
  test(`expiry hides clean and dirty standalone guest ${kind} and refuses writes, images and previews`, async ({
    context,
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(120_000);
    const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
    const auth = new AuthStore(db),
      workspace = new WorkspaceStore(auth);
    const owner = auth.createUser(`Expiry ${kind} owner`);
    const item = workspace.create(owner.id, {
      kind,
      name: `Private expiring ${kind}`,
      parentId: null,
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
    const created = await context.request.put(`/api/items/${item.id}/link`, {
      headers: { Origin: baseURL! },
      data: { role: 'editor', expiryDays: 1 },
    });
    expect(created.ok()).toBe(true);
    const link = new URL((await created.json()).url);
    const guest = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
    const network = await syncNetwork(guest);
    const dirty = await guest.newPage(),
      clean = await guest.newPage();
    let release = () => {};
    try {
      for (const view of [dirty, clean]) {
        await view.goto(link.href);
        await expect(view.getByRole('status', { name: 'Save status', exact: true })).toHaveText(
          'All changes saved.',
          { timeout: 30_000 },
        );
      }
      const bytes = Buffer.from(
        await dirty.evaluate(() => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 2;
          canvas.getContext('2d')!.fillRect(0, 0, 2, 2);
          return canvas.toDataURL('image/png').split(',')[1];
        }),
        'base64',
      );
      let image: { url: string };
      if (kind === 'doc') {
        const upload = await guest.request.post(`/api/guest/${item.id}/images`, {
          headers: { Origin: baseURL!, 'Content-Type': 'image/png' },
          data: bytes,
        });
        expect(upload.status()).toBe(201);
        image = await upload.json();
      } else {
        // Sheets read scoped imported images; a Sheet upload UI is out of scope.
        const imageId = createHash('sha256').update(bytes).digest('hex');
        db.prepare('INSERT INTO doc_images(item_id,id,mime,data) VALUES(?,?,?,?)').run(
          item.id,
          imageId,
          'image/png',
          bytes,
        );
        image = { url: `/api/items/${item.id}/images/${imageId}` };
      }
      expect((await guest.request.get(image.url)).status()).toBe(200);
      const preview = `/share/${item.id}?preview=${link.searchParams.get('preview')}`;
      expect(await (await guest.request.get(preview)).text()).toContain(item.name);
      const before = (await (await context.request.get(`/api/items/${item.id}/${kind}`)).json())
        .snapshot;
      let received = 0;
      const forwarded: boolean[] = [];
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      network.interceptWrites(async (write) => {
        received++;
        await held;
        forwarded.push(write.forward());
      });
      await dirty.bringToFront();
      if (kind === 'doc') {
        await dirty
          .getByRole('region', { name: 'Doc document', exact: true })
          .locator('.univer-container')
          .click({ position: { x: 130, y: 200 } });
        await dirty.keyboard.type('Private pending contribution');
      } else {
        const address = dirty
          .getByRole('region', { name: 'Sheet document', exact: true })
          .locator('[data-u-comp="defined-name"]')
          .getByRole('textbox');
        await address.fill('B2');
        await address.press('Enter');
        await dirty.keyboard.type('Private pending contribution');
        await dirty.keyboard.press('Enter');
      }
      await expect.poll(() => received).toBeGreaterThan(0);
      await expect(dirty.getByRole('status', { name: 'Save status', exact: true })).toContainText(
        'not saved',
      );
      // A real deadline, not explicit turn-off: the server must close both tabs
      // even while the dirty tab cannot complete its ordinary metadata poll.
      await dirty.route(`**/api/guest/${item.id}`, (route) => route.abort('failed'));
      db.prepare('UPDATE workspace_links SET expires_at=? WHERE item_id=?').run(
        Date.now() + 1000,
        item.id,
      );
      for (const view of [dirty, clean]) {
        await expect(view.getByRole('alert')).toHaveText('This link no longer works.', {
          timeout: 10_000,
        });
        await expect(view).toHaveTitle('Spinel');
        await expect(
          view.locator('.univer-container, canvas, [contenteditable="true"]'),
        ).toHaveCount(0);
        await expect(
          view.getByRole('button', { name: /Copy|Export|Recover|Retry saving|People|Formulas/ }),
        ).toHaveCount(0);
        await expect(view.getByRole('textbox')).toHaveCount(0);
        expect(await view.locator('body').innerText()).not.toContain(item.name);
        expect(await view.locator('body').innerText()).not.toContain(
          'Private pending contribution',
        );
      }
      await expect(
        dirty.getByText('Some changes were not saved. This document is no longer accessible.', {
          exact: true,
        }),
      ).toBeVisible();
      await expect(clean.getByText('Some changes were not saved.', { exact: false })).toHaveCount(
        0,
      );
      release();
      await network.drainWrites();
      expect(forwarded).toEqual(Array(received).fill(false));
      expect(
        (await (await context.request.get(`/api/items/${item.id}/${kind}`)).json()).snapshot,
      ).toEqual(before);
      expect((await guest.request.get(image.url)).status()).toBe(401);
      expect(
        (
          await guest.request.post(`/api/guest/${item.id}/images`, {
            headers: { Origin: baseURL!, 'Content-Type': 'image/png' },
            data: bytes,
          })
        ).status(),
      ).toBe(404);
      expect(await (await guest.request.get(preview)).text()).not.toContain(item.name);
      expect(
        (
          await guest.request.post(`/api/guest/${item.id}/session`, {
            headers: { Origin: baseURL! },
            data: { token: link.hash.slice(1) },
          })
        ).status(),
      ).toBe(404);
      expect((await context.request.get(`/api/items/${item.id}/${kind}`)).status()).toBe(200);
      await mkdir('test-results/theme-screenshots', { recursive: true });
      await dirty.screenshot({
        path: `test-results/theme-screenshots/spn-066-expired-${kind}-${info.project.name}.png`,
        fullPage: true,
      });
    } finally {
      release();
      await network.drainWrites();
      await guest.close();
      db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(owner.id);
      db.prepare('DELETE FROM auth_users WHERE id=?').run(owner.id);
      db.close();
    }
  });
}
