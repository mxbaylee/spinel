import { expect, test } from 'vitest';
import { TabStopAlignment, TabStopLeader } from '@univerjs/core';
import type { ICellDataForSheetInterceptor } from '@univerjs/core';
import { PRINT_LIMITS } from './contract.ts';
import { fixtureFonts } from './font-fixtures.ts';
import { PreparedFonts } from './fonts.ts';
import { prepareCellText } from './text.ts';

test('prepared glyph coverage follows native display casing rather than only the authored lowercase text', async () => {
  const input = await fixtureFonts();
  const fonts = new PreparedFonts([input[0]], input[0].family, [], PRINT_LIMITS);
  const coverage = fonts.faces[0].covers;
  // Model an admitted font repertoire that contains the source letter but not
  // its displayed capital. No native fallback may silently fill that gap.
  fonts.faces[0].covers = (point) => point !== 65 && coverage(point);
  for (const casing of [{ caps: true }, { smallCaps: true }])
    expect(() =>
      prepareCellText(
        {
          p: {
            id: 'display-casing',
            documentStyle: {},
            body: { dataStream: 'a\r\n', textRuns: [{ st: 0, ed: 1, ts: casing }] },
          },
        },
        fonts,
      ),
    ).toThrow('prepared font glyphs');
});

test('generated tab leaders are rejected before native repeated-glyph allocation', async () => {
  const input = await fixtureFonts();
  const fonts = new PreparedFonts([input[0]], input[0].family, [], PRINT_LIMITS);
  const stop = { offset: 100_000, alignment: TabStopAlignment.START, leader: TabStopLeader.DOT };
  for (const placement of ['default', 'paragraph', 'positioned']) {
    const cell: ICellDataForSheetInterceptor = {
      s: { fs: 0.001 },
      p: { id: 'tab-leader', documentStyle: {}, body: { dataStream: 'A\tB\r\n' } },
    };
    if (placement === 'default')
      cell.p!.documentStyle!.defaultParagraphStyle = { tabStops: [stop] };
    else if (placement === 'paragraph')
      cell.p!.body!.paragraphs = [
        { startIndex: 3, paragraphId: 'leader', paragraphStyle: { tabStops: [stop] } },
      ];
    else
      cell.p!.body!.textRuns = [
        {
          st: 1,
          ed: 2,
          ts: {
            positionedTab: {
              alignment: TabStopAlignment.START,
              relativeTo: 'margin',
              leader: TabStopLeader.DOT,
            },
          },
        },
      ];
    expect(() => prepareCellText(cell, fonts)).toThrow(
      'tab leaders require a prepared representation',
    );
  }
});
