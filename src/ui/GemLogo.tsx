import { useId } from 'react';
// Original faceted-heart geometry from the owner's gem-rail reference.
type Pos = [number, number];
const HEART =
  'M50 27C44 13 31 6 20 9 8 12 2 24 4 37 7 56 29 76 50 94 71 76 93 56 96 37 98 24 92 12 80 9 69 6 56 13 50 27Z';
const GEM_POINTS: Record<string, Pos> = {
  A: [23, 33],
  B: [77, 33],
  D: [50, 80],
  K1: [50, 22],
  K2: [34, 12],
  K3: [66, 12],
  K4: [7, 30],
  K5: [93, 30],
  K6: [15, 60],
  K7: [85, 60],
  K8: [38, 85],
  K9: [62, 85],
  P: [50, 94],
  TL: [20, -10],
  T: [50, -10],
  TR: [80, -10],
  L1: [-10, 20],
  L2: [-10, 62],
  R1: [110, 20],
  R2: [110, 62],
  BOT: [50, 110],
};
// Each facet: its corners and a tone from 1 (darkest) to 6 (lightest). Outer facets overshoot and are clipped to HEART.
const GEM_FACETS = (
  [
    ['TL T K1 K2', 3],
    ['T TR K3 K1', 2],
    ['TL K2 K4 L1', 3],
    ['TR R1 K5 K3', 2],
    ['L1 K4 K6 L2', 4],
    ['L2 K6 K8 P BOT', 3],
    ['R1 R2 K7 K5', 2],
    ['R2 BOT P K9 K7', 1],
    ['A K2 K1', 4],
    ['K1 K3 B', 3],
    ['A K1 B', 2],
    ['K4 K2 A', 5],
    ['B K3 K5', 2],
    ['K4 A K6', 6],
    ['K6 A D', 5],
    ['K6 D K8', 3],
    ['K5 K7 B', 3],
    ['K7 D B', 1],
    ['K7 K9 D', 2],
    ['K8 D P', 2],
    ['D K9 P', 1],
    ['A B D', 4],
  ] as [string, number][]
).map(([corners, tone]) => ({
  d:
    'M' +
    corners
      .split(' ')
      .map((n) => GEM_POINTS[n].join(' '))
      .join('L') +
    'Z',
  tone,
}));

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
