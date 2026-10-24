import {
  BaselineOffset,
  BooleanNumber,
  BuildTextUtils,
  CustomRangeType,
  DrawingTypeEnum,
  getDocsEmptySnapshot,
  IUniverInstanceService,
  JSONX,
  NamedStyleType,
  PositionedObjectLayoutType,
  PresetListType,
  PRESERVE_INSERTED_PARAGRAPH_IDS,
  TabStopAlignment,
  TextX,
  TextXActionType,
  UniverInstanceType,
  UpdateDocsAttributeType,
} from '@univerjs/core';
import type {
  DocumentDataModel,
  IDocumentBody,
  IDocumentData,
  ITextRange,
  ITextStyle,
} from '@univerjs/core';
import { docFormulas, formulaBody } from '@spinel/doc-formulas';
import { docIds } from '../src/docs.ts';
import type { Mutation } from '../index.ts';
import type { Replica } from './harness.ts';
import type { Generate } from './simulate.ts';
import { pick } from './generate.ts';

const unitId = 'doc';

/** A two-paragraph document with fixed ids, so every replica starts identical. */
export function seededDoc(): IDocumentData {
  const doc = getDocsEmptySnapshot(unitId, 'enUS' as never, 'Doc');
  const dataStream = 'Alpha beta gamma\rDelta epsilon\r\n';
  doc.body = {
    dataStream,
    textRuns: [{ st: 0, ed: 5, ts: { bl: 1 } }],
    customBlocks: [],
    customRanges: [],
    tables: [],
    paragraphs: [
      { startIndex: 16, paragraphId: 'p1' },
      { startIndex: 30, paragraphId: 'p2' },
    ],
    sectionBreaks: [{ startIndex: 31, sectionId: 's1' }],
  };
  return doc;
}

function model(replica: Replica): DocumentDataModel {
  const instances = replica.injector.get(IUniverInstanceService);
  return instances.getCurrentUnitOfType<DocumentDataModel>(UniverInstanceType.UNIVER_DOC)!;
}

const edit = (actions: unknown): Mutation[] => [
  { id: docIds.richText, params: { unitId, segmentId: '', actions, textRanges: [] } },
];

const range = (startOffset: number, endOffset: number): ITextRange => ({
  startOffset,
  endOffset,
  collapsed: startOffset === endOffset,
});

/** As InsertTextCommand: retain to the caret, insert a body with optional runs and a paragraph. */
function insertText(body: IDocumentBody, next: () => number): unknown {
  const at = next() % (body.dataStream.length - 1);
  const word = pick(next, ['x', 'yz', 'abc']);
  const paragraph = next() % 4 === 0;
  const insert: IDocumentBody = {
    // Univer gives an inserted paragraph, and the one it splits, fresh random
    // ids on every replica unless the body is marked to keep them, so the sync
    // client must send its realized ids with this marker.
    ...(paragraph && { [PRESERVE_INSERTED_PARAGRAPH_IDS]: true }),
    dataStream: paragraph ? `${word}\r` : word,
    ...(next() % 2 === 0 && { textRuns: [{ st: 0, ed: word.length, ts: { it: 1 } }] }),
    ...(paragraph && { paragraphs: [{ startIndex: word.length, paragraphId: `p${next()}` }] }),
  };
  const textX = new TextX();
  if (at > 0) textX.push({ t: TextXActionType.RETAIN, len: at });
  textX.push({ t: TextXActionType.INSERT, body: insert, len: insert.dataStream.length });
  return JSONX.getInstance().editOp(textX.serialize());
}

/** As DeleteTextCommand: delete the text and the drawings anchored in it. */
function deleteRange(doc: DocumentDataModel, body: IDocumentBody, start: number, end: number) {
  const selection = range(start, end);
  const textX = new TextX();
  textX.push(...BuildTextUtils.selection.delete([selection], body, 0, null, true));
  const removals = BuildTextUtils.drawing.remove(doc.getSnapshot(), [selection], body, '');
  return [JSONX.getInstance().editOp(textX.serialize()), ...removals].reduce((all, action) =>
    JSONX.compose(all, action),
  );
}

