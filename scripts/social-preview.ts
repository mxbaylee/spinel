/** Regenerate the fixed public card: node scripts/social-preview.ts.
 * No document, account or request data enters this image. Commit the PNG so
 * production needs neither fonts nor a rendering service. */
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { socialCardBackground } from '../src/ui/socialCardBackground.ts';
const svg = socialCardBackground();
await writeFile(
  new URL('../src/ui/social-preview.png', import.meta.url),
  await sharp(Buffer.from(svg)).png().toBuffer(),
);
