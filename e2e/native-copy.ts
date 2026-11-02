import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function openNativeCopy(
  page: Page,
  mobile = false,
  captureMenu?: () => Promise<void>,
) {
  if (mobile) {
    // The actual native More control must remain reachable for a Doc viewer.
    await page.locator('.univer-container [data-u-comp="mobile-more-trigger"]').tap();
    const action = page
      .locator('[data-u-comp="mobile-more-menu"]')
      .getByRole('button', { name: 'Make a copy', exact: true });
    await expect(action).toBeVisible();
    await captureMenu?.();
    await action.tap();
  } else {
    const toolbar = page.locator('.univer-container [data-u-comp="ribbon-toolbar"]');
    await expect(toolbar).toBeVisible();
    const inline = toolbar.getByRole('button', { name: 'Make a copy', exact: true });
    if (!(await inline.isVisible())) {
      // The pinned native classic ribbon collapses trailing items into this
      // dropdown at desktop widths. Its overflow trigger has no accessible name.
      const overflow = toolbar.locator(':scope > div > button[aria-haspopup="dialog"]');
      await expect(overflow).toHaveCount(1);
      await overflow.click();
    }
    const action = page.locator('[data-u-command="spinel.command.make-copy"]:visible');
    await expect(action).toHaveAccessibleName('Make a copy');
    await action.click();
  }
  const dialog = page.getByRole('dialog').filter({
    has: page.getByRole('form', { name: 'Make a copy', exact: true }),
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toBeVisible();
  return dialog;
}
