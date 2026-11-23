import type { Page } from '@playwright/test';

// Desktop automation cannot open an OS keyboard. Exercise the browser viewport
// contract separately from the required physical keyboard observations.
export async function keyboardOcclusion(page: Page, height: number) {
  await page.evaluate((height) => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error('Visual viewport is unavailable.');
    Reflect.deleteProperty(viewport, 'height');
    const available = viewport.height;
    if (height)
      Object.defineProperty(viewport, 'height', {
        configurable: true,
        get: () => available - height,
      });
    viewport.dispatchEvent(new Event('resize'));
  }, height);
}
