export type TextRaster = {
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
  box: { x: number; y: number; width: number; height: number };
};

/** Locate the first visible text line, excluding colored images, borders and carets. */
export function textPoints({ data, width, height, channels, box }: TextRaster) {
  const points: {
    x: number;
    y: number;
    centerX: number;
    glyphWidth: number;
    lineHeight: number;
    pixels: number;
  }[] = [];
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 17 ||
    height < 17 ||
    ![3, 4].includes(channels) ||
    data.length !== width * height * channels ||
    ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
    box.width <= 0 ||
    box.height <= 0
  )
    throw new Error('invalid-text-raster');
  let light = 0;
  let dark = 0;
  for (let y = 8; y < height - 8; y += 8)
    for (let x = 8; x < width - 8; x += 8) {
      const at = (y * width + x) * channels;
      const value = (data[at]! + data[at + 1]! + data[at + 2]!) / 3;
      if (value > 192) light++;
      if (value < 64) dark++;
    }
  const darkPaper = dark > light;
  const ink = (x: number, y: number) => {
    const at = (y * width + x) * channels;
    const low = Math.min(data[at]!, data[at + 1]!, data[at + 2]!);
    const high = Math.max(data[at]!, data[at + 1]!, data[at + 2]!);
    return high - low < 60 && (darkPaper ? low > 170 : high < 115);
  };
  const inset = Math.max(8, Math.round((width / box.width) * 8));
  const bottom = Math.min(height - inset, Math.floor(height * 0.65));
  for (let y = inset; y < bottom; y++) {
    const top = y;
    let pixels = 0;
    let left = width;
    let right = -1;
    while (y < bottom) {
      let rowPixels = 0;
      for (let x = inset; x < width - inset; x++)
        if (ink(x, y)) {
          rowPixels++;
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
      if (rowPixels < 2) break;
      pixels += rowPixels;
      y++;
    }
    const lineHeight = y - top;
    if (lineHeight < 4 || pixels < 24 || right - left < 12) continue;
    let glyphRight = left;
    while (glyphRight <= right) {
      let occupied = false;
      for (let row = top; row < y; row++) occupied ||= ink(glyphRight, row);
      if (!occupied) break;
      glyphRight++;
    }
    if (glyphRight - left < 2) continue;
    points.push({
      x: box.x + ((left + 0.2) / width) * box.width,
      y: box.y + ((top + lineHeight / 2) / height) * box.height,
      centerX: box.x + ((left + glyphRight) / 2 / width) * box.width,
      glyphWidth: glyphRight - left,
      lineHeight,
      pixels,
    });
  }
  return points;
}
