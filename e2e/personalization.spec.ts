import { filenameEmoji } from '../src/shared/appearance.ts';
import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { WorkspaceStore } from '../src/server/workspace/store.ts';
import { AppearanceStore } from '../src/server/appearance/store.ts';

function contrastRatio(foreground: string, background: string) {
  const luminance = (color: string) => {
    // These controls use opaque colors; do not treat transparency as black.
    const rgb = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(color);
    if (!rgb) throw new Error(`Expected an opaque computed color, received ${color}`);
    const [r, g, b] = rgb.slice(1).map((part) => {
      const channel = Number(part) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [low, high] = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (high + 0.05) / (low + 0.05);
}
for (const variant of [
  { name: 'light', width: 1440, height: 1000 },
  { name: 'dark', width: 1440, height: 1000 },
  { name: 'phone-light', width: 390, height: 844 },
  { name: 'phone-dark', width: 390, height: 844 },
]) {
  test(`personalization persists and cover controls remain stable ${variant.name}`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    test.setTimeout(120_000);
    const db = openDatabase(`test-results/${info.project.name}/app.sqlite`),
      auth = new AuthStore(db),
      workspace = new WorkspaceStore(auth);
    const owner = auth.createUser('Iris Garden');
    const item = workspace.create(owner.id, {
      name: 'Field notes',
      kind: 'doc',
      parentId: null,
      icon: '🌷',
    });
    await new AppearanceStore(workspace).update({ userId: owner.id, customData: {} }, item.id, {
      revision: 1,
      cover: { source: 'gem', gem: 'spinel' },
    });
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
    await page.setViewportSize({ width: variant.width, height: variant.height });
    await page.addInitScript(
      (theme) => localStorage.setItem('spinel-theme', theme),
      variant.name.includes('dark') ? 'dark' : 'light',
    );
    await mkdir('test-results/theme-screenshots', { recursive: true });
    const capture = async (name: string) => {
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.screenshot({
        path: `test-results/theme-screenshots/spn-086-${name}-${variant.name}-${info.project.name}.png`,
        animations: 'disabled',
      });
    };
    try {
      await page.goto(`/?item=${item.id}`);
      await expect(
        page.getByRole('button', { name: 'Change appearance', exact: true }),
      ).toBeVisible();
      await expect(page.locator('.appearance-banner img')).toBeVisible();
      await expect(page.locator('.appearance-banner img')).toHaveCSS('object-position', '0% 50%');
      await expect
        .poll(() =>
          page
            .locator('.appearance-banner img')
            .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
        )
        .toBe(true);
      await expect(page.getByRole('tab', { name: 'Start', exact: true })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Save details: Saved', exact: true }),
      ).toBeVisible();
      await capture('editor');
      await page.getByRole('button', { name: 'Change appearance', exact: true }).click();
      await page.getByRole('button', { name: 'Choose icon or emoji', exact: true }).click();
      const identityPicker = page.getByRole('dialog', {
        name: 'Choose an icon or emoji',
        exact: true,
      });
      await identityPicker
        .getByRole('textbox', { name: 'Search icons and emojis', exact: true })
        .fill('lemon');
      await capture('identity-picker');
      await identityPicker.getByRole('button', { name: 'Lemon emoji', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Choose icon or emoji', exact: true }),
      ).toBeFocused();
      await page.getByRole('button', { name: 'Choose icon or emoji', exact: true }).click();
      await page.keyboard.press('Escape');
      await expect(identityPicker).toHaveCount(0);
      await expect(page.locator('.identity-choice-current')).toContainText('🍋');
      await expect(
        page.getByRole('button', { name: 'Choose icon or emoji', exact: true }),
      ).toBeFocused();
      if (variant.name === 'light') {
        const path = `**/api/appearance/items/${item.id}`;
        await page.route(path, (route) =>
          route.request().method() === 'GET'
            ? route.fulfill({ status: 503, json: { error: 'Temporary connection failure.' } })
            : route.continue(),
        );
        const failedPoll = page.waitForResponse(
          (response) =>
            response.url().endsWith(`/api/appearance/items/${item.id}`) &&
            response.status() === 503,
        );
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await failedPoll;
        await expect(page.locator('.identity-choice-current')).toContainText('🍋');
        await page.unroute(path);
      }

      await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Change appearance', exact: true }),
      ).toContainText('🍋');
      await page.reload();
      await expect(
        page.getByRole('button', { name: 'Save details: Saved', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Change appearance', exact: true }),
      ).toContainText('🍋');
      await page.getByRole('button', { name: 'Change appearance', exact: true }).click();
      // A tint belongs to the chosen line icon and survives reload; emojis keep native colors.
      await page.getByRole('button', { name: 'Choose icon or emoji', exact: true }).click();
      await identityPicker
        .getByRole('textbox', { name: 'Search icons and emojis', exact: true })
        .fill('book');
      await identityPicker.getByRole('button', { name: 'Book Open', exact: true }).click();
      const colors = page.getByRole('group', { name: 'Icon color', exact: true });
      // Fill colors need their paired ink: pale/yellow choices must keep a visible glyph.
      for (const [label, id] of [
        ['Primary, soft', 'primary-soft'],
        ['Highlight, strong', 'highlight-strong'],
      ] as const) {
        await colors.getByRole('button', { name: label, exact: true }).click();
        const preview = page.locator('.identity-choice-current .item-icon');
        await expect(preview).toHaveAttribute('style', new RegExp(`--fill-${id}-fg`));
        await expect(preview).toHaveAttribute('style', new RegExp(`--fill-${id}-bg`));
        await capture(`icon-color-${id}`);
      }
      await colors.getByRole('button', { name: 'Info, strong', exact: true }).click();
      await expect(
        colors.getByRole('button', { name: 'Info, strong', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');
      await capture('icon-color-doc');
      await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.reload();
      const headerIcon = page.getByRole('button', { name: 'Change appearance', exact: true });
      await expect(headerIcon.locator('[data-profile-icon="lucide:book-open"]')).toBeVisible();
      await expect(headerIcon.locator('.item-icon')).toHaveAttribute(
        'style',
        /--fill-info-strong-bg/,
      );
      const colored = await (await context.request.get(`/api/appearance/items/${item.id}`)).json();
      expect(colored.appearance.iconColor).toBe('info-strong');
      await headerIcon.click();
      await page.getByRole('button', { name: 'Choose icon or emoji', exact: true }).click();
      await identityPicker
        .getByRole('textbox', { name: 'Search icons and emojis', exact: true })
        .fill('lemon');
      await identityPicker.getByRole('button', { name: 'Lemon emoji', exact: true }).click();
      await expect(colors).toHaveCount(0);
      await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
      await expect(headerIcon.locator('.item-icon')).not.toHaveAttribute('style', /--fill-/);
      await headerIcon.click();
      await page.getByRole('button', { name: 'Change cover', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Page cover', exact: true });
      await expect(dialog).toBeVisible();
      const initial = (await dialog.boundingBox())!.height;
      for (const source of ['Upload', 'Unsplash', 'Gems']) {
        const sourceButton = dialog.getByRole('button', { name: source, exact: true });
        await sourceButton.click();
        await expect(sourceButton).toHaveAttribute('aria-pressed', 'true');
        // Shared hover CSS must not replace only half of the selected color pair.
        for (const hovered of [false, true]) {
          if (hovered) await sourceButton.hover();
          else await page.mouse.move(0, 0);
          await expect
            .poll(
              async () => {
                const colors = await sourceButton.evaluate((button) => {
                  const style = getComputedStyle(button);
                  return { foreground: style.color, background: style.backgroundColor };
                });
                return contrastRatio(colors.foreground, colors.background);
              },
              { message: `${source} selected label contrast (${hovered ? 'hover' : 'rest'})` },
            )
            .toBeGreaterThanOrEqual(4.5);
        }
        expect(Math.abs((await dialog.boundingBox())!.height - initial)).toBeLessThanOrEqual(1);
        if (source !== 'Gems')
          await expect(dialog.locator('.appearance-pairing')).toHaveCSS('display', 'flex');
        const overflow = await dialog.evaluate((root) =>
          [
            root,
            ...root.querySelectorAll<HTMLElement>(
              '.appearance-cover-picker, .appearance-cover-options, .appearance-cover-position, .appearance-search, .appearance-photo-grid',
            ),
          ]
            .filter((element) => element.scrollWidth > element.clientWidth + 1)
            .map((element) => ({
              className: element.className,
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth,
            })),
        );
        expect(overflow).toEqual([]);
        if (source === 'Gems') {
          const options = (await dialog.locator('.appearance-cover-options').boundingBox())!;
          const actions = (await dialog
            .locator('.appearance-cover-footer .sp-actions')
            .boundingBox())!;
          expect(actions.y - options.y - options.height).toBeLessThanOrEqual(16);
        }
        await capture(`picker-${source.toLowerCase()}`);
      }
      await dialog.getByRole('button', { name: 'Bismuth', exact: true }).click();
      await dialog.getByRole('button', { name: 'Save cover', exact: true }).click();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Change appearance', exact: true }),
      ).toBeFocused();
      const saved = await (await context.request.get(`/api/appearance/items/${item.id}`)).json();
      expect(saved.appearance.cover).toEqual({ source: 'gem', gem: 'bismuth' });
      expect(saved.appearance.icon).toBe('🍋');
      if (
        info.project.name === 'production' &&
        variant.name === 'light' &&
        process.env.UNSPLASH_ACCESS_KEY
      ) {
        await page.getByRole('button', { name: 'Change appearance', exact: true }).click();
        await page.getByRole('button', { name: 'Change cover', exact: true }).click();
        await page.getByRole('button', { name: 'Unsplash', exact: true }).click();
        await page.getByRole('textbox', { name: 'Search Unsplash', exact: true }).fill('mountains');
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        const choice = page.getByRole('button', { name: /Select photo by/ }).first();
        await expect(choice).toBeVisible({ timeout: 15000 });
        await choice.click();
        await expect(page.locator('.appearance-cover-preview .appearance-credit')).toBeVisible();
        await page.getByRole('button', { name: 'Save cover', exact: true }).click();
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(page.locator('.appearance-banner .appearance-credit')).toBeVisible();
        await expect
          .poll(() =>
            page
              .locator('.appearance-banner img')
              .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
          )
          .toBe(true);
        await capture('unsplash-live');
      }
      await page.locator('.editor-frame').evaluate((element) => {
        element.scrollTop = 200;
      });
      await expect
        .poll(
          async () =>
            (await page.locator('.appearance-banner').boundingBox())!.y +
            (await page.locator('.appearance-banner').boundingBox())!.height,
        )
        .toBeLessThanOrEqual(1);
      await page.goto('/');
      await page.getByRole('button', { name: 'New', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Folder', exact: true }).click();
      const folderDialog = page.getByRole('dialog', { name: 'New folder', exact: true });
      await folderDialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Colored folder');
      await folderDialog.getByRole('button', { name: 'Secondary, strong', exact: true }).click();
      await folderDialog.getByRole('button', { name: 'Create', exact: true }).click();
      // Wait for the real create request rather than reading the fixture database ahead of it.
      await expect(
        page.getByRole('button', { name: 'More actions for Colored folder', exact: true }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'More actions for Colored folder', exact: true })
        .click();
      await page.getByRole('menuitem', { name: 'Appearance…', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Secondary, strong', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Choose icon or emoji', exact: true }).click();
      await identityPicker
        .getByRole('textbox', { name: 'Search icons and emojis', exact: true })
        .fill('book');
      await identityPicker.getByRole('button', { name: 'Book Open', exact: true }).click();
      await page.getByRole('button', { name: 'Info, strong', exact: true }).click();
      await capture('icon-color-folder');
      await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.reload();
      await page
        .getByRole('button', { name: 'More actions for Colored folder', exact: true })
        .click();
      await page.getByRole('menuitem', { name: 'Appearance…', exact: true }).click();
      await expect(page.locator('.identity-choice-current .item-icon')).toHaveAttribute(
        'style',
        /--fill-info-strong-bg/,
      );
      await page.getByRole('button', { name: 'Reset color', exact: true }).click();
      await expect(page.locator('.identity-choice-current .item-icon')).not.toHaveAttribute(
        'style',
        /--fill-/,
      );
      await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(
        workspace.list(owner.id).find((entry) => entry.name === 'Colored folder')?.appearance
          ?.iconColor,
      ).toBeNull();
      if (variant.name === 'light')
        for (const [name, icon] of [
          ['Automatic Doc', null],
          ['Chosen Doc', '🌻'],
          ['Colored Doc', 'lucide:book-open'],
        ] as const) {
          await page.goto('/');
          await page.getByRole('button', { name: 'New', exact: true }).click();
          await page.getByRole('menuitem', { name: 'Doc', exact: true }).click();
          const create = page.getByRole('dialog', { name: 'New doc', exact: true });
          await create.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
          await expect(
            create.getByRole('button', { name: 'Reset icon', exact: true }),
          ).toBeDisabled();
          if (icon) {
            await create.getByRole('button', { name: 'Choose icon or emoji', exact: true }).click();
            const picker = page.getByRole('dialog', {
              name: 'Choose an icon or emoji',
              exact: true,
            });
            await picker
              .getByRole('textbox', { name: 'Search icons and emojis', exact: true })
              .fill('book');
            await picker.getByRole('button', { name: 'Book Open', exact: true }).click();
            await expect(create.locator('[data-profile-icon="lucide:book-open"]')).toBeVisible();
            if (icon.startsWith('lucide:')) {
              await create.getByRole('button', { name: 'Info, strong', exact: true }).click();
            } else {
              await create
                .getByRole('button', { name: 'Choose icon or emoji', exact: true })
                .click();
              await picker
                .getByRole('textbox', { name: 'Search icons and emojis', exact: true })
                .fill(icon);
              await picker.getByRole('button', { name: 'Sunflower emoji', exact: true }).click();
            }
          }
          await create.getByRole('button', { name: 'Create', exact: true }).click();
          if (icon?.startsWith('lucide:')) {
            await expect(
              page
                .getByRole('button', { name: 'Change appearance', exact: true })
                .locator('.item-icon'),
            ).toHaveAttribute('style', /--fill-info-strong-bg/);
          } else {
            await expect(
              page.getByRole('button', { name: 'Change appearance', exact: true }),
            ).toContainText(icon ?? filenameEmoji(name));
          }
        }
    } finally {
      db.prepare('DELETE FROM workspace_items WHERE owner_id=?').run(owner.id);
      db.prepare('DELETE FROM auth_users WHERE id=?').run(owner.id);
      db.close();
    }
  });
}

test('Space accents follow preference changes, spare native formatting and restore Spinel on exit', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const { SpaceStore } = await import('../src/server/workspace/spaces.ts');
  const { palettes, spaceAccentPalettes } = await import('../src/ui/palette.ts');
  const db = openDatabase(`test-results/${info.project.name}/app.sqlite`),
    auth = new AuthStore(db),
    workspace = new WorkspaceStore(auth, { spacesEnabled: true });
  const owner = auth.createUser('Iris Garden'),
    session = auth.createSession(owner.id),
    spaces = new SpaceStore(workspace);
  const root = spaces.createRoot(owner.id, {
    name: 'Field station',
    parentId: null,
    icon: '🌿',
  }).space;
  const child = spaces.createChild(owner.id, root.id, {
    name: 'Observations',
    kind: 'doc',
    parentId: root.id,
    icon: '🍋',
  }).item;
  const appearance = new AppearanceStore(workspace);
  await appearance.update(
    {
      userId: owner.id,
      customData: {
        sessionHash: session.session.token_hash,
        spaceId: root.id,
        spaceItem: child.id,
      },
    },
    child.id,
    { revision: 1, cover: { source: 'gem', gem: 'spinel' } },
  );
  await context.addCookies([
    {
      name: COOKIE_NAME,
      value: session.token,
      url: baseURL!.replace('http:', 'https:'),
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    if (!localStorage.getItem('spinel-theme')) localStorage.setItem('spinel-theme', 'light');
  });
  const variable = (selector: string, name: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((element, key) => getComputedStyle(element).getPropertyValue(key).trim(), name);
  const preference = (value: string) =>
    page.evaluate((value) => {
      localStorage.setItem('spinel-theme', value);
      window.dispatchEvent(new StorageEvent('storage', { key: 'spinel-theme', newValue: value }));
    }, value);
  try {
    await page.goto(`/spaces/${root.id}?item=${child.id}`);
    await expect(page.getByRole('button', { name: 'Space appearance', exact: true })).toBeEnabled();
    await expect(
      page.getByRole('button', { name: 'Save details: Saved', exact: true }),
    ).toBeVisible();
    const read = async () =>
      (
        await (
          await context.request.get(`/api/appearance/spaces/${root.id}/items/${child.id}`)
        ).json()
      ).appearance;
    const before = await read();
    const lightArt = await page.locator('.appearance-banner img').getAttribute('src');
    await page.getByRole('button', { name: 'Space appearance', exact: true }).click();
    await page.getByRole('combobox', { name: 'Space accent', exact: true }).click();
    await page.getByRole('option', { name: 'Sapphire', exact: true }).click();
    await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
    await expect
      .poll(() => variable('.space-navigation', '--sp-accent'))
      .toBe(spaceAccentPalettes.sapphire.light.accent);
    await expect(page.getByRole('button', { name: 'Space appearance', exact: true })).toBeFocused();
    await expect
      .poll(() => variable('.space-native-editor', '--sp-accent'))
      .toBe(palettes.light['sp-accent']);
    // Same resolved theme still resets root tokens; Space accent must reapply synchronously.
    await preference('system');
    await expect
      .poll(() => variable('.space-navigation', '--sp-accent'))
      .toBe(spaceAccentPalettes.sapphire.light.accent);
    await preference('dark');
    await expect
      .poll(() => variable('.space-navigation', '--sp-accent'))
      .toBe(spaceAccentPalettes.sapphire.dark.accent);
    await expect
      .poll(() => variable('.space-native-editor', '--sp-accent'))
      .toBe(palettes.dark['sp-accent']);
    const selection = await page
      .locator('.space-navigation h2')
      .evaluate((element) => getComputedStyle(element, '::selection').backgroundColor);
    const rgb = (hex: string) =>
      `rgb(${[1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)).join(', ')})`;
    expect(selection).toBe(rgb(spaceAccentPalettes.sapphire.dark.accent));
    await expect
      .poll(() => page.locator('.appearance-banner img').getAttribute('src'))
      .not.toBe(lightArt);
    expect(await read()).toEqual(before);
    await mkdir('test-results/theme-screenshots', { recursive: true });
    await page.screenshot({
      path: `test-results/theme-screenshots/spn-086-space-dark-${info.project.name}.png`,
      animations: 'disabled',
    });
    // A deliberately shared cover stays fixed when the surrounding theme changes.
    await page.getByRole('button', { name: 'Change appearance', exact: true }).click();
    await page.getByRole('button', { name: 'Change cover', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Gem artwork', exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('checkbox', { name: 'Separate light and dark images' }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(
      page.getByRole('checkbox', { name: 'Separate light and dark images' }),
    ).not.toBeChecked();
    const { default: sharp } = await import('sharp');
    await page.getByLabel(/Upload cover image/).setInputFiles({
      name: 'field-marker.png',
      mimeType: 'image/png',
      buffer: await sharp({ create: { width: 8, height: 8, channels: 3, background: '#5e8fc9' } })
        .png()
        .toBuffer(),
    });
    await page.getByRole('button', { name: 'Save cover', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    const shared = await read();
    expect(shared.cover.source).toBe('upload');
    expect(Object.keys(shared.cover.images)).toEqual(['shared']);
    const sharedArt = await page.locator('.appearance-banner img').getAttribute('src');
    await expect
      .poll(() =>
        page
          .locator('.appearance-banner img')
          .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
    await preference('light');
    await expect
      .poll(() => variable('.space-navigation', '--sp-accent'))
      .toBe(spaceAccentPalettes.sapphire.light.accent);
    await expect(page.locator('.appearance-banner img')).toHaveAttribute('src', sharedArt!);
    await preference('dark');
    await expect
      .poll(() => variable('.space-navigation', '--sp-accent'))
      .toBe(spaceAccentPalettes.sapphire.dark.accent);
    await expect(page.locator('.appearance-banner img')).toHaveAttribute('src', sharedArt!);
    expect(await read()).toEqual(shared);
    // The real exit retains the chosen theme and leaves the Space override behind.
    await page.getByRole('button', { name: 'My files', exact: true }).first().click();
    await expect.poll(() => variable('html', '--sp-accent')).toBe(palettes.dark['sp-accent']);
    await expect.poll(() => variable('html', '--appearance-selection-bg')).toBe('');
  } finally {
    db.prepare('DELETE FROM workspace_items WHERE id=?').run(child.id);
    db.prepare('DELETE FROM workspace_items WHERE id=?').run(root.id);
    db.prepare('DELETE FROM auth_users WHERE id=?').run(owner.id);
    db.close();
  }
});