/**
 * As UpdateTextCommand: retain a range with a style merged in, or replacing
 * its style, as the format painter does, with the keys it unsets as 0.
 */
function styleRange(start: number, end: number, next: () => number): unknown {
  const replace = next() % 5 === 0;
  const ts = replace
    ? { bl: 0, it: 0 }
    : pick(next, [{ bl: 1 }, { it: 1 }, { fs: 14 }, { cl: { rgb: '#cc0000' } }]);
  const textX = new TextX();
  if (start > 0) textX.push({ t: TextXActionType.RETAIN, len: start });
  textX.push({
    t: TextXActionType.RETAIN,
    len: end - start,
    body: { dataStream: '', textRuns: [{ st: 0, ed: end - start, ts }] },
    coverType: replace ? 1 : 0,
  });
  return JSONX.getInstance().editOp(textX.serialize());
}

/** As InsertDocDrawingCommand: a custom-block anchor plus `drawings` and `drawingsOrder` entries. */
function insertDrawing(doc: DocumentDataModel, at: number, next: () => number): unknown {
  const drawingId = `d${next()}`;
  const size = { width: 40 + (next() % 40), height: 30 };
  const drawing = {
    unitId,
    subUnitId: unitId,
    drawingId,
    drawingType: DrawingTypeEnum.DRAWING_IMAGE,
    imageSourceType: 'URL',
    source: `https://example.com/${drawingId}.png`,
    transform: { left: 0, top: 0, ...size },
    docTransform: {
      size,
      positionH: { relativeFrom: 0, posOffset: 0 },
      positionV: { relativeFrom: 1, posOffset: 0 },
      angle: 0,
    },
    behindDoc: 0,
    title: '',
    description: '',
    layoutType: PositionedObjectLayoutType.INLINE,
    wrapText: 0,
    distB: 0,
    distL: 0,
    distR: 0,
    distT: 0,
  };
  return BuildTextUtils.drawing.add({
    selection: { ...range(at, at), segmentId: '' },
    documentDataModel: doc,
    drawings: [drawing as never],
  });
}

/** A drawing inserted at `at`, for focused tests. */
export const docDrawingInsert = (replica: Replica, at: number, next: () => number) =>
  edit(insertDrawing(model(replica), at, next));

/** As the drawing-property commands: replace one leaf of a drawing. */
function updateDrawing(doc: DocumentDataModel, drawingId: string, next: () => number): unknown {
  const old = doc.getSnapshot().drawings![drawingId];
  return JSONX.getInstance().replaceOp(
    ['drawings', drawingId, 'description'],
    old.description,
    `note ${next() % 100}`,
  );
}

/**
 * As the list commands: a bullet or numbered list on the paragraphs a range
 * touches. Or as SetParagraphStyleCommand: a heading or normal text on them.
 */
function paragraphEdit(doc: DocumentDataModel, start: number, end: number, next: () => number) {
  const body = doc.getBody()!;
  const textRanges = [range(start, end)];
  if (next() % 2 === 0) {
    const style = {
      namedStyleType: pick(next, [NamedStyleType.HEADING_1, NamedStyleType.NORMAL_TEXT]),
    };
    const textX = BuildTextUtils.paragraph.style.set({
      textRanges,
      segmentId: '',
      document: doc,
      style,
    });
    return JSONX.getInstance().editOp(textX.serialize());
  }
  const paragraphs = BuildTextUtils.range.getParagraphsInRanges(
    textRanges,
    body.paragraphs ?? [],
    body.dataStream,
  );
  const textX = BuildTextUtils.paragraph.bullet.set({
    paragraphs,
    listType: pick(next, [PresetListType.BULLET_LIST, PresetListType.ORDER_LIST]),
    listId: `l${next() % 1000}`,
    segmentId: '',
    document: doc,
  });
  return textX && JSONX.getInstance().editOp(textX.serialize());
}

/** As AddDocHyperLinkCommand (addCustomRangeBySelectionFactory): a link over a range. */
function addLink(body: IDocumentBody, start: number, end: number, next: () => number) {
  const textX = BuildTextUtils.customRange.add({
    ranges: [range(start, end)],
    rangeId: `link${next() % 1000}`,
    rangeType: CustomRangeType.HYPERLINK,
    properties: { url: `https://example.com/${next() % 10}` },
    body,
  });
  return textX && JSONX.getInstance().editOp(textX.serialize());
}

