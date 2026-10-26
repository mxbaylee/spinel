import { isDeepStrictEqual } from 'node:util';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import type { PreparedImage } from '@spinel/print';
import { imageSources } from '../workspace/imageSources.ts';
import { PDF_LIMITS, PdfError } from './limits.ts';

type Snapshot = IDocumentData | IWorkbookData;
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
function invalid(): never {
  throw new PdfError('unsupported');
}

/** Bound parent-side cloning and JSON resource decoding before native isolation. */
export function inspectPdfSnapshot(value: unknown) {
  let nodes = 0;
  let strings = 0;
  const seen = new Set<object>();
  const visit = (entry: unknown, depth: number) => {
    if (++nodes > PDF_LIMITS.snapshotNodes || depth > 64) throw new PdfError('limit');
    if (typeof entry === 'string') {
      strings += Buffer.byteLength(entry);
      if (strings > PDF_LIMITS.snapshotBytes) throw new PdfError('limit');
    } else if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) invalid();
    }
    else if (entry && typeof entry === 'object') {
      if (seen.has(entry)) invalid();
      seen.add(entry);
      if (Array.isArray(entry) && entry.length > PDF_LIMITS.snapshotNodes)
        throw new PdfError('limit');
      if (!Array.isArray(entry) && Object.getPrototypeOf(entry) !== Object.prototype &&
          Object.getPrototypeOf(entry) !== null) invalid();
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(entry))) {
        if (['__proto__', 'prototype', 'constructor'].includes(key) || !('value' in descriptor))
          invalid();
        visit(descriptor.value, depth + 1);
      }
      seen.delete(entry);
    } else if (entry !== null && entry !== undefined && typeof entry !== 'boolean') invalid();
  };
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value) ?? '') > PDF_LIMITS.snapshotBytes)
    throw new PdfError('limit');
}

function resourceData(snapshot: Snapshot) {
  const result = new Map<string, unknown>();
  if (snapshot.resources !== undefined && !Array.isArray(snapshot.resources)) invalid();
  for (const resource of snapshot.resources ?? []) {
    if (!resource || typeof resource.name !== 'string' || !resource.name ||
        typeof resource.data !== 'string' || result.has(resource.name)) invalid();
    let data: unknown;
    // Several public native resource serializers use the empty string for no state.
    try { data = resource.data === '' ? {} : JSON.parse(resource.data); }
    catch { invalid(); }
    inspectPdfSnapshot(data);
    result.set(resource.name, data);
  }
  return result;
}

function prepareDocResources(snapshot: IDocumentData, resources: Map<string, unknown>) {
  const drawings = resources.get('DOC_DRAWING_PLUGIN');
  if (drawings !== undefined) {
    if (!object(drawings) || Object.keys(drawings).some((key) => !['data', 'order'].includes(key)))
      invalid();
    if (drawings.data !== undefined && !object(drawings.data)) invalid();
    if (drawings.order !== undefined && !Array.isArray(drawings.order)) invalid();
    const data = (drawings.data ?? {}) as NonNullable<IDocumentData['drawings']>;
    const order = (drawings.order ?? []) as string[];
    // The native resource duplicates the model. Conflicting copies are never guessed.
    if (Object.keys(snapshot.drawings ?? {}).length && !isDeepStrictEqual(snapshot.drawings, data))
      invalid();
    if (snapshot.drawingsOrder?.length && !isDeepStrictEqual(snapshot.drawingsOrder, order))
      invalid();
    snapshot.drawings = data;
    snapshot.drawingsOrder = order;
    resources.delete('DOC_DRAWING_PLUGIN');
  }
  const links = resources.get('DOC_HYPER_LINK_PLUGIN');
  if (links !== undefined) {
    if (!object(links) || Object.keys(links).some((key) => key !== 'links') ||
        (links.links !== undefined && !Array.isArray(links.links))) invalid();
    const ids = new Set<string>();
    const ranges = snapshot.body?.customRanges ?? [];
    for (const value of (links.links ?? []) as unknown[]) {
      if (!object(value) || typeof value.id !== 'string' || typeof value.payload !== 'string' ||
          ids.has(value.id) || Object.keys(value).some((key) => !['id', 'payload'].includes(key)))
        invalid();
      const range = ranges.find((entry) => entry.rangeId === value.id && entry.rangeType === 0);
      if (!range) invalid();
      // Destinations never enter a PDF; preserve the complete native text and appearance.
      ids.add(value.id);
    }
    resources.delete('DOC_HYPER_LINK_PLUGIN');
  }
  const config = snapshot.documentStyle?.renderConfig;
  if (config) {
    const data = config as Record<string, unknown>;
    if (Object.keys(data).some((key) => ![
      'zeroWidthParagraphBreak', 'vertexAngle', 'centerAngle', 'background',
    ].includes(key))) invalid();
    for (const key of ['zeroWidthParagraphBreak', 'vertexAngle', 'centerAngle'])
      if (data[key] != null && data[key] !== 0) invalid();
    // The standard modern editor stores a gray canvas background. PDF paper is
    // always white by the product's deterministic pagination policy.
    delete snapshot.documentStyle.renderConfig;
  }
}

