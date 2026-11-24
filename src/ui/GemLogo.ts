import { createElement, useId } from 'react';
import { HEART, GEM_FACETS } from './gemGeometry.ts';

/** Restart on every activation, including taps that leave hover or focus in place. */
export function replayGemWiggle(button: HTMLElement) {
  const wrapper = button.querySelector('.gem')?.parentElement;
  if (!wrapper) return;
  // Animate the wrapper: the SVG owns its independent dark-theme inversion.
  wrapper.getAnimations().forEach((animation) => animation.cancel());
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  wrapper.animate(
    [0, -12, 9, -6, 3, 0].map((angle) => ({ transform: `rotate(${angle}deg)` })),
    { duration: 600, easing: 'ease-in-out' },
  );
}

// Native Node loads this shared component while rendering the initial HTML.
export function GemLogo({ size = 36 }: { size?: number }) {
  const clip = useId();
  return createElement(
    'svg',
    {
      className: 'gem',
      width: size,
      height: size,
      viewBox: '0 0 100 100',
      role: 'img',
      'aria-label': 'Spinel',
    },
    createElement(
      'defs',
      null,
      createElement('clipPath', { id: clip }, createElement('path', { d: HEART })),
    ),
    createElement(
      'g',
      { clipPath: `url(#${clip})`, strokeWidth: '0.6', strokeLinejoin: 'round' },
      GEM_FACETS.map((f, n) =>
        createElement('path', {
          key: n,
          d: f.d,
          fill: `var(--gem-${f.tone})`,
          stroke: `var(--gem-${f.tone})`,
        }),
      ),
    ),
    createElement('path', {
      d: HEART,
      fill: 'none',
      stroke: 'var(--gem-edge)',
      strokeWidth: '3.2',
      strokeLinejoin: 'round',
    }),
  );
}
