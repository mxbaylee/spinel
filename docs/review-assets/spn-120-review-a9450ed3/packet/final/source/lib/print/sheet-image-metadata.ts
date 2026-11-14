/** Shared bounded Sheet image metadata. This module never loads a renderer. */
import { Styles } from '@univerjs/core';
import type { ICellData, IWorkbookData, IWorksheetData } from '@univerjs/core';
import { PRINT_LIMITS, PrintError, printCheckpoint } from './contract.ts';
import type { PrintBox, SheetPrintOptions } from './contract.ts';
import { preflightSheetsBefore } from './preflight.ts';
import type { SheetGeometry, SheetPreflight } from './preflight.ts';
import { readResource, resourceRecord } from './resources.ts';
import { PrintWorksheet, displayTextBudget } from './worksheet.ts';
import type { ImageAppearance } from './image-render.ts';
import type { ImageGroupNode } from './image-group-metadata.ts';

export interface SheetImageMetadata {
  source: string;
  opacity: number;
  appearance: ImageAppearance;
}

export function invalidImageLayout(): never {
  throw new PrintError('invalid-input', 'Invalid PDF image layout.');
}

function unsupported(): never {
  throw new PrintError('unsupported', 'This PDF drawing model is not supported.');
}

// No supported axis can exceed this ceiling (50k rows of 100k layout pixels,
// plus one bounded marker offset). Keep absolute drawings in the same domain.
const MAX_LAYOUT_COORDINATE = (PRINT_LIMITS.rows + 1) * 100_000;

export function imageCoordinate(value: unknown, fallback?: number): number {
  const number = value === undefined ? fallback : value;
  if (
    typeof number !== 'number' ||
    !Number.isFinite(number) ||
    number < 0 ||
    number > MAX_LAYOUT_COORDINATE
  )
    invalidImageLayout();
  return number;
}

function position(value: unknown, fallback = 0): number {
  const number = value === undefined ? fallback : value;
  if (
    typeof number !== 'number' ||
    !Number.isFinite(number) ||
    Math.abs(number) > MAX_LAYOUT_COORDINATE
  )
    invalidImageLayout();
  return number;
}

function addExtent(start: number, size: number): number {
  const end = position(start + size);
  // A positive dimension must not round back to its starting coordinate. This
  // check precedes intentional zero-area omission, including marker offsets.
  if (size > 0 && end <= start) invalidImageLayout();
  return end;
}

export function imageExtent(value: unknown): number {
  const number = imageCoordinate(value);
  if (number > 100_000) invalidImageLayout();
  return number;
}

export function imageSource(value: unknown): string {
  if (typeof value !== 'string' || !value) invalidImageLayout();
  return value;
}

function imageAppearance(
  drawing: Record<string, unknown>,
  transform: Record<string, unknown>,
  frame: PrintBox,
): ImageAppearance {
  if (
    drawing.drawingType !== 0 ||
    drawing.groupId ||
    drawing.isMultiTransform ||
    drawing.transforms != null ||
    (drawing.prstGeom != null && drawing.prstGeom !== 'rect') ||
    drawing.adjustValues != null ||
    ['skewX', 'skewY'].some((key) => transform[key] !== undefined && transform[key] !== 0) ||
    ['scaleX', 'scaleY'].some((key) => transform[key] !== undefined && transform[key] !== 1)
  )
    unsupported();
  const angle = transform.angle ?? 0;
  if (typeof angle !== 'number' || !Number.isFinite(angle) || Math.abs(angle) > 100_000)
    invalidImageLayout();
  for (const key of ['flipX', 'flipY'])
    if (transform[key] !== undefined && typeof transform[key] !== 'boolean') invalidImageLayout();
  const appearance: ImageAppearance = {
    left: frame.left,
    top: frame.top,
    width: frame.right - frame.left,
    height: frame.bottom - frame.top,
    angle: angle % 360,
    flipX: transform.flipX === true,
    flipY: transform.flipY === true,
  };
  if (drawing.srcRect != null) {
    const crop = resourceRecord(drawing.srcRect);
    if (Object.keys(crop).some((key) => !['left', 'top', 'right', 'bottom'].includes(key)))
      invalidImageLayout();
    const offset = (key: string) => {
      const value = crop[key] ?? 0;
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 100_000)
        invalidImageLayout();
      return value;
    };
    const srcRect = {
      left: offset('left'),
      top: offset('top'),
      right: offset('right'),
      bottom: offset('bottom'),
    };
    if (
      appearance.width + srcRect.left + srcRect.right <= 0 ||
      appearance.height + srcRect.top + srcRect.bottom <= 0
    )
      invalidImageLayout();
    appearance.srcRect = srcRect;
  }
  return appearance;
}

