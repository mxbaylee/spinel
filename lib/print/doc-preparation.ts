/** Own and admit public document data before native parsing, layout or decoding. */
import {
  DEFAULT_STYLES,
  DocumentFlavor,
  NAMED_STYLE_MAP,
  PRESET_LIST_TYPE,
  resolveDocumentParagraphStyle,
} from '@univerjs/core';
import type {
  IDocumentData,
  IDocDrawingBase,
  IDocumentStyle,
  IListData,
  INumberUnit,
  IParagraphStyle,
  ITable,
  ITextRun,
  ITextStyle,
} from '@univerjs/core';
import { getTextWithCaps } from '@univerjs/engine-render';
import { PrintError } from './contract.ts';
import type { PrintLimits } from './contract.ts';
import type { PreparedFonts } from './fonts.ts';
import { inspectSnapshot } from './preflight.ts';
import { projectDocFormulas } from './doc-formulas.ts';
import { projectDocHyperlinks } from './doc-hyperlinks.ts';
import {
  docStories,
  isolateDocStoryGeometry,
  prepareDocStoryFields,
  pruneUnusedDocStories,
  replaceDocStories,
} from './doc-stories.ts';
import { prepareDocColumnBreaks } from './doc-column-breaks.ts';
import { fixedDocSourceGeometry } from './doc-fixed-images.ts';
import { docGroupImageSources, prepareDocImageGroups } from './doc-image-groups.ts';
import type { PreparedDocFormula } from './doc-formulas.ts';
export type {
  PreparedDocFormula,
  PreparedDocFormulaResult,
  PreparedFormulaValue,
} from './doc-formulas.ts';

function invalid(): never {
  throw new PrintError('invalid-input', 'Invalid prepared PDF document.');
}

function unsupported(): never {
  throw new PrintError('unsupported', 'PDF document contains an unsupported appearance model.');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function number(value: unknown, minimum = 0, maximum = 100_000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) invalid();
  if (value > maximum)
    throw new PrintError('limit', 'PDF document geometry exceeds its layout budget.');
  return value;
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value)) invalid();
  return number(value, minimum, maximum);
}

function unit(value: INumberUnit | undefined, minimum = -100_000) {
  if (value === undefined) return;
  record(value);
  number(value.v, minimum);
  if (value.u !== undefined && ![0, 1, 2, 3, 4].includes(value.u)) invalid();
}

function nonempty(value: unknown) {
  return value != null && (typeof value !== 'object' || Object.keys(value).length > 0);
}

function textStyle(style: ITextStyle | undefined) {
  if (!style) return;
  record(style);
  if (style.fs !== undefined) number(style.fs, Number.MIN_VALUE, 512);
  if (style.ff != null && typeof style.ff !== 'string') invalid();
  if (style.eastAsiaFontFamily != null && typeof style.eastAsiaFontFamily !== 'string') invalid();
  for (const value of [style.bl, style.it]) if (value != null && ![0, 1].includes(value)) invalid();
  for (const value of [style.sc, style.pos]) if (value != null) number(value, -100_000);
  if (style.sa != null) number(style.sa, 1, 1000);
  if (style.kerning != null) number(style.kerning, 0, 512);
  if (
    style.symbol ||
    style.textFill ||
    style.textOutline ||
    style.glow ||
    style.outerShadow ||
    (style.positionedTab?.leader != null && ![0, 1].includes(style.positionedTab.leader)) ||
    Object.keys(style).some((key) =>
      ['customGlyphKey', 'customGlyphRenderer', 'fontRenderExtension'].includes(key),
    )
  )
    unsupported();
}

function paragraphStyle(style: IParagraphStyle | undefined) {
  if (!style) return;
  record(style);
  textStyle(style.textStyle);
  textStyle(style.paragraphMarkTextStyle);
  if (style.namedStyleType != null && !Object.hasOwn(NAMED_STYLE_MAP, style.namedStyleType))
    invalid();
  for (const name of ['defaultTabStop', 'lineSpacing'] as const)
    if (style[name] != null) number(style[name]);
  for (const name of [
    'spaceAbove',
    'spaceBelow',
    'indentFirstLine',
    'hanging',
    'indentStart',
    'indentEnd',
  ] as const)
    unit(style[name]);
  for (const stop of style.tabStops ?? []) {
    number(stop.offset);
    if (stop.leader != null && ![0, 1].includes(stop.leader)) unsupported();
  }
  for (const name of [
    'borderBetween',
    'borderTop',
    'borderBottom',
    'borderLeft',
    'borderRight',
  ] as const) {
    const border = style[name];
    if (!border) continue;
    number(border.width, 0, 512);
    number(border.padding);
  }
  if (style.paragraphFrame) unsupported();
}

