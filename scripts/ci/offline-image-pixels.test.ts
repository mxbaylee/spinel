import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countOfflineImagePixels, offlineImagesPainted } from './offline-image-pixels.ts';
import type { OfflineImageBounds, OfflineImageRaster } from './offline-image-pixels.ts';

function raster(width = 64, height = 24, channels = 3): OfflineImageRaster {
  return { data: new Uint8Array(width * height * channels).fill(255), width, height, channels };
}

function paint(image: OfflineImageRaster, area: OfflineImageBounds, color: number[]) {
  for (let y = area.top; y < area.top + area.height; y++) {
    for (let x = area.left; x < area.left + area.width; x++) {
      image.data.set(color, (y * image.width + x) * image.channels);
    }
  }
}

test('the retained fixture colors must all paint, with the existing count and color tolerance', () => {
  const image = raster();
  const colors = [
    [255, 153, 0],
    [34, 85, 238],
    [34, 187, 102],
  ];
  colors.forEach((color, index) =>
    paint(image, { left: index * 20, top: 4, width: 16, height: 12 }, color),
  );
  const counts = countOfflineImagePixels(image, 'sheet');
  assert.deepEqual(counts, [192, 192, 192]);
  assert.equal(offlineImagesPainted(counts, 'sheet'), true);
  paint(image, { left: 40, top: 4, width: 16, height: 12 }, [255, 255, 255]);
  assert.equal(offlineImagesPainted(countOfflineImagePixels(image, 'sheet'), 'sheet'), false);

  const doc = raster(11, 10);
  paint(doc, { left: 0, top: 0, width: 11, height: 10 }, [130, 11, 215]);
  assert.equal(offlineImagesPainted(countOfflineImagePixels(doc, 'doc'), 'doc'), true);
  paint(doc, { left: 0, top: 0, width: 11, height: 10 }, [131, 0, 204]);
  assert.equal(offlineImagesPainted(countOfflineImagePixels(doc, 'doc'), 'doc'), false);
  assert.equal(offlineImagesPainted([100], 'doc'), false);
  assert.equal(offlineImagesPainted([101], 'doc'), true);
});

test('intact model or stored bytes cannot substitute for absent pixels inside the visible editor', () => {
  const image = raster();
  assert.deepEqual(countOfflineImagePixels(image, 'doc'), [0]);
  assert.equal(offlineImagesPainted(countOfflineImagePixels(image, 'doc'), 'doc'), false);
  paint(image, { left: 32, top: 0, width: 16, height: 12 }, [119, 0, 204]);
  assert.equal(offlineImagesPainted(countOfflineImagePixels(image, 'doc'), 'doc'), true);
  const editor = { left: 0, top: 0, width: 24, height: 24 };
  assert.deepEqual(countOfflineImagePixels(image, 'doc', editor), [0]);
  assert.equal(offlineImagesPainted(countOfflineImagePixels(image, 'doc', editor), 'doc'), false);
  assert.deepEqual(
    countOfflineImagePixels(image, 'doc', { left: 32, top: 0, width: 16, height: 12 }),
    [192],
  );
});

test('transparent image payloads do not count as painted pixels', () => {
  const image = raster(12, 12, 4);
  const area = { left: 0, top: 0, width: 12, height: 12 };
  paint(image, area, [119, 0, 204, 0]);
  assert.deepEqual(countOfflineImagePixels(image, 'doc'), [0]);
  paint(image, area, [119, 0, 204, 254]);
  assert.deepEqual(countOfflineImagePixels(image, 'doc'), [0]);
  paint(image, area, [119, 0, 204, 255]);
  assert.equal(offlineImagesPainted(countOfflineImagePixels(image, 'doc'), 'doc'), true);
});

test('malformed raster dimensions, channels, byte counts and crop rectangles reject evidence', () => {
  const image = raster();
  for (const changed of [
    { width: 0 },
    { width: 3.5 },
    { height: -1 },
    { height: Number.NaN },
    { width: Number.MAX_SAFE_INTEGER },
    { channels: 2 },
    { channels: 5 },
    { data: image.data.subarray(1) },
  ]) {
    assert.throws(
      () => countOfflineImagePixels({ ...image, ...changed }, 'sheet'),
      /raster-invalid/,
    );
  }
  for (const area of [
    { left: -1, top: 0, width: 10, height: 10 },
    { left: 0, top: 0.5, width: 10, height: 10 },
    { left: 0, top: 0, width: 0, height: 10 },
    { left: 0, top: 0, width: 10, height: Number.POSITIVE_INFINITY },
    { left: 60, top: 0, width: 5, height: 10 },
    { left: 0, top: 20, width: 10, height: 5 },
  ]) {
    assert.throws(() => countOfflineImagePixels(image, 'sheet', area), /bounds-invalid/);
  }
});

test('missing or malformed color counts cannot become a successful rendering observation', () => {
  for (const counts of [[], [101, 101], [101, 101, 101, 101], [101, 0, 101], [101, NaN, 101]])
    assert.equal(offlineImagesPainted(counts, 'sheet'), false);
  for (const counts of [[], [101, 101], [Infinity], [101.5], [-1]])
    assert.equal(offlineImagesPainted(counts, 'doc'), false);
});
