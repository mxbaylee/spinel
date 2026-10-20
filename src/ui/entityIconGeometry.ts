import { palettes } from './palette.ts';
import type { ThemeMode } from './palette.ts';

// Shared by React and the PNG renderer. Space is artwork only, not a workspace kind.
export type EntityKind = 'doc' | 'sheet' | 'space';
export const entityLabels: Record<EntityKind, string> = {
  doc: 'Doc',
  sheet: 'Sheet',
  space: 'Space',
};
const outline = 'M6 2H18L21 5V19L18 22H6L3 19V5Z';
const facets: [string, number][] = [
  ['M6 2H18L17 5H7Z', 4],
  ['M3 5L6 2 7 5V19L3 19Z', 3],
  ['M3 19L7 19H17L18 22H6Z', 2],
  ['M18 2L21 5V19L18 22 17 19V5Z', 1],
  ['M7 5H17V19H7Z', 2],
  ['M7 5H17L7 13Z', 3],
  ['M7 13L17 19H7Z', 1],
];
type IconPath = {
  d: string;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  transform?: string;
};
export function entityIconPaths(kind: EntityKind, monochrome = false): IconPath[] {
  const tone = (n: number) => (monochrome ? 'sp-text' : `entity-${kind}-${n}`);
  const mark = monochrome ? 'sp-panel' : 'entity-mark';
  const line = { fill: 'none', stroke: mark, strokeWidth: 1, opacity: monochrome ? 1 : 0.86 };
  const solid = { fill: mark, opacity: monochrome ? 1 : 0.86 };
  const glyphs: Record<EntityKind, IconPath[]> = {
    doc: [{ ...line, d: 'M8 8.5H16M8 12H14.5M8 15.5H15.5', strokeWidth: 1.25 }],
    sheet: [
      { ...line, d: 'M8 8H16V16H8ZM8 12H16' },
      { ...solid, d: 'M8 8H16V10H8Z' },
    ],
    space: [
      { ...line, d: 'M12 6.8L15.5 10.3 12 13.8 8.5 10.3Z', strokeWidth: 1.5 },
      { ...solid, d: 'M8.5 13.4L11 15.9 8.5 18.4 6 15.9ZM15.5 13.4L18 15.9 15.5 18.4 13 15.9Z' },
    ].map((path) => ({ ...path, transform: 'translate(12 12) scale(.74) translate(-12 -12.325)' })),
  };
  return [
    ...facets.map(([d, n]) => ({ d, fill: tone(n), stroke: tone(n), strokeWidth: 0.08 })),
    { d: outline, fill: 'none', stroke: tone(0), strokeWidth: 0.55 },
    ...glyphs[kind],
  ];
}

/** Compact raw SVG, with trusted geometry and resolved tokens; no user text. */
export function entityIconSvg(
  kind: EntityKind,
  size = 24,
  mode: ThemeMode = 'light',
  monochrome = false,
) {
  const color = (token: string) => (token === 'none' ? token : palettes[mode][token]);
  const paths = entityIconPaths(kind, monochrome)
    .map(
      (path) =>
        `<path d="${path.d}" fill="${color(path.fill)}"${path.stroke ? ` stroke="${color(path.stroke)}" stroke-width="${path.strokeWidth}"` : ''}${path.opacity !== undefined ? ` opacity="${path.opacity}"` : ''}${path.transform ? ` transform="${path.transform}"` : ''}/>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}
