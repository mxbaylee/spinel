import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Read the computed value through the real grid's native Copy action. The
 * server retains authored formulas; a stored calculation cache is not its API. */
export async function expectNativeSheetValue(
  page: Page,
  address: string,
  expected: string,
  copyShortcut: 'Control+c' | 'ControlOrMeta+c' = 'Control+c',
) {
  await page.bringToFront();
  const box = page
    .getByRole('region', { name: 'Sheet document', exact: true })
    .locator('[data-u-comp="defined-name"] input');
  await expect
    .poll(
      async () => {
        await box.fill(address);
        await box.press('Enter');
        const sentinel = `not-copied-${crypto.randomUUID()}`;
        await page.evaluate((value) => navigator.clipboard.writeText(value), sentinel);
        await page.keyboard.press(copyShortcut);
        await expect
          .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
            timeout: 5000,
            intervals: [10],
          })
          .not.toBe(sentinel);
        return (await page.evaluate(() => navigator.clipboard.readText())).trim();
      },
      { timeout: 10_000 },
    )
    .toBe(expected);
  await page.keyboard.press('Escape');
}
