/** Public native text layout and ink measurement; no replacement shaping engine. */
import {
  DEFAULT_STYLES,
  HorizontalAlign,
  TabStopLeader,
  WrapStrategy,
  createDocumentModelWithStyle,
  getDisplayValueFromCell,
} from '@univerjs/core';
import type {
  ICellDataForSheetInterceptor,
  IDocumentData,
  IParagraphStyle,
  IStyleData,
  ITextRun,
  ITextStyle,
} from '@univerjs/core';
import {
  DEFAULT_PADDING_DATA,
  DocSimpleSkeleton,
  SpreadsheetSkeleton,
  UniverPrintingContext,
  getDocsSkeletonPageSize,
  getTextWithCaps,
  glyphIterator,
  lineIterator,
  shouldRenderRowText,
} from '@univerjs/engine-render';
import type {
  IDrawInfo,
  IFontCacheItem,
  IViewportInfo,
  Spreadsheet,
} from '@univerjs/engine-render';
import { createCanvas } from '@napi-rs/canvas';
import type { SKRSContext2D } from '@napi-rs/canvas';
import { PrintError } from './contract.ts';
import type { PrintBox, PrintLimits } from './contract.ts';
import { PreparedFonts } from './fonts.ts';
import { unionBox } from './preflight.ts';

function unsupported(message = 'PDF text exceeds its supported cell bounds.'): never {
  throw new PrintError('unsupported', message);
}

/** Match the admitted axis domain before native paragraph/shaping work begins. */
function boundedGeometry(value: unknown, minimum = -100_000, maximum = 100_000) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new PrintError('invalid-input', 'Invalid PDF text geometry.');
  if (value < minimum || value > maximum)
    throw new PrintError('limit', 'PDF text geometry exceeds its layout budget.');
}

function paragraphGeometry(style: IParagraphStyle | undefined) {
  if (!style) return;
  boundedGeometry(style.defaultTabStop, 0);
  boundedGeometry(style.lineSpacing, 0);
  for (const name of [
    'spaceAbove',
    'spaceBelow',
    'indentFirstLine',
    'hanging',
    'indentStart',
    'indentEnd',
  ] as const)
    boundedGeometry(style[name]?.v);
  for (const stop of style.tabStops ?? []) {
    boundedGeometry(stop.offset, 0);
    tabLeader(stop.leader);
  }
  for (const name of [
    'borderBetween',
    'borderTop',
    'borderBottom',
    'borderLeft',
    'borderRight',
  ] as const) {
    boundedGeometry(style[name]?.padding, 0);
    boundedGeometry(style[name]?.width, 0, 512);
  }
}

function tabLeader(leader: TabStopLeader | undefined) {
  if (
    leader != null &&
    ![TabStopLeader.TAB_STOP_LEADER_UNSPECIFIED, TabStopLeader.NONE].includes(leader)
  )
    unsupported('PDF rich-text tab leaders require a prepared representation.');
}

function validStyle(style: ITextStyle) {
  if (style.fs !== undefined && (!Number.isFinite(style.fs) || style.fs <= 0 || style.fs > 512))
    throw new PrintError('limit', 'PDF font size exceeds its layout budget.');
  boundedGeometry(style.sc);
  boundedGeometry(style.pos);
  boundedGeometry(style.sa, 1, 1_000);
  boundedGeometry(style.kerning, 0, 512);
  tabLeader(style.positionedTab?.leader);
  // These document-only paint models can introduce images or effect surfaces.
  // They are not native Sheet rich-text formatting and are not silently flattened.
  if (style.symbol || style.textFill || style.textOutline || style.glow || style.outerShadow)
    unsupported('PDF rich text contains an unsupported paint model.');
}

