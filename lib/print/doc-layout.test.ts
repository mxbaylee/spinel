import { expect, test } from 'vitest';
import {
  docInput,
  retainDocPdf,
  runDocJobs,
  tableDoc,
  textDoc,
} from './doc-native-test-support.ts';

const summary = (value: unknown) =>
  JSON.stringify(value, (key, item) => (key === 'bytes' ? '<bytes>' : item));
const compact = (text: string) => text.replace(/\s+/gu, '');

test('terminal font padding does not add a page while authored blank and border endings survive', async () => {
  const lines = Array.from(
    { length: 13 },
    (_, index) => `TAIL-${String(index).padStart(2, '0')}-END`,
  );
  const plain = textDoc(lines, { pageSize: { width: 600, height: 396 } });
  const blank = textDoc([...lines, ''], plain.documentStyle);
  const explicit = textDoc([...lines, '\f'], {
    ...plain.documentStyle,
    pageSize: { width: 600, height: 400 },
  });
  const bordered = structuredClone(plain);
  bordered.body!.paragraphs!.at(-1)!.paragraphStyle = {
    borderBottom: { color: { rgb: '#5522bb' }, width: 6, padding: 2, dashStyle: 0 },
  };
  const results = await runDocJobs(
    await Promise.all(
      [plain, blank, explicit, bordered].map(async (snapshot) => ({
        input: await docInput(snapshot),
      })),
    ),
  );
  for (const [index, result] of results.entries()) {
    expect(result, summary(result)).toMatchObject({
      ok: true,
      pages: index === 0 ? 1 : 2,
      restored: true,
      remainingFonts: 0,
    });
    const pages = await retainDocPdf(`terminal-native-extent-${index}`, result.bytes!);
    const text = compact(pages.map((page) => page.text).join(' '));
    for (const line of lines) expect(text.split(line)).toHaveLength(2);
    if (index === 1 || index === 2)
      expect(pages.at(-1)!.pixels.every((value, offset) => offset % 4 === 3 || value === 255)).toBe(
        true,
      );
    if (index === 3) {
      let borderPixels = 0;
      for (const page of pages)
        for (let offset = 0; offset < page.pixels.length; offset += 4) {
          const [r, g, b] = page.pixels.slice(offset, offset + 3);
          if (Math.abs(r - 85) < 3 && Math.abs(g - 34) < 3 && Math.abs(b - 187) < 3) borderPixels++;
        }
      expect(borderPixels).toBeGreaterThan(1_500);
      expect(pages.at(-1)!.text).toContain(lines.at(-1)!);
    }
  }
}, 60_000);

test('literal form feeds create distinct physical boundaries without repeated text', async () => {
  const input = await docInput(
    textDoc(['BEFOREBREAK', '\fAFTERFIRSTBREAK', '\fAFTERSECONDBREAK'], {
      pageSize: { width: 600, height: 400 },
    }),
  );
  const [result] = await runDocJobs([{ input }]);
  expect(result, summary(result)).toMatchObject({
    ok: true,
    pages: 3,
    restored: true,
    remainingFonts: 0,
  });
  const pages = await retainDocPdf('literal-page-breaks', result.bytes!);
  expect(pages.map((page) => compact(page.text))).toEqual([
    'BEFOREBREAK',
    'AFTERFIRSTBREAK',
    'AFTERSECONDBREAK',
  ]);
  const soft = structuredClone(input);
  // The same literal tokens marked as layout-generated remain soft; they are
  // not promoted into authored breaks by this finite print representation.
  soft.snapshot.body!.renderedPageBreaks = [...soft.snapshot.body!.dataStream.matchAll(/\f/g)].map(
    (match) => match.index,
  );
  const [softResult] = await runDocJobs([{ input: soft }]);
  expect(softResult, summary(softResult)).toMatchObject({
    ok: true,
    pages: 1,
    restored: true,
    remainingFonts: 0,
  });
  const softPages = await retainDocPdf('soft-page-breaks', softResult.bytes!);
  expect(compact(softPages[0].text)).toBe('BEFOREBREAKAFTERFIRSTBREAKAFTERSECONDBREAK');
}, 60_000);