function documentStyle(style: IDocumentStyle, inherited?: IDocumentStyle) {
  record(style);
  const size = style.pageSize ??
    inherited?.pageSize ?? { width: (210 * 96) / 25.4, height: (297 * 96) / 25.4 };
  record(size);
  const width = number(size.width ?? inherited?.pageSize?.width ?? (210 * 96) / 25.4, 1);
  const height = number(size.height ?? inherited?.pageSize?.height ?? (297 * 96) / 25.4, 1);
  const margins = {
    marginTop: style.marginTop ?? inherited?.marginTop ?? 48,
    marginBottom: style.marginBottom ?? inherited?.marginBottom ?? 48,
    marginLeft: style.marginLeft ?? inherited?.marginLeft ?? 48,
    marginRight: style.marginRight ?? inherited?.marginRight ?? 48,
  };
  for (const value of Object.values(margins)) number(value);
  if (
    margins.marginTop + margins.marginBottom >= height ||
    margins.marginLeft + margins.marginRight >= width
  )
    invalid();
  if (style.documentFlavor != null && ![0, 1, 2].includes(style.documentFlavor)) unsupported();
  if (
    nonempty(style.background) ||
    nonempty(style.fontFamilyFallbacks) ||
    nonempty(style.pageBorders) ||
    nonempty(style.renderConfig)
  )
    unsupported();
  for (const key of [
    'defaultHeaderId',
    'defaultFooterId',
    'evenPageHeaderId',
    'evenPageFooterId',
    'firstPageHeaderId',
    'firstPageFooterId',
  ] as const)
    if (style[key] !== undefined && typeof style[key] !== 'string') invalid();
  for (const key of ['useFirstPageHeaderFooter', 'evenAndOddHeaders'] as const)
    if (style[key] !== undefined && ![0, 1].includes(style[key])) invalid();
  for (const key of ['marginHeader', 'marginFooter'] as const)
    if (style[key] !== undefined) number(style[key], 0, height);
  if (style.pageNumberStart !== undefined) integer(style.pageNumberStart, 0, 100_000);
  for (const name of ['defaultTabStop', 'paragraphLineGapDefault', 'hyphenationZone'] as const)
    if (style[name] !== undefined) number(style[name]);
  textStyle(style.textStyle);
  paragraphStyle(style.defaultParagraphStyle);
  if (style.documentFlavor === DocumentFlavor.MODERN) {
    // Keep the native continuous document's implicit paragraph spacing when
    // choosing finite physical pages. Explicit stored defaults still win.
    style.defaultParagraphStyle = resolveDocumentParagraphStyle(style, undefined);
  }
  // A finite Traditional layout is the print representation for continuous Docs.
  // It retains all explicitly stored dimensions and margins rather than letting
  // MODERN's viewport-oriented defaults replace them during native layout.
  Object.assign(style, margins, {
    pageSize: { width, height },
    documentFlavor: DocumentFlavor.TRADITIONAL,
  });
}

