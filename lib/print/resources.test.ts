import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { LocaleType } from '@univerjs/core';
import sharp from 'sharp';
import type { SheetPrintInput } from '@spinel/print';
import { PRINT_LIMITS } from './contract.ts';
import { fixtureFonts } from './font-fixtures.ts';
import type { NativeJob } from './native-fixture.ts';
import { evidenceDirectory, retainPdf, runNativeJobs } from './native-test-support.ts';
import { validateSheetResources } from './resources.ts';

async function resourceFixture(): Promise<SheetPrintInput> {
  const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#d02040' } })
    .png()
    .toBuffer();
  return {
    fonts: await fixtureFonts(),
    defaultFamily: 'Atkinson Hyperlegible',
    images: [
      { source: 'one', bytes },
      { source: 'two', bytes },
    ],
    snapshot: {
      id: 'resources',
      name: 'Synthetic resource fixture',
      appVersion: '1.1.0',
      locale: LocaleType.EN_US,
      styles: {},
      sheetOrder: ['sheet'],
      sheets: {
        sheet: {
          id: 'sheet',
          rowCount: 40,
          columnCount: 1,
          defaultRowHeight: 32,
          defaultColumnWidth: 160,
          showGridlines: 0,
          cellData: { 0: { 0: { v: 'Resource baseline' } }, 39: { 0: { v: 'Complete tail' } } },
        },
      },
      resources: [
        {
          name: 'SHEET_DRAWING_PLUGIN',
          data: JSON.stringify({
            sheet: {
              order: ['one', 'two'],
              data: Object.fromEntries(
                ['one', 'two'].map((source, index) => [
                  source,
                  {
                    drawingId: source,
                    unitId: 'resources',
                    subUnitId: 'sheet',
                    drawingType: 0,
                    anchorType: '2',
                    source,
                    transform: { left: index * 40, top: 40, width: 30, height: 20 },
                  },
                ]),
              ),
            },
          }),
        },
      ],
    },
  };
}

test('measures resource failures and cancellation with no partial output or residual native state', async () => {
  const input = await resourceFixture();
  const dense = structuredClone(input);
  dense.snapshot.sheets.sheet.rowCount = 7_000;
  dense.snapshot.sheets.sheet.cellData = Object.fromEntries(
    Array.from({ length: 7_000 }, (_, row) => [row, { 0: { v: 'Bounded deadline fixture' } }]),
  );
  const cases: { name: string; job: NativeJob; code: string; message?: string }[] = [
    { name: 'snapshot', job: { input, options: { limits: { snapshotBytes: 1 } } }, code: 'limit' },
    { name: 'fonts', job: { input, options: { limits: { fontBytes: 1 } } }, code: 'limit' },
    { name: 'grid', job: { input, options: { limits: { gridCells: 1 } } }, code: 'limit' },
    { name: 'pages', job: { input, options: { limits: { pages: 1 } } }, code: 'limit' },
    {
      name: 'encoded-images',
      job: {
        input,
        options: {
          limits: {
            encodedImageBytes: input.images[0].bytes.length * 2 - 1,
          },
        },
      },
      code: 'limit',
    },
    {
      name: 'aggregate-decoded-pixels',
      job: { input, options: { limits: { decodedImagePixels: 11 } } },
      code: 'limit',
    },
    { name: 'output', job: { input, options: { limits: { outputBytes: 1 } } }, code: 'limit' },
    {
      name: 'deadline',
      job: { input: dense, options: { limits: { durationMs: 1 } } },
      code: 'limit',
      message: 'time limit',
    },
    { name: 'cancel-before', job: { input, abort: true }, code: 'cancelled' },
    { name: 'cancel-during-prepare', job: { input, abortDuringPrepare: true }, code: 'cancelled' },
    { name: 'cancel-during-cleanup', job: { input, abortDuringCleanup: true }, code: 'cancelled' },
  ];
  const results = await runNativeJobs([...cases.map((item) => item.job), { input }]);
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(
    resolve(evidenceDirectory, 'resource-measurements.json'),
    JSON.stringify(
      {
        note: 'Synthetic package admission measurements; process maximum RSS includes native imports and earlier jobs. Not production host limits.',
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cases: results.map(({ bytes, ...result }, index) => ({
          name: cases[index]?.name ?? 'success-after-failures',
          ...result,
          publishedBytes: bytes?.byteLength ?? 0,
        })),
      },
      null,
      2,
    ),
  );
  for (const [index, item] of cases.entries()) {
    expect(results[index], item.name).toMatchObject({
      ok: false,
      code: item.code,
      restored: true,
      remainingFonts: 0,
    });
    expect(results[index].bytes, item.name).toBeUndefined();
    if (item.message) expect(results[index].message).toContain(item.message);
    expect(results[index].metrics.durationMs).toBeGreaterThanOrEqual(0);
    expect(results[index].metrics.maxRssKiB).toBeGreaterThan(0);
  }
  const success = results.at(-1)!;
  expect(success).toMatchObject({ ok: true, pages: 2, restored: true, remainingFonts: 0 });
  const pages = await retainPdf('resource-baseline', success.bytes!);
  expect(pages).toHaveLength(2);
  expect(pages[0].text).toContain('Resource baseline');
  expect(pages[1].text).toContain('Complete tail');
}, 90_000);

