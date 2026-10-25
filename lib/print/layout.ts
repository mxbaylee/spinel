import { HorizontalAlign, Styles, VerticalAlign } from '@univerjs/core';
import type { ICellData, IWorkbookData } from '@univerjs/core';
import { SHEET_FILTER_SNAPSHOT_ID } from '@univerjs/sheets-filter';
import { PRINT_LIMITS, PrintError, printCheckpoint } from './contract.ts';
import type {
  PreparedImage,
  PrintBox,
  PrintLimits,
  SheetPrintOptions,
  SheetPrintPage,
} from './contract.ts';
import { admitImages } from './images.ts';
import type { AdmittedImage } from './images.ts';
import { paginateSheet, preflightSheets, preflightSheetsBefore, unionBox } from './preflight.ts';
import type { SheetGeometry } from './preflight.ts';
import { readResource, resourceRecord, validateSheetResources } from './resources.ts';
import { PrintWorksheet, displayTextBudget } from './worksheet.ts';
import { imageBounds } from './image-render.ts';
import type { ImageAppearance } from './image-render.ts';
import { calculateCellImageRect } from '@univerjs/engine-render';

export interface PlacedImage {
  source: string;
  /** Full drawing destination, never resized separately for a continuation page. */
  bounds: PrintBox;
  opacity: number;
  /** Public native rectangular-image appearance, drawn without any URL loading. */
  appearance?: ImageAppearance;
}

export interface TiledBackground {
  source: string;
  bounds: PrintBox;
  tileWidth: number;
  tileHeight: number;
  /** Fixed worksheet-space origin, including across page slices and hidden axes. */
  origin: { x: 0; y: 0 };
}

export interface ImageSlice extends PlacedImage {
  /** Intersection of the transformed object bounds with this worksheet-space page. */
  clip: PrintBox;
}

export interface LayoutPage extends SheetPrintPage {
  images: ImageSlice[];
  background: (TiledBackground & { clip: PrintBox }) | null;
}

export interface LayoutSheet extends SheetGeometry {
  bounds: PrintBox | null;
  images: PlacedImage[];
  background: TiledBackground | null;
}

function invalid(): never {
  throw new PrintError('invalid-input', 'Invalid PDF image layout.');
}

function unsupported(): never {
  throw new PrintError('unsupported', 'This PDF drawing model is not supported.');
}

// No supported axis can exceed this ceiling (50k rows of 100k layout pixels,
// plus one bounded marker offset). Keep absolute drawings in the same domain.
const MAX_LAYOUT_COORDINATE = (PRINT_LIMITS.rows + 1) * 100_000;

function coordinate(value: unknown, fallback?: number): number {
  const number = value === undefined ? fallback : value;
  if (
    typeof number !== 'number' ||
    !Number.isFinite(number) ||
    number < 0 ||
    number > MAX_LAYOUT_COORDINATE
  )
    invalid();
  return number;
}

function position(value: unknown, fallback = 0): number {
  const number = value === undefined ? fallback : value;
  if (
    typeof number !== 'number' ||
    !Number.isFinite(number) ||
    Math.abs(number) > MAX_LAYOUT_COORDINATE
  )
    invalid();
  return number;
}

function addExtent(start: number, size: number): number {
  const end = position(start + size);
  // A positive dimension must not round back to its starting coordinate. This
  // check precedes intentional zero-area omission, including marker offsets.
  if (size > 0 && end <= start) invalid();
  return end;
}

function extent(value: unknown): number {
  const number = coordinate(value);
  if (number > 100_000) invalid();
  return number;
}

function source(value: unknown): string {
  if (typeof value !== 'string' || !value) invalid();
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
  if (typeof angle !== 'number' || !Number.isFinite(angle) || Math.abs(angle) > 100_000) invalid();
  for (const key of ['flipX', 'flipY'])
    if (transform[key] !== undefined && typeof transform[key] !== 'boolean') invalid();
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
      invalid();
    const offset = (key: string) => {
      const value = crop[key] ?? 0;
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 100_000)
        invalid();
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
      invalid();
    appearance.srcRect = srcRect;
  }
  return appearance;
}

