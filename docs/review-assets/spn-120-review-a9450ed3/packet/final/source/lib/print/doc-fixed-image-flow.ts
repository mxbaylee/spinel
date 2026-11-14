/** Map continuous fixed images into retained physical sections by their visible source location. */
import {
  DocumentFlavor,
  ObjectRelativeFromV,
  PositionedObjectLayoutType,
  updateAttributeByDelete,
  updateAttributeByInsert,
} from '@univerjs/core';
import type { IDocumentBody, IDocumentData } from '@univerjs/core';
import type { IDocumentSkeletonCached, IDocumentSkeletonPage } from '@univerjs/engine-render';
import { PrintError } from './contract.ts';
import type { PrintLimits } from './contract.ts';
import type { FixedDocSourceGeometry } from './doc-fixed-images.ts';
import { imageBounds } from './image-render.ts';
import { inspectSnapshot } from './preflight.ts';

const epsilon = 0.011; // Native wrap exclusions deliberately advance a boundary by 0.01px.
interface Glyph {
  content: string;
  x: number;
  y: number;
  width: number;
  font: string;
}
interface Line {
  start: number;
  end: number;
  top: number;
  height: number;
  container: string;
  visible: boolean;
}
interface Drawing {
  left: number;
  top: number;
  width: number;
  height: number;
  angle: number;
  container: string;
}
interface Geometry {
  glyphs: Glyph[];
  lines: Line[];
  images: Map<string, Drawing>;
}

function unsupported(): never {
  throw new PrintError('unsupported', 'PDF fixed image flow cannot preserve its source geometry.');
}

function measure(data: IDocumentSkeletonCached, maximum: number, visit: () => void): Geometry {
  const result: Geometry = { glyphs: [], lines: [], images: new Map() };
  const walk = (page: IDocumentSkeletonPage, x: number, y: number, path: string, depth: number) => {
    visit();
    if (depth > 32 || !Number.isFinite(page.height) || page.skeColumnGroups.size) unsupported();
    if (page.height > maximum)
      throw new PrintError('limit', 'PDF continuous image measurement exceeds its page budget.');
    for (const section of page.sections)
      for (const column of section.columns)
        for (const line of column.lines) {
          visit();
          let visible = false;
          for (const divide of line.divides)
            for (const glyph of divide.glyphGroup) {
              visit();
              if (
                glyph.drawingId ||
                ![...glyph.content].some((value) => value.codePointAt(0)! >= 0x20)
              )
                continue;
              visible = true;
              const item = {
                content: glyph.content,
                x: x + column.left + divide.left + divide.paddingLeft + glyph.left + glyph.xOffset,
                y: y + section.top + line.top + line.marginTop + line.paddingTop + line.asc,
                width: glyph.width,
                font: glyph.fontStyle?.fontString ?? '',
              };
              if (![item.x, item.y, item.width].every(Number.isFinite)) unsupported();
              result.glyphs.push(item);
            }
          result.lines.push({
            start: line.st,
            end: line.paragraphIndex,
            top: y + section.top + line.top,
            height: line.lineHeight,
            container: path,
            visible,
          });
        }
    for (const table of page.skeTables.values())
      for (const row of table.rows)
        for (const [index, cell] of row.cells.entries())
          if (!cell.isMergedCellCovered)
            walk(
              cell,
              x + table.left + cell.left + cell.marginLeft,
              y + table.top + row.top + cell.marginTop,
              `${path}/${table.tableId}/${row.index}/${index}`,
              depth + 1,
            );
    for (const image of page.skeDrawings.values()) {
      visit();
      if (result.images.has(image.drawingId)) unsupported();
      const item = {
        left: x + image.aLeft,
        top: y + image.aTop,
        width: image.width,
        height: image.height,
        angle: image.angle,
        container: path,
      };
      if (![item.left, item.top, item.width, item.height, item.angle].every(Number.isFinite))
        unsupported();
      result.images.set(image.drawingId, item);
    }
  };
  data.pages.forEach((page, index) =>
    walk(page, page.marginLeft, page.marginTop, String(index), 0),
  );
  return result;
}

function verify(before: Geometry, after: Geometry, visit: () => void) {
  if (before.glyphs.length !== after.glyphs.length || before.images.size !== after.images.size)
    unsupported();
  for (const [index, glyph] of before.glyphs.entries()) {
    visit();
    const actual = after.glyphs[index];
    if (
      glyph.content !== actual.content ||
      glyph.font !== actual.font ||
      (['x', 'y', 'width'] as const).some((key) => Math.abs(glyph[key] - actual[key]) > epsilon)
    )
      unsupported();
  }
  for (const [id, image] of before.images) {
    visit();
    const actual = after.images.get(id);
    if (
      !actual ||
      image.container !== actual.container ||
      (['left', 'top', 'width', 'height', 'angle'] as const).some(
        (key) => Math.abs(image[key] - actual[key]) > epsilon,
      )
    )
      unsupported();
  }
}

function move(body: IDocumentBody, id: string, target: number) {
  const block = body.customBlocks?.find((entry) => entry.blockId === id);
  if (
    !block ||
    body.dataStream[block.startIndex] !== '\b' ||
    !Number.isSafeInteger(target) ||
    target < 0 ||
    target >= body.dataStream.length
  )
    unsupported();
  const from = block.startIndex;
  if (from === target) return;
  if (
    (body.customRanges ?? []).some(
      (range) =>
        (range.startIndex < target && range.endIndex >= target) ||
        (range.startIndex <= from && range.endIndex >= from),
    )
  )
    unsupported();
  const removed = updateAttributeByDelete(body, 1, from);
  if (removed.dataStream !== '\b') unsupported();
  updateAttributeByInsert(body, removed, 1, target > from ? target - 1 : target);
}