function aliasedRuns(text: string, style: ITextStyle, fonts: PreparedFonts): ITextRun[] {
  style = { ...style, fs: style.fs ?? DEFAULT_STYLES.fs, bl: style.bl ?? 0, it: style.it ?? 0 };
  validStyle(style);
  // Cmap admission must cover the glyphs the native painter will actually use.
  // Keep authored text and UTF-16 run indices; the public Office casing helper
  // preserves one source character (including ß) instead of expanding strings.
  const displayed = getTextWithCaps(text, Boolean(style.caps || style.smallCaps));
  if (displayed.length !== text.length)
    unsupported('PDF display casing changes unsupported text-run indices.');
  const result: ITextRun[] = [];
  const pieces = style.eastAsiaFontFamily
    ? [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(displayed)].map(
        (part) => ({
          text: part.segment,
          start: part.index,
          family:
            /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}]/u.test(
              part.segment,
            )
              ? style.eastAsiaFontFamily!
              : style.ff,
        }),
      )
    : [{ text: displayed, start: 0, family: style.ff }];
  for (const piece of pieces) {
    for (const run of fonts.runs(
      piece.text,
      piece.family ?? undefined,
      style.bl === 1,
      style.it === 1,
    )) {
      result.push({
        st: piece.start + run.start,
        ed: piece.start + run.end,
        ts: { ...style, ff: run.family, eastAsiaFontFamily: run.family },
      });
    }
  }
  return result;
}

function plainDocument(text: string, style: IStyleData): IDocumentData {
  const content = text.replace(/\r\n|[\r\n\u0085\u2028\u2029]/gu, '\r');
  const model = createDocumentModelWithStyle(content, style);
  try {
    return structuredClone(model.getSnapshot());
  } finally {
    model.dispose();
  }
}

