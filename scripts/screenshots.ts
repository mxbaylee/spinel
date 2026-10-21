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
  'dashboard-dashboard--empty-workspace',
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
  : [...Object.keys(index.entries).filter((id) => id.startsWith('redesign-')), ...before];
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
      if (id === 'redesign-screens--profile-icon-picker')
        await expect(
          page.getByRole('dialog', { name: 'Choose your icon', exact: true }),
        ).toBeVisible();
      if (id === 'redesign-screens--profile-colour-picker')
        await expect(
          page.getByRole('dialog', { name: 'Choose your profile colour', exact: true }),
        ).toBeVisible();
      if (id === 'redesign-screens--dashboard-new-menu') {
        await expect(page.getByRole('menu', { name: 'New file', exact: true })).toBeVisible();
      }
      if (id.startsWith('redesign-')) {
        await expect(page.locator('.sp-ui').first()).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
          `Page overflow: ${id} ${variant}`,
        ).toBe(true);
      }
      if (id.startsWith('redesign-') && width <= 768) {
        const smallTargets = await page
          .locator(
            '.sp-ui button, .sp-ui input:not([type=radio]), .sp-ui summary, .sp-ui [role=radio]',
          )
          .evaluateAll((nodes) =>
            nodes.flatMap((node) => {
              if (node.closest('[aria-hidden="true"]')) return [];
              const box = node.getBoundingClientRect();
              if (!box.width || !box.height) return [];
              return box.height < 43.5 || box.width < 43.5
                ? [
                    {
                      label: node.getAttribute('aria-label') || node.textContent?.trim(),
                      width: box.width,
                      height: box.height,
                    },
                  ]
                : [];
            }),
          );
        expect(smallTargets, `Touch targets: ${id} ${variant}`).toEqual([]);
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
    }
    await page.close();
  }
  if (requested.includes('redesign-screens--dashboard')) {
    for (const width of [1280, 768, 390]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        hasTouch: width <= 768,
      });
      await page.goto(
        'http://127.0.0.1:6007/iframe.html?id=redesign-screens--dashboard&viewMode=story&globals=theme:light',
      );
      const network = page.getByRole('button', {
        name: 'Online — connected to Spinel',
        exact: true,
      });
      if (width > 900) await network.hover();
      else await network.click();
      await expect(
        page.getByText('Connected to Spinel. Open save status for details about this document.', {
          exact: true,
        }),
      ).toBeVisible();
      await page.screenshot({ path: resolve(directory, `network-explanation-${width}.png`) });
      await page.keyboard.press('Escape');
      await expect(
        page.getByText('Connected to Spinel. Open save status for details about this document.', {
          exact: true,
        }),
      ).toBeHidden();
      const namesBefore = await page
        .getByRole('list', { name: 'Files', exact: true })
        .getByRole('listitem')
        .allTextContents();
      await page.getByRole('button', { name: 'Grid view', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Grid view', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(
        await page
          .getByRole('list', { name: 'Files', exact: true })
          .getByRole('listitem')
          .allTextContents(),
      ).toEqual(namesBefore);
      await page.getByRole('button', { name: 'List view', exact: true }).click();
      if (width > 900) {
        await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Browse files', exact: true })).toBeFocused();
        const pinned = page
          .getByRole('navigation', { name: 'File shortcuts' })
          .getByRole('button', { name: 'Quarterly budget', exact: true });
        // Use actual keyboard navigation so the browser enters :focus-visible mode.
        for (let step = 0; step < 3; step += 1) await page.keyboard.press('Tab');
        await expect(pinned).toBeFocused();
        await expect(pinned.locator('.rd-nav-tooltip')).toBeVisible();
        await page
          .getByRole('navigation', { name: 'File shortcuts' })
          .getByRole('button', { name: 'Shared with me', exact: true })
          .click();
        await expect(
          page.getByRole('heading', { name: 'Shared with me', exact: true }),
        ).toBeVisible();
        await page
          .getByRole('navigation', { name: 'File shortcuts' })
          .getByRole('button', { name: 'My files', exact: true })
          .click();
        await page.getByRole('button', { name: 'Browse files', exact: true }).click();
        await expect(
          page.getByRole('button', { name: 'Collapse navigation', exact: true }),
        ).toBeFocused();
        await page.getByRole('button', { name: /^Filters/ }).click();
        await page.getByRole('combobox', { name: 'Ownership', exact: true }).click();
        await page.getByRole('option', { name: 'Mine', exact: true }).click();
        await expect(page.getByRole('listitem').filter({ hasText: 'Household' })).toBeVisible();
        await expect(
          page.getByRole('listitem').filter({ hasText: 'Quarterly budget' }),
        ).toHaveCount(0);
      } else {
        await page.getByRole('button', { name: 'Browse files', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Browse files', exact: true })).toBeVisible();
        await page.screenshot({ path: resolve(directory, `navigation-open-${width}.png`) });
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'Shared with me', exact: true })
          .click();
        await expect(page.getByRole('dialog')).toBeHidden();
        await expect(
          page.getByRole('heading', { name: 'Shared with me', exact: true }),
        ).toBeVisible();
      }
      if (width <= 900) await page.getByRole('button', { name: /^Appearance:/ }).click();
      const appearance = page.getByRole('radiogroup', { name: 'Appearance', exact: true });
      await appearance.getByRole('radio', { name: 'Dark', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await appearance.getByRole('radio', { name: 'Follow system', exact: true }).click();
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await page.emulateMedia({ colorScheme: 'light' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await expect(
        appearance.getByRole('radio', { name: 'Follow system', exact: true }),
      ).toBeChecked();
      await page.screenshot({ path: resolve(directory, `appearance-system-${width}.png`) });
      await page.close();
      verifications.push(
        `${width}px: navigation/focus, list/grid parity and segmented appearance/system response`,
      );
    }
  }
  if (requested.includes('redesign-controls--default')) {
    for (const [theme, width, variant] of variants) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        hasTouch: width <= 768,
        reducedMotion: 'reduce',
      });
      await page.goto(
        `http://127.0.0.1:6007/iframe.html?id=redesign-controls--default&viewMode=story&globals=theme:${theme}`,
      );
      await verifyControls(page, variant, directory);
      verifications.push(
        `${variant}: menu/selector keyboard navigation, Escape/focus return, dialog containment and nested themed portal`,
      );
      await page.close();
    }
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
const pairs = [
  ['dashboard-dashboard--populated', 'dashboard'],
  ['dashboard-dashboard--empty-workspace', 'empty-folder'],
  ['dashboard-searchpanel--results', 'search'],
  ['dashboard-trash--with-items', 'trash'],
  ['settings-themesettings--default', 'profile'],
  ['settings-assistantconnections--loaded', 'connections'],
  ['settings-connectassistant--consent', 'consent'],
  ['editor-versionnames--open', 'history'],
  ['sharing-sharing--with-people', 'sharing'],
  ['sharing-sharelink--link-on-view-only', 'sharing-existing-link'],
  ['admin-adminusers--loaded', 'admin'],
  ['admin-admininvites--loaded', 'admin-invites'],
  ['admin-backupstatus--healthy', 'admin-health'],
  ['guest-guestapp--link-revoked', 'revoked-link'],
];
const paired = pairs
  .map(([oldId, suffix]) => {
    const newId = `redesign-screens--${suffix}`;
    if (!requested.includes(oldId) || !requested.includes(newId)) return '';
    return `<section><h2>Before / proposed · ${escape(index.entries[newId].name)}</h2>${variants.map(([, , variant]) => `<h3>${variant}</h3><div class="shots">${[oldId, newId].map((id, i) => `<figure><a href="${id}-${variant}.png"><img loading="lazy" src="${id}-${variant}.png" alt="${i ? 'Proposed' : 'Before'} ${escape(index.entries[id].name)}"></a><figcaption>${i ? 'Proposed' : 'Before'} · ${escape(index.entries[id].title)}</figcaption></figure>`).join('')}</div>`).join('')}</section>`;
  })
  .join('');
await writeFile(
  resolve(directory, 'index.html'),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Spinel design review</title><style>body{font:16px system-ui;margin:32px;background:#fafafa;color:#222}nav{display:flex;gap:16px;flex-wrap:wrap}section{margin:40px 0} .shots{display:flex;gap:16px;overflow:auto;align-items:start}figure{margin:0;flex:0 0 480px}img{width:100%;border:1px solid #ddd}figcaption{padding:12px}a{color:#8a1d3f}</style><h1>Spinel · SPN-047 design review</h1><p>Proposed screens are Storybook mockups, not production routes. Current screens are labelled by their existing story title. Space and delegated file Admin are planned.</p><h2>Paired comparisons</h2>${paired}<h2>All states and sizes</h2><nav>${requested.map((id) => `<a href="#${escape(id)}">${escape(index.entries[id].name)}</a>`).join('')}</nav>${requested
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
  (name) => /Controls|Mockups/i.test(name) && name.endsWith('.js'),
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
  await expect(page.getByRole('option', { name: 'Follow system', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('option', { name: 'Modern · Dark', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(select).toContainText('Modern');
  const appearance = page.getByRole('radiogroup', { name: 'Appearance', exact: true });
  await appearance.getByRole('radio', { name: 'Follow system', exact: true }).click();
  await page.keyboard.press('ArrowRight');
  await expect(appearance.getByRole('radio', { name: 'Light', exact: true })).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await expect(appearance.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
  await page.screenshot({ path: resolve(output, `appearance-choice-${variant}.png`) });
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
  await expect(page.getByRole('combobox', { name: 'Example nested selector' })).toBeFocused();
  for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    await expect
      .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)), {
        message: 'Modal keeps keyboard focus inside after its focus guard settles',
      })
      .toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await writeFile(
    resolve(output, `controls-semantics-${variant}.txt`),
    await page.locator('#storybook-root').ariaSnapshot(),
  );
}
