import { useId } from 'react';
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

export function GemLogo({ size = 36 }: { size?: number }) {
  const clip = useId();
  return (
    <svg
      className="gem"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="Spinel"
    >
      <defs>
        <clipPath id={clip}>
          <path d={HEART} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`} strokeWidth="0.6" strokeLinejoin="round">
        {GEM_FACETS.map((f, n) => (
          <path key={n} d={f.d} fill={`var(--gem-${f.tone})`} stroke={`var(--gem-${f.tone})`} />
        ))}
      </g>
      <path
        d={HEART}
        fill="none"
        stroke="var(--gem-edge)"
        strokeWidth="3.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