function imageMetadata(
  drawing: Record<string, unknown>,
  appearance: ImageAppearance,
): SheetImageMetadata | null {
  const opacity = imageCoordinate(drawing.opacity, 1);
  if (opacity > 1) invalidImageLayout();
  if (!appearance.width || !appearance.height || !opacity) return null;
  return { source: imageSource(drawing.source), opacity, appearance };
}

function marker(value: unknown, sheet: SheetGeometry) {
  const point = resourceRecord(value);
  const row = point.row as number;
  const column = point.column as number;
  if (
    !Number.isSafeInteger(row) ||
    row < 0 ||
    row >= sheet.rows.length - 1 ||
    !Number.isSafeInteger(column) ||
    column < 0 ||
    column >= sheet.columns.length - 1
  )
    invalidImageLayout();
  return {
    x: addExtent(sheet.columns[column], imageExtent(point.columnOffset)),
    y: addExtent(sheet.rows[row], imageExtent(point.rowOffset)),
  };
}

/**
 * Interprets the published ISheetImage anchor contract. No URL is evaluated and
 * no native image cache is created. Unsupported appearance is rejected, not lost.
 */
function floatingImage(
  value: unknown,
  id: string,
  bookId: string,
  sheet: SheetGeometry,
): SheetImageMetadata | null {
  const drawing = resourceRecord(value);
  if (drawing.drawingId !== id || drawing.unitId !== bookId || drawing.subUnitId !== sheet.id)
    invalidImageLayout();
  if (drawing.hidden !== undefined && typeof drawing.hidden !== 'boolean') invalidImageLayout();
  if (drawing.hidden) return null;
  const transform = resourceRecord(drawing.transform ?? {});
  const anchored = resourceRecord(drawing.sheetTransform ?? {});
  // The native cell-anchor transform owns orientation for anchored drawings.
  const orientation = { ...transform };
  for (const key of ['angle', 'skewX', 'skewY', 'flipX', 'flipY'])
    if (anchored[key] !== undefined) orientation[key] = anchored[key];
  const anchor = drawing.anchorType ?? '0';
  let left: number, top: number, right: number, bottom: number;
  if (anchor === '2') {
    left = position(transform.left);
    top = position(transform.top);
    right = addExtent(left, imageExtent(transform.width ?? 0));
    bottom = addExtent(top, imageExtent(transform.height ?? 0));
  } else if (anchor === '0' || anchor === '1') {
    const from = marker(anchored.from, sheet);
    left = from.x;
    top = from.y;
    if (anchor === '1') {
      const to = marker(anchored.to, sheet);
      right = to.x;
      bottom = to.y;
    } else {
      right = addExtent(left, imageExtent(transform.width ?? 0));
      bottom = addExtent(top, imageExtent(transform.height ?? 0));
    }
  } else invalidImageLayout();
  if (right < left || bottom < top || ![left, top, right, bottom].every(Number.isFinite))
    invalidImageLayout();
  return imageMetadata(
    drawing,
    imageAppearance(drawing, orientation, { left, top, right, bottom }),
  );
}

/**
 * Sheet groups keep one anchored parent, the original nonzero base rectangle,
 * and each child's saved scene transform. Child cell anchors are stale while
 * grouped; the public editor deliberately does not recompute them on reopen.
 */
