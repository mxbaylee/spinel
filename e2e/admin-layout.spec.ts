import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';

for (const width of [1280, 390]) {
  test(`administration sections preserve private metadata and keyboard focus at ${width}px`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
    const auth = new AuthStore(db),
      workspace = new WorkspaceStore(auth);
    const suffix = `${info.testId}-${info.retry}`;
    const operator = auth.createUser(`Layout operator ${suffix}`, true),
      member = auth.createUser(`Layout member ${suffix}`);
    const privateItem = workspace.create(member.id, {
      kind: 'doc',
      name: `Private document ${suffix}`,
      parentId: null,
    });
    db.prepare('INSERT INTO auth_passkeys VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
      `protected-${suffix}`,
      operator.id,
      Buffer.from([1]),
      0,
      '[]',
      'Only operator key',
      'Browser',
      auth.now(),
      null,
      0,
      'singleDevice',
    );
    await context.addCookies([
      {
        name: COOKIE_NAME,
        value: auth.createSession(operator.id).token,
        url: baseURL!.replace('http:', 'https:'),
        secure: true,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await mkdir('test-results/theme-screenshots', { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/admin');
      const nav = page.getByRole('navigation', { name: 'Administration sections' });
      await expect(
        page.getByRole('heading', { name: 'Administration', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: 'Your profile', exact: true })).toBeInViewport();
      const operatorAction = page.getByRole('button', {
        name: `Actions for ${operator.name}`,
        exact: true,
      });
      await operatorAction.click();
      await expect(page.getByRole('menuitem', { name: 'Disable account…' })).toBeDisabled();
      await page.getByRole('menuitem', { name: 'Manage passkeys', exact: true }).click();
      const passkeys = page.getByRole('dialog', {
        name: `Passkeys for ${operator.name}`,
        exact: true,
      });
      await expect(passkeys).toContainText('This admin’s last passkey cannot be removed.');
      await passkeys.getByRole('button', { name: 'Actions for passkey Only operator key' }).click();
      await expect(page.getByRole('menuitem', { name: 'Remove passkey…' })).toBeDisabled();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(passkeys).not.toBeVisible();
      await expect(operatorAction).toBeFocused();
      const memberAction = page.getByRole('button', {
        name: `Actions for ${member.name}`,
        exact: true,
      });
      await memberAction.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('menuitem', { name: 'Disable account…' }).click();
      const confirm = page.getByRole('dialog', { name: `Disable ${member.name}?`, exact: true });
      await expect(confirm).toContainText('Its documents and shares will remain');
      await page.keyboard.press('Escape');
      await expect(confirm).not.toBeVisible();
      await expect(memberAction).toBeFocused();
      expect(auth.user(member.id)?.id).toBe(member.id);
      for (const theme of ['light', 'dark'] as const) {
        await page
          .locator('.workspace > header')
          .getByRole('radio', { name: theme === 'light' ? 'Light' : 'Dark', exact: true })
          .click();
        for (const section of ['People', 'Invites', 'Connections', 'Backups & health']) {
          await nav.getByRole('link', { name: section, exact: true }).click();
          await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible();
          await expect(nav.getByRole('link', { name: section, exact: true })).toHaveAttribute(
            'aria-current',
            'page',
          );
          const refreshName =
            section === 'People'
              ? 'Refresh users'
              : section === 'Invites'
                ? 'Create invite'
                : section === 'Connections'
                  ? 'Refresh connected assistants'
                  : 'Refresh backup status';
          await expect(page.getByRole('button', { name: refreshName, exact: true })).toBeEnabled();
          for (const link of await nav.getByRole('link').all()) {
            await expect(link).toBeInViewport();
            expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
          }
          await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
            .toBe(true);
          expect(await page.locator('body').innerText()).not.toContain(privateItem.name);
          await page.screenshot({
            path: `test-results/theme-screenshots/admin-${info.project.name}-${width}-${theme}-${section.toLowerCase().replaceAll(/[^a-z]+/g, '-')}.png`,
            fullPage: true,
          });
        }
      }
      expect(errors).toEqual([]);
    } finally {
      db.close();
    }
  });
}

test('pending invitations prevent section changes, manual copying works, and leaving discards the secret', async ({
  page,
  context,
  baseURL,
}, info) => {
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`),
    auth = new AuthStore(db);
  const operator = auth.createUser(`Invite layout ${info.testId}-${info.retry}`, true);
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: auth.createSession(operator.id).token,
      url: baseURL!.replace('http:', 'https:'),
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  let release = () => {},
    releaseReadback = () => {};
  let created = false,
    heldReadback = false;
  const readbackGate = new Promise<void>((resolve) => {
    releaseReadback = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/auth/invites', async (route) => {
    if (route.request().method() === 'POST') {
      await gate;
      const response = await route.fetch();
      created = true;
      await route.fulfill({ response });
    } else if (created && !heldReadback) {
      heldReadback = true;
      await readbackGate;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Could not refresh invitations.' }),
      });
    } else await route.continue();
  });
  try {
    await page.goto('/admin#invites');
    await page.getByRole('button', { name: 'Create invite', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create invite', exact: true });
    await dialog.getByRole('button', { name: 'Create invite', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Creating…' })).toBeDisabled();
    await page.evaluate(() => {
      location.hash = 'people';
    });
    await expect(page).toHaveURL(/#invites$/);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    release();
    const address = page.getByRole('textbox', { name: 'New invite link' });
    await expect(address).toBeVisible();
    await expect(address).toBeFocused();
    // The once-only address remains the focus target while a slow readback keeps Create disabled.
    await expect(page.getByRole('button', { name: 'Create invite', exact: true })).toBeDisabled();
    releaseReadback();
    await expect(page.getByRole('button', { name: 'Refresh invites', exact: true })).toBeEnabled();
    await expect(address).toBeFocused();
    const secret = await address.inputValue();
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error('Unavailable');
          },
        },
      });
    });
    await page.getByRole('button', { name: 'Copy invite link' }).click();
    await expect(
      page.getByRole('region', { name: 'Invites', exact: true }).getByRole('status'),
    ).toHaveText('Select the link below and copy it manually.');
    await expect(address).toHaveValue(secret);
    const nav = page.getByRole('navigation', { name: 'Administration sections' });
    await nav.getByRole('link', { name: 'People', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'People', exact: true })).toBeVisible();
    await nav.getByRole('link', { name: 'Invites', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Invites' })).toBeVisible();
    await expect(address).toHaveCount(0);
    expect(await page.content()).not.toContain(secret);
    await page.reload();
    await expect(page.getByRole('list', { name: 'Invites' })).toBeVisible();
    await expect(address).toHaveCount(0);
    expect(await (await context.request.get('/api/auth/invites')).text()).not.toContain(secret);
  } finally {
    release();
    releaseReadback();
    db.close();
  }
});

test('a response from an unmounted section cannot redirect a current administration view', async ({
  page,
  context,
  baseURL,
}, info) => {
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`),
    auth = new AuthStore(db);
  const operator = auth.createUser(`Stale layout ${info.testId}-${info.retry}`, true);
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: auth.createSession(operator.id).token,
      url: baseURL!.replace('http:', 'https:'),
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  let release = () => {},
    started = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/api/auth/admin/users', async (route) => {
    started();
    await gate;
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Expired old response' }),
    });
  });
  try {
    await page.goto('/admin');
    await requested;
    await page
      .getByRole('navigation', { name: 'Administration sections' })
      .getByRole('link', { name: 'Invites', exact: true })
      .click();
    await expect(page.getByRole('button', { name: 'Create invite', exact: true })).toBeEnabled();
    const response = page.waitForResponse('**/api/auth/admin/users');
    release();
    await response;
    // A second authorized load gives the abandoned callback time to finish without a fixed sleep.
    await page.getByRole('button', { name: 'Create invite', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Create invite', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/admin#invites$/);
    await expect(page.getByText('Expired old response', { exact: true })).toHaveCount(0);
  } finally {
    release();
    db.close();
  }
});