test('rejects incomplete raster bodies and unresolved formulas without publishing earlier pages', async () => {
  const input = await resourceFixture();
  const broken = structuredClone(input);
  // Preserve a complete PNG header (including valid dimensions), remove pixel data.
  broken.images = broken.images.map((image) => ({ ...image, bytes: image.bytes.slice(0, 33) }));
  const unresolved = structuredClone(input);
  unresolved.snapshot.sheets.sheet.cellData![39][0] = { f: '=PRIVATE_SOURCE()' };
  const results = await runNativeJobs([{ input: broken }, { input: unresolved }, { input }]);
  for (const result of results.slice(0, 2)) {
    expect(result).toMatchObject({
      ok: false,
      code: 'invalid-input',
      restored: true,
      remainingFonts: 0,
    });
    expect(result.bytes).toBeUndefined();
    expect(result.message).not.toContain('PRIVATE_SOURCE');
  }
  expect(results[2]).toMatchObject({ ok: true, restored: true, remainingFonts: 0 });
  const pages = await retainPdf('resource-recovery', results[2].bytes!);
  expect(pages).toHaveLength(2);
  expect(pages[1].text).toContain('Complete tail');
}, 90_000);

test('rejects unsupported rendering resources instead of silently losing their appearance', async () => {
  const input = await resourceFixture();
  input.snapshot.resources!.push({
    name: 'SHEET_CONDITIONAL_FORMATTING_PLUGIN',
    data: JSON.stringify({ sheet: [{ color: '#ff0000' }] }),
  });
  expect(() => validateSheetResources(input.snapshot, PRINT_LIMITS, () => {})).toThrow(
    'unsupported worksheet resource',
  );
  const [result] = await runNativeJobs([{ input }]);
  expect(result).toMatchObject({
    ok: false,
    code: 'unsupported',
    restored: true,
    remainingFonts: 0,
  });
  expect(result.bytes).toBeUndefined();
  input.snapshot.resources![1].data = '{}';
  expect(() => validateSheetResources(input.snapshot, PRINT_LIMITS, () => {})).not.toThrow();
  input.snapshot.resources!.push(input.snapshot.resources![1]);
  expect(() => validateSheetResources(input.snapshot, PRINT_LIMITS, () => {})).toThrow('Duplicate');
}, 90_000);

test('cleanup failure overrides a rendering rejection and tells the host to discard the process', async () => {
  const input = await resourceFixture();
  // A dedicated test process deliberately leaves its own font registrations
  // behind. It exits after this result; no later render reuses that process.
  const [result] = await runNativeJobs([
    { input, options: { limits: { outputBytes: 1 } }, failCleanup: true },
  ]);
  expect(result).toMatchObject({
    ok: false,
    code: 'cleanup',
    message: 'Native PDF cleanup failed.',
    restored: true,
  });
  expect(result.bytes).toBeUndefined();
  expect(result.remainingFonts).toBeGreaterThan(0);
}, 90_000);