export function floatingImageMetadata(
  entries: [string, unknown][],
  bookId: string,
  sheet: SheetGeometry,
  visit: () => void,
) {
  const data = new Map(entries.map(([id, value]) => [id, resourceRecord(value)]));
  const children = new Map<string, string[]>();
  for (const [id, drawing] of data) {
    visit();
    if (drawing.drawingId !== id || drawing.unitId !== bookId || drawing.subUnitId !== sheet.id)
      invalidImageLayout();
    if (drawing.hidden !== undefined && typeof drawing.hidden !== 'boolean') invalidImageLayout();
    if (drawing.groupId != null && typeof drawing.groupId !== 'string') invalidImageLayout();
    if (!drawing.groupId) continue;
    if (data.get(drawing.groupId as string)?.drawingType !== 6) unsupported();
    const siblings = children.get(drawing.groupId as string) ?? [];
    siblings.push(id);
    children.set(drawing.groupId as string, siblings);
  }
  const prepared = new Map<string, ImageGroupNode>();
  const visiting = new Set<string>();
  const prepare = (id: string, depth: number): ImageGroupNode => {
    visit();
    if (depth > 32) throw new PrintError('limit', 'PDF image group exceeds its nesting budget.');
    if (visiting.has(id)) invalidImageLayout();
    const cached = prepared.get(id);
    if (cached) return cached;
    visiting.add(id);
    const drawing = data.get(id)!;
    const isGroup = drawing.drawingType === 6;
    if (drawing.drawingType !== 0 && !isGroup) unsupported();
    if (
      isGroup &&
      (drawing.srcRect != null ||
        drawing.glow != null ||
        drawing.outerShadow != null ||
        (drawing.opacity !== undefined && drawing.opacity !== 1))
    )
      unsupported();
    const transform = resourceRecord(drawing.transform ?? {});
    const left = position(transform.left),
      top = position(transform.top);
    const width = imageExtent(transform.width ?? 0),
      height = imageExtent(transform.height ?? 0);
    // Reuse ordinary appearance validation after consuming only the hierarchy.
    const detached = { ...drawing, drawingType: 0, groupId: undefined };
    const appearance = imageAppearance(detached, transform, {
      left,
      top,
      right: addExtent(left, width),
      bottom: addExtent(top, height),
    });
    const opacity = imageCoordinate(drawing.opacity, 1);
    if (opacity > 1) invalidImageLayout();
    const node: ImageGroupNode = {
      appearance,
      hidden: drawing.hidden === true,
      opacity,
      children: [],
    };
    if (isGroup) {
      const base = resourceRecord(drawing.groupBaseBound);
      if (Object.keys(base).some((key) => !['left', 'top', 'width', 'height'].includes(key)))
        invalidImageLayout();
      const width = imageExtent(base.width),
        height = imageExtent(base.height);
      if (!width || !height) invalidImageLayout();
      node.base = { left: position(base.left), top: position(base.top), width, height };
      const ids = children.get(id);
      if (!ids?.length) invalidImageLayout();
      node.children = ids.map((child) => prepare(child, depth + 1));
    } else {
      node.source = imageSource(drawing.source);
    }
    visiting.delete(id);
    prepared.set(id, node);
    return node;
  };
  const result: { image: SheetImageMetadata; group?: ImageGroupNode }[] = [];
  for (const [id, drawing] of data) {
    visit();
    if (drawing.groupId) continue;
    if (drawing.drawingType !== 6) {
      const image = floatingImage(drawing, id, bookId, sheet);
      if (image) result.push({ image });
      continue;
    }
    const group = prepare(id, 0);
    const image = floatingImage(
      { ...drawing, drawingType: 0, source: 'group-layout-carrier' },
      id,
      bookId,
      sheet,
    );
    if (!image) continue;
    result.push({ image, group });
  }
  // A rootless cycle or disconnected child must not vanish from successful output.
  for (const [id, drawing] of data) if (drawing.groupId && !prepared.has(id)) invalidImageLayout();
  return result;
}

/** Standard native in-cell pictures are single inline-image documents. */
export function cellImageMetadata(
  cell: ICellData,
  row: number,
  column: number,
  book: IWorkbookData,
  sheet: SheetGeometry,
  check: () => void,
): { image: SheetImageMetadata; cellRect: PrintBox } | null {
  const document = resourceRecord(cell.p);
  const config = book.sheets[sheet.id];
  let firstRow = row,
    lastRow = row,
    firstColumn = column,
    lastColumn = column;
  for (const merge of config.mergeData ?? []) {
    check();
    if (
      row >= merge.startRow &&
      row <= merge.endRow &&
      column >= merge.startColumn &&
      column <= merge.endColumn
    ) {
      // Only the native merge anchor is visible; nonanchor cell data is not output.
      if (row !== merge.startRow || column !== merge.startColumn) return null;
      firstRow = merge.startRow;
      lastRow = merge.endRow;
      firstColumn = merge.startColumn;
      lastColumn = merge.endColumn;
      break;
    }
  }
  const cellRect = {
    left: sheet.columns[firstColumn],
    top: sheet.rows[firstRow],
    right: sheet.columns[lastColumn + 1],
    bottom: sheet.rows[lastRow + 1],
  };
  // A hidden anchor can still have a visible merged remainder. Fully collapsed
  // cells do not resolve, validate or copy any unrelated prepared image bytes.
  if (cellRect.right === cellRect.left || cellRect.bottom === cellRect.top) return null;
  const order = document.drawingsOrder;
  const data = resourceRecord(document.drawings ?? {});
  const body = resourceRecord(document.body);
  if (
    !Array.isArray(order) ||
    order.length !== 1 ||
    Object.keys(data).length !== 1 ||
    typeof order[0] !== 'string' ||
    !Object.hasOwn(data, order[0])
  )
    unsupported();
  if (body.dataStream !== '\b\r\n') unsupported();
  const blocks = body.customBlocks;
  if (!Array.isArray(blocks) || blocks.length !== 1) invalidImageLayout();
  const block = resourceRecord(blocks[0]);
  if (block.startIndex !== 0 || block.blockId !== order[0]) invalidImageLayout();
  const drawing = resourceRecord(data[order[0]]);
  if (
    drawing.drawingId !== order[0] ||
    drawing.unitId !== document.id ||
    drawing.subUnitId !== document.id
  )
    invalidImageLayout();
  if (drawing.hidden !== undefined && typeof drawing.hidden !== 'boolean') invalidImageLayout();
  if (drawing.hidden) return null;
  const transform = resourceRecord(drawing.docTransform);
  const size = resourceRecord(transform.size);
  const width = imageExtent(size.width),
    height = imageExtent(size.height);
  if (!width || !height) return null;
  const appearance = imageAppearance(drawing, transform, {
    left: 0,
    top: 0,
    right: width,
    bottom: height,
  });
  const image = imageMetadata(drawing, appearance);
  return image ? { image, cellRect } : null;
}

