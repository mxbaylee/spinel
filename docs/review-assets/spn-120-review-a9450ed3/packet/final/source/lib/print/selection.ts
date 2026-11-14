/** Metadata-only source selection; importing this module never loads a renderer. */
import { DrawingTypeEnum } from '@univerjs/core';
import type { ICellData, IDocumentData, IWorkbookData } from '@univerjs/core';
import { PrintError, printCheckpoint, printLimits } from './contract.ts';
import type { SheetPrintOptions } from './contract.ts';
import { pruneUnusedDocStories } from './doc-stories.ts';
import { inspectSnapshot, preflightSheets } from './preflight.ts';
import { groupImageSources } from './image-group-metadata.ts';
import {
  backgroundImageMetadata,
  cellImageMetadata,
  floatingImageMetadata,
  imageSource,
  prepareSheetImageMetadata,
  sheetDrawings,
} from './sheet-image-metadata.ts';

export type DocImageSelectionOptions = Pick<SheetPrintOptions, 'limits' | 'signal'>;
type RecordValue = Record<string, unknown>;

function invalid(): never {
  throw new PrintError('invalid-input', 'Invalid PDF image source metadata.');
}

function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as RecordValue;
}

/**
 * Select opaque source references before a host reads authorized image bytes.
 * The renderer still admits all native appearance and layout. Source-only legacy
 * records are retained here so hosts validate their URLs before native isolation.
 */
export function selectDocImageSources(
  snapshot: IDocumentData,
  options: DocImageSelectionOptions = {},
): readonly string[] {
  const limits = printLimits(options);
  const deadline = performance.now() + limits.durationMs;
  const check = () => printCheckpoint(options.signal, deadline);
  inspectSnapshot(snapshot, limits, check);
  record(snapshot);
  record(snapshot.documentStyle);
  record(snapshot.body);
  const owned = structuredClone(snapshot);
  // Use the exact renderer story selectors, including section inheritance,
  // first/even variants and shared drawing descendants of removed anchors.
  pruneUnusedDocStories(owned, check);
  const root = record(owned.drawings ?? {});
  const sources = new Set<string>();
  let work = 0;
  const visit = () => {
    check();
    if (++work > limits.snapshotNodes)
      throw new PrintError('limit', 'PDF image source selection exceeds its work budget.');
  };
  const collect = (value: unknown, depth: number) => {
    visit();
    if (depth > 64)
      throw new PrintError('limit', 'PDF image source metadata exceeds its nesting budget.');
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value) && Object.hasOwn(value, 'source')) {
      const source = (value as RecordValue).source;
      if (typeof source !== 'string' || !source) invalid();
      sources.add(source);
      if (sources.size > limits.images)
        throw new PrintError('limit', 'PDF document exceeds its image source budget.');
    }
    // Preserve admission of source-bearing image payloads, rather than treating
    // an unrecognized nested source as ordinary text or silently omitting it.
    for (const child of Object.values(value)) collect(child, depth + 1);
  };
  for (const container of [
    owned,
    ...Object.values(owned.headers ?? {}),
    ...Object.values(owned.footers ?? {}),
  ]) {
    visit();
    record(container);
    const local = record(container.drawings ?? {});
    // Shared registries can be large and reused by many stories. Resolve each
    // charged lookup directly; do not copy the registry once per story.
    const drawingAt = (id: string) => {
      if (Object.hasOwn(local, id)) return record(local[id]);
      if (Object.hasOwn(root, id)) return record(root[id]);
      return undefined;
    };
    const hidden = new Map<string, boolean>();
    const depths = new Map<string, number>();
    const active = new Set<string>();
    const isHidden = (id: string, depth: number): boolean => {
      visit();
      if (depth > 32) throw new PrintError('limit', 'PDF image group exceeds its nesting budget.');
      if (active.has(id)) invalid();
      const cached = hidden.get(id);
      if (cached !== undefined) return cached;
      const drawing = drawingAt(id);
      if (!drawing) invalid();
      if (drawing.drawingId !== undefined && drawing.drawingId !== id) invalid();
      if (drawing.hidden !== undefined && typeof drawing.hidden !== 'boolean') invalid();
      if (
        drawing.drawingType !== undefined &&
        ![DrawingTypeEnum.DRAWING_IMAGE, DrawingTypeEnum.DRAWING_GROUP].includes(
          drawing.drawingType as DrawingTypeEnum,
        )
      )
        throw new PrintError('unsupported', 'PDF image source contains an unsupported drawing.');
      if (drawing.groupId != null && typeof drawing.groupId !== 'string') invalid();
      active.add(id);
      let inherited = false;
      let nesting = 0;
      if (drawing.groupId) {
        const parentId = drawing.groupId as string;
        if (drawingAt(parentId)?.drawingType !== DrawingTypeEnum.DRAWING_GROUP) invalid();
        inherited = isHidden(parentId, depth + 1);
        nesting = depths.get(parentId)! + 1;
        if (nesting > 32)
          throw new PrintError('limit', 'PDF image group exceeds its nesting budget.');
      }
      const result = inherited || drawing.hidden === true;
      hidden.set(id, result);
      depths.set(id, nesting);
      active.delete(id);
      return result;
    };
    // Validate the complete active hierarchy before returning any reference to
    // the host; hidden ancestors suppress only byte preparation, not bad links.
    for (const id of Object.keys(local)) isHidden(id, 0);
    for (const [id, drawing] of Object.entries(local)) if (!hidden.get(id)) collect(drawing, 0);
  }
  return [...sources];
}

/** Select potentially required visible Sheet sources before authorized byte reads. */
export function selectSheetImageSources(
  snapshot: IWorkbookData,
  options: SheetPrintOptions = {},
): readonly string[] {
  const initial = preflightSheets(snapshot, options);
  const { limits, deadline } = initial;
  const check = () => printCheckpoint(options.signal, deadline);
  const { book, drawingResource, measured } = prepareSheetImageMetadata(
    snapshot,
    initial,
    options,
    true,
  );
  const sources = new Set<string>();
  let imageCount = 0;
  let work = 0;
  const visit = () => {
    check();
    if (++work > limits.gridCells)
      throw new PrintError('limit', 'PDF image groups exceed their layout budget.');
  };
  const admit = (count: number) => {
    imageCount += count;
    if (imageCount > limits.images) throw new PrintError('limit', 'PDF has too many drawings.');
  };
  for (const geometry of measured.sheets) {
    check();
    const config = book.sheets[geometry.id];
    for (const [row, cells] of Object.entries(config.cellData ?? {})) {
      for (const [column, cell] of Object.entries<ICellData | null>(cells)) {
        check();
        if (
          !cell?.p ||
          (!Object.keys(cell.p.drawings ?? {}).length && !cell.p.drawingsOrder?.length)
        )
          continue;
        admit(1);
        const metadata = cellImageMetadata(
          cell,
          Number(row),
          Number(column),
          book,
          geometry,
          check,
        );
        if (metadata) sources.add(metadata.image.source);
      }
    }
    const entries = sheetDrawings(
      Object.hasOwn(drawingResource, geometry.id) ? drawingResource[geometry.id] : undefined,
    );
    admit(entries.length);
    for (const { image, group } of floatingImageMetadata(entries, book.id, geometry, visit)) {
      if (group) {
        for (const source of groupImageSources([image.source], new Map([[image.source, group]])))
          sources.add(source);
      } else sources.add(image.source);
    }
    const background = backgroundImageMetadata(config, geometry);
    if (background) {
      admit(1);
      sources.add(imageSource(background.source));
    }
  }
  check();
  return [...sources];
}