function placedImage(
  drawing: Record<string, unknown>,
  appearance: ImageAppearance,
): PlacedImage | null {
  const opacity = coordinate(drawing.opacity, 1);
  if (opacity > 1) invalid();
  if (!appearance.width || !appearance.height || !opacity) return null;
  const bounds = imageBounds(appearance);
  return bounds ? { source: source(drawing.source), bounds, opacity, appearance } : null;
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
    invalid();
  return {
    x: addExtent(sheet.columns[column], extent(point.columnOffset)),
    y: addExtent(sheet.rows[row], extent(point.rowOffset)),
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
): PlacedImage | null {
  const drawing = resourceRecord(value);
  if (drawing.drawingId !== id || drawing.unitId !== bookId || drawing.subUnitId !== sheet.id)
    invalid();
  if (drawing.hidden !== undefined && typeof drawing.hidden !== 'boolean') invalid();
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
    right = addExtent(left, extent(transform.width ?? 0));
    bottom = addExtent(top, extent(transform.height ?? 0));
  } else if (anchor === '0' || anchor === '1') {
    const from = marker(anchored.from, sheet);
    left = from.x;
    top = from.y;
    if (anchor === '1') {
      const to = marker(anchored.to, sheet);
      right = to.x;
      bottom = to.y;
    } else {
      right = addExtent(left, extent(transform.width ?? 0));
      bottom = addExtent(top, extent(transform.height ?? 0));
    }
  } else invalid();
  if (right < left || bottom < top || ![left, top, right, bottom].every(Number.isFinite)) invalid();
  return placedImage(drawing, imageAppearance(drawing, orientation, { left, top, right, bottom }));
}

/** Standard native in-cell pictures are single inline-image documents. */
function cellImage(
  cell: ICellData,
  row: number,
  column: number,
  book: IWorkbookData,
  sheet: SheetGeometry,
  worksheet: PrintWorksheet,
  check: () => void,
): PlacedImage | null {
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
  if (!Array.isArray(blocks) || blocks.length !== 1) invalid();
  const block = resourceRecord(blocks[0]);
  if (block.startIndex !== 0 || block.blockId !== order[0]) invalid();
  const drawing = resourceRecord(data[order[0]]);
  if (
    drawing.drawingId !== order[0] ||
    drawing.unitId !== document.id ||
    drawing.subUnitId !== document.id
  )
    invalid();
  if (drawing.hidden !== undefined && typeof drawing.hidden !== 'boolean') invalid();
  if (drawing.hidden) return null;
  const transform = resourceRecord(drawing.docTransform);
  const size = resourceRecord(transform.size);
  const width = extent(size.width),
    height = extent(size.height);
  if (!width || !height) return null;
  const appearance = imageAppearance(drawing, transform, {
    left: 0,
    top: 0,
    right: width,
    bottom: height,
  });
  const originalBounds = imageBounds(appearance)!;
  const rotatedWidth = originalBounds.right - originalBounds.left;
  const rotatedHeight = originalBounds.bottom - originalBounds.top;
  const style = worksheet.getComposedCellStyleByCellData(row, column, cell);
  const padding = style.pd ?? {};
  const pad = (key: 'l' | 'r' | 't' | 'b') => extent(padding[key] ?? 2);
  const availableWidth = cellRect.right - cellRect.left - pad('l') - pad('r');
  const availableHeight = cellRect.bottom - cellRect.top - pad('t') - pad('b');
  if (availableWidth <= 0 || availableHeight <= 0)
    throw new PrintError('unsupported', 'A PDF cell image has no visible padded area.');
  const scale = Math.min(availableWidth / rotatedWidth, availableHeight / rotatedHeight);
  const scaledWidth = width * scale,
    scaledHeight = height * scale;
  const positioned = calculateCellImageRect({
    cellRect,
    imageWidth: rotatedWidth * scale,
    imageHeight: rotatedHeight * scale,
    horizontalAlign: style.ht ?? HorizontalAlign.UNSPECIFIED,
    verticalAlign: style.vt ?? VerticalAlign.UNSPECIFIED,
    padding,
  });
  appearance.left = (positioned.left + positioned.right - scaledWidth) / 2;
  appearance.top = (positioned.top + positioned.bottom - scaledHeight) / 2;
  appearance.width = scaledWidth;
  appearance.height = scaledHeight;
  if (appearance.srcRect) {
    for (const key of ['left', 'right', 'top', 'bottom'] as const) appearance.srcRect[key] *= scale;
  }
  return placedImage(drawing, appearance);
}

