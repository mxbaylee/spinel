import { createCanvas } from '@napi-rs/canvas';
import { CustomRangeType } from '@univerjs/core';
import { expect, test } from 'vitest';
import { docInput, retainDocPdf, runDocJobs, tableDoc } from './doc-native-test-support.ts';

const summary = (value: unknown) =>
  JSON.stringify(value, (key, item) => (key === 'bytes' ? '<bytes>' : item));

test('generated hyphens fit narrow native cells deterministically beside Formula text and an inline image', async () => {
  const expression = 'PRIVATE-FORMULA';
  const snapshot = tableDoc([[`AFTER-MERGE\r${expression} \b`, 'NEIGHBOR']]);
  snapshot.documentStyle.autoHyphenation = 1;
  const table = snapshot.tableSource!['native-table'];
  table.size.width.v = 220;
  for (const column of table.tableColumns) column.size.width.v = 110;
  table.tableRows[0].trHeight.hRule = 0;
  for (const cell of table.tableRows[0].tableCells) cell.size!.width.v = 110;
  const end = snapshot.body!.dataStream.indexOf('\r');
  snapshot.body!.paragraphs!.push({
    startIndex: end,
    paragraphId: 'authored-hyphen',
    paragraphStyle: {
      spaceAbove: { v: 3, u: 3 },
      spaceBelow: { v: 7, u: 3 },
    },
  });
  snapshot.body!.paragraphs!.sort((a, b) => a.startIndex - b.startIndex);
  const formula = snapshot.body!.dataStream.indexOf(expression);
  snapshot.body!.customRanges = [
    {
      rangeId: 'formula',
      rangeType: CustomRangeType.CUSTOM,
      wholeEntity: true,
      startIndex: formula,
      endIndex: formula + expression.length - 1,
    },
  ];
  snapshot.body!.customBlocks = [
    { startIndex: snapshot.body!.dataStream.indexOf('\b'), blockId: 'image' },
  ];
  snapshot.drawingsOrder = ['image'];
  snapshot.drawings = {
    image: {
      drawingId: 'image',
      unitId: snapshot.id,
      subUnitId: snapshot.id,
      drawingType: 0,
      source: 'authorized-image',
      layoutType: 0,
      docTransform: {
        size: { width: 16, height: 8 },
        positionH: { relativeFrom: 0, posOffset: 0 },
        positionV: { relativeFrom: 1, posOffset: 0 },
        angle: 0,
      },
    },
  } as typeof snapshot.drawings;
  const canvas = createCanvas(16, 8),
    context = canvas.getContext('2d');
  context.fillStyle = '#237c36';
  context.fillRect(0, 0, 16, 8);
  const input = await docInput(snapshot);
  input.images = [{ source: 'authorized-image', bytes: await canvas.encode('png') }];
  input.formulas = [{ rangeId: 'formula', result: { kind: 'scalar', value: 'OK42' } }];
  const original = structuredClone(snapshot);
  // This native reference explicitly leaves the seven-pixel dash advance
  // available in this fixture font, without changing cell width or other runs.
  const reference = structuredClone(snapshot);
  reference.body!.paragraphs!.find(
    (paragraph) => paragraph.startIndex === end,
  )!.paragraphStyle!.indentEnd = { v: 7, u: 3 };
  const results = await runDocJobs([
    { input, options: { limits: { pages: 1 } } },
    { input, options: { limits: { pages: 1 } } },
    { input: { ...input, snapshot: reference }, options: { limits: { pages: 1 } } },
  ]);
  const rendered = [];
  for (const [index, result] of results.entries()) {
    expect(result, summary(result)).toMatchObject({
      ok: true,
      pages: 1,
      restored: true,
      remainingFonts: 0,
    });
    const pages = await retainDocPdf(`generated-hyphen-${index}`, result.bytes!);
    const text = pages[0].text.replace(/\s+/gu, '');
    for (const marker of ['AFTER-MERGE', 'OK42', 'NEIGHBOR', 'TABLE-END-SENTINEL'])
      expect(text.split(marker), marker).toHaveLength(2);
    expect(text).not.toContain('PRIVATE');
    let imagePixels = 0;
    for (let offset = 0; offset < pages[0].pixels.length; offset += 4)
      if (
        [35, 124, 54].every(
          (value, channel) => Math.abs(pages[0].pixels[offset + channel] - value) < 2,
        )
      )
        imagePixels++;
    expect(imagePixels).toBeGreaterThanOrEqual(16 * 8 * 0.75 ** 2 * 0.9);
    rendered.push(pages[0]);
  }
  // A cold dictionary and a previously used worker produce identical native
  // ink. The explicit reservation reference also preserves all other styling.
  expect(Buffer.from(rendered[0].pixels).equals(Buffer.from(rendered[1].pixels))).toBe(true);
  expect(Buffer.from(rendered[0].pixels).equals(Buffer.from(rendered[2].pixels))).toBe(true);
  expect(snapshot).toEqual(original);
}, 60_000);
