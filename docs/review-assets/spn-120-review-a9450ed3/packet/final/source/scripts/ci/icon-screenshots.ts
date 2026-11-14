/** Check real built stories and their API fixtures; --no-screenshots omits routine review PNGs. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { preview } from 'vite';
import { chromium, expect } from '@playwright/test';

const args = process.argv.slice(2);
if (args.length > 1 || args.some((arg) => arg !== '--no-screenshots')) {
  throw new Error('Only --no-screenshots is accepted by the icon review.');
}
const captureScreenshots = !args.includes('--no-screenshots');
const checked: { id: string; variant: string }[] = [];

const server = await preview({
  configFile: false,
  root: resolve('storybook-static'),
  build: { outDir: '.' },
  preview: { host: '127.0.0.1', port: 6006, strictPort: true },
});
const browser = await chromium.launch();
const directory = 'test-results/entity-icons';
try {
  await mkdir(directory, { recursive: true });
  for (const [theme, width, label] of [
    ['light', 1280, 'light'],
    ['dark', 1280, 'dark'],
    ['light', 390, 'phone'],
  ] as const) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const [id, text] of [
      ['identity-entity-icons--lineup', 'One gem family'],
      ['identity-entity-icons--in-context', 'Create and browse'],
      ['dashboard-dashboard--populated', 'Quarterly budget'],
      ['dashboard-dashboard--shared-drawer', 'Shared forecast'],
      ['dashboard-dashboard--new-doc', 'New doc'],
      ['dashboard-dashboard--new-sheet', 'New sheet'],
      ['dashboard-searchpanel--results', 'Budget notes'],
      ['dashboard-trash--with-items', 'Old budget'],
      ...['document', 'spreadsheet', 'space-preview', 'emoji', 'long-title', 'long-word'].map(
        (example) => [`identity-social-cards--${example}`, ''],
      ),
    ]) {
      try {
        await page.goto(
          `http://127.0.0.1:6006/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`,
        );
        if (text) await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
        if (id === 'dashboard-searchpanel--results')
          await expect(page.getByText('Household / Finance', { exact: true })).toBeVisible();
        if (id.endsWith('--new-doc'))
          await expect(page.getByRole('combobox', { name: 'Type', exact: true })).toHaveValue(
            'doc',
          );
        if (id.endsWith('--new-sheet'))
          await expect(page.getByRole('combobox', { name: 'Type', exact: true })).toHaveValue(
            'sheet',
          );
        if (id.includes('social-cards')) {
          await expect(page.getByRole('img')).toBeVisible();
          await page.getByRole('img').evaluate(async (image) => {
            await (image as HTMLImageElement).decode();
          });
        } else {
          await expect(page.locator('.entity-icon').first()).toBeVisible();
        }
        await expect(page.locator('.sb-errordisplay')).toBeHidden();
        expect(errors, `Runtime errors in ${id}`).toEqual([]);
        if (captureScreenshots) {
          await page.screenshot({ path: `${directory}/${id}-${label}.png`, fullPage: true });
        }
        checked.push({ id, variant: label });
      } catch (error) {
        // Failure evidence remains available when routine review captures are off.
        await Promise.allSettled([
          page.screenshot({
            path: `${directory}/failed-${id}-${label}.png`,
            fullPage: true,
            timeout: 5000,
          }),
          writeFile(
            resolve(directory, `failed-${id}-${label}.json`),
            JSON.stringify(
              {
                id,
                variant: label,
                captureScreenshots,
                checked,
                error: (error instanceof Error
                  ? (error.stack ?? error.message)
                  : String(error)
                ).slice(0, 6000),
              },
              null,
              2,
            ),
          ),
        ]);
        throw error;
      }
    }
    await page.close();
  }
  await writeFile(
    resolve(directory, 'manifest.json'),
    JSON.stringify({ captureScreenshots, checked }, null, 2),
  );
} finally {
  await browser.close();
  await new Promise<void>((done, reject) =>
    server.httpServer.close((error) => (error ? reject(error) : done())),
  );
}
