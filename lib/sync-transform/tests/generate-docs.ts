import {
  BuildTextUtils,
  DrawingTypeEnum,
  getDocsEmptySnapshot,
  IUniverInstanceService,
  JSONX,
  PositionedObjectLayoutType,
  PRESERVE_INSERTED_PARAGRAPH_IDS,
  TextX,
  TextXActionType,
  UniverInstanceType,
} from '@univerjs/core';
import type { DocumentDataModel, IDocumentBody, IDocumentData, ITextRange } from '@univerjs/core';
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

/** As UpdateTextCommand: retain a range with a style merged in. */
function styleRange(start: number, end: number, next: () => number): unknown {
  const ts = pick(next, [{ bl: 1 }, { it: 1 }, { fs: 14 }, { cl: { rgb: '#cc0000' } }]);
  const textX = new TextX();
  if (start > 0) textX.push({ t: TextXActionType.RETAIN, len: start });
  textX.push({
    t: TextXActionType.RETAIN,
    len: end - start,
    body: { dataStream: '', textRuns: [{ st: 0, ed: end - start, ts }] },
    coverType: 0,
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

/** Random rich-text edits and renames, built the way Univer's doc commands build them. */
export const docEdit: Generate = (replica, next) => {
  const doc = model(replica);
  const body = doc.getBody()!;
  // The final "\r\n" (paragraph and section break) always stays.
  const content = body.dataStream.length - 2;
  const kind = next() % 10;
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
  if (content < 2) return null;
  const start = next() % content;
  const end = start + 1 + (next() % Math.min(4, content - start));
  return edit(kind <= 5 ? deleteRange(doc, body, start, end) : styleRange(start, end, next));
};
