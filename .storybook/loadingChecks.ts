import { expect, waitFor } from 'storybook/test';

/** Exercise the shared artwork in its real screen, including actual CSS motion. */
export async function checkLoadingRunner(canvasElement: HTMLElement) {
  const runner = canvasElement.querySelector<SVGSVGElement>('.rd-runner')!;
  await expect(runner).toBeVisible();
  await expect(runner).toHaveAttribute('aria-hidden', 'true');
  await expect(runner).toHaveAttribute('focusable', 'false');
  const view = canvasElement.ownerDocument.defaultView!;
  const still =
    view.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    runner.closest('[data-motion="still"]') !== null;
  const bounce = runner.querySelector('.rd-runner-bounce')!;
  const leg = runner.querySelector('.rd-runner-leg-front')!;
  await expect(view.getComputedStyle(bounce).animationName).toBe(
    still ? 'none' : 'rd-runner-bounce',
  );
  await expect(view.getComputedStyle(leg).animationName).toBe(still ? 'none' : 'rd-runner-stride');
  const scheme =
    runner.closest('[data-scheme]')?.getAttribute('data-scheme') ??
    canvasElement.ownerDocument.documentElement.dataset.theme;
  for (const variant of ['light', 'dark']) {
    const part = runner.querySelector(`.rd-runner-${variant}`)!;
    await expect(view.getComputedStyle(part).display === 'none').toBe(variant !== scheme);
  }
  if (still) {
    for (const part of runner.querySelectorAll('g'))
      await expect(view.getComputedStyle(part).animationName).toBe('none');
  } else {
    for (const part of [bounce, leg]) {
      const first = view.getComputedStyle(part).transform;
      await waitFor(() => expect(view.getComputedStyle(part).transform).not.toBe(first));
    }
  }
  const bounds = runner.getBoundingClientRect();
  await expect(bounds.left).toBeGreaterThanOrEqual(0);
  await expect(bounds.right).toBeLessThanOrEqual(view.innerWidth);
}
