/** Regenerate reviewable standalone assets: node scripts/gem-covers.ts */
import { mkdir, writeFile } from 'node:fs/promises';
import { gems, gemCoverSvg } from '../src/ui/redesign/gemCovers.ts';
const directory = new URL('../src/ui/redesign/assets/gems/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const gem of gems) {
  for (const mode of ['light', 'dark'] as const) {
    await writeFile(new URL(`${gem}-${mode}.svg`, directory), gemCoverSvg(gem, mode));
  }
}

if (process.argv.includes('--review')) {
  const { default: sharp } = await import('sharp');
  const review = new URL('../docs/design/review/spn-086/', import.meta.url);
  await mkdir(review, { recursive: true });
  const composite: { input: Buffer; left: number; top: number }[] = [];
  for (const [i, gem] of gems.entries()) {
    for (const [j, mode] of (['light', 'dark'] as const).entries()) {
      const input = await sharp(Buffer.from(gemCoverSvg(gem, mode)))
        .extract({ left: 0, top: 0, width: 1000, height: 180 })
        .png()
        .toBuffer();
      composite.push({ input, left: j * 1000, top: i * 210 + 30 });
      composite.push({
        input: Buffer.from(
          `<svg width="1000" height="30"><text x="10" y="22" font-size="20">${gem} ${mode}</text></svg>`,
        ),
        left: j * 1000,
        top: i * 210,
      });
    }
  }
  await sharp({ create: { width: 2000, height: 2520, channels: 4, background: '#eeeeee' } })
    .composite(composite)
    .png()
    .toFile(new URL('pairs.png', review).pathname);
}
