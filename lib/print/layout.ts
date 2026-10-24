import { Styles } from '@univerjs/core';
import type { IWorkbookData } from '@univerjs/core';
import { SHEET_FILTER_SNAPSHOT_ID } from '@univerjs/sheets-filter';
import { PrintError, printCheckpoint } from './contract.ts';
import type { PreparedImage, PrintBox, SheetPrintOptions, SheetPrintPage } from './contract.ts';
import { admitImages } from './images.ts';
import type { AdmittedImage } from './images.ts';
import { paginateSheet, preflightSheets, preflightSheetsBefore, unionBox } from './preflight.ts';
import type { SheetGeometry } from './preflight.ts';
import { readResource, resourceRecord } from './resources.ts';
import { PrintWorksheet } from './worksheet.ts';

export interface PlacedImage {
  source: string;
  /** Full drawing destination, never resized separately for a continuation page. */
  bounds: PrintBox;
  opacity: number;
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
  clip: PrintBox;
  /** Normalized source crop; each continuation draws the corresponding pixels. */
  crop: PrintBox;
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
  throw new PrintError('unsupported', 'This PDF drawing layout is not implemented yet.');
}

function coordinate(value: unknown, fallback?: number): number {
  const number = value === undefined ? fallback : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) invalid();
  return number;
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
    x: sheet.columns[column] + extent(point.columnOffset),
    y: sheet.rows[row] + extent(point.rowOffset),
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
  if (
    drawing.drawingType !== 0 ||
    drawing.groupId ||
    drawing.isMultiTransform ||
    drawing.transforms != null
  )
    unsupported();
  const transform = resourceRecord(drawing.transform ?? {});
  const anchored = resourceRecord(drawing.sheetTransform ?? {});
  for (const state of [transform, anchored]) {
    if (
      ['angle', 'skewX', 'skewY'].some((key) => state[key] !== undefined && state[key] !== 0) ||
      ['flipX', 'flipY'].some((key) => state[key] !== undefined && state[key] !== false)
    )
      unsupported();
  }
  if (
    drawing.srcRect != null ||
    (drawing.prstGeom != null && drawing.prstGeom !== 'rect') ||
    drawing.adjustValues != null
  )
    unsupported();
  const opacity = coordinate(drawing.opacity, 1);
  if (opacity > 1) invalid();
  const anchor = drawing.anchorType ?? '0';
  let left: number, top: number, right: number, bottom: number;
  if (anchor === '2') {
    left = coordinate(transform.left, 0);
    top = coordinate(transform.top, 0);
    right = left + extent(transform.width ?? 0);
    bottom = top + extent(transform.height ?? 0);
  } else if (anchor === '0' || anchor === '1') {
    const from = marker(anchored.from, sheet);
    left = from.x;
    top = from.y;
    if (anchor === '1') {
      const to = marker(anchored.to, sheet);
      right = to.x;
      bottom = to.y;
    } else {
      right = left + extent(transform.width ?? 0);
      bottom = top + extent(transform.height ?? 0);
    }
  } else invalid();
  if (right < left || bottom < top || ![left, top, right, bottom].every(Number.isFinite)) invalid();
  if (left === right || top === bottom || opacity === 0) return null;
  return { source: source(drawing.source), bounds: { left, top, right, bottom }, opacity };
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

/** Source-space cropping keeps a tall image continuous instead of fitting it per page. */
export function sliceImages(images: readonly PlacedImage[], page: PrintBox): ImageSlice[] {
  return images.flatMap((image) => {
    const clip = intersection(image.bounds, page);
    if (!clip) return [];
    const { left, top, right, bottom } = image.bounds;
    return [
      {
        ...image,
        clip,
        crop: {
          left: (clip.left - left) / (right - left),
          right: (clip.right - left) / (right - left),
          top: (clip.top - top) / (bottom - top),
          bottom: (clip.bottom - top) / (bottom - top),
        },
      },
    ];
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

/**
 * Internal renderer preparation, NOT a completed PDF or final text used range.
 * Text overflow/shaping and cell-image layout still require the native bridge.
 * Caller receives nothing until every selected sheet and aggregate budget passes.
 */
export async function prepareSheetLayout(
  snapshot: IWorkbookData,
  preparedImages: readonly PreparedImage[],
  mediaBox: { width: number; height: number },
  options: SheetPrintOptions = {},
) {
  const initial = preflightSheets(snapshot, options);
  const { limits, deadline } = initial;
  const check = () => printCheckpoint(options.signal, deadline);
  const book = structuredClone(snapshot);
  const filters = readResource(book, SHEET_FILTER_SNAPSHOT_ID, limits, check);
  const drawingResource = readResource(book, 'SHEET_DRAWING_PLUGIN', limits, check);
  const styles = new Styles(book.styles);
  // Evaluate public saved filters before geometry, preserving every raw cell/value.
  for (const geometry of initial.sheets) {
    check();
    const sheet = new PrintWorksheet(book, book.sheets[geometry.id], styles);
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
    // A future native rich-text bridge must supply their true image rectangles;
    // accepting only text bounds here would silently omit or fetch these images.
    // Reject even a hidden anchor until merge-aware rich-cell layout exists: a
    // hidden anchor can belong to a merge that still has visible row/column area.
    for (const cells of Object.values(config.cellData ?? {})) {
      for (const cell of Object.values(cells)) {
        if (cell?.p?.drawings && Object.keys(cell.p.drawings).length) unsupported();
      }
    }
    const images: PlacedImage[] = [];
    let bounds = geometry.cellBounds;
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
    if (config.backgroundImage) {
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
  let work = 0;
  const plannedPages: SheetPrintPage[] = [];
  for (const sheet of sheets) {
    check();
    sheet.visibleGridCells = gridWork(sheet, sheet.bounds);
    work += sheet.visibleGridCells;
    if (!Number.isSafeInteger(work) || work > limits.gridCells)
      throw new PrintError('limit', 'PDF grid and background exceed their layout budget.');
    if (plannedPages.length === limits.pages)
      throw new PrintError('limit', 'PDF exceeds its page budget.');
    plannedPages.push(
      ...paginateSheet(sheet.id, sheet.bounds, mediaBox, limits.pages - plannedPages.length),
    );
  }
  // Grid/page admission precedes image inspection. Both snapshot and required byte
  // copies are owned before this first await; the original deadline still applies.
  const images: Map<string, AdmittedImage> = await admitImages(
    [...sources],
    preparedImages,
    limits,
    deadline,
    options.signal,
  );
  const pages: LayoutPage[] = [];
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
      work += Math.ceil(bounds.right / tileWidth) * Math.ceil(bounds.bottom / tileHeight);
      sheet.background = { source: key, bounds, tileWidth, tileHeight, origin: { x: 0, y: 0 } };
    }
    if (!Number.isSafeInteger(work) || work > limits.gridCells)
      throw new PrintError('limit', 'PDF grid and background exceed their layout budget.');
    for (const page of plannedPages.filter((page) => page.sheetId === sheet.id)) {
      check();
      const clip = sheet.background && intersection(sheet.background.bounds, page.source);
      pages.push({
        ...page,
        images: sliceImages(sheet.images, page.source),
        background: clip && sheet.background ? { ...sheet.background, clip } : null,
      });
    }
  }
  check();
  return { book, sheets, pages, images, limits, deadline };
}
