export type OfflineImageRaster = {
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
};

/** Integer screenshot pixels, already mapped from the visible editor rectangle. */
export type OfflineImageBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type Kind = 'sheet' | 'doc';

/**
 * The existing offline fixtures use three visible Sheet images and one visible
 * Doc body image. Header/footer bytes have a separate persistence assertion.
 * Read the captured screen, not the model or an offscreen canvas, for this proof.
 */
export function countOfflineImagePixels(
  raster: OfflineImageRaster,
  kind: Kind,
  bounds?: OfflineImageBounds,
): number[] {
  const { data, width, height, channels } = raster;
  if (
    !(data instanceof Uint8Array) ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    (channels !== 3 && channels !== 4) ||
    !Number.isSafeInteger(width * height * channels) ||
    data.length !== width * height * channels
  ) {
    throw new Error('offline-image-raster-invalid');
  }
  const area = bounds ?? { left: 0, top: 0, width, height };
  if (
    ![area.left, area.top, area.width, area.height].every(Number.isSafeInteger) ||
    area.left < 0 ||
    area.top < 0 ||
    area.width <= 0 ||
    area.height <= 0 ||
    area.left + area.width > width ||
    area.top + area.height > height
  ) {
    throw new Error('offline-image-bounds-invalid');
  }
  const colors =
    kind === 'sheet'
      ? [
          [255, 153, 0],
          [34, 85, 238],
          [34, 187, 102],
        ]
      : kind === 'doc'
        ? [[119, 0, 204]]
        : null;
  if (!colors) throw new Error('offline-image-kind-invalid');
  const counts = colors.map(() => 0);
  for (let y = area.top; y < area.top + area.height; y++) {
    for (let x = area.left; x < area.left + area.width; x++) {
      const offset = (y * width + x) * channels;
      // A transparent RGB payload is not evidence that those pixels are visible.
      if (channels === 4 && data[offset + 3] !== 255) continue;
      colors.forEach((color, index) => {
        if (color.every((value, channel) => Math.abs(data[offset + channel] - value) < 12))
          counts[index]++;
      });
    }
  }
  return counts;
}

export function offlineImagesPainted(counts: readonly number[], kind: Kind): boolean {
  const expected = kind === 'sheet' ? 3 : kind === 'doc' ? 1 : 0;
  return (
    expected > 0 &&
    counts.length === expected &&
    counts.every((count) => Number.isSafeInteger(count) && count > 100)
  );
}
