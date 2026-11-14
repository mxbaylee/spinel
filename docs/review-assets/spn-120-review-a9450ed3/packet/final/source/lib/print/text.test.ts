import { expect, test } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { TabStopAlignment, TabStopLeader } from '@univerjs/core';
import type { ICellDataForSheetInterceptor } from '@univerjs/core';
import { PRINT_LIMITS } from './contract.ts';
import type { PrintBox } from './contract.ts';
import { fixtureFonts } from './font-fixtures.ts';
import { PreparedFonts } from './fonts.ts';
import { InkContext, prepareCellText } from './text.ts';

test('only visible horizontal stroke ink contributes a pagination border constraint', () => {
  const borders: PrintBox[] = [];
  const ink = new InkContext(
    createCanvas(32, 32).getContext('2d'),
    () => {},
    undefined,
    (box) => borders.push(box),
  );
  ink.beginPath();
  ink.rect(0, 0, 10, 10);
  ink.clip();
  ink.beginPath();
  ink.moveTo(1, 20);
  ink.lineTo(8, 20);
  ink.stroke();
  expect(ink.bounds).toBeNull();
  expect(borders).toHaveLength(0);
  ink.beginPath();
  ink.moveTo(1, 5);
  ink.lineTo(8, 5);
  ink.stroke();
  expect(borders).toHaveLength(1);
  expect(borders[0].top).toBeLessThan(5);
  expect(borders[0].bottom).toBeGreaterThan(5);
  ink.beginPath();
  ink.moveTo(3, 2);
  ink.lineTo(3, 8);
  ink.stroke();
  expect(ink.bounds!.top).toBeLessThan(2);
  // A long vertical table border remains splittable across physical pages.
  expect(borders).toHaveLength(1);
});

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