/** Every painted run names one admitted face, including explicit fallback. */
export function prepareCellText(
  cell: ICellDataForSheetInterceptor,
  fonts: PreparedFonts,
): ICellDataForSheetInterceptor {
  if (cell.fontRenderExtension)
    unsupported('PDF cell render extensions require a prepared representation.');
  const style: IStyleData = {
    ...(cell.s as IStyleData | null),
    fs: (cell.s as IStyleData | null)?.fs ?? DEFAULT_STYLES.fs,
    bl: (cell.s as IStyleData | null)?.bl ?? 0,
    it: (cell.s as IStyleData | null)?.it ?? 0,
  };
  validStyle(style);
  boundedGeometry(style.tr?.a, -360, 360);
  for (const side of ['t', 'r', 'b', 'l'] as const) boundedGeometry(style.pd?.[side], 0);
  const text = getDisplayValueFromCell(cell);
  if (
    text
      .split('')
      .some(
        (character) =>
          character.charCodeAt(0) < 32 && ![9, 10, 13].includes(character.charCodeAt(0)),
      )
  )
    unsupported('PDF text contains an unsupported control character.');
  const runs = aliasedRuns(cell.p ? ' ' : text || ' ', style, fonts);
  const firstFamily = runs[0]?.ts?.ff;
  const mappedStyle = { ...style, ff: firstFamily, eastAsiaFontFamily: firstFamily };
  if (
    !cell.p &&
    !/[\t\r\n\u0085\u2028\u2029]/u.test(text) &&
    runs.every((run) => run.ts?.ff === firstFamily)
  )
    return { ...cell, s: mappedStyle };

  const document = cell.p ? structuredClone(cell.p) : plainDocument(text, style);
  boundedGeometry(document.documentStyle?.defaultTabStop, 0);
  boundedGeometry(document.documentStyle?.paragraphLineGapDefault, 0);
  boundedGeometry(document.documentStyle?.hyphenationZone, 0);
  paragraphGeometry(document.documentStyle?.defaultParagraphStyle);
  const body = document.body;
  if (!body || typeof body.dataStream !== 'string' || !body.dataStream.endsWith('\r\n'))
    throw new PrintError('invalid-input', 'Invalid PDF rich-text stream.');
  const stream = body.dataStream;
  if (
    stream.split('').some((character, index) => {
      const point = character.codePointAt(0)!;
      return (
        (point < 32 && ![9, 10, 13].includes(point)) ||
        (point === 10 && index !== stream.length - 1)
      );
    }) ||
    body.tables?.length ||
    body.customBlocks?.length ||
    document.drawingsOrder?.length ||
    Object.keys(document.drawings ?? {}).length ||
    document.documentStyle?.background ||
    Object.keys(document.documentStyle?.fontFamilyFallbacks ?? {}).length
  )
    unsupported('PDF rich text contains an unsupported embedded model.');

  const paragraphMap = new Map<number, NonNullable<typeof body.paragraphs>[number]>();
  for (const paragraph of body.paragraphs ?? []) {
    paragraphGeometry(paragraph.paragraphStyle);
    if (
      !Number.isSafeInteger(paragraph.startIndex) ||
      stream[paragraph.startIndex] !== '\r' ||
      paragraphMap.has(paragraph.startIndex)
    )
      throw new PrintError('invalid-input', 'Invalid PDF rich-text paragraph.');
    if (paragraph.bullet || paragraph.paragraphStyle?.namedStyleType)
      unsupported('PDF rich text requires explicit paragraph formatting.');
    paragraphMap.set(paragraph.startIndex, paragraph);
  }
  body.paragraphs = [];
  const paragraphIds = new Set(
    [...paragraphMap.values()].map((paragraph) => paragraph.paragraphId),
  );
  for (let index = 0; index < stream.length; index++) {
    if (stream[index] !== '\r') continue;
    const existing = paragraphMap.get(index);
    if (existing) body.paragraphs.push(existing);
    else {
      let paragraphId = `print-paragraph-${index}`;
      while (paragraphIds.has(paragraphId)) paragraphId += '-generated';
      paragraphIds.add(paragraphId);
      body.paragraphs.push({ startIndex: index, paragraphId });
    }
  }
  if (
    (body.sectionBreaks ?? []).some(
      (section) =>
        section.startIndex !== stream.length - 1 ||
        Object.keys(section).some((key) => !['startIndex', 'sectionId'].includes(key)),
    )
  )
    unsupported('PDF cell text cannot contain document section breaks.');

  const base: ITextStyle = { ...style, ...document.documentStyle?.textStyle };
  const original = body.textRuns ?? [];
  const boundaries = new Set([0, stream.length]);
  const graphemes = new Set([0, stream.length]);
  for (const part of new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(stream))
    graphemes.add(part.index);
  for (let index = 0; index < stream.length; index++)
    if (['\r', '\n'].includes(stream[index])) graphemes.add(index);
  let previous = 0;
  for (const run of original) {
    if (
      !Number.isSafeInteger(run.st) ||
      !Number.isSafeInteger(run.ed) ||
      run.st < previous ||
      run.ed < run.st ||
      run.ed > stream.length ||
      !graphemes.has(run.st) ||
      !graphemes.has(run.ed)
    )
      throw new PrintError('invalid-input', 'Invalid PDF rich-text run.');
    previous = run.ed;
    boundaries.add(run.st);
    boundaries.add(run.ed);
  }
  for (const paragraph of body.paragraphs) boundaries.add(paragraph.startIndex + 1);
  const points = [...boundaries].sort((a, b) => a - b);
  const normalized: ITextRun[] = [];
  let runIndex = 0,
    paragraphIndex = 0;
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index],
      end = points[index + 1];
    while (runIndex < original.length && original[runIndex].ed <= start) runIndex++;
    while (
      paragraphIndex < body.paragraphs.length - 1 &&
      body.paragraphs[paragraphIndex].startIndex < start
    )
      paragraphIndex++;
    const paragraph = body.paragraphs[paragraphIndex];
    const run = original[runIndex];
    const effective = {
      ...base,
      ...paragraph?.paragraphStyle?.textStyle,
      ...(run && run.st <= start ? run.ts : {}),
    };
    for (const prepared of aliasedRuns(stream.slice(start, end), effective, fonts))
      normalized.push({ ...prepared, st: start + prepared.st, ed: start + prepared.ed });
  }
  body.textRuns = normalized;
  const defaultStyle = aliasedRuns(' ', base, fonts)[0].ts;
  document.documentStyle = { ...document.documentStyle, textStyle: defaultStyle };
  for (const paragraph of body.paragraphs) {
    if (paragraph.paragraphStyle?.textStyle)
      paragraph.paragraphStyle.textStyle = aliasedRuns(
        ' ',
        { ...base, ...paragraph.paragraphStyle.textStyle },
        fonts,
      )[0].ts;
    if (paragraph.paragraphStyle?.paragraphMarkTextStyle)
      paragraph.paragraphStyle.paragraphMarkTextStyle = aliasedRuns(
        ' ',
        { ...base, ...paragraph.paragraphStyle.paragraphMarkTextStyle },
        fonts,
      )[0].ts;
  }
  return { ...cell, s: mappedStyle, p: document };
}