function validateTables(snapshot: IDocumentData, limits: Readonly<PrintLimits>, check: () => void) {
  const body = snapshot.body!;
  const sources = snapshot.tableSource ?? {};
  record(sources);
  const byStart = new Map<number, { table: ITable; end: number }>();
  const ids = new Set<string>();
  let cells = 0;
  let mergeCells = 0;
  for (const range of body.tables ?? []) {
    check();
    integer(range.startIndex, 0, body.dataStream.length - 1);
    integer(range.endIndex, range.startIndex + 1, body.dataStream.length);
    if (
      typeof range.tableId !== 'string' ||
      !range.tableId ||
      ids.has(range.tableId) ||
      byStart.has(range.startIndex)
    )
      invalid();
    const table = sources[range.tableId];
    if (
      !table ||
      table.tableId !== range.tableId ||
      body.dataStream[range.startIndex] !== '\x1a' ||
      body.dataStream[range.endIndex - 1] !== '\x0f'
    )
      invalid();
    ids.add(range.tableId);
    const rows = table.tableRows;
    const columns = table.tableColumns;
    if (!Array.isArray(rows) || !rows.length || !Array.isArray(columns) || !columns.length)
      invalid();
    if (rows.length > limits.rows || columns.length > limits.columns)
      throw new PrintError('limit', 'PDF table exceeds its axis budget.');
    cells += rows.length * columns.length;
    if (!Number.isSafeInteger(cells) || cells > limits.cells)
      throw new PrintError('limit', 'PDF table exceeds its cell budget.');
    unit(table.size?.width, 0);
    unit(table.indent);
    unit(table.legacyIndentAdjustment);
    if (
      table.textWrap !== 0 ||
      ![0, 1, 2].includes(table.align) ||
      (table.layout != null && ![0, 1].includes(table.layout))
    )
      unsupported();
    for (const column of columns) unit(column.size?.width, Number.MIN_VALUE);
    const covered = new Set<number>();
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      check();
      const row = rows[rowIndex];
      if (!row || !Array.isArray(row.tableCells) || row.tableCells.length !== columns.length)
        unsupported();
      if (row.gridBefore || row.gridAfter || row.widthBefore || row.widthAfter) unsupported();
      if (row.repeatHeaderRow) unsupported();
      unit(row.trHeight?.val, 0);
      if (!row.trHeight || ![0, 1, 2].includes(row.trHeight.hRule)) invalid();
      for (let column = 0; column < columns.length; column++) {
        const cell = row.tableCells[column];
        record(cell);
        const rowSpan = integer(cell.rowSpan ?? 1, 0, rows.length - rowIndex);
        const columnSpan = integer(cell.columnSpan ?? 1, 0, columns.length - column);
        const key = rowIndex * columns.length + column;
        if (covered.has(key) !== (rowSpan === 0 || columnSpan === 0)) invalid();
        if (rowSpan > 1 || columnSpan > 1) {
          mergeCells += rowSpan * columnSpan;
          if (mergeCells > limits.mergeCells)
            throw new PrintError('limit', 'PDF merged cells exceed their layout budget.');
          for (let y = rowIndex; y < rowIndex + rowSpan; y++)
            for (let x = column; x < column + columnSpan; x++) {
              if (y === rowIndex && x === column) continue;
              const target = y * columns.length + x;
              if (covered.has(target)) invalid();
              covered.add(target);
            }
        }
        unit(cell.size?.width, 0);
        for (const margins of [table.cellMargin, row.cellMargin, cell.margin])
          for (const side of ['start', 'end', 'top', 'bottom'] as const) unit(margins?.[side], 0);
        for (const side of ['borderTop', 'borderBottom', 'borderLeft', 'borderRight'] as const) {
          unit(cell[side]?.width, 0);
          unit(cell[side]?.tableTopBorder?.width, 0);
          unit(cell[side]?.tableBottomBorder?.width, 0);
        }
        if (cell.textDirection && cell.textDirection !== 'lrTb') unsupported();
      }
    }
    byStart.set(range.startIndex, { table, end: range.endIndex });
  }
  if (Object.keys(sources).some((id) => !ids.has(id))) invalid();
  // Match the serialized tree before handing it to the native parser. Unbalanced
  // tokens and count mismatches otherwise risk omissions or unbounded traversal.
  type Frame =
    | { kind: 'table'; table: ITable; end: number; rows: number }
    | { kind: 'row'; cells: number }
    | { kind: 'cell'; start: number; covered: boolean };
  const stack: Frame[] = [];
  const tableFrame = () =>
    stack.findLast((frame): frame is Extract<Frame, { kind: 'table' }> => frame.kind === 'table');
  const rowFrame = () =>
    stack.findLast((frame): frame is Extract<Frame, { kind: 'row' }> => frame.kind === 'row');
  for (let index = 0; index < body.dataStream.length; index++) {
    check();
    const token = body.dataStream[index];
    const last = stack.at(-1);
    if (token === '\x1a') {
      if (last && last.kind !== 'cell') invalid();
      const definition = byStart.get(index);
      if (!definition) invalid();
      stack.push({ kind: 'table', ...definition, rows: 0 });
      if (stack.length > 64)
        throw new PrintError('limit', 'PDF table nesting exceeds its layout budget.');
    } else if (token === '\x1b') {
      if (last?.kind !== 'table' || last.rows >= last.table.tableRows.length) invalid();
      stack.push({ kind: 'row', cells: 0 });
    } else if (token === '\x1c') {
      if (last?.kind !== 'row') invalid();
      const table = tableFrame()!;
      const cell = table.table.tableRows[table.rows].tableCells[last.cells];
      if (!cell) invalid();
      stack.push({
        kind: 'cell',
        start: index + 1,
        covered: cell.rowSpan === 0 || cell.columnSpan === 0,
      });
    } else if (token === '\x1d') {
      if (last?.kind !== 'cell' || body.dataStream.slice(index - 2, index) !== '\r\n') invalid();
      if (last.covered && body.dataStream.slice(last.start, index) !== '\r\n') invalid();
      stack.pop();
      rowFrame()!.cells++;
    } else if (token === '\x0e') {
      if (last?.kind !== 'row') invalid();
      const table = tableFrame()!;
      if (last.cells !== table.table.tableRows[table.rows].tableCells.length) invalid();
      stack.pop();
      table.rows++;
    } else if (token === '\x0f') {
      if (
        last?.kind !== 'table' ||
        last.end !== index + 1 ||
        last.rows !== last.table.tableRows.length
      )
        invalid();
      stack.pop();
    } else if (last && last.kind !== 'cell') invalid();
  }
  if (stack.length) invalid();
}

