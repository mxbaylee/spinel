import { spaceAccentPalettes } from '../palette.ts';
import { spinelCoverSvg } from './spinelCover.ts';

export type Gem = keyof typeof spaceAccentPalettes;
export type CoverMode = 'light' | 'dark';
export const gems = Object.keys(spaceAccentPalettes) as Gem[];

type Artwork = { light: string[]; dark: string[]; shape: string; faces: string[] };
// Each list follows the reference's planes, not a shared generic gem mesh.
// The muted colors belong to decorative artwork, never semantic UI tokens.
const artwork: Record<Exclude<Gem, 'spinel'>, Artwork> = {
  ruby: {
    light: ['#eec6ca', '#f4dac3', '#dda4ba', '#cb90a5', '#f1b7ad'],
    dark: ['#914554', '#ac7a5f', '#6d2844', '#5a2439', '#a8635b'],
    shape: 'M50 3A47 47 0 1 1 50 97A47 47 0 1 1 50 3Z',
    faces: [
      'M0 0H100L69 31H31Z',
      'M0 0L31 31V69L0 100Z',
      'M100 0V100L69 69V31Z',
      'M0 100L31 69H69L100 100Z',
      'M31 31H69V69H31Z',
    ],
  },
  jasper: {
    light: ['#f3d6ac', '#ebb795', '#c9ae9f'],
    dark: ['#a4804a', '#925737', '#644942'],
    shape: 'M50 2L82 65L50 98L18 65Z',
    faces: ['M50 2V80L18 65Z', 'M50 2L82 65L50 80Z', 'M18 65L50 80L82 65L50 98Z'],
  },
  yellowDiamond: {
    light: ['#faf2c5', '#d4c175', '#e7d18d', '#f6ebb2', '#f4e791'],
    dark: ['#a4975d', '#675720', '#876f2e', '#9a8949', '#b09d4b'],
    shape: 'M50 2L91 50L50 98L9 50Z',
    faces: [
      'M50 2L50 20L25 50H9Z',
      'M50 2L91 50H75L50 20Z',
      'M91 50L50 98V80L75 50Z',
      'M50 98L9 50H25L50 80Z',
      'M50 20L75 50L50 80L25 50Z',
    ],
  },
  peridot: {
    light: ['#c0e1b2', '#9fcca6', '#dcedc9', '#b4d8ab', '#eaf3c0'],
    dark: ['#4b6f46', '#305e42', '#809965', '#5a814b', '#abb770'],
    shape: 'M9 16Q50 5 91 16L96 29L56 89Q50 97 44 89L4 29Z',
    faces: [
      'M9 16Q50 5 91 16L82 25Q50 18 14 25Z',
      'M91 16L96 29L56 89Q50 97 50 86L85 32Z',
      'M4 29L14 25L15 34L46 81L50 93Q44 93 40 85Z',
      'M14 25Q50 18 82 25L85 32L50 86L46 81L15 34Z',
      'M51 25Q58 18 80 25Q87 27 80 35L67 48Q60 54 53 44Q43 30 51 25Z',
    ],
  },
  sapphire: {
    light: ['#a6afd8', '#b2bfe6', '#a5c6ef', '#c5d9f2'],
    dark: ['#2e3877', '#3b478b', '#395f96', '#6986b5'],
    shape: 'M50 3A47 47 0 1 1 50 97A47 47 0 1 1 50 3Z',
    faces: [
      'M0 0H50V22L24 68L0 85Z',
      'M50 0H100V85L76 68L50 22Z',
      'M0 85L24 68H76L100 85V100H0Z',
      'M50 22L76 68H24Z',
    ],
  },
  lapis: {
    light: ['#9ab9de', '#b4d5ea'],
    dark: ['#294774', '#386d94'],
    shape: 'M50 3C35 17 17 51 17 69C17 108 83 108 83 69C83 51 65 17 50 3Z',
    faces: ['M0 0H100V100H0Z', 'M50 3C43 10 36 18 32 24C22 60 55 87 80 63C76 42 62 15 50 3Z'],
  },
  amethyst: {
    light: ['#d0ade6', '#e1c5ee', '#c09fd9', '#b28fcc', '#c19cdc', '#cca8e4', '#d9b5e8'],
    dark: ['#713f94', '#865aa0', '#5b3379', '#4a2965', '#633581', '#764296', '#8f60a8'],
    shape: 'M50 3A47 47 0 1 1 50 97A47 47 0 1 1 50 3Z',
    faces: [
      'M0 0H25L38 29L26 50H0Z',
      'M25 0H75L62 29H38Z',
      'M75 0H100V50H74L62 29Z',
      'M75 100H25L38 71H62Z',
      'M100 50V100H75L62 71L74 50Z',
      'M0 50H26L38 71L25 100H0Z',
      'M38 29H62L74 50L62 71H38L26 50Z',
    ],
  },
  roseQuartz: {
    light: ['#f5daeb', '#eeb7d1', '#efc3db', '#e0a2c2', '#e8b0cb', '#f0cbe5'],
    dark: ['#a67a97', '#8d4e6f', '#9d5f82', '#753758', '#8b4467', '#af789d'],
    shape: 'M50 3A47 47 0 1 1 50 97A47 47 0 1 1 50 3Z',
    faces: [
      'M0 0H50V25L27 43L0 35Z',
      'M50 0H100V35L73 43L50 25Z',
      'M100 35V100L64 69L73 43Z',
      'M0 100L36 69H64L100 100Z',
      'M0 35L27 43L36 69L0 100Z',
      'M50 25L73 43L64 69H36L27 43Z',
    ],
  },
  pearl: {
    light: ['#decaeb', '#fef9f7'],
    dark: ['#8a7299', '#d2c7d9'],
    shape: 'M50 3C73 3 88 25 88 53C88 78 73 97 50 97C27 97 12 78 12 53C12 25 27 3 50 3Z',
    faces: ['M0 0H100V100H0Z', 'M64 0C93 35 69 93 32 83C-20 74 -20 0 64 0Z'],
  },
  obsidian: {
    light: ['#51515d', '#6f6c7a', '#e09b78', '#918388'],
    dark: ['#252732', '#363845', '#ba754b', '#53505b'],
    shape: 'M50 3L82 23L93 63L50 97L7 63L18 23Z',
    faces: [
      'M0 0H100V100H0Z',
      'M50 3L82 23L65 48L50 75L26 48Z',
      'M18 23L26 48L50 75L50 97L47 76L23 50Z',
      'M82 23L65 48L93 63L67 52L53 76L50 97L50 75Z',
    ],
  },
  bismuth: {
    light: [
      '#c8b2cf',
      '#c9a6da',
      '#eac0e5',
      '#bbc7e1',
      '#d0b3d9',
      '#add7c7',
      '#bbe3e4',
      '#c8e7e6',
      '#b7d4d4',
      '#edecc8',
    ],
    dark: [
      '#5a4762',
      '#7d6092',
      '#937191',
      '#596985',
      '#7a5c85',
      '#50756e',
      '#6c9491',
      '#779f9c',
      '#5d8180',
      '#a2a37b',
    ],
    shape: 'M8 8H92V92H8Z',
    faces: [
      'M8 8H92V92H8Z',
      'M20 20H80L71 29H29Z',
      'M80 20V80L71 71V29Z',
      'M20 80L29 71H71L80 80Z',
      'M20 20L29 29V71L20 80Z',
      'M29 29H71L62 38H38Z',
      'M29 29L38 38V62L29 71Z',
      'M71 29V71L62 62V38Z',
      'M29 71L38 62H62L71 71Z',
      'M38 38H62V62H38Z',
    ],
  },
};

