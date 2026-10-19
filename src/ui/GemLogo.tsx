import { useId } from 'react';
import { HEART, GEM_FACETS } from './gemGeometry.ts';

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