function validateBody(
  snapshot: IDocumentData,
  limits: Readonly<PrintLimits>,
  check: () => void,
  fieldMarkers: ReadonlySet<number> = new Set(),
) {
  const body = snapshot.body!;
  record(body);
  const stream = body.dataStream;
  if (typeof stream !== 'string' || !stream.endsWith('\r\n')) invalid();
  if (stream.length > limits.textCharacters)
    throw new PrintError('limit', 'PDF document exceeds its character budget.');
  for (const name of [
    'paragraphs',
    'textRuns',
    'sectionBreaks',
    'customBlocks',
    'customRanges',
    'tables',
    'renderedPageBreaks',
  ] as const)
    if (body[name] !== undefined && !Array.isArray(body[name])) invalid();
  for (const name of [
    'docxRawCustomBlocks',
    'docxRawBlocks',
    'docxExportExcludedRanges',
    'columnGroups',
    'blockRanges',
    'customDecorations',
    'payloads',
  ] as const)
    if (nonempty(body[name])) unsupported();
  // Only native table, image, tab, authored/soft page and paragraph/section tokens.
  for (let index = 0; index < stream.length; index++) {
    const point = stream.charCodeAt(index);
    if (
      point <= 7 ||
      (point >= 16 && point <= 25) ||
      (point >= 30 && point <= 31 && !fieldMarkers.has(index))
    )
      unsupported();
  }
  const paragraphMap = new Map<number, NonNullable<typeof body.paragraphs>[number]>();
  const paragraphIds = new Set<string>();
  for (const paragraph of body.paragraphs ?? []) {
    check();
    if (
      !paragraph ||
      !Number.isSafeInteger(paragraph.startIndex) ||
      stream[paragraph.startIndex] !== '\r' ||
      paragraphMap.has(paragraph.startIndex)
    )
      invalid();
    if (
      typeof paragraph.paragraphId !== 'string' ||
      !paragraph.paragraphId ||
      paragraphIds.has(paragraph.paragraphId)
    )
      invalid();
    paragraphIds.add(paragraph.paragraphId);
    paragraphStyle(paragraph.paragraphStyle);
    if (paragraph.bullet) {
      const bullet = paragraph.bullet;
      if (
        typeof bullet.listId !== 'string' ||
        !bullet.listId ||
        typeof bullet.listType !== 'string' ||
        !bullet.listType
      )
        invalid();
      integer(bullet.nestingLevel, 0, 8);
      if (bullet.startNumber !== undefined) integer(bullet.startNumber, 0, limits.rows);
      if (bullet.image) unsupported();
      textStyle(bullet.textStyle);
    }
    paragraphMap.set(paragraph.startIndex, paragraph);
  }
  body.paragraphs = [];
  for (let index = 0; index < stream.length; index++) {
    if (stream[index] !== '\r') continue;
    const existing = paragraphMap.get(index);
    let paragraphId = `print-paragraph-${index}`;
    while (paragraphIds.has(paragraphId)) paragraphId += '-generated';
    body.paragraphs.push(existing ?? { startIndex: index, paragraphId });
    paragraphIds.add(paragraphId);
  }
  const graphemes = new Set([0, stream.length]);
  for (const part of new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(stream))
    graphemes.add(part.index);
  for (let index = 0; index < stream.length; index++)
    if (stream.charCodeAt(index) < 32) graphemes.add(index);
  let previous = 0;
  for (const run of body.textRuns ?? []) {
    if (
      !run ||
      !Number.isSafeInteger(run.st) ||
      !Number.isSafeInteger(run.ed) ||
      run.st < previous ||
      run.ed < run.st ||
      run.ed > stream.length ||
      !graphemes.has(run.st) ||
      !graphemes.has(run.ed)
    )
      invalid();
    textStyle(run.ts);
    previous = run.ed;
  }
  const soft = new Set<number>();
  for (const index of body.renderedPageBreaks ?? []) {
    if (!Number.isSafeInteger(index) || stream[index] !== '\f' || soft.has(index)) invalid();
    soft.add(index);
  }
  const sections = new Set<number>();
  for (const section of body.sectionBreaks ?? []) {
    if (
      !Number.isSafeInteger(section.startIndex) ||
      stream[section.startIndex] !== '\n' ||
      sections.has(section.startIndex)
    )
      invalid();
    sections.add(section.startIndex);
    if (section.textDirection || section.noteProperties) unsupported();
    if (section.columnProperties !== undefined) {
      if (!Array.isArray(section.columnProperties)) invalid();
      if (section.columnProperties.length > limits.columns)
        throw new PrintError('limit', 'PDF section exceeds its column budget.');
      for (const column of section.columnProperties) {
        record(column);
        number(column.width, Number.MIN_VALUE);
        number(column.paddingEnd);
      }
    }
    for (const key of ['sectionType', 'sectionTypeNext'] as const)
      if (section[key] !== undefined && ![0, 1, 2, 3, 4, 5].includes(section[key])) invalid();
    // Public native layout derives this configuration hint from the following
    // section's authoritative sectionType. A saved stale hint has no separate
    // transition semantics and must not select the physical print path.
    delete section.sectionTypeNext;
    if (
      section.columnSeparatorType !== undefined &&
      ![0, 1, 2].includes(section.columnSeparatorType)
    )
      invalid();
    documentStyle(section, snapshot.documentStyle);
  }
  validateTables(snapshot, limits, check);
}

/**
 * The public editor marks an inline story image as one object with repeated
 * viewport presentations. Those cached positions include screen/page offsets;
 * native story layout derives authoritative geometry from docTransform instead.
 */
function normalizeStoryImageViews(drawing: IDocDrawingBase, limits: Readonly<PrintLimits>) {
  if (drawing.isMultiTransform !== 1 || drawing.layoutType !== 0) return;
  const views = drawing.transforms ?? [];
  if (!Array.isArray(views)) invalid();
  if (views.length > limits.pages)
    throw new PrintError('limit', 'PDF image view cache exceeds its entry budget.');
  const numeric = ['left', 'top', 'width', 'height', 'angle', 'skewX', 'skewY', 'scaleX', 'scaleY'];
  const flags = ['flipX', 'flipY', 'rotateEnabled', 'resizeEnabled', 'borderEnabled'];
  for (const value of views) {
    const view = record(value);
    if (Object.keys(view).some((key) => ![...numeric, ...flags, 'clipBounds'].includes(key)))
      unsupported();
    for (const key of numeric)
      if (view[key] != null)
        number(view[key], key === 'width' || key === 'height' ? 0 : -10_000_000, 10_000_000);
    for (const key of flags) if (view[key] != null && typeof view[key] !== 'boolean') invalid();
    for (const key of ['skewX', 'skewY']) if (view[key] != null && view[key] !== 0) unsupported();
    for (const key of ['scaleX', 'scaleY']) if (view[key] != null && view[key] !== 1) unsupported();
    if (view.clipBounds != null) {
      const clip = record(view.clipBounds);
      if (Object.keys(clip).some((key) => !['left', 'top', 'width', 'height'].includes(key)))
        unsupported();
      for (const key of ['left', 'top', 'width', 'height'])
        number(clip[key], key === 'width' || key === 'height' ? 0 : -10_000_000, 10_000_000);
    }
  }
  // This is one anchored image, repeated by the native header/footer plan.
  // Keep its docTransform, crop, opacity, flips and source ordering untouched.
  delete drawing.transforms;
  delete drawing.isMultiTransform;
}