/** As DeleteDocHyperLinkCommand (deleteCustomRangeFactory): one link removed by id. */
function removeLink(doc: DocumentDataModel, rangeId: string) {
  const textX = BuildTextUtils.customRange.delete({
    documentDataModel: doc,
    rangeId,
    segmentId: '',
  });
  return textX && JSONX.getInstance().editOp(textX.serialize());
}

/**
 * As SPN-033's adapter (installDocFormulas' insert, through InsertTextCommand):
 * a formula's source text with one whole-entity range, at the caret, over a
 * selection, or in place of an existing formula under the same id.
 */
function insertFormula(body: IDocumentBody, start: number, end: number, id: string, cell: string) {
  const expression = `=Budget.Summary.${cell}`;
  const insert = formulaBody(id, {
    version: 1,
    expression,
    references: [
      { start: 1, end: expression.length, itemId: 'item', sheetId: 'sheet', range: cell },
    ],
  });
  const textX = new TextX();
  if (start === end) {
    if (start > 0) textX.push({ t: TextXActionType.RETAIN, len: start });
    textX.push({ t: TextXActionType.INSERT, body: insert, len: insert.dataStream.length });
  } else textX.push(...BuildTextUtils.selection.delete([range(start, end)], body, 0, insert));
  return JSONX.getInstance().editOp(textX.serialize());
}

/** A formula over `start` to `end` (the caret when equal), for focused tests. */
export const docFormulaInsert = (
  replica: Replica,
  start: number,
  end: number,
  id: string,
  cell: string,
) => edit(insertFormula(model(replica).getBody()!, start, end, id, cell));

const cellOf = (next: () => number) => `A${1 + (next() % 9)}`;

/** Random rich-text edits, links, formulas and renames, built the way Univer's doc commands build them. */
export const docEdit: Generate = (replica, next) => {
  const doc = model(replica);
  const body = doc.getBody()!;
  // The final "\r\n" (paragraph and section break) always stays.
  const content = body.dataStream.length - 2;
  const kind = next() % 16;
  if (kind === 0) {
    return [{ id: docIds.rename, params: { unitId, name: `Doc ${next() % 100}` } }];
  }
  if (kind <= 3) return edit(insertText(body, next));
  const blocks = body.customBlocks ?? [];
  if (kind === 7) return edit(insertDrawing(doc, next() % (content + 1), next));
  if (kind === 8 && blocks.length > 0) {
    const { startIndex } = pick(next, blocks);
    return edit(deleteRange(doc, body, startIndex, startIndex + 1));
  }
  if (kind === 9 && blocks.length > 0)
    return edit(updateDrawing(doc, pick(next, blocks).blockId, next));
  const formulas = docFormulas(body);
  if (kind === 15 && formulas.length > 0) {
    const { id, start, end } = pick(next, formulas);
    return edit(insertFormula(body, start, end, id, cellOf(next)));
  }
  const links = (body.customRanges ?? []).filter(
    ({ rangeType }) => rangeType === CustomRangeType.HYPERLINK,
  );
  if (kind === 12 && links.length > 0) {
    const actions = removeLink(doc, pick(next, links).rangeId);
    return actions ? edit(actions) : null;
  }
  if (content < 2) return null;
  const start = next() % content;
  const end = start + 1 + (next() % Math.min(4, content - start));
  if (kind >= 14) {
    // At the caret, or over the selection. The adapter's ids are random UUIDs.
    const caret = next() % 2 === 0;
    return edit(insertFormula(body, start, caret ? start : end, `f${next()}`, cellOf(next)));
  }
  if (kind >= 12) {
    const actions = addLink(body, start, end, next);
    return actions ? edit(actions) : null;
  }
  if (kind >= 10) {
    const actions = paragraphEdit(doc, start, end, next);
    return actions ? edit(actions) : null;
  }
  return edit(kind <= 5 ? deleteRange(doc, body, start, end) : styleRange(start, end, next));
};