/**
 * The position UI's PAGE coordinate is continuous in Modern Docs. Retained
 * physical headers/columns require mapping that coordinate to its actual source
 * line, which may be several pages away from the original anchor after edits.
 * Public body operations move only the existing control and preserve all spans.
 * The same bounded native compensation used by the editor proves equivalent
 * continuous wrapping before the physical model receives the projection.
 */
export async function projectContinuousFixedImages(
  snapshot: IDocumentData,
  ids: ReadonlySet<string>,
  original: FixedDocSourceGeometry,
  limits: Readonly<PrintLimits>,
  check: () => void,
  visit: () => void,
  layout: (snapshot: IDocumentData) => Promise<IDocumentSkeletonCached>,
): Promise<void> {
  inspectSnapshot(snapshot, limits, check);
  const source = structuredClone(snapshot);
  Object.assign(source.documentStyle, original.style, { documentFlavor: DocumentFlavor.MODERN });
  const sections = source.body!.sectionBreaks ?? [];
  if (sections.length !== original.sections.length) unsupported();
  sections.forEach((section, index) => Object.assign(section, original.sections[index]));
  const maximum = snapshot.documentStyle.pageSize!.height! * limits.pages;
  const sample = async () => measure(await layout(source), maximum, visit);
  let baseline = await sample();
  const visibleSource = snapshot.body!.dataStream.replaceAll('\b', '');
  for (const id of ids) {
    visit();
    const drawing = source.drawings?.[id];
    const image = baseline.images.get(id);
    if (!drawing || !image) unsupported();
    const bounds = imageBounds({
      ...image,
      flipX: drawing.docTransform.flipX ?? false,
      flipY: drawing.docTransform.flipY ?? false,
    });
    if (!bounds) unsupported();
    const containerLines = baseline.lines.filter((line) => line.container === image.container);
    const visibleLines = containerLines.filter((line) => line.visible);
    const lines = visibleLines.length ? visibleLines : containerLines;
    // After deleting all text, native blank/control paragraphs still locate the
    // picture. Use its top band, including a zero-height control line, rather
    // than moving that control below the image into a different blank paragraph.
    // Existing authored paragraph marks and spans remain the only source flow.
    const target = !visibleLines.length
      ? lines.find(
          (line) =>
            Math.abs(line.top - bounds.top) <= epsilon ||
            line.top + line.height > bounds.top + epsilon,
        )
      : drawing.layoutType === PositionedObjectLayoutType.WRAP_TOP_AND_BOTTOM
        ? lines.find((line) => line.top >= bounds.bottom + (drawing.distB ?? 0) - epsilon)
        : lines.find((line) => line.top + line.height > bounds.top + epsilon);
    const destination = target ?? lines.at(-1);
    if (!destination) unsupported();
    // A picture beyond the last visible line retains its measured blank gap.
    // Put its existing control after that line's text, never ahead of it.
    const location = target ? destination.start : destination.end;
    move(source.body!, id, location);
    if (!target) {
      // A fixed picture can outlive the text formerly ahead of it. Beyond all
      // visible source lines its wrapping excludes no text, so an equivalent
      // positioned overlay retains the measured blank gap. The proof below
      // checks every glyph and image before the existing physical continuation
      // mechanism adds any required pages with their retained stories.
      if (lines.some((line) => line.top + line.height > bounds.top + epsilon)) unsupported();
      if (drawing.layoutType !== PositionedObjectLayoutType.WRAP_NONE) drawing.behindDoc = 0;
      drawing.layoutType = PositionedObjectLayoutType.WRAP_NONE;
    }
    let offset = image.top - destination.top;
    let previous: { offset: number; delta: number } | undefined;
    let equivalent: Geometry | undefined;
    for (let attempt = 0; attempt < 8; attempt++) {
      visit();
      if (!Number.isFinite(offset) || Math.abs(offset) > maximum) unsupported();
      drawing.docTransform.positionV = {
        relativeFrom: ObjectRelativeFromV.PARAGRAPH,
        posOffset: offset,
      };
      const measured = await sample();
      const actual = measured.images.get(id);
      if (!actual) unsupported();
      const delta = image.top - actual.top;
      if (Math.abs(delta) <= epsilon) {
        verify(baseline, measured, visit);
        equivalent = measured;
        break;
      }
      const next =
        previous && Math.abs(previous.delta - delta) > epsilon
          ? offset - (delta * (offset - previous.offset)) / (delta - previous.delta)
          : offset + delta;
      previous = { offset, delta };
      offset = next;
    }
    if (!equivalent) unsupported();
    move(snapshot.body!, id, location);
    snapshot.drawings![id].docTransform.positionV = { ...drawing.docTransform.positionV };
    snapshot.drawings![id].layoutType = drawing.layoutType;
    snapshot.drawings![id].behindDoc = drawing.behindDoc;
    if (snapshot.body!.dataStream.replaceAll('\b', '') !== visibleSource) unsupported();
    baseline = equivalent;
  }
  inspectSnapshot(snapshot, limits, check);
}
