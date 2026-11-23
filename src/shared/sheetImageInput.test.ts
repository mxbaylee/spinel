import { expect, test } from 'vitest';
import {
  imageSizeMessage,
  latestChooser,
  pasteBelongsToCells,
  storedImageUrl,
  uploadFailedMessage,
  uploadFailureMessage,
} from './sheetImageInput.ts';

test.each([
  ['a bare file clipboard', '', '', false],
  ['a browser Copy image wrapper', '<img src="https://example.test/a.png">', '', false],
  ['a file manager copy with a one-line name', '', 'photo.png', false],
  ['Excel range HTML', '<table><tr><td>1</td></tr></table>', '1', true],
  [
    'a Word picture marked as Office HTML',
    '<html xmlns:o="urn:schemas-microsoft-com:office:office"><img src="file:///a.png"></html>',
    '',
    false,
  ],
  [
    'Office HTML holding a table',
    '<html xmlns:o="urn:schemas-microsoft-com:office:office"><table><tr><td>1</td></tr></table></html>',
    '',
    true,
  ],
  ['tab-separated text beside a bitmap', '', 'a\tb', true],
  ['multi-line text beside a bitmap', '', 'a\nb', true],
])('paste with %s', (_name, html, text, cells) => {
  expect(pasteBelongsToCells({ html, text })).toBe(cells);
});

test('a trailing newline alone does not make a clipboard tabular', () => {
  expect(pasteBelongsToCells({ html: '', text: 'photo.png\n' })).toBe(false);
});

test.each([
  ['a 502 HTML body', 502, undefined, uploadFailedMessage],
  ['a 413 without a body', 413, undefined, imageSizeMessage],
  ['a 413 with a server message', 413, { error: 'Images use 50 MiB.' }, 'Images use 50 MiB.'],
  ['a 403 with a server message', 403, { error: 'Only editors.' }, 'Only editors.'],
  ['an empty error string', 500, { error: '' }, uploadFailedMessage],
  ['a non-string error', 500, { error: 7 }, uploadFailedMessage],
  ['a null body', 500, null, uploadFailedMessage],
])('upload failure for %s', (_name, status, body, message) => {
  expect(uploadFailureMessage(status, body)).toBe(message);
});

test('a new chooser aborts the stale one and only the holder releases the slot', () => {
  const chooser = latestChooser();
  const first = chooser.start();
  expect(chooser.open).toBe(true);
  const second = chooser.start();
  expect(first.signal.aborted).toBe(true);
  expect(second.signal.aborted).toBe(false);
  first.release();
  expect(chooser.open).toBe(true);
  second.release();
  expect(chooser.open).toBe(false);
});

test('aborting closes the open chooser and ignores an idle slot', () => {
  const chooser = latestChooser();
  chooser.abort();
  const own = chooser.start();
  chooser.abort();
  expect(own.signal.aborted).toBe(true);
  expect(chooser.open).toBe(false);
});

const hash = 'a'.repeat(64);
test.each([
  ['a canonical URL', { url: `/api/items/doc1/images/${hash}` }, `/api/items/doc1/images/${hash}`],
  ['a missing url', {}, undefined],
  ['a non-string url', { url: 7 }, undefined],
  ['another item', { url: `/api/items/doc2/images/${hash}` }, undefined],
  ['a short hash', { url: '/api/items/doc1/images/abc' }, undefined],
  ['a non-hex hash', { url: `/api/items/doc1/images/${'z'.repeat(64)}` }, undefined],
  ['a trailing path', { url: `/api/items/doc1/images/${hash}/x` }, undefined],
  ['no body', undefined, undefined],
])('stored image URL from %s', (_name, body, url) => {
  expect(storedImageUrl('doc1', body)).toBe(url);
});
