import { expect } from 'storybook/test';

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