export interface PreparePdfOptions {
  readImage(imageId: string): { mime: string; data: Uint8Array };
  worksheetIds?: readonly string[];
}

/** No credential, arbitrary URL, filename, image decoder or network fetch crosses this API. */
export function preparePdfSnapshot<T extends Snapshot>(
  kind: 'sheet' | 'doc',
  itemId: string,
  source: T,
  options: PreparePdfOptions,
): { snapshot: T; images: PreparedImage[]; imageIds: string[] } {
  inspectPdfSnapshot(source);
  const snapshot = structuredClone(source);
  const resources = resourceData(snapshot);
  if (kind === 'doc') prepareDocResources(snapshot as IDocumentData, resources);
  // Only empty state is discarded here. Calculation/appearance resources for
  // Sheets remain present until the isolated native preparation consumes them.
  snapshot.resources = [...resources].flatMap(([name, data]) =>
    data && typeof data === 'object' && Object.keys(data).length === 0
      ? [] : [{ name, data: JSON.stringify(data) }]);
  if (kind === 'doc' && snapshot.resources.length) invalid();
  if (kind === 'doc') delete snapshot.resources;
  const images = new Map<string, PreparedImage>();
  const imageIds: string[] = [];
  let bytes = 0;
  let imageView: Snapshot = snapshot;
  if (kind === 'sheet') {
    const book = snapshot as IWorkbookData;
    if (!Array.isArray(book.sheetOrder) || !object(book.sheets)) invalid();
    const selected = options.worksheetIds ? new Set(options.worksheetIds) : undefined;
    if (selected && (selected.size !== options.worksheetIds!.length || !selected.size ||
        [...selected].some((id) => !book.sheetOrder.includes(id)))) invalid();
    const included = new Set(book.sheetOrder.filter((id) =>
      book.sheets[id] && !book.sheets[id].hidden && (!selected || selected.has(id))));
    if (!included.size) invalid();
    imageView = { ...book, sheets: Object.fromEntries(
      Object.entries(book.sheets).filter(([id]) => included.has(id)),
    ), resources: book.resources?.map((resource) => {
      if (resource.name !== 'SHEET_DRAWING_PLUGIN') return resource;
      const data = resources.get(resource.name);
      if (!object(data)) invalid();
      return { ...resource, data: JSON.stringify(Object.fromEntries(
        Object.entries(data).filter(([id]) => included.has(id)),
      )) };
    }) };
  }
  imageSources(imageView, (reference) => {
    if (images.has(reference)) return reference;
    const prefix = `/api/items/${itemId}/images/`;
    if (!reference.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(reference.slice(prefix.length)))
      invalid();
    const id = reference.slice(prefix.length);
    const image = options.readImage(id);
    if (!(image.data instanceof Uint8Array) || !image.data.byteLength ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(image.mime)) invalid();
    bytes += image.data.byteLength;
    if (images.size >= PDF_LIMITS.images || bytes > PDF_LIMITS.encodedImageBytes)
      throw new PdfError('limit');
    images.set(reference, { source: reference, bytes: new Uint8Array(image.data) });
    imageIds.push(id);
    return reference;
  });
  inspectPdfSnapshot(snapshot);
  return { snapshot, images: [...images.values()], imageIds };
}
