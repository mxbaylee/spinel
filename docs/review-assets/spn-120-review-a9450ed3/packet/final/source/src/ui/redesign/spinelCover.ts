import { GEM_FACETS, HEART } from '../gemGeometry.ts';
import { spaceAccentPalettes, spinelCoverField } from '../palette.ts';

// Preserve the approved light artwork; the dark pair has deliberately chosen plum tones.
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

// The extended field keeps height-driven crops on wide editors as well as phones.
// The focal gem stays at the left; no extra hearts are repeated across the field.
export function spinelCoverSvg(mode: 'light' | 'dark') {
  const tones =
    mode === 'light'
      ? spaceAccentPalettes.spinel.facets
      : ['#633b53', '#73465e', '#82526a', '#925e76', '#a16e85', '#b68195'];
  const faces = GEM_FACETS.map(({ d, tone }) => [d, tone - 1] as [string, number]);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="180" viewBox="0 0 4000 180" fill="none">
<title>Spinel — soft gem facets</title>
<rect width="4000" height="180" fill="${mode === 'light' ? tones[3] : '#49313f'}"/>
<g transform="${mode === 'light' ? 'translate(80 21) scale(1.5)' : 'translate(80 159) scale(1.5 -1.5)'}">
${field
  .map((points, i) => {
    const color =
      mode === 'light'
        ? spinelCoverField[i]
        : ['#342632', '#3a2a36', '#402e3b', '#49313f', '#513747', '#593d4d'][fieldTones[i]];
    return `<polygon points="${points}" fill="${color}" stroke="${color}" stroke-width="0.4"/>`;
  })
  .join('\n')}
<defs><clipPath id="gem"><path d="${HEART}"/></clipPath></defs>
<g clip-path="url(#gem)">
<path d="${HEART}" fill="${tones[2]}"/>
${faces.map(([d, tone]) => `<path d="${d}" fill="${tones[tone]}" stroke="${tones[tone]}" stroke-width="0.4"/>`).join('\n')}
</g></g></svg>`;
}