const path = (d: string, fill: string) => `<path d="${d}" fill="${fill}"/>`;
function background(gem: Exclude<Gem, 'spinel'>, dark: boolean): string {
  // Quiet fields use the same hue family as the focal gem, at a separate lightness.
  const hues = {
    ruby: 350,
    jasper: 25,
    yellowDiamond: 48,
    peridot: 102,
    sapphire: 226,
    lapis: 210,
    amethyst: 278,
    roseQuartz: 325,
    pearl: 285,
    obsidian: 255,
    bismuth: 285,
  };
  const tone = (i: number) =>
    `hsl(${hues[gem]} ${gem === 'obsidian' ? 8 : dark ? 22 : 38}% ${(dark ? 17 : 88) + i * (dark ? 1.6 : 1.2)}%)`;
  if (gem === 'obsidian') {
    const ground = dark ? '#28272e' : '#e5e0df';
    const lava = dark ? '#554036' : '#d5bead';
    const rock = dark ? '#34313a' : '#d3ced0';
    return (
      `<rect width="4000" height="180" fill="${ground}"/>` +
      path(
        'M-100 180C-130 20 40 -90 250 -30S420 235 225 170C125 138 165 33 295 30C490 25 510 220 700 190L700 250H-100Z',
        lava,
      ) +
      path(
        'M-100 180C-120 35 35 -70 230 -18S380 200 235 150C145 115 200 55 295 55C450 55 520 250 700 210L700 260H-100Z',
        rock,
      ) +
      path(
        'M520 -40C780 -60 860 200 1070 130S1170 -130 1450 -50L1500 0C1190 -65 1280 180 1070 165S780 5 520 -5Z',
        lava,
      ) +
      path(
        'M1350 210C1450 -35 1800 -85 1950 95S2180 230 2350 110L2420 180C2180 340 1950 225 1890 120S1510 0 1410 210Z',
        rock,
      ) +
      path(
        'M2300 -30C2660 70 2530 255 2870 155S3360 -100 4050 80V125C3360 -55 3260 65 2870 195S2630 100 2300 15Z',
        lava,
      )
    );
  }
  let result = `<rect width="4000" height="180" fill="${tone(2)}"/>`;
  // Larger planes open out toward the right; avoid a repeating wallpaper rhythm.
  const widths = [220, 220, 340, 480, 620, 800, 1000, 1100];
  let x = -175;
  for (const [i, width] of widths.entries()) {
    const scale = width / 220;
    let shapes = '';
    if (gem === 'ruby' || gem === 'bismuth') {
      // Nested square planes continue beyond the frame, like enlarged crystal terraces.
      shapes =
        path('M0 -40H220V180H0Z', tone((i % 3) + 2)) +
        path('M24 -16H196V156H24Z', tone(4)) +
        path('M48 8H172V132H48Z', tone(2)) +
        path('M72 32H148V108H72Z', tone(5));
      if (gem === 'bismuth') {
        const purple = dark ? '#4d455e' : '#d7c7e2';
        const mint = dark ? '#3e5952' : '#c8dfd4';
        const cyan = dark ? '#3d5961' : '#c5dfe2';
        shapes =
          path('M0 -40H220V180H0Z', tone(2)) +
          `<path d="M24 156H196V-16H24V120H160V20H60V84H124V56H96" fill="none" stroke="${purple}" stroke-width="24"/>` +
          path('M12 -28L36 -4V108H60V132H12Z', mint) +
          path('M60 132H172V8L148 32V108H60Z', cyan);
      }
    } else if (gem === 'yellowDiamond') {
      shapes =
        path('M110 -65L220 70L110 205L0 70Z', tone(4)) +
        path('M110 -65V-20L38 70H0Z', tone(6)) +
        path('M110 -65L220 70H182L110 -20Z', tone(0)) +
        path('M220 70L110 205V160L182 70Z', tone(2)) +
        path('M110 205L0 70H38L110 160Z', tone(5));
    } else if (gem === 'jasper') {
      shapes =
        path('M110 -65L220 70L110 205L0 70Z', tone(4)) +
        path('M110 -65V135L0 70Z', tone(6)) +
        path('M110 -65L220 70L110 135Z', tone(2)) +
        path('M0 70L110 135L220 70L110 205Z', tone(0));
    } else if (gem === 'peridot') {
      shapes =
        path('M-20 -30Q110 -55 240 -30L110 180Z', tone(4)) +
        path('M0 0Q110 -20 220 0L110 156Z', tone(2)) +
        path('M110 156L220 0L240 -30L110 180Z', tone(0));
    } else if (gem === 'amethyst') {
      shapes =
        path('M55 -10H165L220 85L165 180H55L0 85Z', tone(4)) +
        path('M77 28H143L176 85L143 142H77L44 85Z', tone(1)) +
        path('M55 -10L77 28H143L165 -10Z', tone(6));
    } else if (gem === 'roseQuartz') {
      shapes =
        path('M110 -35L230 52L184 193H36L-10 52Z', tone(3)) +
        path('M110 6L190 64L160 158H60L30 64Z', tone(5)) +
        path('M110 6L190 64L160 158L110 109Z', tone(1));
    } else if (gem === 'sapphire') {
      shapes =
        `<circle cx="110" cy="90" r="112" fill="${tone(1)}"/>` +
        path('M110 -22A112 112 0 0 1 207 146L110 20Z', tone(3)) +
        path('M13 146A112 112 0 0 0 207 146L174 126H46Z', tone(2)) +
        path('M110 20L174 126H46Z', tone(5));
    } else if (gem === 'lapis') {
      shapes =
        path(
          'M110 -70C50 -15 -15 65 -15 122C-15 240 235 240 235 122C235 65 170 -15 110 -70Z',
          tone(1),
        ) + path('M110 -70C80 10 70 122 151 150Q220 176 235 122C235 65 170 -15 110 -70Z', tone(5));
    } else if (gem === 'pearl') {
      shapes = `<ellipse cx="110" cy="80" rx="136" ry="190" fill="${tone(1)}"/><ellipse cx="87" cy="53" rx="113" ry="163" fill="${tone(6)}"/>`;
    }
    result += `<g transform="translate(${x} ${(gem === 'ruby' || gem === 'bismuth' ? 116 : 90) - 90 * scale}) scale(${scale})">${shapes}</g>`;
    x += width;
  }
  return result;
}