/** Printing's normal range excludes partial final rows; export must continue them. */
export class PrintSkeleton extends SpreadsheetSkeleton {
  override getCacheRangeByViewport(view?: IViewportInfo, _isPrinting?: boolean) {
    const bound = view?.cacheBound;
    // The public inclusive lookup rounds coordinates. Round the query outwards
    // first so a fractional page seam never drops the remaining row/column tail.
    return super.getRangeByViewBound(
      bound && {
        left: Math.floor(bound.left),
        top: Math.floor(bound.top),
        right: Math.ceil(bound.right),
        bottom: Math.ceil(bound.bottom),
      },
    );
  }
}

function completeText(
  skeleton: SpreadsheetSkeleton,
  row: number,
  column: number,
  font: IFontCacheItem,
  limits: Readonly<PrintLimits>,
  check: () => void,
) {
  check();
  const cell = skeleton.getCellWithCoordByIndex(row, column);
  const bounds = cell.isMergedMainCell ? cell.mergeInfo : cell;
  const width = bounds.endX - bounds.startX,
    height = bounds.endY - bounds.startY;
  if (
    !width ||
    !height ||
    (!cell.isMergedMainCell &&
      (!skeleton.worksheet.getRowVisible(row) || !skeleton.worksheet.getColVisible(column)))
  )
    return;
  if (!cell.isMergedMainCell && !shouldRenderRowText(height)) unsupported();
  const padding = font.style?.pd;
  const top = padding?.t ?? DEFAULT_PADDING_DATA.t,
    bottom = padding?.b ?? DEFAULT_PADDING_DATA.b;
  const left = padding?.l ?? DEFAULT_PADDING_DATA.l,
    right = padding?.r ?? DEFAULT_PADDING_DATA.r;
  if (![top, bottom, left, right].every((value) => Number.isFinite(value) && value >= 0))
    throw new PrintError('invalid-input', 'Invalid PDF text padding.');
  const native = font.documentSkeleton;
  if (native) {
    const model = native.getViewModel().getDataModel();
    const wrap = font.wrapStrategy === WrapStrategy.WRAP;
    if (
      !font.vertexAngle &&
      (wrap ||
        [HorizontalAlign.JUSTIFIED, HorizontalAlign.DISTRIBUTED].includes(font.horizontalAlign))
    ) {
      model.updateDocumentDataPageSize(width);
      native.calculate();
    } else if (!wrap && (model.getBody()?.paragraphs?.length ?? 0) > 1) {
      model.updateDocumentDataPageSize(Infinity);
      native.calculate();
      const size = getDocsSkeletonPageSize(native);
      if (!size) unsupported();
      model.updateDocumentDataPageSize(size.width + left + right);
      native.calculate();
    }
    check();
    const data = native.getSkeletonData();
    const stream = model.getBody()?.dataStream ?? '';
    if (!data || data.pages.length !== 1)
      unsupported('PDF cell text requires one continuous native layout.');
    const covered = new Uint8Array(stream.length);
    let glyphs = 0;
    lineIterator(data.pages, (line) => {
      check();
      if (
        ![line.st, line.ed, line.top, line.lineHeight].every(Number.isFinite) ||
        line.st < 0 ||
        line.ed >= stream.length ||
        line.ed < line.st
      )
        unsupported();
      covered.fill(1, line.st, line.ed + 1);
    });
    glyphIterator(data.pages, (glyph) => {
      check();
      if (++glyphs > limits.textCharacters * 4 || !Number.isFinite(glyph.width) || glyph.width < 0)
        throw new PrintError('limit', 'PDF glyph layout exceeds its budget.');
    });
    for (let index = 0; index < stream.length; index++)
      if (!covered[index] && !['\r', '\n'].includes(stream[index]))
        unsupported('PDF rich-text layout is incomplete.');
    const size = getDocsSkeletonPageSize(native, font.vertexAngle ?? 0);
    if (
      !size ||
      ![size.width, size.height].every((value) => Number.isFinite(value) && value >= 0) ||
      size.height + top + bottom > height + 0.01
    )
      unsupported();
  } else {
    const text = font.displayText ?? getDisplayValueFromCell(font.cellData);
    if (!text) return;
    const wrap = font.wrapStrategy === WrapStrategy.WRAP;
    const available = width - left - right;
    if (available <= 0) unsupported();
    const measured = new DocSimpleSkeleton(
      text,
      font.fontString,
      wrap,
      available,
      Infinity,
      skeleton.textLineGap,
    );
    const lines = measured.calculate();
    check();
    if (lines.map((line) => line.text).join('') !== text)
      unsupported('PDF wrapped text is incomplete.');
    const boundaries = new Set([0, text.length]);
    for (const part of new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text))
      boundaries.add(part.index);
    let offset = 0;
    for (const line of lines) {
      offset += line.text.length;
      if (!boundaries.has(offset)) unsupported('PDF wrapped text splits a grapheme.');
    }
    if (
      measured.getTotalHeight() + top + bottom > height + 0.01 ||
      (wrap && measured.getTotalWidth() > available + 0.01)
    )
      unsupported();
  }
}

