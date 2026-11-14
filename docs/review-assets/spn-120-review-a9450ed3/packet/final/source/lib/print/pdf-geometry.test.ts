import { PDFDocument } from '@napi-rs/canvas';
import { expect, test } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { preservePdfPageGeometries, preservePdfPageGeometry } from './pdf-geometry.ts';
import { retainPdf } from './native-test-support.ts';

function pdfBytes(width = 451, height = 526) {
  const pdf = new PDFDocument({ title: '', author: '', creator: '@spinel/print' });
  const page = pdf.beginPage(width, height);
  page.fillStyle = '#ffffff';
  page.fillRect(0, 0, width, height);
  page.translate(0, height - 525.375);
  page.fillStyle = '#d02040';
  page.fillRect(10, 10, 20, 20);
  pdf.endPage();
  return pdf.close();
}

test('preserves fractional stored geometry without rewriting any native stream', async () => {
  const original = pdfBytes();
  const adjusted = preservePdfPageGeometry(original, 450.625, 525.375, 1);
  expect(Buffer.from(adjusted.subarray(0, original.length))).toEqual(Buffer.from(original));
  const pages = await retainPdf('fractional-frame', adjusted, 'output/pdf/spn-102');
  expect(pages[0].view).toEqual([0, 0, 450.625, 525.375]);
  const offset = (15 * pages[0].width + 15) * 4;
  expect(Array.from(pages[0].pixels.slice(offset, offset + 4))).toEqual([208, 32, 64, 255]);
});

test('does not change an integral frame and refuses mismatched or malformed native output', async () => {
  const original = pdfBytes();
  expect(preservePdfPageGeometry(original, 451, 526, 1)).toBe(original);
  for (const [width, height, count] of [
    [450, 526, 1],
    [451, 526, 2],
    [NaN, 526, 1],
  ])
    expect(() => preservePdfPageGeometry(original, width, height, count)).toThrow(
      'page geometry cannot be preserved',
    );
  const altered = Buffer.from(original);
  const tail = altered.lastIndexOf('startxref');
  altered[tail + 10] = 57;
  expect(() => preservePdfPageGeometry(altered, 450.625, 525.375, 1)).toThrow();
  expect(() => preservePdfPageGeometry(original.slice(0, -16), 450.625, 525.375, 1)).toThrow();
  const loading = getDocument({ data: new Uint8Array(original) });
  try {
    expect((await loading.promise).numPages).toBe(1);
  } finally {
    await loading.destroy();
  }
});

test('preserves each section frame in physical page-tree order', async () => {
  const frames = [
    { width: 450.375, height: 300.1875 },
    { width: 600.1875, height: 375.375 },
  ];
  const pdf = new PDFDocument({ title: '', author: '', creator: '@spinel/print' });
  for (const [index, frame] of frames.entries()) {
    const page = pdf.beginPage(Math.ceil(frame.width), Math.ceil(frame.height));
    page.translate(0, Math.ceil(frame.height) - frame.height);
    page.fillStyle = index ? '#2040d0' : '#d02040';
    page.fillRect(10, 10, 20, 20);
    pdf.endPage();
  }
  const original = pdf.close();
  const adjusted = preservePdfPageGeometries(original, frames);
  expect(Buffer.from(adjusted.subarray(0, original.length))).toEqual(Buffer.from(original));
  const pages = await retainPdf('heterogeneous-frames', adjusted, 'output/pdf/spn-102');
  expect(pages.map((page) => page.view)).toEqual(
    frames.map(({ width, height }) => [0, 0, width, height]),
  );
  expect(() => preservePdfPageGeometries(original, [...frames].reverse())).toThrow();
});