function imageSources(
  snapshot: IDocumentData,
  limits: Readonly<PrintLimits>,
  repeatedStory = false,
) {
  const body = snapshot.body!;
  const drawings = snapshot.drawings ?? {};
  const order = snapshot.drawingsOrder ?? Object.keys(drawings);
  if (
    !Array.isArray(order) ||
    order.length > limits.images ||
    Object.keys(drawings).length > limits.images
  )
    throw new PrintError('limit', 'PDF document exceeds its image budget.');
  if (
    new Set(order).size !== order.length ||
    order.some((id) => !Object.hasOwn(drawings, id)) ||
    Object.keys(drawings).some((id) => !order.includes(id))
  )
    invalid();
  const anchored = new Set<string>();
  const positions = new Set<number>();
  for (const block of body.customBlocks ?? []) {
    if (
      !Number.isSafeInteger(block.startIndex) ||
      body.dataStream[block.startIndex] !== '\b' ||
      positions.has(block.startIndex) ||
      anchored.has(block.blockId)
    )
      invalid();
    if (block.blockType != null && block.blockType !== 0) unsupported();
    if (block.noteType || block.noteId || block.docxRawXml || block.docxExportTs) unsupported();
    if (!Object.hasOwn(drawings, block.blockId)) invalid();
    anchored.add(block.blockId);
    positions.add(block.startIndex);
  }
  for (let index = 0; index < body.dataStream.length; index++)
    if (body.dataStream[index] === '\b' && !positions.has(index)) invalid();
  const sources: string[] = [];
  for (const id of order) {
    const drawing = drawings[id];
    const raw = record(drawing);
    if (repeatedStory) normalizeStoryImageViews(drawing, limits);
    if (drawing.drawingId !== id || !anchored.has(id)) invalid();
    if (drawing.hidden !== undefined && typeof drawing.hidden !== 'boolean') invalid();
    if (drawing.behindDoc !== undefined && ![0, 1].includes(drawing.behindDoc)) invalid();
    if (
      drawing.drawingType !== 0 ||
      drawing.groupId ||
      drawing.transforms?.length ||
      drawing.isMultiTransform ||
      drawing.groupBaseBound ||
      drawing.start?.length ||
      drawing.lineTo?.length ||
      (raw.prstGeom != null && raw.prstGeom !== 'rect') ||
      nonempty(raw.adjustValues)
    )
      unsupported();
    if (![0, 1, 3, 6].includes(drawing.layoutType)) unsupported();
    if (typeof raw.source !== 'string' || !raw.source) invalid();
    const transform = drawing.docTransform;
    if (!transform) invalid();
    for (const flag of [transform.flipX, transform.flipY])
      if (flag !== undefined && typeof flag !== 'boolean') invalid();
    number(transform.size?.width, Number.MIN_VALUE);
    number(transform.size?.height, Number.MIN_VALUE);
    number(transform.angle ?? 0, -360, 360);
    if (drawing.transform?.skewX || drawing.transform?.skewY) unsupported();
    for (const candidate of [raw.transform, raw.docTransform]) {
      const values = candidate == null ? {} : record(candidate);
      for (const key of ['skewX', 'skewY'])
        if (values[key] != null && values[key] !== 0) unsupported();
      for (const key of ['scaleX', 'scaleY'])
        if (values[key] != null && values[key] !== 1) unsupported();
    }
    for (const position of [transform.positionH, transform.positionV]) {
      if (position === undefined && drawing.layoutType === 0) continue;
      record(position);
      integer(position.relativeFrom, 0, 7);
      if (position.posOffset !== undefined) number(position.posOffset, -100_000);
      if (position.percent !== undefined) number(position.percent, -1000, 1000);
      if (position.align !== undefined) integer(position.align, 0, 6);
    }
    if (drawing.layoutType !== 0) {
      const horizontal = transform.positionH;
      const vertical = transform.positionV;
      // Several public enums still have empty positioning branches in the
      // pinned native renderer. Reject those instead of accepting its zero
      // fallback and silently moving the saved image.
      if (
        ![0, 1, 3].includes(horizontal.relativeFrom) ||
        ![0, 1, 2, 3].includes(vertical.relativeFrom)
      )
        unsupported();
      if (horizontal.align !== undefined) {
        if (![0, 2, 4].includes(horizontal.align)) unsupported();
      } else if (
        horizontal.posOffset === undefined &&
        horizontal.percent !== undefined &&
        horizontal.relativeFrom !== 0
      )
        unsupported();
      if (vertical.align !== undefined) {
        if (![0, 2].includes(vertical.relativeFrom) || ![0, 1, 4].includes(vertical.align))
          unsupported();
      } else if (
        vertical.posOffset === undefined &&
        vertical.percent !== undefined &&
        vertical.relativeFrom !== 0
      )
        unsupported();
      if (
        horizontal.align === undefined &&
        horizontal.percent === undefined &&
        horizontal.posOffset === undefined
      )
        horizontal.posOffset = 0;
      if (
        vertical.align === undefined &&
        vertical.percent === undefined &&
        vertical.posOffset === undefined
      )
        vertical.posOffset = 0;
    }
    for (const name of ['distL', 'distR', 'distT', 'distB'] as const)
      if (drawing[name] != null) number(drawing[name]);
    if (
      nonempty(drawing.effectExtent) ||
      nonempty(drawing.drawingMLSizeScale) ||
      nonempty(raw.crop) ||
      raw.geometry
    )
      unsupported();
    if (raw.opacity != null) number(raw.opacity, 0, 1);
    if (raw.srcRect != null) {
      const source = record(raw.srcRect);
      if (Object.keys(source).some((key) => !['left', 'top', 'right', 'bottom'].includes(key)))
        invalid();
      const crop = {
        left: number(source.left ?? 0, -100_000),
        top: number(source.top ?? 0, -100_000),
        right: number(source.right ?? 0, -100_000),
        bottom: number(source.bottom ?? 0, -100_000),
      };
      if (
        transform.size.width! + crop.left + crop.right <= 0 ||
        transform.size.height! + crop.top + crop.bottom <= 0
      )
        invalid();
      raw.srcRect = crop;
    }
    if (drawing.hidden !== true) sources.push(raw.source);
  }
  snapshot.drawingsOrder = [...order];
  return [...new Set(sources)];
}