/** A text-run style key's falsy value, where its type has one, and set values. */
interface Values {
  falsy?: unknown;
  set: readonly unknown[];
}
const line = { falsy: { s: BooleanNumber.FALSE }, set: [{ s: BooleanNumber.TRUE }] };
const flag = { falsy: false, set: [true] };
const color = { set: [{ rgb: '#cc0000' }] };
/** Every ITextStyle key (IStyleBase's and the text run's own), as cell-schema writes take them. */
const textStyleValues: Record<keyof ITextStyle, Values> = {
  ff: { falsy: '', set: ['Arial'] },
  eastAsiaFontFamily: { falsy: '', set: ['SimSun'] },
  fs: { falsy: 0, set: [9, 14] },
  it: { falsy: BooleanNumber.FALSE, set: [BooleanNumber.TRUE] },
  bl: { falsy: BooleanNumber.FALSE, set: [BooleanNumber.TRUE] },
  ul: line,
  bbl: line,
  st: line,
  ol: line,
  bg: color,
  bd: { set: [{ b: { s: 1, cl: { rgb: '#000000' } } }] },
  cl: color,
  va: { set: [BaselineOffset.SUBSCRIPT, BaselineOffset.SUPERSCRIPT] },
  n: { falsy: { pattern: '' }, set: [{ pattern: '0.00' }] },
  hidden: flag,
  fontHint: { set: ['eastAsia', 'cs'] },
  positionedTab: { set: [{ alignment: TabStopAlignment.CENTER, relativeTo: 'margin' }] },
  symbol: { set: [{ font: 'Symbol', code: 0x2022 }] },
  lang: { falsy: '', set: ['en-US'] },
  altLang: { falsy: '', set: ['fr-FR'] },
  kerning: { falsy: 0, set: [1] },
  caps: flag,
  smallCaps: flag,
  sc: { falsy: 0, set: [90] },
  pos: { falsy: 0, set: [3] },
  sa: { falsy: 0, set: [1] },
  textFill: { falsy: { type: 'none' }, set: [{ type: 'solid', color: '#00aa00' }] },
  textOutline: { falsy: { width: 0 }, set: [{ color: '#000000', width: 1 }] },
  glow: { set: [{ color: '#ffcc00', radius: 2 }] },
  outerShadow: { set: [{ color: '#000000', blurRadius: 2 }] },
};

/**
 * A text-run style with each ITextStyle key left out (most), null, falsy or
 * set: about three of its 30 keys, never none.
 */
function textStyle(next: () => number): ITextStyle {
  const ts: Record<string, unknown> = {};
  for (const [key, { falsy, set }] of Object.entries(textStyleValues)) {
    if (next() % 10 !== 0) continue;
    const choice = next() % 3;
    if (choice === 0) ts[key] = null;
    else if (choice === 1 && falsy !== undefined) ts[key] = structuredClone(falsy);
    else ts[key] = structuredClone(pick(next, set));
  }
  return Object.keys(ts).length > 0 ? ts : { bl: BooleanNumber.TRUE };
}

/**
 * `docEdit`, or half the time a range restyled with `textStyle`, merged in
 * (COVER) or replacing the run's style (REPLACE), as UpdateTextCommand sends
 * either.
 */
export const textStyleEdit: Generate = (replica, next) => {
  const body = model(replica).getBody()!;
  const content = body.dataStream.length - 2;
  if (next() % 2 === 0 || content < 2) return docEdit(replica, next);
  const start = next() % content;
  const end = start + 1 + (next() % Math.min(4, content - start));
  const coverType = pick(next, [UpdateDocsAttributeType.COVER, UpdateDocsAttributeType.REPLACE]);
  const textX = new TextX();
  if (start > 0) textX.push({ t: TextXActionType.RETAIN, len: start });
  textX.push({
    t: TextXActionType.RETAIN,
    len: end - start,
    body: { dataStream: '', textRuns: [{ st: 0, ed: end - start, ts: textStyle(next) }] },
    coverType,
  });
  return edit(JSONX.getInstance().editOp(textX.serialize()));
};
