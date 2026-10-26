import { readFile, writeFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect } from '@playwright/test';
import type { Download, Locator, Page, TestInfo } from '@playwright/test';

/** Fail on the real endpoint response instead of hiding a rejection behind a download timeout. */
export async function downloadPdf(page: Page, button: Locator, path?: string) {
  const download = page.waitForEvent('download', { timeout: 65_000 }).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  const response = page
    .waitForResponse(
      (value) =>
        value.request().method() === 'POST' &&
        (path
          ? new URL(value.url()).pathname === path
          : new URL(value.url()).pathname.endsWith('/pdf')),
      { timeout: 65_000 },
    )
    .then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
  await button.click();
  const returned = await response;
  if ('error' in returned) throw returned.error;
  const endpoint = new URL(returned.value.url()).pathname;
  const diagnostic = returned.value.ok()
    ? ''
    : await returned.value.text().catch(() => 'Response body unavailable.');
  expect(
    returned.value.status(),
    `PDF POST ${endpoint} returned ${returned.value.status()}: ${diagnostic.slice(0, 2000)}`,
  ).toBe(200);
  expect(returned.value.headers()['content-type']).toMatch(/^application\/pdf(?:;|$)/);
  const received = await download;
  if ('error' in received) throw received.error;
  expect(await received.value.failure()).toBeNull();
  return received.value;
}

/** Reopen the actual downloaded bytes and retain every page, not an editor screenshot. */
export async function inspectPdf(
  download: Download,
  info: TestInfo,
  label: string,
  expected: { text?: string[]; forbidden?: string[]; image?: boolean; colors?: number[][] } = {},
) {
  const pdf = await readFile((await download.path())!);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  await writeFile(info.outputPath(`${label}-export.pdf`), pdf);
  const loading = getDocument({ data: new Uint8Array(pdf), useSystemFonts: false });
  const reopened = await loading.promise;
  try {
    expect(reopened.numPages).toBeGreaterThan(0);
    const metadata = await reopened.getMetadata();
    const details = metadata.info as Record<string, unknown>;
    expect(details.Author ?? '').toBe('');
    expect(metadata.metadata).toBeNull();
    const text: string[] = [];
    let image = false;
    let ink = 0;
    const colorCounts = (expected.colors ?? []).map(() => 0);
    for (let number = 1; number <= reopened.numPages; number++) {
      const page = await reopened.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      text.push(
        (await page.getTextContent()).items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' '),
      );
      image ||= (await page.getOperatorList()).fnArray.some((operation) =>
        [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].includes(
          operation,
        ),
      );
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 0; index < pixels.length; index += 4) {
        if (
          pixels[index + 3] &&
          Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) < 240
        )
          ink++;
        expected.colors?.forEach((color, colorIndex) => {
          if (color.every((value, channel) => Math.abs(pixels[index + channel] - value) < 12))
            colorCounts[colorIndex]++;
        });
      }
      await writeFile(
        info.outputPath(`${label}-page-${number}-export-opened.png`),
        await canvas.encode('png'),
      );
    }
    const content = text.join('\n');
    for (const value of expected.text ?? [])
      expect(content.replace(/\s/g, '')).toContain(value.replace(/\s/g, ''));
    for (const value of ['watermark', ...(expected.forbidden ?? [])]) {
      expect(content.toLowerCase()).not.toContain(value.toLowerCase());
      expect(JSON.stringify(metadata).toLowerCase()).not.toContain(value.toLowerCase());
    }
    if (expected.text?.length || expected.image)
      expect(
        ink,
        'The downloaded PDF must contain visible content on its rendered pages',
      ).toBeGreaterThan(50);
    if (expected.image)
      expect(image, 'The downloaded PDF must preserve its authored image').toBe(true);
    for (const count of colorCounts)
      expect(count, 'Each authored image color must remain visible in the PDF').toBeGreaterThan(50);
    return { text: content, pages: reopened.numPages };
  } finally {
    await loading.destroy();
  }
}
