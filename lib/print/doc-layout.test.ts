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