export function prepareDocSnapshot(
  snapshot: IDocumentData,
  formulas: readonly PreparedDocFormula[] = [],
  limits: Readonly<PrintLimits>,
  check: () => void,
) {
  // Aggregate inspection precedes structuredClone and never invokes accessors.
  inspectSnapshot({ snapshot, formulas }, limits, check);
  record(snapshot);
  if (!snapshot.body || !snapshot.documentStyle) invalid();
  const owned = structuredClone(snapshot);
  const prepared = structuredClone(formulas);
  for (const name of ['notes', 'noteSettings', 'footnotes', 'endnotes', 'resources'] as const)
    if (nonempty(owned[name])) unsupported();
  for (const style of Object.values(owned.styles ?? {})) {
    textStyle(style.textStyle);
    paragraphStyle(style.paragraphStyle);
  }
  const sourceFlavor = owned.documentStyle.documentFlavor;
  const sourceGeometry = fixedDocSourceGeometry(owned);
  documentStyle(owned.documentStyle);
  pruneUnusedDocStories(owned, check);
  const imageGroups = prepareDocImageGroups(owned, limits, check, (view, repeated) =>
    imageSources(view, limits, repeated),
  );
  isolateDocStoryGeometry(owned, limits, check);
  const stories = docStories(owned, true, limits, check);
  const sources: string[] = [];
  let characters = 0;
  let images = 0;
  for (const story of stories) {
    check();
    const item = story.snapshot;
    const markers = story.kind === 'body' ? undefined : prepareDocStoryFields(item);
    validateBody(item, limits, check, markers);
    projectDocHyperlinks(item, limits, check);
    if (story.kind === 'body') {
      prepareDocColumnBreaks(item, limits, check);
      projectDocFormulas(item, prepared, limits, check);
      validateBody(item, limits, check);
    }
    characters += item.body!.dataStream.length;
    images += Object.keys(item.drawings ?? {}).length;
    if (characters > limits.textCharacters || images > limits.images)
      throw new PrintError('limit', 'PDF document stories exceed their resource budget.');
    sources.push(...imageSources(item, limits, story.kind !== 'body'));
  }
  replaceDocStories(owned, stories);
  for (const style of [owned.documentStyle, ...(owned.body!.sectionBreaks ?? [])]) {
    for (const key of ['defaultHeaderId', 'evenPageHeaderId', 'firstPageHeaderId'] as const)
      if (style[key] && !Object.hasOwn(owned.headers ?? {}, style[key])) invalid();
    for (const key of ['defaultFooterId', 'evenPageFooterId', 'firstPageFooterId'] as const)
      if (style[key] && !Object.hasOwn(owned.footers ?? {}, style[key])) invalid();
  }
  // The renderer uses fixed metadata; remove unrelated document identity from
  // its owned model as well, without touching the caller's snapshot.
  owned.id = 'print-document';
  delete owned.title;
  delete owned.rev;
  for (const drawing of Object.values(owned.drawings ?? {})) {
    drawing.unitId = owned.id;
    drawing.subUnitId = owned.id;
    delete drawing.title;
    delete drawing.name;
    delete drawing.description;
  }
  for (const table of Object.values(owned.tableSource ?? {})) delete table.description;
  inspectSnapshot(owned, limits, check);
  return {
    snapshot: owned,
    imageSources: docGroupImageSources(sources, imageGroups),
    imageGroups,
    sourceFlavor,
    sourceGeometry,
  };
}

