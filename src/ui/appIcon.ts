import { HEART, GEM_FACETS } from './gemGeometry.ts';
import { palettes } from './palette.ts';

export function iconSvg() {
  const palette = palettes.light;
  // Keep the existing heart within the maskable icon's central safe circle.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${palette['sp-bg']}"/><defs><clipPath id="heart"><path d="${HEART}"/></clipPath></defs><g transform="translate(20 20) scale(.6)"><g clip-path="url(#heart)" stroke-width=".6" stroke-linejoin="round">${GEM_FACETS.map((facet) => `<path d="${facet.d}" fill="${palette[`gem-${facet.tone}`]}" stroke="${palette[`gem-${facet.tone}`]}"/>`).join('')}</g><path d="${HEART}" fill="none" stroke="${palette['gem-edge']}" stroke-width="3.2" stroke-linejoin="round"/></g></svg>`;
}
