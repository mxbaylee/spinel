import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const appearanceStory = 'redesign-appearance--playground-story';
const controlsStory = 'redesign-controls--default';

async function appearanceState(page: Page, capture: (state: string) => Promise<void>) {
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: 'Choose icon or emoji', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Choose an icon or emoji', exact: true });
  await expect(picker).toBeVisible();
  await picker.getByRole('textbox', { name: 'Search icons and emojis' }).fill('book');
  const selected = picker.getByRole('button', { name: 'Book Open', exact: true });
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  const icon = {
    dialog: await style(picker),
    grid: await style(picker.locator('.profile-icon-grid')),
    search: await style(picker.getByRole('textbox')),
    selected: await style(selected),
  };
  await capture('nested-icon');
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await page.getByRole('button', { name: 'Change cover', exact: true }).click();
  const gems = page.getByRole('group', { name: 'Cover source' }).getByRole('button', {
    name: 'Gems',
    exact: true,
  });
  await expect(gems).toHaveAttribute('aria-pressed', 'true');
  const cover = await style(gems);
  await capture('selected-cover');
  return { icon, cover };
}

async function style(locator: Locator) {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      display: computed.display,
      gridColumns: computed.gridTemplateColumns,
      padding: computed.padding,
      margin: computed.margin,
      overflow: computed.overflow,
      overscroll: computed.overscrollBehavior,
      color: computed.color,
      background: computed.backgroundColor,
      border: computed.border,
      borderRadius: computed.borderRadius,
    };
  });
}

/** A real same-document story switch must not let another specimen restyle production controls. */
export async function verifyStoryStyleIsolation(
  page: Page,
  ready: (page: Page, id: string) => Promise<void>,
  capture: (state: string) => Promise<void>,
  record: (observations: unknown) => Promise<void>,
) {
  await ready(page, appearanceStory);
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  const beforeSheets = await page.evaluate(() =>
    [...document.styleSheets].map((sheet) => sheet.href),
  );
  const before = await appearanceState(page, (state) => capture(`${state}-before`));
  for (const id of [controlsStory, appearanceStory]) {
    await page.evaluate((storyId) => {
      const preview = (
        window as Window & {
          __STORYBOOK_PREVIEW__?: {
            channel: {
              emit(event: string, selection: { storyId: string; viewMode: string }): void;
            };
          };
        }
      ).__STORYBOOK_PREVIEW__;
      if (!preview) throw new Error('Storybook preview is unavailable');
      // Storybook's pinned SET_CURRENT_STORY event selects the next real fixture,
      // retaining the document and its loaded stylesheets, just as its manager does.
      preview.channel.emit('setCurrentStory', { storyId, viewMode: 'story' });
    }, id);
    await ready(page, id);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
  }
  const after = await appearanceState(page, (state) => capture(`${state}-after`));
  const afterSheets = await page.evaluate(() =>
    [...document.styleSheets].map((sheet) => sheet.href),
  );
  await record({ timeOrigin, beforeSheets, afterSheets, before, after });
  // This relational contract catches layout AND selected-state color contamination.
  expect(after).toEqual(before);
}
