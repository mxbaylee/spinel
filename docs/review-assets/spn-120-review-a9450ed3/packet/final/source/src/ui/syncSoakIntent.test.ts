import { expect, test } from 'vitest';
import { assertDocSoakContent, docSoakInsertion } from '../../e2e/sync-soak-intent.ts';

const owner = docSoakInsertion(13, 'owner');
const peer = docSoakInsertion(14, 'peer');
const edits = [owner, peer];
const complete = owner.text + peer.text + '\r\n';

test('Doc intent proof accepts later insertions inside earlier text without losing identity or order', () => {
  const nested = owner.text.slice(0, 2) + peer.text + owner.text.slice(2) + '\r\n';
  const interleaved = [...owner.text].map((character, i) => character + peer.text[i]).join('');
  expect(() => assertDocSoakContent(complete, edits)).not.toThrow();
  expect(() => assertDocSoakContent(nested, edits)).not.toThrow();
  expect(() => assertDocSoakContent(interleaved + '\r\n', edits)).not.toThrow();
});

test('Doc intent proof rejects loss, duplication, and replacement even when overall length agrees', () => {
  expect(() => assertDocSoakContent(complete.slice(1), edits)).toThrow('authored characters');
  expect(() => assertDocSoakContent(owner.text[1] + complete.slice(1), edits)).toThrow(
    'Duplicated',
  );
  expect(() => assertDocSoakContent('x' + complete.slice(1), edits)).toThrow('Unexpected');
});

test('Doc intent proof rejects reordered characters even when the complete inventory is preserved', () => {
  const reversed = owner.text[1] + owner.text[0] + owner.text.slice(2) + peer.text + '\r\n';
  expect(() => assertDocSoakContent(reversed, edits)).toThrow('Character order changed');
});

test('all 300 planned Doc insertions have distinct character identities and preserve the terminator', () => {
  const planned = Array.from({ length: 150 }, (_, round) => [
    docSoakInsertion(round, 'owner'),
    docSoakInsertion(round, 'peer'),
  ]).flat();
  const content = planned.map(({ text }) => text).join('');
  expect(() => assertDocSoakContent(content + '\r\n', planned)).not.toThrow();
  expect(() => assertDocSoakContent(content, planned)).toThrow('terminator');
});
