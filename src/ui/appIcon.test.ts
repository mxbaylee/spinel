import { expect, it } from 'vitest';
import sharp from 'sharp';
import { iconSvg } from './appIcon.ts';

// Regression contract (SPN-090 own-phone run): on a Pixel launcher the installed icon's heart
// looked off-centre. Its visual weight must sit at the centre and inside the maskable safe circle.
it('keeps the heart optically centred inside the maskable safe circle', async () => {
  const size = 512;
  const { data } = await sharp(Buffer.from(iconSvg()))
    .resize(size, size)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const background = [data[0]!, data[1]!, data[2]!];
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let farthest = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const at = (y * size + x) * 4;
      const away =
        Math.abs(data[at]! - background[0]!) +
        Math.abs(data[at + 1]! - background[1]!) +
        Math.abs(data[at + 2]! - background[2]!);
      if (away <= 30) continue;
      count++;
      sumX += x;
      sumY += y;
      farthest = Math.max(farthest, Math.hypot(x - (size - 1) / 2, y - (size - 1) / 2));
    }
  expect(Math.abs(sumX / count - size / 2)).toBeLessThan(6);
  expect(Math.abs(sumY / count - size / 2)).toBeLessThan(6);
  expect(farthest).toBeLessThan(size * 0.33);
});
