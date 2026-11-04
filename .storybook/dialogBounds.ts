import { expect, within } from 'storybook/test';

/** Align the actual cue with the first text line, including wrapped titles. */
export async function assertDialogCueAlignment(cue: Element | null) {
  if (!cue) throw new Error('Dialog title cue is missing');
  await cue.ownerDocument.fonts.ready;
  const text = cue.nextElementSibling;
  if (!text) throw new Error('Dialog title text is missing');
  const firstLine = (element: Element) => {
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    const bounds = Array.from(range.getClientRects()).find((rect) => rect.width && rect.height);
    if (!bounds) throw new Error('Dialog title content has no visible text line');
    return bounds;
  };
  const textBounds = firstLine(text);
  const cueBounds = cue.querySelector('svg')?.getBoundingClientRect() ?? firstLine(cue);
  const difference = Math.abs(
    cueBounds.top + cueBounds.height / 2 - (textBounds.top + textBounds.height / 2),
  );
  await expect(difference, 'Dialog cue is centered on the first title line').toBeLessThanOrEqual(1);
}

/** A decorative cue must not replace or duplicate the dialog's textual name. */
export async function assertDialogTitle(dialog: HTMLElement, title: string) {
  await expect(dialog).toHaveAccessibleName(title);
  const heading = within(dialog).getByRole('heading', { name: title });
  const cue = heading.querySelector('.sp-modal-title-icon');
  await expect(heading).toBeVisible();
  await expect(cue).toBeVisible();
  await expect(cue).toHaveAttribute('aria-hidden', 'true');
  await expect(cue?.textContent?.trim() || cue?.querySelector('svg')).toBeTruthy();
  await assertDialogCueAlignment(cue);
  const bounds = heading.getBoundingClientRect();
  await expect(bounds.left).toBeGreaterThanOrEqual(0);
  await expect(bounds.right).toBeLessThanOrEqual(innerWidth + 1);
  await expect(heading.scrollWidth).toBeLessThanOrEqual(heading.clientWidth + 1);
}

/** Portals must keep real target sizes without depending on a workspace ancestor. */
export async function assertDialogControls(dialog: HTMLElement) {
  const phone = matchMedia('(pointer: coarse), (max-width: 640px)').matches;
  for (const control of dialog.querySelectorAll<HTMLElement>(
    'button, input, select, textarea, summary',
  )) {
    if (!control.getClientRects().length) continue;
    const box = control.getBoundingClientRect();
    await expect(box.height).toBeGreaterThanOrEqual(phone ? 44 : 36);
    if (phone) await expect(box.width).toBeGreaterThanOrEqual(44);
    await expect(box.left).toBeGreaterThanOrEqual(0);
    await expect(box.right).toBeLessThanOrEqual(innerWidth + 1);
    if (control.matches(':disabled'))
      await expect(Number(getComputedStyle(control).opacity)).toBeLessThanOrEqual(0.6);
  }
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
}
