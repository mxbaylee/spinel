import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { WorkspaceFiles } from '../src/server/workspace/files.ts';

// A wide viewport can still be a touch tablet: target size must not depend on width alone.
test.use({ hasTouch: true });

test('sharing keeps confirmed access on failure, retries, traps focus and returns to its trigger', async ({
  page,
  context,
  baseURL,
}, info) => {
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`);
  const auth = new AuthStore(db),
    files = new WorkspaceFiles(new WorkspaceStore(auth, { spacesEnabled: true }));
  // Retried tests share the database: keep each attempt's accessible names unique.
  const attempt = `${info.testId}-${info.retry}`;
  const owner = auth.createUser('Dialog owner ' + attempt),
    peer = auth.createUser('Dialog peer ' + attempt);
  const item = files.create(owner.id, {
    kind: 'space',
    name: 'Sharing dialog Space',
    parentId: null,
  });
  files.share(owner.id, item.id, peer.id, 'editor');
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
  // Clipboard denial is a real supported browser condition; manual copy remains available.
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException('Clipboard denied', 'NotAllowedError');
        },
      },
    }),
  );
  let writes = 0,
    linkWrites = 0,
    accessHeld = false,
    linkHeld = false,
    releaseAccess = () => {},
    releaseLink = () => {};
  const accessGate = new Promise<void>((resolve) => {
    releaseAccess = resolve;
  });
  const linkGate = new Promise<void>((resolve) => {
    releaseLink = resolve;
  });
  async function switchTab(from: Locator, to: Locator, key: 'ArrowLeft' | 'ArrowRight') {
    await expect(from).toBeEnabled();
    // Target the key at the tab in one action, after any write guard clears.
    // A separate focus/keyboard pair can race an editor's focus restoration.
    await from.press(key);
    await expect(to).toHaveAttribute('aria-selected', 'true');
    await expect(to).toBeFocused();
  }
  await page.route(`**/api/items/${item.id}/sharing`, async (route) => {
    if (route.request().method() === 'PUT') {
      if (++writes === 1) {
        await route.fulfill({ status: 503, json: { error: 'Temporary access update failure.' } });
        return;
      }
      if (writes === 2) {
        accessHeld = true;
        await accessGate;
      }
    }
    await route.continue();
  });
  await page.route(`**/api/items/${item.id}/link`, async (route) => {
    if (route.request().method() === 'PUT' && ++linkWrites === 1) {
      linkHeld = true;
      await linkGate;
    }
    await route.continue();
  });
  try {
    await page.goto(`/spaces/${item.id}`);
    const trigger = page.getByRole('button', {
      name: `Space actions for ${item.name}`,
      exact: true,
    });
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
    const dialog = page.getByRole('dialog', {
      name: `Share ${item.name}`,
      exact: true,
      includeHidden: true,
    });
    await expect(page.getByRole('dialog')).toHaveCount(1);
    const peopleTab = dialog.getByRole('tab', { name: 'People', exact: true, includeHidden: true }),
      linkTab = dialog.getByRole('tab', { name: 'Link', exact: true, includeHidden: true }),
      edit = dialog.getByRole('button', { name: `Edit access for ${peer.name}`, exact: true });
    await expect(peopleTab).toHaveAttribute('aria-selected', 'true');
    await edit.click();
    const choice = dialog.getByRole('combobox', { name: `Access for ${peer.name}`, exact: true });
    const row = dialog.locator('.sharing-person').filter({ hasText: peer.name });
    await choice.selectOption('viewer');
    await row.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(row.getByRole('alert')).toContainText('Could not confirm the update.');
    await expect(edit).toContainText('Can edit');
    await expect(choice).toHaveValue('viewer');
    expect(files.get(peer.id, item.id).access).toBe('editor');
    await row.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(() => accessHeld).toBe(true);
    for (const tab of [peopleTab, linkTab]) await expect(tab).toBeDisabled();
    await expect(choice).toBeDisabled();
    await expect(row.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    releaseAccess();
    await expect(edit).toContainText('View only');
    await expect(choice).toHaveCount(0);
    await expect(edit).toBeFocused();
    expect(files.get(peer.id, item.id).access).toBe('viewer');
    await dialog.getByRole('button', { name: 'Copy account link', exact: true }).click();
    await expect(dialog.getByLabel('Share address', { exact: true })).toHaveValue(
      `${baseURL}/spaces/${item.id}`,
    );
    await expect(
      dialog.getByRole('status').filter({ hasText: 'Could not copy automatically.' }),
    ).toBeVisible();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
      await edit.click();
      await choice.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await choice.focus();
      for (let count = 0; count < 8; count++) {
        await page.keyboard.press(count % 2 ? 'Shift+Tab' : 'Tab');
        await expect
          .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
          .toBe(true);
      }
      await row.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.press('Enter');
    await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
    await expect(edit).toContainText('View only');
    // Real arrow-key tab activation discards an unfinished editor draft.
    await edit.click();
    await choice.selectOption('editor');
    await switchTab(peopleTab, linkTab, 'ArrowRight');
    await switchTab(linkTab, peopleTab, 'ArrowLeft');
    await edit.click();
    await expect(choice).toHaveValue('viewer');
    await row.getByRole('button', { name: 'Cancel', exact: true }).click();
    await switchTab(peopleTab, linkTab, 'ArrowRight');
    const link = dialog.getByRole('region', {
      name: 'Guest link',
      exact: true,
      includeHidden: true,
    });
    await link.getByRole('button', { name: 'Create link', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Share the whole Space?', exact: true });
    await expect(confirmation).toContainText('every current and future page and folder');
    await confirmation.getByRole('button', { name: 'Create view link', exact: true }).click();
    await expect.poll(() => linkHeld).toBe(true);
    for (const tab of [peopleTab, linkTab]) await expect(tab).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: 'Close dialog', exact: true, includeHidden: true }),
    ).toBeDisabled();
    await expect(
      link.getByRole('combobox', { name: 'Link access', exact: true, includeHidden: true }),
    ).toBeDisabled();
    await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(confirmation).toBeVisible();
    releaseLink();
    await expect(confirmation).toBeHidden();
    await expect(link.getByRole('button', { name: 'Copy guest link', exact: true })).toBeFocused();
    const address = await link.getByLabel('Guest link address', { exact: true }).inputValue();
    expect(address).toMatch(/#.+$/);
    // The inactive panel is inaccessible, but its controller keeps the once-only URL.
    await switchTab(linkTab, peopleTab, 'ArrowLeft');
    await expect(link).toBeHidden();
    await expect(dialog.getByRole('button', { name: 'Copy guest link', exact: true })).toHaveCount(
      0,
    );
    await expect(
      dialog.getByRole('textbox', { name: 'Guest link address', exact: true }),
    ).toHaveCount(0);
    await switchTab(peopleTab, linkTab, 'ArrowRight');
    await expect(link.getByLabel('Guest link address', { exact: true })).toHaveValue(address);
    expect(linkWrites).toBe(1);
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
    await expect(peopleTab).toHaveAttribute('aria-selected', 'true');
    await linkTab.click();
    const replaceAction = link.getByRole('button', { name: 'Replace link…', exact: true });
    await expect(replaceAction).toBeVisible();
    await expect(link.getByLabel('Guest link address', { exact: true })).toHaveCount(0);
    await replaceAction.click();
    const replace = page.getByRole('dialog', { name: 'Replace the link?', exact: true });
    await replace.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(replaceAction).toBeFocused();
    await expect(link.getByText('Guests can view.', { exact: true })).toBeVisible();
    await link.getByRole('button', { name: 'More guest link actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Turn off link', exact: true }).click();
    const turnOff = page.getByRole('dialog', { name: 'Turn off this Space link?', exact: true });
    await turnOff.getByRole('button', { name: 'Turn off link', exact: true }).click();
    await expect(turnOff).toBeHidden();
    await expect(link.getByRole('button', { name: 'Create link', exact: true })).toBeFocused();
    await expect(
      link.getByText('Off. Only people with access can open this item.', { exact: true }),
    ).toBeVisible();
  } finally {
    releaseAccess();
    releaseLink();
    db.close();
  }
});
