import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { TextX, UpdateDocsAttributeType, composeBody } from '@univerjs/core';
import type { IDocumentBody, IParagraph } from '@univerjs/core';
import { patchCore } from './patch-univer-core.ts';

// Retain updates on the wire may omit identity; the snapshot interface requires it.
// These deliberate legacy/update fixtures exercise the documented runtime fallback.
const update = (value: Omit<IParagraph, 'paragraphId'> & { paragraphId?: string }) =>
  value as IParagraph;

const paragraph: IParagraph = {
  startIndex: 0,
  paragraphId: 'stable-paragraph',
  bullet: { listId: 'list', listType: 'BULLET_LIST', nestingLevel: 0 },
  paragraphStyle: { namedStyleType: 4, outlineLevel: 0, headingId: 'heading' },
};

test('composed paragraph replacement matches sequential application and preserves identity', () => {
  const base: IDocumentBody = {
    dataStream: '\r\n',
    paragraphs: [{ startIndex: 0, paragraphId: 'stable-paragraph' }],
  };
  const replacements = [
    { startIndex: 0 },
    { startIndex: 0, paragraphStyle: {} },
    { startIndex: 0, paragraphStyle: { outlineLevel: 1 } },
    { startIndex: 0, paragraphId: 'replacement-id' },
  ].map(update);
  for (const replacement of replacements) {
    const first = new TextX()
      .retain(
        1,
        { dataStream: '', paragraphs: [structuredClone(paragraph)] },
        UpdateDocsAttributeType.REPLACE,
      )
      .serialize();
    const second = new TextX()
      .retain(1, { dataStream: '', paragraphs: [replacement] }, UpdateDocsAttributeType.REPLACE)
      .serialize();
    const sequential = TextX.apply(
      TextX.apply(structuredClone(base), structuredClone(first)),
      structuredClone(second),
    );
    const combined = TextX.apply(
      structuredClone(base),
      TextX.compose(structuredClone(first), structuredClone(second)),
    );
    assert.deepEqual(combined, sequential);
    assert.equal(combined.paragraphs![0].bullet, undefined);
    assert.equal(combined.paragraphs![0].paragraphStyle?.headingId, undefined);
    assert.equal(
      combined.paragraphs![0].paragraphId,
      replacement.paragraphId ?? 'stable-paragraph',
    );
  }
});

test('COVER preserves attributes, and both runtime formats use the same REPLACE repair', () => {
  const first: IDocumentBody = { dataStream: '', paragraphs: [paragraph] };
  const second: IDocumentBody = {
    dataStream: '',
    paragraphs: [update({ startIndex: 0, paragraphStyle: { outlineLevel: 1 } })],
  };
  assert.equal(
    composeBody(structuredClone(first), second, UpdateDocsAttributeType.COVER).paragraphs![0].bullet
      ?.listId,
    'list',
  );
  const require = createRequire(import.meta.url);
  const cjs = require('@univerjs/core') as typeof import('@univerjs/core');
  for (const core of [{ composeBody }, cjs]) {
    const result = core.composeBody(
      structuredClone(first),
      structuredClone(second),
      UpdateDocsAttributeType.REPLACE,
    );
    assert.equal(result.paragraphs![0].bullet, undefined);
    assert.equal(result.paragraphs![0].paragraphStyle?.headingId, undefined);
    assert.equal(result.paragraphs![0].paragraphId, 'stable-paragraph');
  }
});

test('install patch is idempotent and rejects changed upstream bytes', async () => {
  for (const format of ['es', 'cjs'] as const) {
    const source = await readFile(
      new URL(`../../node_modules/@univerjs/core/lib/${format}/index.js`, import.meta.url),
      'utf8',
    );
    const patched = patchCore(source, format);
    assert.equal(patchCore(patched, format), patched);
    assert.throws(() => patchCore(source + '\n// unexpected change', format), /Unrecognized/);
  }
});

test('explicit replacement arrays clear omitted paragraphs while absent arrays preserve them', () => {
  const base: IDocumentBody = {
    dataStream: '\r\r\n',
    paragraphs: [{ ...paragraph }, { ...paragraph, startIndex: 1, paragraphId: 'second' }],
  };
  for (const updates of [undefined, [], [update({ startIndex: 1 })]]) {
    const first = new TextX()
      .retain(
        2,
        { dataStream: '', paragraphs: structuredClone(base.paragraphs) },
        UpdateDocsAttributeType.REPLACE,
      )
      .serialize();
    const second = new TextX()
      .retain(
        2,
        { dataStream: '', ...(updates ? { paragraphs: updates } : {}) },
        UpdateDocsAttributeType.REPLACE,
      )
      .serialize();
    const sequential = TextX.apply(
      TextX.apply(structuredClone(base), structuredClone(first)),
      structuredClone(second),
    );
    const composed = TextX.apply(
      structuredClone(base),
      TextX.compose(structuredClone(first), structuredClone(second)),
    );
    assert.deepEqual(composed, sequential);
  }
});