function drawings(value: unknown): [string, unknown][] {
  if (value === undefined) return [];
  const sheet = resourceRecord(value);
  const data = resourceRecord(sheet.data ?? {});
  const order = sheet.order ?? [];
  if (!Array.isArray(order)) invalid();
  const seen = new Set<string>();
  const result: [string, unknown][] = [];
  for (const id of order) {
    if (typeof id !== 'string' || seen.has(id) || !Object.hasOwn(data, id)) invalid();
    seen.add(id);
    result.push([id, data[id]]);
  }
  // Native reopening also appends drawings omitted from the saved z-order.
  for (const entry of Object.entries(data)) if (!seen.has(entry[0])) result.push(entry);
  return result;
}

function intersection(a: PrintBox, b: PrintBox): PrintBox | null {
  const result = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
  return result.right > result.left && result.bottom > result.top ? result : null;
}

/** Keep the complete object transform on each page; the exact page clip limits drawing. */
export function sliceImages(images: readonly PlacedImage[], page: PrintBox): ImageSlice[] {
  return images.flatMap((image) => {
    const clip = intersection(image.bounds, page);
    return clip ? [{ ...image, clip }] : [];
  });
}

function gridWork(sheet: SheetGeometry, bounds: PrintBox | null) {
  if (!bounds) return 0;
  const count = (axis: Float64Array, start: number, end: number) => {
    let total = 0;
    for (let i = 1; i < axis.length; i++)
      if (axis[i] > axis[i - 1] && axis[i] > start && axis[i - 1] < end) total++;
    return total;
  };
  return (
    count(sheet.rows, bounds.top, bounds.bottom) * count(sheet.columns, bounds.left, bounds.right)
  );
}

/** Rebuild slices after text/image bounds expand, rechecking every shared budget. */
export function replanSheetPages(
  layout: { sheets: LayoutSheet[]; limits: Readonly<PrintLimits> },
  mediaBox: { width: number; height: number },
  check: () => void = () => {},
): LayoutPage[] {
  let work = 0;
  const pages: LayoutPage[] = [];
  for (const sheet of layout.sheets) {
    check();
    sheet.visibleGridCells = gridWork(sheet, sheet.bounds);
    work += sheet.visibleGridCells;
    if (!Number.isSafeInteger(work) || work > layout.limits.gridCells)
      throw new PrintError('limit', 'PDF grid and background exceed their layout budget.');
    if (pages.length >= layout.limits.pages)
      throw new PrintError('limit', 'PDF exceeds its page budget.');
    for (const page of paginateSheet(
      sheet.id,
      sheet.bounds,
      mediaBox,
      layout.limits.pages - pages.length,
    )) {
      check();
      const background = sheet.background;
      const clip = background && intersection(background.bounds, page.source);
      if (background && clip) {
        // Count actual per-page draws: a boundary-crossing tile is drawn twice.
        work +=
          (Math.ceil(clip.right / background.tileWidth) -
            Math.floor(clip.left / background.tileWidth)) *
          (Math.ceil(clip.bottom / background.tileHeight) -
            Math.floor(clip.top / background.tileHeight));
        if (!Number.isSafeInteger(work) || work > layout.limits.gridCells)
          throw new PrintError('limit', 'PDF grid and background exceed their layout budget.');
      }
      pages.push({
        ...page,
        images: sliceImages(sheet.images, page.source),
        background: background && clip ? { ...background, clip } : null,
      });
    }
  }
  return pages;
}

/**
 * Internal renderer preparation, NOT a completed PDF or final text used range.
 * Text overflow/shaping and actual painted bounds still require the native bridge.
 * Caller receives nothing until every selected sheet and aggregate budget passes.
 */