// Local planes meet the focal artwork at its actual facet vertices. Their color
// continues beyond the silhouette before receding into the larger shape field.
const extensions: Record<Exclude<Gem, 'spinel'>, [string, number][]> = {
  ruby: [
    ['M31 31H69L330 -230H-230Z', 0],
    ['M31 69H69L330 330H-230Z', 3],
  ],
  jasper: [
    ['M50 -200V80L-200 -37Z', 0],
    ['M50 80L-200 -37V300H300V-37Z', 2],
  ],
  yellowDiamond: [
    ['M50 -150V20L25 50H-150Z', 0],
    ['M50 80L75 50H250L50 280Z', 2],
  ],
  peridot: [
    ['M-150 -100H220L82 25Q50 18 14 25Z', 0],
    ['M-200 -90L15 34L46 81L50 93L-100 220Z', 2],
    ['M82 25L220 -100L56 250L50 86Z', 1],
  ],
  sapphire: [
    ['M50 -200V22L24 68L-200 200V-200Z', 0],
    ['M24 68H76L300 220H-200Z', 2],
  ],
  lapis: [
    ['M17 69C17 108 83 108 83 69C110 120 140 160 180 180H-80C-40 160 0 120 17 69Z', 0],
    ['M50 3C43 10 36 18 32 24C22 60 55 87 80 63C150 20 230 -50 250 -170C100 -120 80 -20 50 3Z', 1],
  ],
  amethyst: [
    ['M-60 -190H160L62 29H38Z', 1],
    ['M-60 290H160L62 71H38Z', 3],
  ],
  roseQuartz: [
    ['M-200 -100H50V25L27 43L-200 -25Z', 0],
    ['M36 69H64L300 300H-200Z', 3],
  ],
  pearl: [
    ['M50 -100C180 -100 190 200 50 200C-80 200 -80 -100 50 -100Z', 0],
    ['M64 -100C93 35 69 93 32 83C-140 74 -140 -100 64 -100Z', 1],
  ],
  obsidian: [
    ['M50 -160L220 23L65 48L50 75L26 48L-120 23Z', 1],
    ['M-120 -150L26 48L50 75V250L47 76L23 50Z', 2],
  ],
  bismuth: [
    ['M-130 -130H230V230H-130Z', 0],
    ['M20 20H80L230 -130H-130Z', 1],
    ['M20 80L29 71H71L80 80L230 230H-130Z', 3],
  ],
};

