/** Preserve the public Doc group's one text anchor and native child coordinate spaces. */
import { DrawingTypeEnum, PositionedObjectLayoutType } from '@univerjs/core';
import type { IDocDrawingBase, IDocumentData } from '@univerjs/core';
import { PrintError } from './contract.ts';
import type { PrintLimits } from './contract.ts';
import type { ImageAppearance } from './image-render.ts';
import type { ImageGroupNode, PreparedImageGroups } from './image-groups.ts';

export type PreparedDocImageGroups = PreparedImageGroups;
export type { ImageGroupGeometry as DocImageGeometry } from './image-groups.ts';
export {
  groupImageSources as docGroupImageSources,
  imageGroupBounds as docImageGroupBounds,
  drawPreparedGroupedImage as drawPreparedDocImage,
} from './image-groups.ts';

function invalid(): never {
  throw new PrintError('invalid-input', 'Invalid PDF image group.');
}

function unsupported(): never {
  throw new PrintError('unsupported', 'PDF image group contains an unsupported appearance.');
}

function finite(value: unknown, minimum = -100_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) invalid();
  if (value > 100_000)
    throw new PrintError('limit', 'PDF image group exceeds its geometry budget.');
  return value;
}

/** The only synthesized source keys identify layout carriers, never prepared bytes. */
export function prepareDocImageGroups(
  snapshot: IDocumentData,
  limits: Readonly<PrintLimits>,
  check: () => void,
  validate: (view: IDocumentData, repeatedStory: boolean) => readonly string[],
): PreparedDocImageGroups {
  const groups = new Map<string, ImageGroupNode>();
  const containers = [
    snapshot,
    ...Object.values(snapshot.headers ?? {}),
    ...Object.values(snapshot.footers ?? {}),
  ];
  let count = 0;
  const sourceKeys = new Set<string>();
  for (const container of containers)
    for (const drawing of Object.values(container.drawings ?? {})) {
      check();
      if (!drawing || typeof drawing !== 'object' || Array.isArray(drawing)) invalid();
      if (++count > limits.images)
        throw new PrintError('limit', 'PDF document exceeds its image budget.');
      if (typeof (drawing as { source?: unknown }).source === 'string')
        sourceKeys.add((drawing as unknown as { source: string }).source);
    }
  const anchors = new Set(
    containers.flatMap((container) =>
      (container.body?.customBlocks ?? []).map((block) => block.blockId),
    ),
  );
  const bodyAnchors = new Set((snapshot.body?.customBlocks ?? []).map((block) => block.blockId));
  for (const container of containers) {
    const drawings = container.drawings ?? {};
    const entries = Object.entries(drawings);
    if (
      !entries.some(
        ([, drawing]) => drawing.groupId || drawing.drawingType === DrawingTypeEnum.DRAWING_GROUP,
      )
    )
      continue;
    const order = container.drawingsOrder ?? Object.keys(drawings);
    const headerOrder = container === snapshot ? (snapshot.headerFooterDrawingsOrder ?? []) : [];
    for (const values of [order, headerOrder])
      if (
        !Array.isArray(values) ||
        new Set(values).size !== values.length ||
        values.some((id) => typeof id !== 'string' || !Object.hasOwn(drawings, id))
      )
        invalid();
    const ordered = [...new Set([...order, ...headerOrder, ...Object.keys(drawings)])];
    // Public Docs paint behind-text objects before the rest, retaining authored
    // order within each layer. Group children retain that native z ordering.
    ordered.sort(
      (a, b) =>
        Number(
          drawings[b].layoutType === PositionedObjectLayoutType.WRAP_NONE &&
            drawings[b].behindDoc === 1,
        ) -
        Number(
          drawings[a].layoutType === PositionedObjectLayoutType.WRAP_NONE &&
            drawings[a].behindDoc === 1,
        ),
    );
    const children = new Map<string, string[]>();
    for (const id of ordered) {
      const drawing = drawings[id];
      if (drawing.drawingId !== id) invalid();
      if (drawing.groupId != null && typeof drawing.groupId !== 'string') invalid();
      if (!drawing.groupId) continue;
      if (drawings[drawing.groupId]?.drawingType !== DrawingTypeEnum.DRAWING_GROUP) unsupported();
      if (anchors.has(id)) invalid();
      const siblings = children.get(drawing.groupId) ?? [];
      siblings.push(id);
      children.set(drawing.groupId, siblings);
    }
    const prepared = new Map<string, ImageGroupNode>();
    const visiting = new Set<string>();
    const prepare = (id: string, repeated: boolean, depth: number): ImageGroupNode => {
      check();
      if (depth > 32) throw new PrintError('limit', 'PDF image group exceeds its nesting budget.');
      if (visiting.has(id)) invalid();
      const cached = prepared.get(id);
      if (cached) return cached;
      visiting.add(id);
      const drawing = drawings[id];
      const isGroup = drawing.drawingType === DrawingTypeEnum.DRAWING_GROUP;
      const raw = drawing as IDocDrawingBase & {
        source?: string;
        opacity?: number;
        srcRect?: ImageAppearance['srcRect'];
        glow?: unknown;
        outerShadow?: unknown;
      };
      if (drawing.drawingType !== DrawingTypeEnum.DRAWING_IMAGE && !isGroup) unsupported();
      if (
        isGroup &&
        (raw.srcRect ||
          raw.glow ||
          raw.outerShadow ||
          (raw.opacity !== undefined && raw.opacity !== 1))
      )
        unsupported();
      // Validate the original image appearance through the ordinary image
      // admission, removing only the relationship consumed by this projection.
      const detached = {
        ...drawing,
        drawingType: DrawingTypeEnum.DRAWING_IMAGE,
        ...(isGroup ? { source: 'group-validation-carrier' } : {}),
      };
      delete detached.groupId;
      if (isGroup) delete detached.groupBaseBound;
      if (drawing.groupId) detached.layoutType = PositionedObjectLayoutType.INLINE;
      const view: IDocumentData = {
        id: snapshot.id,
        documentStyle: snapshot.documentStyle,
        body: { dataStream: '\b\r\n', customBlocks: [{ startIndex: 0, blockId: id }] },
        drawings: { [id]: detached },
        drawingsOrder: [id],
      };
      validate(view, repeated);
      const transform = detached.docTransform;
      if (drawing.groupId)
        for (const position of [transform.positionH, transform.positionV])
          if (
            position?.relativeFrom !== 0 ||
            position.align !== undefined ||
            position.percent !== undefined ||
            !Number.isFinite(position.posOffset)
          )
            unsupported();
      const node: ImageGroupNode = {
        appearance: {
          left: drawing.groupId ? finite(transform.positionH.posOffset) : 0,
          top: drawing.groupId ? finite(transform.positionV.posOffset) : 0,
          width: transform.size.width!,
          height: transform.size.height!,
          angle: transform.angle ?? 0,
          flipX: transform.flipX ?? false,
          flipY: transform.flipY ?? false,
          ...((detached as typeof raw).srcRect
            ? { srcRect: (detached as typeof raw).srcRect }
            : {}),
        },
        hidden: drawing.hidden === true,
        opacity: raw.opacity ?? 1,
        children: [],
      };
      if (isGroup) {
        const base = drawing.groupBaseBound;
        if (
          !base ||
          Object.keys(base).some((key) => !['left', 'top', 'width', 'height'].includes(key))
        )
          invalid();
        node.base = {
          left: finite(base.left),
          top: finite(base.top),
          width: finite(base.width, Number.MIN_VALUE),
          height: finite(base.height, Number.MIN_VALUE),
        };
        const ids = children.get(id);
        if (!ids?.length) invalid();
        node.children = ids.map((child) => prepare(child, repeated, depth + 1));
      } else node.source = raw.source!;
      visiting.delete(id);
      prepared.set(id, node);
      return node;
    };
    for (const [id, drawing] of entries) {
      if (drawing.groupId || drawing.drawingType !== DrawingTypeEnum.DRAWING_GROUP) continue;
      const node = prepare(id, !bodyAnchors.has(id), 0);
      let source = `print-image-group-${groups.size}`;
      while (sourceKeys.has(source)) source += '-generated';
      sourceKeys.add(source);
      groups.set(source, node);
      const carrier = { ...drawing, drawingType: DrawingTypeEnum.DRAWING_IMAGE, source };
      delete carrier.groupBaseBound;
      drawings[id] = carrier;
    }
    // A rootless cycle must not disappear when child entries are removed.
    for (const [id, drawing] of entries) if (drawing.groupId && !prepared.has(id)) invalid();
    const nested = new Set(entries.filter(([, drawing]) => drawing.groupId).map(([id]) => id));
    for (const id of nested) delete drawings[id];
    if (container.drawingsOrder)
      container.drawingsOrder = container.drawingsOrder.filter((id) => !nested.has(id));
    if (container === snapshot && snapshot.headerFooterDrawingsOrder)
      snapshot.headerFooterDrawingsOrder = snapshot.headerFooterDrawingsOrder.filter(
        (id) => !nested.has(id),
      );
  }
  return groups;
}
