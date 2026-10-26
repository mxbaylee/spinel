/** Public document stories share resources, but have independent source offsets. */
import { CustomRangeType } from '@univerjs/core';
import type { IDocumentData, IFooterData, IHeaderData } from '@univerjs/core';
import { PrintError } from './contract.ts';

export interface DocStory {
  kind: 'body' | 'header' | 'footer';
  id: string;
  snapshot: IDocumentData;
}

function invalid(): never {
  throw new PrintError('invalid-input', 'Invalid PDF document story.');
}

/**
 * Native stories may refer to tables/images stored on the root document. Scope
 * each validation pass to its own anchors without losing the shared resources
 * required by the public native layout model.
 */
export function docStories(snapshot: IDocumentData): DocStory[] {
  for (const value of [snapshot.headers, snapshot.footers])
    if (value != null && (typeof value !== 'object' || Array.isArray(value))) invalid();
  const definitions: {
    kind: DocStory['kind'];
    id: string;
    value: IDocumentData | IHeaderData | IFooterData;
  }[] = [
    { kind: 'body', id: '', value: snapshot },
    ...Object.entries(snapshot.headers ?? {}).map(([id, value]) => ({
      kind: 'header' as const,
      id,
      value,
    })),
    ...Object.entries(snapshot.footers ?? {}).map(([id, value]) => ({
      kind: 'footer' as const,
      id,
      value,
    })),
  ];
  const ids = new Set<string>();
  const usedTables = new Set<string>();
  const usedDrawings = new Set<string>();
  const result = definitions.map(({ kind, id, value }) => {
    if (
      !value ||
      typeof value !== 'object' ||
      !value.body ||
      (kind !== 'body' &&
        (!id ||
          ids.has(id) ||
          (kind === 'header'
            ? (value as IHeaderData).headerId
            : (value as IFooterData).footerId) !== id))
    )
      invalid();
    if (id) ids.add(id);
    if (
      kind !== 'body' &&
      (Object.keys(value.headers ?? {}).length ||
        Object.keys(value.footers ?? {}).length ||
        Object.keys(value.footnotes ?? {}).length ||
        Object.keys(value.endnotes ?? {}).length)
    )
      invalid();
    for (const values of [value.body.tables, value.body.customBlocks])
      if (values !== undefined && !Array.isArray(values)) invalid();
    const tableIds = new Set((value.body.tables ?? []).map((range) => range.tableId));
    const drawingIds = new Set((value.body.customBlocks ?? []).map((block) => block.blockId));
    for (const key of tableIds) usedTables.add(key);
    for (const key of drawingIds) usedDrawings.add(key);
    const tables = { ...snapshot.tableSource, ...value.tableSource };
    const drawings = { ...snapshot.drawings, ...value.drawings };
    for (const key of tableIds) if (!Object.hasOwn(tables, key)) invalid();
    for (const key of drawingIds) if (!Object.hasOwn(drawings, key)) invalid();
    const authoredOrder =
      kind === 'body'
        ? snapshot.drawingsOrder
        : (value.drawingsOrder ?? snapshot.headerFooterDrawingsOrder);
    if (
      authoredOrder !== undefined &&
      (!Array.isArray(authoredOrder) ||
        new Set(authoredOrder).size !== authoredOrder.length ||
        authoredOrder.some((key) => typeof key !== 'string' || !Object.hasOwn(drawings, key)))
    )
      invalid();
    if (
      (kind === 'body' || value.drawingsOrder !== undefined) &&
      authoredOrder &&
      [...drawingIds].some((key) => !authoredOrder.includes(key))
    )
      invalid();
    const order = authoredOrder?.filter((key) => drawingIds.has(key)) ?? [...drawingIds];
    for (const key of drawingIds) if (!order.includes(key)) order.push(key);
    return {
      kind,
      id,
      snapshot: {
        id: 'print-document',
        body: value.body,
        documentStyle: structuredClone(snapshot.documentStyle),
        styles: structuredClone(snapshot.styles),
        lists: structuredClone({ ...snapshot.lists, ...value.lists }),
        tableSource: Object.fromEntries([...tableIds].map((key) => [key, tables[key]])),
        drawings: Object.fromEntries([...drawingIds].map((key) => [key, drawings[key]])),
        drawingsOrder: order,
      },
    };
  });
  for (const { value } of definitions) {
    if (
      Object.keys(value.tableSource ?? {}).some((key) => !usedTables.has(key)) ||
      Object.keys(value.drawings ?? {}).some((key) => !usedDrawings.has(key))
    )
      invalid();
  }
  return result;
}