function nearField(gem: Exclude<Gem, 'spinel'>, tones: string[]): string {
  // A broad fade removes the artificial edge of this local extension; the planes
  // themselves remain aligned beside the gem, with enough contrast to read its edge. No blur or dark filter.
  const transform = gem === 'peridot' ? 'translate(0 14) scale(1 .72)' : '';
  return `<defs><radialGradient id="continuity-fade" gradientUnits="userSpaceOnUse" cx="50" cy="50" r="220"><stop offset="0" stop-color="#777"/><stop offset=".28" stop-color="#777"/><stop offset="1" stop-color="black"/></radialGradient><mask id="continuity" maskUnits="userSpaceOnUse" x="-200" y="-230" width="600" height="600"><rect x="-200" y="-230" width="600" height="600" fill="url(#continuity-fade)"/></mask></defs><g transform="translate(80 21) scale(1.5)"><g transform="${transform}" mask="url(#continuity)">${extensions[gem].map(([d, tone]) => path(d, tones[tone])).join('')}</g></g>`;
}

export function gemCoverSvg(gem: Gem, mode: CoverMode = 'light'): string {
  if (gem === 'spinel') return spinelCoverSvg(mode);
  const art = artwork[gem];
  const tones = art[mode];
  let faces = path(art.shape, tones[0]) + art.faces.map((d, i) => path(d, tones[i])).join('');
  if (gem === 'bismuth') {
    // The lower-left terrace turns into the center, preserving the reference's open spiral.
    faces += path('M20 80V68H32V60H44L39 69H33V92H20Z', tones[0]);
    faces += `<path d="M30 80H20V20H80V80H40V69H33V64H43" fill="none" stroke="${mode === 'light' ? '#8e709c' : '#b49ac3'}" stroke-width="1.2" stroke-linejoin="round"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="180" viewBox="0 0 4000 180" fill="none"><title>${spaceAccentPalettes[gem].label} — ${mode} gem cover</title>${background(gem, mode === 'dark')}${nearField(gem, tones)}<defs><clipPath id="gem"><path d="${art.shape}"/></clipPath></defs><g transform="translate(80 21) scale(1.5)" ${gem === 'peridot' ? '' : 'clip-path="url(#gem)"'}>${gem === 'peridot' ? `<g transform="translate(0 14) scale(1 .72)" clip-path="url(#gem)">${faces}</g>` : faces}</g></svg>`;
}

export const gemCoverSources = Object.fromEntries(
  gems.map((gem) => [
    gem,
    Object.fromEntries(
      (['light', 'dark'] as const).map((mode) => [
        mode,
        `data:image/svg+xml,${encodeURIComponent(gemCoverSvg(gem, mode))}`,
      ]),
    ),
  ]),
) as Record<Gem, Record<CoverMode, string>>;
