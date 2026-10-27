import { HEART, GEM_FACETS } from './gemGeometry.ts';
import { palettes } from './palette.ts';
import type { ThemeMode } from './palette.ts';

/** Browser tabs need tight framing, unlike the installation icon's maskable safe area. */
export function faviconSvg(mode: ThemeMode | 'auto' = 'auto') {
  const colors = (theme: ThemeMode) => {
    const palette = palettes[theme];
    return `.gem{transform:${theme === 'dark' ? 'matrix(-1,0,0,-1,100,100)' : 'matrix(1,0,0,1,0,0)'}}.edge{stroke:${palette['gem-edge']}}${Array.from(
      { length: 6 },
      (_, index) =>
        `.facet-${index + 1}{fill:${palette[`gem-${index + 1}`]};stroke:${palette[`gem-${index + 1}`]}}`,
    ).join('')}`;
  };
  const styles =
    mode === 'auto'
      ? `${colors('light')}@media (prefers-color-scheme:dark){${colors('dark')}}`
      : colors(mode);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>Spinel</title><style>${styles}</style><defs><clipPath id="heart"><path d="${HEART}"/></clipPath></defs><g class="gem"><g clip-path="url(#heart)" stroke-width=".6" stroke-linejoin="round">${GEM_FACETS.map((facet) => `<path class="facet-${facet.tone}" d="${facet.d}"/>`).join('')}</g><path class="edge" d="${HEART}" fill="none" stroke-width="3.2" stroke-linejoin="round"/></g></svg>`;
}
