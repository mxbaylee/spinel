/** Fixed image offsets belong to the source mode's native page coordinate space. */
import { DocumentFlavor, ObjectRelativeFromV, PositionedObjectLayoutType } from '@univerjs/core';
import type { IDocumentData, IDocumentStyle } from '@univerjs/core';
import { PrintError } from './contract.ts';

export function fixedDocImageAnchors(snapshot: IDocumentData): ReadonlySet<string> {
  const result = new Set<string>();
  const body = new Set((snapshot.body?.customBlocks ?? []).map((block) => block.blockId));
  for (const [id, image] of Object.entries(snapshot.drawings ?? {})) {
    const position = image.docTransform.positionV;
    if (
      !body.has(id) ||
      image.hidden ||
      image.layoutType === PositionedObjectLayoutType.INLINE ||
      ![ObjectRelativeFromV.PAGE, ObjectRelativeFromV.MARGIN].includes(position.relativeFrom)
    )
      continue;
    // Both public position panels and the Follow-text command persist an
    // explicit compensated offset. Imported alignment/percentage models use
    // different native drawing and text-wrap origins and remain unprepared.
    if (
      !Number.isFinite(position.posOffset) ||
      position.align !== undefined ||
      position.percent !== undefined
    )
      throw new PrintError(
        'unsupported',
        'PDF fixed image positioning requires an explicit offset.',
      );
    result.add(id);
  }
  return result;
}

type SourceGeometry = Pick<
  IDocumentStyle,
  'pageSize' | 'marginTop' | 'marginBottom' | 'marginLeft' | 'marginRight'
>;
export interface FixedDocSourceGeometry {
  style: SourceGeometry;
  sections: SourceGeometry[];
}

/** Keep only coordinate defaults that finite print preparation resolves. */
export function fixedDocSourceGeometry(
  snapshot: IDocumentData,
): FixedDocSourceGeometry | undefined {
  if (snapshot.documentStyle.documentFlavor !== DocumentFlavor.MODERN) return;
  const copy = (style: IDocumentStyle): SourceGeometry => ({
    pageSize: style.pageSize && { ...style.pageSize },
    marginTop: style.marginTop,
    marginBottom: style.marginBottom,
    marginLeft: style.marginLeft,
    marginRight: style.marginRight,
  });
  return {
    style: copy(snapshot.documentStyle),
    sections: (snapshot.body?.sectionBreaks ?? []).map(copy),
  };
}
