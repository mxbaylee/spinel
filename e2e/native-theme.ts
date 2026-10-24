import { createCanvas, loadImage } from '@napi-rs/canvas';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/** Wait for the rendered SDK surface, not just the earlier app theme update. */
export async function nativeTheme(page: Page, target: Locator, scheme: 'light' | 'dark') {
  await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
  // Match appearance.spec.ts's composited-surface check: transparent native
  // cells must be measured over the SDK's CSS surface, not as raw canvas pixels.
  await expect
    .poll(async () => {
      const image = await loadImage(await target.screenshot());
      const canvas = createCanvas(image.width, image.height);
      const drawing = canvas.getContext('2d');
      drawing.drawImage(image, 0, 0);
      const { data } = drawing.getImageData(0, 0, image.width, image.height);
      let matching = 0;
      for (let i = 0; i < data.length; i += 4)
        if (
          data[i + 3] === 255 &&
          (scheme === 'dark'
            ? Math.max(data[i], data[i + 1], data[i + 2]) < 96
            : Math.min(data[i], data[i + 1], data[i + 2]) > 192)
        )
          matching++;
      return matching / (image.width * image.height);
    })
    .toBeGreaterThan(0.8);
}
