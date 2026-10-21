/** npm run screenshots -- <story ids>. Build Storybook first; one browser, one page at a time. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { preview } from 'vite';
import { chromium, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

if (
  process.platform === 'darwin' &&
  execFileSync('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], {
    encoding: 'utf8',
  }).trim() !== '1'
) {
  throw new Error('Memory pressure is elevated. Capture in CI per decision #52.');
}
const index = JSON.parse(await readFile('storybook-static/index.json', 'utf8')) as {
  entries: Record<string, { type: string; title: string; name: string }>;
};
const before = [
  'shell-applayout--desktop',
  'dashboard-dashboard--populated',
  'dashboard-dashboard--empty',
  'dashboard-searchpanel--results',
  'dashboard-trash--with-items',
  'settings-themesettings--default',
  'settings-assistantconnections--loaded',
  'settings-connectassistant--consent',
  'settings-accesstokens--loaded',
  'editor-versionnames--open',
  'sharing-sharing--with-people',
  'sharing-sharelink--link-on-view-only',
  'admin-adminusers--loaded',
  'admin-admininvites--loaded',
  'admin-backupstatus--healthy',
  'guest-guestapp--link-revoked',
];
const args = process.argv.slice(2);
const requested = args.length
  ? args
  : [
      ...Object.keys(index.entries).filter((id) => id.startsWith('redesign-')),
      ...before.filter((id) => index.entries[id]),
    ];
for (const id of requested)
  if (index.entries[id]?.type !== 'story') throw new Error(`Unknown story: ${id}`);
const directory = resolve(process.env.SPINEL_SCREENSHOT_DIR ?? 'test-results/design-review');
await mkdir(directory, { recursive: true });
const server = await preview({
  configFile: false,
  root: resolve('storybook-static'),
  build: { outDir: '.' },
  preview: { host: '127.0.0.1', port: 6007, strictPort: true },
});
const browser = await chromium.launch();
const captures: { id: string; variant: string; filename: string; title: string }[] = [];
const verifications: string[] = [];
const variants = [
  ['light', 1280, 'light'],
  ['dark', 1280, 'dark'],
  ['light', 390, 'phone'],
  ['dark', 390, 'phone-dark'],
  ['light', 768, 'tablet'],
] as const;
try {
  for (const [theme, width, variant] of variants) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      isMobile: width === 390,
      hasTouch: width <= 768,
      reducedMotion: 'reduce',
      colorScheme: theme,
    });
    await page.clock.setFixedTime(new Date('2026-10-20T16:00:00Z'));
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const id of requested) {
      errors.length = 0;
      await page.goto(
        `http://127.0.0.1:6007/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`,
      );
      await expect(page.locator('#storybook-root')).not.toBeEmpty();
      await expect(page.locator('#storybook-root')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('.sb-errordisplay')).toBeHidden();
      if (id.startsWith('redesign-')) {
        await expect(page.locator('.sp-ui').first()).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
          `Page overflow: ${id} ${variant}`,
        ).toBe(true);
      }
      expect(errors, `Runtime errors in ${id}`).toEqual([]);
      const filename = `${id}-${variant}.png`;
      await page.screenshot({
        path: resolve(directory, filename),
        fullPage: true,
        animations: 'disabled',
      });
      captures.push({
        id,
        variant,
        filename,
        title: `${index.entries[id].title} / ${index.entries[id].name}`,
      });
      if (id === 'redesign-controls--default') {
        await verifyControls(page, variant, directory);
        verifications.push(
          `${variant}: menu keyboard navigation, Escape/focus return, selector keyboard selection, nested dialog portal, dialog focus containment, named semantics`,
        );
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise<void>((done, reject) =>
    server.httpServer.close((error) => (error ? reject(error) : done())),
  );
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
await writeFile(
  resolve(directory, 'manifest.json'),
  JSON.stringify({ capturedAt: '2026-10-20T16:00:00Z', captures, verifications }, null, 2),
);
await writeFile(
  resolve(directory, 'index.html'),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Spinel design review</title><style>body{font:16px system-ui;margin:32px;background:#fafafa;color:#222}nav{display:flex;gap:16px;flex-wrap:wrap}section{margin:40px 0} .shots{display:flex;gap:16px;overflow:auto;align-items:start}figure{margin:0;flex:0 0 480px}img{width:100%;border:1px solid #ddd}figcaption{padding:12px}a{color:#8a1d3f}</style><h1>Spinel · SPN-047 design review</h1><p>Proposed screens are Storybook mockups, not production routes. Current screens are labelled by their existing story title. Space and delegated file Admin are planned.</p><nav>${requested.map((id) => `<a href="#${escape(id)}">${escape(index.entries[id].name)}</a>`).join('')}</nav>${requested
    .map(
      (id) =>
        `<section id="${escape(id)}"><h2>${escape(index.entries[id].title)} / ${escape(index.entries[id].name)}</h2><div class="shots">${captures
          .filter((c) => c.id === id)
          .map(
            (c) =>
              `<figure><a href="${escape(c.filename)}"><img loading="lazy" src="${escape(c.filename)}" alt="${escape(c.title + ' · ' + c.variant)}"></a><figcaption>${escape(c.variant)}</figcaption></figure>`,
          )
          .join('')}</div></section>`,
    )
    .join('')}</html>`,
);
// The mockup chunk is isolated from production. Report actual emitted bytes, not npm unpacked size.
const { readdir } = await import('node:fs/promises');
const assets = await readdir('storybook-static/assets');
const bundles = [];
for (const filename of assets.filter(
  (name) => /Controls|Mockups/.test(name) && name.endsWith('.js'),
)) {
  const bytes = await readFile(resolve('storybook-static/assets', filename));
  bundles.push({ filename, bytes: bytes.length, gzipBytes: gzipSync(bytes).length });
}
await writeFile(resolve(directory, 'bundle-size.json'), JSON.stringify(bundles, null, 2));
console.log(
  `Captured ${captures.length} screenshots in ${directory}; ${verifications.length} interaction passes.`,
);

async function verifyControls(page: Page, variant: string, output: string) {
  const menu = page.getByRole('button', { name: 'File actions', exact: true });
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.screenshot({ path: resolve(output, `menu-open-${variant}.png`) });
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Move', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  const select = page.getByRole('combobox', { name: 'Appearance', exact: true });
  await select.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(select).toContainText('Modern');
  const trigger = page.getByRole('button', { name: 'Open confirmation' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Move this file to Trash?' });
  await expect(dialog).toBeVisible();
  await page.getByRole('combobox', { name: 'Example nested selector' }).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await expect(page.getByRole('listbox')).toHaveCSS(
    'color',
    await dialog.evaluate((node) => getComputedStyle(node).color),
  );
  await page.screenshot({ path: resolve(output, `dialog-select-open-${variant}.png`) });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await writeFile(
    resolve(output, `controls-semantics-${variant}.txt`),
    await page.locator('#storybook-root').ariaSnapshot(),
  );
}