export async function prepareSheetLayout(
  snapshot: IWorkbookData,
  preparedImages: readonly PreparedImage[],
  mediaBox: { width: number; height: number },
  options: SheetPrintOptions = {},
  sharedDeadline?: number,
) {
  const initial =
    sharedDeadline === undefined
      ? preflightSheets(snapshot, options)
      : preflightSheetsBefore(snapshot, options, sharedDeadline);
  const { limits, deadline } = initial;
  const check = () => printCheckpoint(options.signal, deadline);
  const textBudget = displayTextBudget(limits, check);
  validateSheetResources(snapshot, limits, check);
  const book = structuredClone(snapshot);
  const filters = readResource(book, SHEET_FILTER_SNAPSHOT_ID, limits, check);
  const drawingResource = readResource(book, 'SHEET_DRAWING_PLUGIN', limits, check);
  const styles = new Styles(book.styles);
  // Evaluate public saved filters before geometry, preserving every raw cell/value.
  for (const geometry of initial.sheets) {
    check();
    // Public Worksheet assigns the same default id when a snapshot omits it.
    // Use the validated workbook key for all per-sheet admission and rendering.
    book.sheets[geometry.id].id = geometry.id;
    const sheet = new PrintWorksheet(book, book.sheets[geometry.id], styles, textBudget);
    sheet.applyFilter(
      Object.hasOwn(filters, geometry.id) ? filters[geometry.id] : undefined,
      limits,
      check,
    );
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
  const sheets: LayoutSheet[] = [];
  const backgrounds = new Map<string, Record<string, unknown>>();
  const sources = new Set<string>();
  let imageCount = 0;
  for (const geometry of measured.sheets) {
    check();
    const config = book.sheets[geometry.id];
    const images: PlacedImage[] = [];
    let bounds = geometry.cellBounds;
    const worksheet = new PrintWorksheet(book, config, styles, textBudget);
    for (const [row, cells] of Object.entries(config.cellData ?? {})) {
      for (const [column, cell] of Object.entries<ICellData | null>(cells)) {
        check();
        if (
          !cell?.p ||
          (!Object.keys(cell.p.drawings ?? {}).length && !cell.p.drawingsOrder?.length)
        )
          continue;
        if (++imageCount > limits.images)
          throw new PrintError('limit', 'PDF has too many drawings.');
        const image = cellImage(
          cell,
          Number(row),
          Number(column),
          book,
          geometry,
          worksheet,
          check,
        );
        if (image) {
          images.push(image);
          sources.add(image.source);
          bounds = unionBox(bounds, image.bounds);
        }
        // Native Font has an asynchronous URL cache. The owned clone keeps the
        // cell's ordinary style but cannot reach that cache after composition.
        delete cell.p;
        delete cell.v;
        delete cell.f;
        delete cell.si;
      }
    }
    for (const [id, value] of drawings(
      Object.hasOwn(drawingResource, geometry.id) ? drawingResource[geometry.id] : undefined,
    )) {
      check();
      if (++imageCount > limits.images) throw new PrintError('limit', 'PDF has too many drawings.');
      const image = floatingImage(value, id, book.id, geometry);
      if (!image) continue;
      images.push(image);
      sources.add(image.source);
      bounds = unionBox(bounds, image.bounds);
    }
    if (config.backgroundImage && geometry.rows.at(-1)! > 0 && geometry.columns.at(-1)! > 0) {
      if (++imageCount > limits.images) throw new PrintError('limit', 'PDF has too many drawings.');
      const background = resourceRecord(config.backgroundImage);
      sources.add(source(background.source));
      backgrounds.set(geometry.id, background);
      bounds = unionBox(bounds, {
        left: 0,
        top: 0,
        right: geometry.columns.at(-1)!,
        bottom: geometry.rows.at(-1)!,
      });
    }
    sheets.push({ ...geometry, bounds, images, background: null });
  }
  replanSheetPages({ sheets, limits }, mediaBox, check);
  // Grid/page admission precedes image inspection. Both snapshot and required byte
  // copies are owned before this first await; the original deadline still applies.
  const images: Map<string, AdmittedImage> = await admitImages(
    [...sources],
    preparedImages,
    limits,
    deadline,
    options.signal,
  );
  for (const sheet of sheets) {
    check();
    const background = backgrounds.get(sheet.id);
    if (background) {
      const key = source(background.source);
      const image = images.get(key)!;
      const scaleX = coordinate(background.scaleX, 1),
        scaleY = coordinate(background.scaleY, 1);
      if (!scaleX || !scaleY || scaleX > 100_000 || scaleY > 100_000) invalid();
      const bounds = { left: 0, top: 0, right: sheet.columns.at(-1)!, bottom: sheet.rows.at(-1)! };
      const tileWidth = image.width * scaleX,
        tileHeight = image.height * scaleY;
      if (
        !Number.isFinite(tileWidth) ||
        !Number.isFinite(tileHeight) ||
        tileWidth <= 0 ||
        tileHeight <= 0
      )
        invalid();
      sheet.background = { source: key, bounds, tileWidth, tileHeight, origin: { x: 0, y: 0 } };
    }
  }
  const pages = replanSheetPages({ sheets, limits }, mediaBox, check);
  check();
  return { book, sheets, pages, images, limits, deadline, textBudget };
}