export function sheetDrawings(value: unknown): [string, unknown][] {
  if (value === undefined) return [];
  const sheet = resourceRecord(value);
  const data = resourceRecord(sheet.data ?? {});
  const order = sheet.order ?? [];
  if (!Array.isArray(order)) invalidImageLayout();
  const seen = new Set<string>();
  const result: [string, unknown][] = [];
  for (const id of order) {
    if (typeof id !== 'string' || seen.has(id) || !Object.hasOwn(data, id)) invalidImageLayout();
    seen.add(id);
    result.push([id, data[id]]);
  }
  // Native reopening also appends drawings omitted from the saved z-order.
  for (const entry of Object.entries(data)) if (!seen.has(entry[0])) result.push(entry);
  return result;
}

export function backgroundImageMetadata(config: Partial<IWorksheetData>, geometry: SheetGeometry) {
  return config.backgroundImage && geometry.rows.at(-1)! > 0 && geometry.columns.at(-1)! > 0
    ? resourceRecord(config.backgroundImage)
    : null;
}

/** Own the input and share the exact filtered geometry used by native layout. */
export function prepareSheetImageMetadata(
  snapshot: IWorkbookData,
  initial: SheetPreflight,
  options: SheetPrintOptions,
  beforeNativePreparation = false,
) {
  const { limits, deadline } = initial;
  const check = () => printCheckpoint(options.signal, deadline);
  const book = structuredClone(snapshot);
  const filters = readResource(book, 'SHEET_FILTER_PLUGIN', limits, check);
  const drawingResource = readResource(book, 'SHEET_DRAWING_PLUGIN', limits, check);
  const styles = new Styles(book.styles);
  const textBudget = displayTextBudget(limits, check);
  // The host selects bytes before the isolated worker recalculates formulas and
  // materializes range themes. They can change a filter's values or appearance.
  // Without an authoritative saved cache, retain all possible image sources.
  let filterInputsMayChange = false;
  if (beforeNativePreparation) {
    filterInputsMayChange =
      Object.keys(readResource(book, 'SHEET_RANGE_THEME_MODEL_PLUGIN', limits, check)).length > 0;
    for (const sheet of Object.values(book.sheets)) {
      const cells: IWorksheetData['cellData'] = sheet.cellData ?? {};
      for (const rowKey of Object.keys(cells)) {
        const row = cells[Number(rowKey)];
        if (!row) continue;
        for (const columnKey of Object.keys(row)) {
          const cell = row[Number(columnKey)];
          check();
          if (cell?.f || cell?.si) filterInputsMayChange = true;
        }
      }
    }
  }
  for (const geometry of initial.sheets) {
    check();
    book.sheets[geometry.id].id = geometry.id;
    const sheet = new PrintWorksheet(book, book.sheets[geometry.id], styles, textBudget);
    const filter = Object.hasOwn(filters, geometry.id) ? filters[geometry.id] : undefined;
    // Still admit every criterion before selecting bytes. An empty temporary
    // cache suppresses only uncertain evaluation, not malformed-filter checks.
    const selectedFilter =
      filter !== undefined &&
      filterInputsMayChange &&
      resourceRecord(filter).cachedFilteredOut === undefined
        ? { ...resourceRecord(filter), cachedFilteredOut: [] }
        : filter;
    sheet.applyFilter(selectedFilter, limits, check);
    const config = book.sheets[geometry.id];
    for (let row = 0; row < geometry.rows.length - 1; row++) {
      check();
      if (sheet.isRowFiltered(row)) {
        config.rowData ??= {};
        config.rowData[row] = { ...config.rowData[row], hd: 1 };
      }
    }
  }
  const measured = preflightSheetsBefore(book, options, deadline);
  return { book, drawingResource, styles, textBudget, measured };
}
