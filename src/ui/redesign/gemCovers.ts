import { GEM_FACETS, HEART } from '../gemGeometry.ts';
import { spaceAccentPalettes, spinelCoverField } from '../palette.ts';

export type Gem = keyof typeof spaceAccentPalettes;
export const gems = Object.keys(spaceAccentPalettes) as Gem[];

// Original geometric interpretations, rather than character illustrations. The same
// quiet field lets each gem's cut and color supply its identity without an outline.
const cuts: Record<Gem, string> = {
  ruby: 'M24 12H76L90 26V78L76 92H24L10 78V26Z',
  jasper: 'M31 9H69L80 70L50 96L20 70Z',
  yellowDiamond: 'M50 3L91 49L50 97L9 49Z',
  peridot: 'M8 18H92L50 94Z',
  sapphire: 'M50 8C77 8 92 25 92 50S77 92 50 92 8 75 8 50 23 8 50 8Z',
  lapis: 'M50 4C43 23 12 44 12 65A38 32 0 0 0 88 65C88 44 57 23 50 4Z',
  amethyst: 'M50 6L88 28V72L50 94L12 72V28Z',
  spinel: HEART,
  roseQuartz: 'M50 5A45 45 0 1 1 50 95A45 45 0 1 1 50 5Z',
  pearl: 'M50 5C72 5 82 25 82 50S72 95 50 95 18 75 18 50 28 5 50 5Z',
  obsidian: 'M50 3L88 25L95 62L50 97L5 62L12 25Z',
  bismuth: 'M12 12H72V25H88V87H28V74H12Z',
};
const field = [
  '-60,-14 20,-14 34,12 7,30 -60,8',
  '20,-14 50,-14 50,27 34,12',
  '50,-14 122,-14 80,9 66,12 50,27',
  '122,-14 236,-14 184,38 93,30 80,9',
  '-60,8 7,30 15,60 -60,90',
  '-60,90 15,60 38,85 50,106 -60,106',
  '38,85 50,94 62,85 138,106 50,106',
  '93,30 184,38 85,60 62,85 50,94',
  '184,38 236,106 138,106 62,85 85,60',
  '236,-14 352,-14 296,66 184,38',
  '184,38 296,66 236,106',
  '352,-14 492,-14 422,26 296,66',
  '296,66 422,26 460,106 236,106',
  '492,-14 634,-14 578,74 422,26',
  '422,26 578,74 460,106',
  '578,74 634,-14 758,34 712,106 460,106',
  '634,-14 836,-14 758,34',
  '758,34 836,-14 948,106 712,106',
  '836,-14 1080,-14 1022,48 948,106',
  '948,106 1022,48 2700,106',
  '1080,-14 2700,-14 2700,106 1022,48',
];
const fieldTones = [3, 4, 5, 3, 4, 1, 1, 1, 2, 5, 3, 3, 5, 2, 3, 4, 5, 3, 1, 4, 5];

// Coordinates are in the gem's 100-unit square. Jasper has three long planes;
// Pearl uses broad, luminous planes and Bismuth has a stepped crystal interior.
const specialFacets: Partial<Record<Gem, [string, number][]>> = {
  jasper: [
    ['M31 9H69L50 77Z', 4],
    ['M31 9L50 77V96L20 70Z', 2],
    ['M69 9L80 70L50 96V77Z', 0],
  ],
  pearl: [
    ['M-10 -10H50L32 50L50 110H-10Z', 5],
    ['M50 -10H80L58 50L50 110L32 50Z', 4],
    ['M80 -10H110V110H50L58 50Z', 2],
  ],
  bismuth: [
    ['M12 12H72V25H25V74H12Z', 0],
    ['M25 25H88V87H75V38H25Z', 4],
    ['M25 38H62V51H38V74H75V87H28V74H25Z', 2],
    ['M38 51H75V74H38V63H62V51Z', 1],
    ['M38 51H62V63H38Z', 5],
    ['M62 38H75V63H62Z', 3],
  ],
};

// The extended field keeps height-driven crops on wide editors as well as phones.
// The focal gem stays at the left; no extra hearts are repeated across the field.
export function gemCoverSvg(gem: Gem) {
  const palette = spaceAccentPalettes[gem];
  const tones = palette.facets;
  const faces =
    specialFacets[gem] ??
    (gem === 'spinel'
      ? GEM_FACETS.map(({ d, tone }) => [d, tone - 1] as [string, number])
      : ([
          ['M-10 -10H110L73 30H27Z', 4],
          ['M-10 -10L27 30L28 70L-10 110Z', 3],
          ['M110 -10V110L72 70L73 30Z', 1],
          ['M-10 110L28 70H72L110 110Z', 2],
          ['M27 30H73L72 70H28Z', 5],
          ['M73 30L72 70L50 94L28 70Z', 0],
        ] as [string, number][]));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="180" viewBox="0 0 4000 180" fill="none">
<title>${palette.label} — soft gem facets</title>
<rect width="4000" height="180" fill="${tones[3]}"/>
<g transform="translate(80 21) scale(1.5)">
${field
  .map((points, i) => {
    const color = gem === 'spinel' ? spinelCoverField[i] : tones[fieldTones[i]];
    return `<polygon points="${points}" fill="${color}" stroke="${color}" stroke-width="0.4"/>`;
  })
  .join('\n')}
<defs><clipPath id="gem"><path d="${cuts[gem]}"/></clipPath></defs>
<g clip-path="url(#gem)">
<path d="${cuts[gem]}" fill="${tones[2]}"/>
${faces.map(([d, tone]) => `<path d="${d}" fill="${tones[tone]}" stroke="${tones[tone]}" stroke-width="0.4"/>`).join('\n')}
</g></g></svg>`;
}

// Each SVG is an isolated image document, so its clip ID cannot collide with a
// second thumbnail. Only the fixed palette and geometry above enter the markup.
export const gemCoverSources = Object.fromEntries(
  gems.map((gem) => [gem, `data:image/svg+xml,${encodeURIComponent(gemCoverSvg(gem))}`]),
) as Record<Gem, string>;