function intersect(a: PrintBox | null, b: PrintBox): PrintBox | null {
  if (!a) return b;
  const box = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
  return box;
}

/** Measure native paint coordinates without allocating a worksheet-size raster. */
export class InkContext extends UniverPrintingContext {
  bounds: PrintBox | null = null;
  private clipBox: PrintBox | null = null;
  private path: PrintBox | null = null;
  private saved: (PrintBox | null)[] = [];
  readonly raw: SKRSContext2D;
  readonly check: () => void;
  readonly onTextInk: ((box: PrintBox) => void) | undefined;
  readonly onHorizontalInk: ((box: PrintBox) => void) | undefined;
  constructor(
    raw: SKRSContext2D,
    check: () => void,
    onTextInk?: (box: PrintBox) => void,
    onHorizontalInk?: (box: PrintBox) => void,
  ) {
    super(raw as unknown as CanvasRenderingContext2D);
    this.raw = raw;
    this.check = check;
    this.onTextInk = onTextInk;
    this.onHorizontalInk = onHorizontalInk;
  }
  private box(left: number, top: number, right: number, bottom: number): PrintBox {
    const matrix = this.raw.getTransform();
    const points = [
      [left, top],
      [right, top],
      [left, bottom],
      [right, bottom],
    ].map(([x, y]) => ({
      x: matrix.a * x + matrix.c * y + matrix.e,
      y: matrix.b * x + matrix.d * y + matrix.f,
    }));
    const result = {
      left: Math.min(...points.map((point) => point.x)),
      right: Math.max(...points.map((point) => point.x)),
      top: Math.min(...points.map((point) => point.y)),
      bottom: Math.max(...points.map((point) => point.y)),
    };
    if (!Object.values(result).every(Number.isFinite)) unsupported();
    return result;
  }
  override save() {
    this.saved.push(this.clipBox);
    super.save();
  }
  override restore() {
    this.clipBox = this.saved.pop() ?? null;
    super.restore();
  }
  override beginPath() {
    this.path = null;
    super.beginPath();
  }
  override rect(x: number, y: number, width: number, height: number) {
    const box = this.box(x, y, x + width, y + height);
    this.path = this.path
      ? {
          left: Math.min(this.path.left, box.left),
          right: Math.max(this.path.right, box.right),
          top: Math.min(this.path.top, box.top),
          bottom: Math.max(this.path.bottom, box.bottom),
        }
      : box;
    super.rect(x, y, width, height);
  }
  override clip(...args: unknown[]) {
    if (
      !this.path ||
      args.some((argument) => argument !== undefined && typeof argument !== 'string')
    )
      unsupported('PDF text uses an unsupported clipping path.');
    this.clipBox = intersect(this.clipBox, this.path);
    // The 1x1 measurement surface is never published; the native paint positions
    // above, rather than pixels clipped by that surface, are the evidence here.
  }
  override moveTo(x: number, y: number) {
    this.point(x, y);
    super.moveTo(x, y);
  }
  override lineTo(x: number, y: number) {
    this.point(x, y);
    super.lineTo(x, y);
  }
  private point(x: number, y: number) {
    const box = this.box(x, y, x, y);
    this.path = this.path
      ? {
          left: Math.min(this.path.left, box.left),
          right: Math.max(this.path.right, box.right),
          top: Math.min(this.path.top, box.top),
          bottom: Math.max(this.path.bottom, box.bottom),
        }
      : box;
  }
  override stroke() {
    if (!this.path) return;
    const transform = this.raw.getTransform();
    const radius =
      (this.raw.lineWidth / 2) *
      Math.max(Math.hypot(transform.a, transform.b), Math.hypot(transform.c, transform.d));
    const box = {
      left: this.path.left - radius,
      top: this.path.top - radius,
      right: this.path.right + radius,
      bottom: this.path.bottom + radius,
    };
    const visible = intersect(this.clipBox, box);
    if (visible && visible.right > visible.left && visible.bottom > visible.top) {
      if (this.path.bottom - this.path.top < 0.001) this.onHorizontalInk?.(visible);
      this.bounds = unionBox(this.bounds, visible);
    }
  }
  override fillRect(x: number, y: number, width: number, height: number) {
    this.check();
    if (!width || !height || this.raw.globalAlpha === 0) return;
    // Native rich-text highlights include glyph spacing and trailing spaces.
    // Their painted rectangle can extend beyond the last glyph's ink bounds.
    const box = intersect(this.clipBox, this.box(x, y, x + width, y + height));
    if (box && box.right > box.left && box.bottom > box.top)
      this.bounds = unionBox(this.bounds, box);
  }
  override fillText(text: string, x: number, y: number, maxWidth?: number) {
    this.text(text, x, y, maxWidth, false);
  }
  override fillTextPrecision(text: string, x: number, y: number, maxWidth?: number) {
    this.text(text, x, y, maxWidth, false);
  }
  override strokeText(text: string, x: number, y: number, maxWidth?: number) {
    this.text(text, x, y, maxWidth, true);
  }
  private text(text: string, x: number, y: number, maxWidth: number | undefined, stroke: boolean) {
    this.check();
    if (!text || this.raw.globalAlpha === 0) return;
    const metrics = this.raw.measureText(text);
    const squeeze =
      maxWidth !== undefined && maxWidth < metrics.width ? maxWidth / metrics.width : 1;
    const radius = stroke ? this.raw.lineWidth / 2 : 0;
    const box = this.box(
      x - metrics.actualBoundingBoxLeft * squeeze - radius,
      y - metrics.actualBoundingBoxAscent - radius,
      x + metrics.actualBoundingBoxRight * squeeze + radius,
      y + metrics.actualBoundingBoxDescent + radius,
    );
    if (box.right <= box.left || box.bottom <= box.top) return;
    if (
      this.clipBox &&
      (box.left < this.clipBox.left - 0.01 ||
        box.right > this.clipBox.right + 0.01 ||
        box.top < this.clipBox.top - 0.01 ||
        box.bottom > this.clipBox.bottom + 0.01)
    )
      unsupported();
    this.onTextInk?.(box);
    this.bounds = unionBox(this.bounds, box);
  }
  override setLineDash(segments: number[]) {
    super.setLineDash(segments.every((value) => value === 0) ? [] : segments);
  }
}

/** Whole-cell admission first, then native Font and Border paints determine ink. */
export function measureSheetInk(
  spreadsheet: Spreadsheet,
  skeleton: SpreadsheetSkeleton,
  view: IViewportInfo,
  limits: Readonly<PrintLimits>,
  check: () => void,
) {
  skeleton.setStylesCache(view);
  skeleton.stylesCache.fontMatrix.forValue((row, column, font) => {
    completeText(skeleton, row, column, font, limits, check);
    return null;
  });
  const ink = new InkContext(createCanvas(1, 1).getContext('2d'), check);
  const info = {
    viewRanges: [skeleton.getCacheRangeByViewport(view)],
    checkOutOfViewBound: true,
    hasMergeData: skeleton.worksheet.getMergeData().length > 0,
    viewportKey: view.viewportKey,
    viewBound: view.cacheBound,
    diffBounds: [],
  } as IDrawInfo;
  spreadsheet.fontExtension.draw(ink, { scaleX: 1, scaleY: 1 }, skeleton, [], info);
  spreadsheet.borderExtension.draw(ink, { scaleX: 1, scaleY: 1 }, skeleton, [], info);
  check();
  return ink.bounds;
}