test('physical continuation retains a heading keep chain and every kept paragraph line', async () => {
  const prefix = Array.from({ length: 5 }, (_, index) => `PREFIX${index}`);
  const body = `KEPTSTART ${Array.from({ length: 20 }, () => 'word').join(' ')} KEPTEND`;
  const snapshot = textDoc([...prefix, 'KEEPHEADING', body, 'AFTERKEPT'], {
    pageSize: { width: 600, height: 220 },
    marginLeft: 20,
    marginRight: 20,
    marginTop: 20,
    marginBottom: 20,
    textStyle: { ff: 'Atkinson Hyperlegible', fs: 18 },
  });
  // Owner's heading and body remain together whenever the complete group fits
  // one physical page, even when it starts near the preceding page's bottom.
  snapshot.body!.paragraphs![5].paragraphStyle = { keepNext: 1 };
  snapshot.body!.paragraphs![6].paragraphStyle = { keepLines: 1, widowControl: 1 };
  const [result] = await runDocJobs([{ input: await docInput(snapshot) }]);
  expect(result, summary(result)).toMatchObject({ ok: true, restored: true, remainingFonts: 0 });
  const pages = await retainDocPdf('kept-heading-paragraph', result.bytes!);
  const texts = pages.map((page) => compact(page.text));
  const heading = texts.findIndex((text) => text.includes('KEEPHEADING'));
  expect(heading).toBeGreaterThan(0);
  expect(texts.findIndex((text) => text.includes('KEPTSTART'))).toBe(heading);
  expect(texts.findIndex((text) => text.includes('KEPTEND'))).toBe(heading);
  const all = texts.join('');
  for (const marker of [...prefix, 'KEEPHEADING', 'KEPTSTART', 'KEPTEND', 'AFTERKEPT'])
    expect(all.split(marker)).toHaveLength(2);
}, 60_000);

test('saved tall row geometry cannot disappear into a virtual-page clamp', async () => {
  const snapshots = [1, 2].map((hRule) => {
    const snapshot = tableDoc([['Short cell', 'Other cell']], [], 1_000);
    snapshot.documentStyle.pageSize = { width: 600, height: 400 };
    snapshot.tableSource!['native-table'].tableRows[0].trHeight.hRule = hRule;
    return snapshot;
  });
  // Blank row area/background/borders are authored geometry too. A source-text
  // assertion alone would miss native clamping of a tall short-text row.
  const results = await runDocJobs([
    ...(await Promise.all(
      snapshots.map(async (snapshot) => ({
        input: await docInput(snapshot),
        options: { limits: { pages: 3 } },
      })),
    )),
    { input: await docInput(textDoc(['AFTERROWLIMIT'])) },
  ]);
  for (const result of results.slice(0, 2)) {
    expect(result, summary(result)).toMatchObject({
      ok: false,
      code: 'limit',
      restored: true,
      remainingFonts: 0,
    });
    expect(result.bytes).toBeUndefined();
  }
  expect(results[2], summary(results[2])).toMatchObject({
    ok: true,
    restored: true,
    remainingFonts: 0,
  });
  const pages = await retainDocPdf('after-saved-row-limit', results[2].bytes!);
  expect(pages[0].text).toContain('AFTERROWLIMIT');
}, 60_000);

test('a saved exact tall row retains its complete blank area and background on every continuation', async () => {
  const snapshot = tableDoc([['SHORT-EXACT-ROW', 'NEIGHBOR']], [], 700);
  snapshot.documentStyle.pageSize = { width: 600, height: 400 };
  const row = snapshot.tableSource!['native-table'].tableRows[0];
  row.trHeight.hRule = 2;
  row.tableCells[0].backgroundColor = { rgb: '#ccddaa' };
  const [result] = await runDocJobs([{ input: await docInput(snapshot) }]);
  expect(result, summary(result)).toMatchObject({
    ok: true,
    pages: 3,
    restored: true,
    remainingFonts: 0,
  });
  const pages = await retainDocPdf('saved-exact-tall-row', result.bytes!);
  let coloredHeight = 0;
  const bands: number[] = [];
  for (const page of pages) {
    let band = 0;
    // A vertical scan away from text/borders proves saved empty row geometry,
    // rather than relying on extraction of its one short text line.
    for (let y = 0; y < page.height; y++) {
      const offset = (y * page.width + 170) * 4;
      const [red, green, blue] = page.pixels.slice(offset, offset + 3);
      if (Math.abs(red - 204) < 2 && Math.abs(green - 221) < 2 && Math.abs(blue - 170) < 2) band++;
    }
    bands.push(band);
    coloredHeight += band;
  }
  expect(bands.every((height) => height > 50)).toBe(true);
  // 700 native 96-DPI pixels occupy 525 PDF points, allowing boundary rasterization.
  expect(coloredHeight).toBeGreaterThanOrEqual(523);
  expect(coloredHeight).toBeLessThanOrEqual(527);
  const text = compact(pages.map((page) => page.text).join(''));
  for (const marker of ['SHORT-EXACT-ROW', 'NEIGHBOR', 'TABLE-END-SENTINEL'])
    expect(text.split(marker)).toHaveLength(2);
}, 60_000);