/** Apply materialized story bodies and resources to the caller-owned print model. */
export function replaceDocStories(snapshot: IDocumentData, stories: readonly DocStory[]) {
  const body = stories[0].snapshot;
  snapshot.body = body.body;
  snapshot.documentStyle = body.documentStyle;
  snapshot.styles = body.styles;
  snapshot.lists = {};
  snapshot.tableSource = {};
  snapshot.drawings = {};
  snapshot.drawingsOrder = body.drawingsOrder;
  snapshot.headerFooterDrawingsOrder = [];
  for (const story of stories) {
    Object.assign(snapshot.lists, story.snapshot.lists);
    Object.assign(snapshot.tableSource, story.snapshot.tableSource);
    Object.assign(snapshot.drawings, story.snapshot.drawings);
    if (story.kind === 'body') continue;
    const target =
      story.kind === 'header' ? snapshot.headers![story.id] : snapshot.footers![story.id];
    target.body = story.snapshot.body!;
    target.tableSource = story.snapshot.tableSource;
    target.drawings = story.snapshot.drawings;
    target.drawingsOrder = story.snapshot.drawingsOrder;
    target.lists = story.snapshot.lists;
    snapshot.headerFooterDrawingsOrder.push(...(story.snapshot.drawingsOrder ?? []));
  }
  if (!snapshot.headerFooterDrawingsOrder.length) delete snapshot.headerFooterDrawingsOrder;
}

/** Admit only the four fields exposed by the editor; never retain their private instructions. */
export function prepareDocStoryFields(snapshot: IDocumentData): ReadonlySet<number> {
  const body = snapshot.body!;
  const markers = new Set<number>();
  let previous = -1;
  const ids = new Set<string>();
  if (body.customRanges !== undefined && !Array.isArray(body.customRanges)) invalid();
  if ((body.customRanges ?? []).some((range) => !range || typeof range !== 'object')) invalid();
  for (const range of [...(body.customRanges ?? [])].sort((a, b) => a.startIndex - b.startIndex)) {
    // Link admission/materialization runs after structural body validation.
    if (range.rangeType === CustomRangeType.HYPERLINK) continue;
    if (range.rangeType !== CustomRangeType.FIELD)
      throw new PrintError(
        'unsupported',
        'PDF header or footer requires a prepared custom result.',
      );
    const properties = range.properties;
    if (
      !Number.isSafeInteger(range.startIndex) ||
      !Number.isSafeInteger(range.endIndex) ||
      range.startIndex <= previous ||
      range.endIndex <= range.startIndex + 1 ||
      range.endIndex >= body.dataStream.length - 2 ||
      !range.rangeId ||
      ids.has(range.rangeId) ||
      range.wholeEntity === true ||
      body.dataStream[range.startIndex] !== '\x1f' ||
      body.dataStream[range.endIndex] !== '\x1e' ||
      !properties ||
      !['PAGE', 'NUMPAGES', 'DATE', 'TIME'].includes(String(properties.fieldType)) ||
      (properties.locked !== undefined && ![0, 1].includes(properties.locked as number))
    )
      invalid();
    const content = body.dataStream.slice(range.startIndex + 1, range.endIndex);
    if ([...content].some((character) => character.charCodeAt(0) < 32)) invalid();
    previous = range.endIndex;
    ids.add(range.rangeId);
    markers.add(range.startIndex);
    markers.add(range.endIndex);
    // PAGE and NUMPAGES are recomputed by the public native skeleton against its
    // complete physical plan. DATE/TIME retain the server-confirmed cached text.
    range.properties = {
      fieldType: properties.fieldType,
      instruction: properties.fieldType,
      ...(properties.locked === 1 ? { locked: 1 } : {}),
    };
  }
  return markers;
}

/** Native physical flow owns columns, section transitions, parity and page fields. */
export function needsPhysicalDocPages(snapshot: IDocumentData): boolean {
  if (Object.keys(snapshot.headers ?? {}).length || Object.keys(snapshot.footers ?? {}).length)
    return true;
  const base = snapshot.documentStyle;
  return (snapshot.body?.sectionBreaks ?? []).some(
    (section) =>
      Boolean(section.columnProperties?.length) ||
      [2, 4, 5].includes(section.sectionType ?? 0) ||
      section.pageSize?.width !== base.pageSize?.width ||
      section.pageSize?.height !== base.pageSize?.height ||
      (['marginTop', 'marginBottom', 'marginLeft', 'marginRight'] as const).some(
        (name) => section[name] !== base[name],
      ),
  );
}
