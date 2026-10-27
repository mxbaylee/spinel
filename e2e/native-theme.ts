import { createCanvas, loadImage } from '@napi-rs/canvas';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/** Wait for the rendered SDK surface, not just the earlier app theme update. */
export async function nativeTheme(page: Page, target: Locator, scheme: 'light' | 'dark') {
  await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
  const eventLoop =
    process.env.VITE_DOC_SELECTION_EVIDENCE === '1'
      ? monitorEventLoopDelay({ resolution: 20 })
      : undefined;
  eventLoop?.enable();
  let attempt = 0;
  let lastMeasurement:
    | {
        attempt: number;
        started: number;
        resolvedMs?: number;
        capturedMs?: number;
        disposedMs?: number;
        ratio?: number;
      }
    | undefined;
  // Match appearance.spec.ts's composited-surface check: transparent native
  // cells must be measured over the SDK's CSS surface, not as raw canvas pixels.
  try {
    await expect
      .poll(async () => {
        const measurement: NonNullable<typeof lastMeasurement> = {
          attempt: ++attempt,
          started: Date.now(),
        };
        lastMeasurement = measurement;
        // Locator.screenshot reports only its first resolution RPC in this
        // Playwright version. Keep the equivalent fresh handle acquisition and
        // disposal, but report screenshot itself so failure traces retain its
        // font, stability, scroll and browser-capture call log.
        const element = await target.elementHandle();
        if (!element) throw new Error('Native theme target did not resolve.');
        measurement.resolvedMs = Date.now() - measurement.started;
        let pixels: Buffer;
        try {
          pixels = await element.screenshot();
          measurement.capturedMs = Date.now() - measurement.started;
        } finally {
          await element.dispose();
          measurement.disposedMs = Date.now() - measurement.started;
        }
        const image = await loadImage(pixels);
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
        measurement.ratio = matching / (image.width * image.height);
        return measurement.ratio;
      })
      .toBeGreaterThan(0.8);
  } catch (error) {
    console.info(
      'Native theme measurement:',
      JSON.stringify({
        scheme,
        lastMeasurement,
        nodeEventLoopDelayMs: eventLoop
          ? { max: eventLoop.max / 1e6, mean: eventLoop.mean / 1e6 }
          : null,
      }),
    );
    throw error;
  } finally {
    eventLoop?.disable();
  }
}
