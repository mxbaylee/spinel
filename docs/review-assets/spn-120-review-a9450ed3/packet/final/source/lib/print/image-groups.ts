/** Public native image hierarchy shared by Sheet and Doc PDF adapters. */
import { DrawingGroupObject, Image as NativeImage, Transform } from '@univerjs/engine-render';
import type { UniverRenderingContext } from '@univerjs/engine-render';
import type { Image as PreparedRaster } from '@napi-rs/canvas';
import { PrintError } from './contract.ts';
import type { PrintBox } from './contract.ts';
import { drawPreparedImage, imageBounds } from './image-render.ts';
import type { ImageAppearance } from './image-render.ts';
import type { PlacedImage } from './layout.ts';

export { groupImageSources } from './image-group-metadata.ts';
export type { ImageGroupNode, PreparedImageGroups } from './image-group-metadata.ts';
import type { ImageGroupNode, PreparedImageGroups } from './image-group-metadata.ts';

export type ImageGroupGeometry = (
  source: string,
  appearance: ImageAppearance,
  visit: () => void,
) => PrintBox | null;

function invalid(): never {
  throw new PrintError('invalid-input', 'Invalid PDF image group.');
}

/** Native group removal assumes a Scene; an isolated hierarchy has no Scene. */
export function disposeImageGroup(group: DrawingGroupObject): void {
  const detach = (parent: DrawingGroupObject) => {
    for (const object of parent.getObjects()) {
      object.parent = null;
      if (object instanceof DrawingGroupObject) detach(object);
    }
  };
  detach(group);
  group.dispose();
}

function nativeGroup(
  node: ImageGroupNode,
  appearance: ImageAppearance,
  rasters: ReadonlyMap<string, PreparedRaster> | undefined,
  visit: () => void,
): DrawingGroupObject {
  visit();
  const group = new DrawingGroupObject('pdf-image-group');
  try {
    group.setBaseBound(node.base!);
    group.transformByState(appearance);
    for (const [index, child] of node.children.entries()) {
      visit();
      if (child.hidden) continue;
      const object = child.base
        ? nativeGroup(child, child.appearance, rasters, visit)
        : new NativeImage('pdf-group-child', {
            ...child.appearance,
            opacity: child.opacity,
            ...(rasters
              ? { image: rasters.get(child.source!) as unknown as HTMLImageElement }
              : {}),
          });
      if (rasters && child.source && !rasters.has(child.source)) {
        object.dispose();
        invalid();
      }
      object.zIndex = index;
      group.addObject(object);
    }
    return group;
  } catch (error) {
    disposeImageGroup(group);
    throw error;
  }
}

/** Native child corners, including resize/rotation beyond the group's layout box. */
export function imageGroupBounds(
  groups: PreparedImageGroups,
  source: string,
  appearance: ImageAppearance,
  visit: () => void,
): PrintBox | null {
  const node = groups.get(source);
  if (!node) return imageBounds(appearance);
  const group = nativeGroup(node, appearance, undefined, visit);
  let bounds: PrintBox | null = null;
  const walk = (parent: DrawingGroupObject) => {
    for (const object of parent.getObjects()) {
      visit();
      if (object instanceof DrawingGroupObject) {
        walk(object);
        continue;
      }
      const box = object.getRealBound();
      const matrix = object.transform.getMatrix();
      const transform = parent.ancestorTransform
        .multiply(
          new Transform([
            matrix[0],
            matrix[1],
            matrix[2],
            matrix[3],
            box.left + box.width / 2,
            box.top + box.height / 2,
          ]),
        )
        .getMatrix();
      const points = [-1, 1].flatMap((x) =>
        [-1, 1].map((y) => ({
          x:
            transform[4] + (transform[0] * x * box.width) / 2 + (transform[2] * y * box.height) / 2,
          y:
            transform[5] + (transform[1] * x * box.width) / 2 + (transform[3] * y * box.height) / 2,
        })),
      );
      const ink = {
        left: Math.min(...points.map((point) => point.x)),
        top: Math.min(...points.map((point) => point.y)),
        right: Math.max(...points.map((point) => point.x)),
        bottom: Math.max(...points.map((point) => point.y)),
      };
      if (
        !Object.values(ink).every(Number.isFinite) ||
        ink.right <= ink.left ||
        ink.bottom <= ink.top
      )
        invalid();
      bounds = bounds
        ? {
            left: Math.min(bounds.left, ink.left),
            top: Math.min(bounds.top, ink.top),
            right: Math.max(bounds.right, ink.right),
            bottom: Math.max(bounds.bottom, ink.bottom),
          }
        : ink;
    }
  };
  try {
    walk(group);
    return bounds;
  } finally {
    disposeImageGroup(group);
  }
}

export function drawPreparedGroupedImage(
  context: UniverRenderingContext,
  rasters: ReadonlyMap<string, PreparedRaster>,
  placement: PlacedImage,
  groups: PreparedImageGroups,
  visit: () => void,
) {
  const node = groups.get(placement.source);
  if (!node) {
    drawPreparedImage(context, rasters.get(placement.source)!, placement);
    return;
  }
  if (!placement.appearance) invalid();
  const group = nativeGroup(node, placement.appearance, rasters, visit);
  try {
    group.render(context, undefined!);
  } finally {
    disposeImageGroup(group);
  }
}