/** Alias every effective face, including heading inheritance and generated lists. */
export function prepareDocFonts(
  snapshot: IDocumentData,
  fonts: PreparedFonts,
  limits: Readonly<PrintLimits>,
  check: () => void,
) {
  const stories = docStories(snapshot, true, limits, check);
  for (const [index, story] of stories.entries())
    prepareDocBodyFonts(story.snapshot, fonts, limits, check, index);
  replaceDocStories(snapshot, stories);
  inspectSnapshot(snapshot, limits, check);
}

function prepareDocBodyFonts(
  snapshot: IDocumentData,
  fonts: PreparedFonts,
  limits: Readonly<PrintLimits>,
  check: () => void,
  storyIndex: number,
) {
  const body = snapshot.body!;
  const style = snapshot.documentStyle;
  const originalBase: ITextStyle = { fs: DEFAULT_STYLES.fs, bl: 0, it: 0, ...style.textStyle };
  const styles = snapshot.styles ?? {};
  const resolveTextStyle = (id: string | undefined, ancestors = new Set<string>()): ITextStyle => {
    if (id === undefined) return {};
    if (!Object.hasOwn(styles, id) || ancestors.has(id) || ancestors.size > 64) invalid();
    ancestors.add(id);
    const entry = styles[id];
    return { ...resolveTextStyle(entry.basedOn, ancestors), ...entry.textStyle };
  };
  const aliased = (text: string, input: ITextStyle): ITextRun[] => {
    check();
    textStyle(input);
    const displayed = getTextWithCaps(text, Boolean(input.caps || input.smallCaps));
    if (displayed.length !== text.length) unsupported();
    const output: ITextRun[] = [];
    const pieces = input.eastAsiaFontFamily
      ? [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(displayed)].map(
          (part) => ({
            text: part.segment,
            start: part.index,
            family:
              /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}]/u.test(
                part.segment,
              )
                ? input.eastAsiaFontFamily
                : input.ff,
          }),
        )
      : [{ text: displayed, start: 0, family: input.ff }];
    for (const piece of pieces)
      for (const run of fonts.runs(
        piece.text,
        piece.family ?? undefined,
        input.bl === 1,
        input.it === 1,
      ))
        output.push({
          st: piece.start + run.start,
          ed: piece.start + run.end,
          ts: { ...input, ff: run.family, eastAsiaFontFamily: run.family },
        });
    return output;
  };
  const single = (text: string, input: ITextStyle) => {
    const runs = aliased(text, input);
    if (new Set(runs.map((run) => run.ts?.ff)).size !== 1) unsupported();
    return runs[0].ts!;
  };
  const originalLists = { ...PRESET_LIST_TYPE, ...snapshot.lists };
  const lists: Record<string, IListData> = {};
  const listCache = new Map<string, string>();
  const paragraphStyles: ITextStyle[] = [];
  const paragraphListStyles: (ITextStyle | undefined)[] = [];
  let markerCharacters = body.dataStream.length;
  const markerAlphabet = (level: IListData['nestingLevel'][number]) =>
    level.glyphSymbol ??
    (level.glyphType === 1
      ? ''
      : level.glyphType === 4
        ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        : level.glyphType === 5
          ? 'abcdefghijklmnopqrstuvwxyz'
          : level.glyphType === 6
            ? 'IVXLCDM'
            : level.glyphType === 7
              ? 'ivxlcdm'
              : level.glyphType
                ? '0123456789'
                : '●');
  for (const paragraph of body.paragraphs!) {
    check();
    resolveTextStyle(paragraph.styleId); // Detect cycles before native style resolution.
    const resolved = resolveDocumentParagraphStyle(style, paragraph.paragraphStyle, {
      styles,
      paragraphStyleId: paragraph.styleId,
    });
    const named =
      !paragraph.styleId && resolved.namedStyleType
        ? NAMED_STYLE_MAP[resolved.namedStyleType]
        : undefined;
    const list = paragraph.bullet ? originalLists[paragraph.bullet.listType] : undefined;
    if (paragraph.bullet) {
      if (
        !list ||
        !Array.isArray(list.nestingLevel) ||
        list.nestingLevel.length > 9 ||
        !list.nestingLevel[paragraph.bullet.nestingLevel]
      )
        unsupported();
      for (const level of list.nestingLevel) {
        record(level);
        integer(level.startNumber, 0, limits.rows);
        if (
          typeof level.glyphFormat !== 'string' ||
          level.glyphFormat.length > 256 ||
          (typeof level.glyphSymbol !== 'string' && level.glyphSymbol !== undefined)
        )
          invalid();
      }
    }
    const effective: ITextStyle = {
      ...originalBase,
      ...named,
      ...resolveTextStyle(paragraph.styleId),
      ...resolved.textStyle,
      ...list?.nestingLevel[0]?.paragraphProperties?.textStyle,
    };
    paragraphStyles.push(effective);
    paragraphListStyles.push(list?.nestingLevel[0]?.paragraphProperties?.textStyle);
    if (paragraph.bullet) {
      if (
        !list ||
        !Array.isArray(list.nestingLevel) ||
        list.nestingLevel.length > 9 ||
        !list.nestingLevel[paragraph.bullet.nestingLevel]
      )
        unsupported();
      const used = list.nestingLevel[paragraph.bullet.nestingLevel];
      markerCharacters +=
        used.glyphSymbol?.length ??
        used.glyphFormat.length +
          [...used.glyphFormat.matchAll(/%(\d+)/gu)].reduce((sum, match) => {
            const level = list.nestingLevel[Number(match[1]) - 1];
            if (!level) invalid();
            return (
              sum +
              (level.glyphSymbol?.length ??
                (level.glyphType === 6 || level.glyphType === 7
                  ? Math.ceil((limits.rows + level.startNumber) / 1000) + 16
                  : 16))
            );
          }, 0);
      if (markerCharacters > limits.textCharacters)
        throw new PrintError('limit', 'PDF list markers exceed their character budget.');
      const key = JSON.stringify([
        paragraph.bullet.listType,
        effective,
        paragraph.bullet.textStyle,
      ]);
      let listType = listCache.get(key);
      if (!listType) {
        listType = `print-list-${storyIndex}-${listCache.size}`;
        const copy = structuredClone(list);
        copy.listType = listType;
        for (const level of copy.nestingLevel) {
          check();
          integer(level.startNumber, 0, limits.rows);
          paragraphStyle(level.paragraphProperties);
          if (
            typeof level.glyphFormat !== 'string' ||
            level.glyphFormat.length > 256 ||
            (typeof level.glyphSymbol !== 'string' && level.glyphSymbol !== undefined)
          )
            invalid();
          if (level.glyphSymbol && level.glyphSymbol.length > 256) invalid();
          if (level.glyphType != null && ![0, 1, 2, 3, 4, 5, 6, 7].includes(level.glyphType))
            unsupported();
          if (level.glyphFormat.replace(/%\d+/gu, '').includes('%')) invalid();
          for (const match of level.glyphFormat.matchAll(/%(\d+)/gu))
            if (Number(match[1]) < 1 || Number(match[1]) > copy.nestingLevel.length) invalid();
          const characters =
            level.glyphSymbol ??
            level.glyphFormat.replace(/%(\d+)/gu, (_match, index) =>
              markerAlphabet(copy.nestingLevel[Number(index) - 1]),
            );
          const marker = { ...effective, ...paragraph.bullet.textStyle, ...level.textStyle };
          level.textStyle = single(characters || ' ', marker);
          if (level.paragraphProperties) delete level.paragraphProperties.textStyle;
        }
        lists[listType] = copy;
        listCache.set(key, listType);
      }
      paragraph.bullet.listType = listType;
      delete paragraph.bullet.textStyle; // Fully materialized in the selected list level.
    }
    paragraph.paragraphStyle = { ...resolved, textStyle: single(' ', effective) };
    if (resolved.paragraphMarkTextStyle)
      paragraph.paragraphStyle.paragraphMarkTextStyle = single(' ', {
        ...effective,
        ...resolved.paragraphMarkTextStyle,
      });
    // Retain styleId for native contextual paragraph spacing. The effective text
    // is fully explicit; definitions remain harmless after aliasing below.
  }
  const boundaries = new Set([0, body.dataStream.length]);
  for (const run of body.textRuns ?? []) {
    boundaries.add(run.st);
    boundaries.add(run.ed);
  }
  for (const paragraph of body.paragraphs!) {
    boundaries.add(paragraph.startIndex);
    boundaries.add(paragraph.startIndex + 1);
  }
  const points = [...boundaries].sort((a, b) => a - b);
  const originalRuns = body.textRuns ?? [];
  const runs: ITextRun[] = [];
  let runIndex = 0;
  let paragraphIndex = 0;
  for (let index = 0; index < points.length - 1; index++) {
    check();
    const start = points[index],
      end = points[index + 1];
    while (runIndex < originalRuns.length && originalRuns[runIndex].ed <= start) runIndex++;
    while (
      paragraphIndex < body.paragraphs!.length - 1 &&
      body.paragraphs![paragraphIndex].startIndex < start
    )
      paragraphIndex++;
    const run = originalRuns[runIndex];
    const paragraph = body.paragraphs![paragraphIndex];
    const effective = {
      ...paragraphStyles[paragraphIndex],
      ...(run && run.st <= start ? { ...resolveTextStyle(run.sId), ...run.ts } : {}),
      ...(start === paragraph.startIndex ? paragraph.paragraphStyle?.paragraphMarkTextStyle : {}),
      ...paragraphListStyles[paragraphIndex],
    };
    // Paragraph-mark style was aliased above. Resolve it from its original face
    // through the adjacent paragraph text, then preserve its already-aliased run.
    if (start === paragraph.startIndex && paragraph.paragraphStyle?.paragraphMarkTextStyle) {
      runs.push({ st: start, ed: end, ts: effective });
    } else
      for (const mapped of aliased(body.dataStream.slice(start, end), effective))
        runs.push({ ...mapped, st: start + mapped.st, ed: start + mapped.ed });
    if (runs.length > limits.snapshotNodes)
      throw new PrintError('limit', 'PDF font projection exceeds its entry budget.');
  }
  body.textRuns = runs;
  snapshot.lists = lists;
  style.textStyle = single(' ', originalBase);
  // All referenced paragraph/character style text is materialized in runs. Keep
  // only paragraph properties needed for native contextual-style identity.
  for (const entry of Object.values(styles)) {
    delete entry.textStyle;
    if (entry.paragraphStyle) {
      delete entry.paragraphStyle.textStyle;
      delete entry.paragraphStyle.paragraphMarkTextStyle;
    }
  }
  inspectSnapshot(snapshot, limits, check);
}
