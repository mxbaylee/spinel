import type { Image as PreparedRaster } from '@napi-rs/canvas';
import { Image as NativeImage } from '@univerjs/engine-render';
import type { UniverRenderingContext } from '@univerjs/engine-render';
import { PrintError } from './contract.ts';
import type { PrintBox } from './contract.ts';
import type { PlacedImage } from './layout.ts';

/** Whitelisted public Image properties, never an image URL or arbitrary native props. */
export interface ImageAppearance {
  left: number;
  top: number;
  width: number;
  height: number;
  angle: number;
  flipX: boolean;
  flipY: boolean;
  srcRect?: { left: number; top: number; right: number; bottom: number };
}

/**
 * Use the same public native transform as drawing, including flips and rotation.
 * The crop clips to this frame; source pixels outside it are deliberately cropped.
 */
export function imageBounds(appearance: ImageAppearance): PrintBox | null {
  const shape = new NativeImage('pdf-image-geometry', appearance);
  try {
    const matrix = shape.transform?.getMatrix();
    if (!matrix || !matrix.every(Number.isFinite))
      throw new PrintError('invalid-input', 'Invalid PDF image transform.');
    const centerX = appearance.left + appearance.width / 2;
    const centerY = appearance.top + appearance.height / 2;
    const corners = [-1, 1].flatMap((x) =>
      [-1, 1].map((y) => ({
        x:
          centerX +
          (matrix[0] * x * appearance.width) / 2 +
          (matrix[2] * y * appearance.height) / 2,
        y:
          centerY +
          (matrix[1] * x * appearance.width) / 2 +
          (matrix[3] * y * appearance.height) / 2,
      })),
    );
    const bounds = {
      left: Math.min(...corners.map((point) => point.x)),
      top: Math.min(...corners.map((point) => point.y)),
      right: Math.max(...corners.map((point) => point.x)),
      bottom: Math.max(...corners.map((point) => point.y)),
    };
    if (!Object.values(bounds).every(Number.isFinite))
      throw new PrintError('invalid-input', 'Invalid PDF image transform.');
    return bounds.right > bounds.left && bounds.bottom > bounds.top ? bounds : null;
  } finally {
    shape.dispose();
  }
}

/** Draw the whole original object inside the caller's exact page clip. */
export function drawPreparedImage(
  context: UniverRenderingContext,
  raster: PreparedRaster,
  placement: PlacedImage,
): void {
  const appearance = placement.appearance ?? {
    left: placement.bounds.left,
    top: placement.bounds.top,
    width: placement.bounds.right - placement.bounds.left,
    height: placement.bounds.bottom - placement.bounds.top,
    angle: 0,
    flipX: false,
    flipY: false,
  };
  // The public Image constructor takes an already decoded object. It cannot
  // create an element or fetch a source because no `url` option is supplied.
  const shape = new NativeImage('pdf-prepared-image', {
    ...appearance,
    opacity: placement.opacity,
    image: raster as unknown as HTMLImageElement,
  });
  try {
    // No viewport argument: native image culling uses the unrotated frame.
    // Our transformed bounds already selected this page, and its clip is exact.
    shape.render(context);
  } finally {
    shape.dispose();
  }
}
