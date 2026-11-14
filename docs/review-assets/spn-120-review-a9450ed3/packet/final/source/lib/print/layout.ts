import { HorizontalAlign, VerticalAlign } from '@univerjs/core';
import type { ICellData, IWorkbookData } from '@univerjs/core';
import { PrintError, printCheckpoint } from './contract.ts';
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
import { validateSheetResources } from './resources.ts';
import { PrintWorksheet } from './worksheet.ts';
import {
  backgroundImageMetadata,
  cellImageMetadata,
  floatingImageMetadata,
  imageCoordinate,
  imageExtent,
  imageSource,
  invalidImageLayout,
  prepareSheetImageMetadata,
  sheetDrawings,
} from './sheet-image-metadata.ts';
import { imageBounds } from './image-render.ts';
import type { ImageAppearance } from './image-render.ts';
import { groupImageSources, imageGroupBounds } from './image-groups.ts';
import type { ImageGroupNode } from './image-groups.ts';
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
  const metadata = cellImageMetadata(cell, row, column, book, sheet, check);
  if (!metadata) return null;
  const { image, cellRect } = metadata;
  const { appearance } = image;
  const { width, height } = appearance;
  const originalBounds = imageBounds(appearance)!;
  const rotatedWidth = originalBounds.right - originalBounds.left;
  const rotatedHeight = originalBounds.bottom - originalBounds.top;
  const style = worksheet.getComposedCellStyleByCellData(row, column, cell);
  const padding = style.pd ?? {};
  const pad = (key: 'l' | 'r' | 't' | 'b') => imageExtent(padding[key] ?? 2);
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
  if (!appearance.width || !appearance.height) return null;
  const bounds = imageBounds(appearance);
  return bounds ? { ...image, bounds } : null;
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
      {
        rows: sheet.rows,
        spans: [...sheet.mergeSpans, ...sheet.images.map((image) => image.bounds)],
      },
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
  let imageWork = 0;
  const visitImage = () => {
    check();
    if (++imageWork > limits.gridCells)
      throw new PrintError('limit', 'PDF image groups exceed their layout budget.');
  };
  validateSheetResources(snapshot, limits, check);
  const { book, drawingResource, styles, textBudget, measured } = prepareSheetImageMetadata(
    snapshot,
    initial,
    options,
  );
  const sheets: LayoutSheet[] = [];
  const backgrounds = new Map<string, Record<string, unknown>>();
  const sources = new Set<string>();
  const groupPlacements: { image: PlacedImage; group: ImageGroupNode }[] = [];
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
    const floating = sheetDrawings(
      Object.hasOwn(drawingResource, geometry.id) ? drawingResource[geometry.id] : undefined,
    );
    imageCount += floating.length;
    if (imageCount > limits.images) throw new PrintError('limit', 'PDF has too many drawings.');
    for (const metadata of floatingImageMetadata(floating, book.id, geometry, visitImage)) {
      const { group } = metadata;
      const frame = metadata.image;
      const imageBoundsValue = group
        ? imageGroupBounds(
            new Map([[frame.source, group]]),
            frame.source,
            frame.appearance,
            visitImage,
          )
        : imageBounds(frame.appearance);
      if (!imageBoundsValue) continue;
      const image: PlacedImage = { ...frame, bounds: imageBoundsValue };
      images.push(image);
      if (group) {
        groupPlacements.push({ image, group });
        for (const key of groupImageSources([image.source], new Map([[image.source, group]])))
          sources.add(key);
      } else sources.add(image.source);
      bounds = unionBox(bounds, image.bounds);
    }
    const background = backgroundImageMetadata(config, geometry);
    if (background) {
      if (++imageCount > limits.images) throw new PrintError('limit', 'PDF has too many drawings.');
      sources.add(imageSource(background.source));
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
  // Carrier keys are private layout identities. Check every real selected
  // source, including later cells/backgrounds, before assigning one to paint.
  const imageGroups = new Map<string, ImageGroupNode>();
  for (const { image, group } of groupPlacements) {
    visitImage();
    let key = `print-sheet-image-group-${imageGroups.size}`;
    while (sources.has(key) || imageGroups.has(key)) key += '-generated';
    image.source = key;
    imageGroups.set(key, group);
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
      const key = imageSource(background.source);
      const image = images.get(key)!;
      const scaleX = imageCoordinate(background.scaleX, 1),
        scaleY = imageCoordinate(background.scaleY, 1);
      if (!scaleX || !scaleY || scaleX > 100_000 || scaleY > 100_000) invalidImageLayout();
      const bounds = { left: 0, top: 0, right: sheet.columns.at(-1)!, bottom: sheet.rows.at(-1)! };
      const tileWidth = image.width * scaleX,
        tileHeight = image.height * scaleY;
      if (
        !Number.isFinite(tileWidth) ||
        !Number.isFinite(tileHeight) ||
        tileWidth <= 0 ||
        tileHeight <= 0
      )
        invalidImageLayout();
      sheet.background = { source: key, bounds, tileWidth, tileHeight, origin: { x: 0, y: 0 } };
    }
  }
  const pages = replanSheetPages({ sheets, limits }, mediaBox, check);
  check();
  return { book, sheets, pages, images, imageGroups, limits, deadline, textBudget, visitImage };
}