test('nested native tables fit their containing cell or fail before clipping empty columns', async () => {
  const snapshots = [200, 480].map((width) => {
    const snapshot = tableDoc([['', 'OUTER-RIGHT']]);
    const outer = snapshot.tableSource!['native-table'];
    const inner = structuredClone(outer);
    inner.tableId = 'inner-table';
    inner.size.width.v = width;
    inner.tableColumns[0].size.width.v = 100;
    inner.tableColumns[1].size.width.v = width - 100;
    inner.tableRows[0].tableCells[0].size!.width.v = 100;
    inner.tableRows[0].tableCells[1].size!.width.v = width - 100;
    inner.tableRows[0].tableCells[1].backgroundColor = { rgb: '#ccddaa' };
    // The wide fixture's short text fits its first column. Only its empty
    // second column's saved background/borders cross the local cell viewport.
    let stream = '\x1a\x1b\x1c';
    const innerStart = stream.length;
    stream += '\x1a\x1b\x1cINNER-LEFT\r\n\x1d\x1c\r\n\x1d\x0e\x0f';
    const innerEnd = stream.length;
    stream += 'OUTER-CELL-TAIL\r\n\x1d\x1cOUTER-RIGHT\r\n\x1d\x0e\x0f';
    const outerEnd = stream.length;
    stream += 'NESTED-DOC-TAIL\r\n';
    snapshot.body = {
      dataStream: stream,
      paragraphs: [...stream.matchAll(/\r/g)].map((match, index) => ({
        startIndex: match.index,
        paragraphId: `nested-${index}`,
      })),
      tables: [
        { startIndex: 0, endIndex: outerEnd, tableId: outer.tableId },
        { startIndex: innerStart, endIndex: innerEnd, tableId: inner.tableId },
      ],
    };
    snapshot.tableSource![inner.tableId] = inner;
    return snapshot;
  });
  const inputs = await Promise.all(snapshots.map((snapshot) => docInput(snapshot)));
  const [fitting, clipped] = await runDocJobs(inputs.map((input) => ({ input })));
  expect(fitting, summary(fitting)).toMatchObject({
    ok: true,
    restored: true,
    remainingFonts: 0,
  });
  const pages = await retainDocPdf('native-nested-table', fitting.bytes!);
  const text = compact(pages.map((page) => page.text).join(''));
  for (const marker of ['INNER-LEFT', 'OUTER-CELL-TAIL', 'OUTER-RIGHT', 'NESTED-DOC-TAIL'])
    expect(text.split(marker)).toHaveLength(2);
  expect(clipped, summary(clipped)).toMatchObject({
    ok: false,
    code: 'unsupported',
    restored: true,
    remainingFonts: 0,
  });
  expect(clipped.bytes).toBeUndefined();
}, 60_000);

test('a moved first row carries its thick native outer border without orphan ink', async () => {
  const prefix = Array.from(
    { length: 12 },
    (_, index) => `THICK-PREFIX-${String(index).padStart(2, '0')}`,
  );
  const snapshot = tableDoc(
    [
      ['THICK-ROW-ONE', 'A'],
      ['THICK-ROW-TWO', 'B'],
    ],
    prefix,
  );
  snapshot.documentStyle.pageSize = { width: 600, height: 400 };
  const rows = snapshot.tableSource!['native-table'].tableRows;
  const outer = {
    color: { rgb: '#5522bb' },
    width: { v: 12, u: 3 as const },
    dashStyle: 1 as const,
  };
  for (const cell of rows[0].tableCells) cell.borderTop = structuredClone(outer);
  for (const cell of rows.at(-1)!.tableCells) cell.borderBottom = structuredClone(outer);
  const [result] = await runDocJobs([{ input: await docInput(snapshot) }]);
  expect(result, summary(result)).toMatchObject({
    ok: true,
    pages: 2,
    restored: true,
    remainingFonts: 0,
  });
  const pages = await retainDocPdf('native-thick-outer-border', result.bytes!);
  expect(pages[0].text).toContain('THICK-PREFIX-11');
  expect(pages[0].text).not.toContain('THICK-ROW-ONE');
  expect(pages[1].text).toContain('THICK-ROW-ONE');
  expect(pages[1].text).toContain('THICK-ROW-TWO');
  const allText = compact(pages.map((page) => page.text).join(''));
  for (const marker of [...prefix, 'THICK-ROW-ONE', 'THICK-ROW-TWO', 'TABLE-END-SENTINEL'])
    expect(allText.split(marker)).toHaveLength(2);
  // Native thick borders add spacing to row.top. Their complete stroke belongs
  // with the moved row, even when the table's outer box starts on the prior page.
  let orphanInk = 0;
  for (let offset = 0; offset < pages[0].pixels.length; offset += 4) {
    if ((offset / 4) % pages[0].width < pages[0].width * 0.6) continue;
    if (pages[0].pixels.slice(offset, offset + 3).some((channel) => channel < 240)) orphanInk++;
  }
  expect(orphanInk).toBe(0);
  let borderPixels = 0;
  for (let offset = 0; offset < pages[1].pixels.length; offset += 4) {
    const [red, green, blue] = pages[1].pixels.slice(offset, offset + 3);
    if (Math.abs(red - 85) < 3 && Math.abs(green - 34) < 3 && Math.abs(blue - 187) < 3)
      borderPixels++;
  }
  // Two 480px-wide, 12px-thick source strokes occupy about 6,480 PDF pixels.
  expect(borderPixels).toBeGreaterThan(6_000);
}, 60_000);
