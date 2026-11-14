import { HEART, GEM_FACETS } from './gemGeometry.ts';
import { palettes } from './palette.ts';

export function iconSvg() {
  const palette = palettes.light;
  // Keep the heart within the maskable icon's central safe circle. It sits 2.5 units low: the
  // lobes make it top-heavy, so centring its outline leaves its weight high and centring its
  // weight leaves the outline low. 2.5 was chosen by eye on a Pixel launcher (0 looked high, 4.5
  // looked low); the test bounds both measures.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${palette['sp-bg']}"/><defs><clipPath id="heart"><path d="${HEART}"/></clipPath></defs><g transform="translate(20 22.5) scale(.6)"><g clip-path="url(#heart)" stroke-width=".6" stroke-linejoin="round">${GEM_FACETS.map((facet) => `<path d="${facet.d}" fill="${palette[`gem-${facet.tone}`]}" stroke="${palette[`gem-${facet.tone}`]}"/>`).join('')}</g><path d="${HEART}" fill="none" stroke="${palette['gem-edge']}" stroke-width="3.2" stroke-linejoin="round"/></g></svg>`;
}
