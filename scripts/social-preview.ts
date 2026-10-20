/** Regenerate the fixed public card: node scripts/social-preview.ts.
 * No document, account or request data enters this image. Commit the PNG so
 * production needs neither fonts nor a rendering service. */
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { iconSvg } from '../src/ui/appIcon.ts';
import { palettes } from '../src/ui/palette.ts';
const p = palettes.light;
const gem = iconSvg()
  .replace(/<rect[^>]+\/>/, '')
  .replace('<svg ', '<svg x="828" y="108" width="384" height="384" ');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">
<rect width="1280" height="640" fill="${p['sp-bg']}"/>
<path d="M0 0H1280V12H0Z" fill="${p['sp-rail']}"/>
<circle cx="1150" cy="120" r="400" fill="${p['sp-header']}"/>
<circle cx="1220" cy="150" r="310" fill="none" stroke="${p['sp-border']}" stroke-width="1.5"/>
<circle cx="1220" cy="150" r="390" fill="none" stroke="${p['sp-border']}" stroke-width="1.5"/>
${gem}
<g font-family="Arial, Helvetica, sans-serif" fill="${p['sp-text']}">
<text x="80" y="138" font-size="44" font-weight="700" letter-spacing="-1.5">Spinel</text>
<text x="76" y="278" font-size="76" font-weight="700" letter-spacing="-3">A little space for</text>
<text x="76" y="368" font-size="76" font-weight="700" letter-spacing="-3">your big ideas.</text>
<text x="80" y="448" font-size="27" fill="${p['sp-muted']}">Documents and spreadsheets, together.</text>
<path d="M80 528H1200" stroke="${p['sp-border']}" stroke-width="1"/>
<text x="80" y="579" font-size="20" fill="${p['sp-muted']}">Your private workspace</text>
<text x="1200" y="579" text-anchor="end" font-size="20" fill="${p['sp-muted']}">Made for a small circle.</text>
</g></svg>`;
await writeFile(
  new URL('../src/ui/social-preview.png', import.meta.url),
  await sharp(Buffer.from(svg)).png().toBuffer(),
);
