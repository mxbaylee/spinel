import { expect, test, vi } from 'vitest';
import sharp from 'sharp';
import { PRINT_LIMITS } from './index.ts';
import { admitImages } from './images.ts';

const png = () => sharp({ create: { width: 3, height: 2, channels: 4, background: '#8844cc' } }).png().toBuffer();
const deadline = () => performance.now() + 30_000;

test('admits actual prepared raster bytes without fetching source references', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network must not run'));
  try {
    const bytes = await png();
    const source = 'https://unreachable.invalid/private-image';
    const admitted = await admitImages([source], [{ source, bytes }], PRINT_LIMITS, deadline());
    expect(admitted.get(source)).toMatchObject({ width: 3, height: 2, format: 'png' });
    expect(admitted.get(source)!.bytes).toEqual(bytes);
    expect(admitted.get(source)!.bytes).not.toBe(bytes);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
  }
});

test('copies inputs before asynchronous metadata reads and requires explicit source binding', async () => {
  const bytes = await png();
  const expected = Buffer.from(bytes);
  const pending = admitImages(['first'], [{ source: 'first', bytes }], PRINT_LIMITS, deadline());
  bytes.fill(0);
  expect((await pending).get('first')!.bytes).toEqual(expected);
  await expect(admitImages(['missing'], [{ source: 'first', bytes: expected }], PRINT_LIMITS, deadline())).rejects.toThrow('authorized prepared bytes');
  await expect(admitImages(['first'], [{ source: 'first', bytes: expected }, { source: 'first', bytes: expected }], PRINT_LIMITS, deadline())).rejects.toThrow('duplicate');
});

test('enforces aggregate encoded/decoded budgets, not only per-image bounds', async () => {
  const bytes = await png();
  const inputs = [{ source: 'one', bytes }, { source: 'two', bytes }];
  await expect(admitImages(['one', 'two'], inputs, { ...PRINT_LIMITS, encodedImageBytes: bytes.length * 2 - 1 }, deadline())).rejects.toThrow('encoded byte budget');
  await expect(admitImages(['one', 'two'], inputs, { ...PRINT_LIMITS, decodedImagePixels: 11 }, deadline())).rejects.toThrow('aggregate decoded pixel');
  const atBoundary = await admitImages(['one', 'two'], inputs, { ...PRINT_LIMITS, decodedImagePixels: 12 }, deadline());
  expect(atBoundary.size).toBe(2);
});

test('rejects URL/SVG input, broken images and cancelled work without output', async () => {
  for (const bytes of [Buffer.from('https://private.invalid/image'), Buffer.from('<svg width="100000" height="100000"/>'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])])
    await expect(admitImages(['private'], [{ source: 'private', bytes }], PRINT_LIMITS, deadline())).rejects.toThrow();
  const bytes = await png();
  const controller = new AbortController();
  controller.abort();
  await expect(admitImages(['private'], [{ source: 'private', bytes }], PRINT_LIMITS, deadline(), controller.signal)).rejects.toThrow('cancelled');
  await expect(admitImages(['private'], [{ source: 'private', bytes }], PRINT_LIMITS, performance.now() - 1)).rejects.toThrow('time limit');
});
