import { expect, test } from 'vitest';
import { encodeOfflineReplay, decodeOfflineReplay } from './offlineReplay.ts';
import type { OfflineReplay } from './offlineReplay.ts';

function fixture(): OfflineReplay {
  // Larger than a codec chunk; includes zero/non-UTF8 bytes and opaque JSON that
  // resembles a generic tagged byte encoding. None may be reinterpreted.
  const bytes = Uint8Array.from({ length: 40_000 }, (_, index) => index % 256);
  const resource = { name: 'opaque', data: '{"bytes":"字 🌷","type":"Uint8Array"}' };
  return {
    version: 1,
    sdkVersion: '1.1.0',
    accountId: 'account',
    itemId: 'stable-item',
    unitId: 'restored-generation',
    access: 'viewer',
    revisionOffset: 34,
    preservedResources: [resource],
    images: [
      {
        source: '/api/items/stable-item/images/' + 'a'.repeat(64),
        sha256: 'a'.repeat(64),
        mime: 'image/png',
        byteLength: 4096,
      },
    ],
    data: {
      targetRevision: 3,
      changesets: [
        {
          unitID: 'restored-generation',
          type: 2,
          baseRev: 1,
          revision: 3,
          sid: 'original-session',
          reqId: 91,
          userID: 'account',
          memberID: 'original-member',
          mutations: [{ id: 'fixture', data: JSON.stringify({ literal: resource.data }) }],
        },
      ],
      snapshot: {
        unitID: 'restored-generation',
        type: 2,
        rev: 2,
        doc: undefined,
        slide: undefined,
        board: undefined,
        workbook: {
          unitID: 'restored-generation',
          rev: 2,
          creator: 'account',
          name: 'Budget',
          originalMeta: bytes,
          sheetOrder: ['one', 'two'],
          resources: [resource],
          sheets: Object.fromEntries(
            ['one', 'two'].map((id) => [
              id,
              {
                type: 0,
                id,
                name: id,
                rowCount: 1000,
                columnCount: 26,
                originalMeta: bytes,
              },
            ]),
          ),
          blockMeta: {
            one: { sheetID: 'one', blocks: ['first'] },
            two: { sheetID: 'two', blocks: ['last'] },
          },
        },
      },
      sheetBlocks: [
        { id: 'first', startRow: 0, endRow: 100, data: bytes },
        { id: 'last', startRow: 900, endRow: 1000, data: bytes },
      ],
    },
  };
}

test('JSON replay transport retains offscreen blocks, binary metadata, original operations and opaque resources', () => {
  const original = fixture();
  const encoded = encodeOfflineReplay(original);
  expect(typeof encoded.data.sheetBlocks[1].data).toBe('string');
  const recovered = decodeOfflineReplay(JSON.parse(JSON.stringify(encoded)));
  expect(recovered).toEqual(original);
  expect(recovered.data.sheetBlocks[1].data).toBeInstanceOf(Uint8Array);
  expect(recovered.data.changesets[0].reqId).toBe(91);
  expect(recovered.data.snapshot.workbook!.sheets.two.originalMeta).not.toBe(
    original.data.snapshot.workbook!.sheets.two.originalMeta,
  );
});

test('Doc replay retains raw document bytes across JSON without interpreting their strings', () => {
  const original = fixture();
  original.data = {
    targetRevision: 4,
    changesets: [],
    sheetBlocks: [],
    snapshot: {
      unitID: original.unitId,
      type: 1,
      rev: 4,
      workbook: undefined,
      slide: undefined,
      board: undefined,
      doc: {
        unitID: original.unitId,
        rev: 4,
        creator: 'account',
        name: 'Journal',
        resources: [],
        originalMeta: new TextEncoder().encode(
          '{"body":{"dataStream":"🌷 字\\r\\n"},"drawings":{}}',
        ),
      },
    },
  };
  expect(decodeOfflineReplay(JSON.parse(JSON.stringify(encodeOfflineReplay(original))))).toEqual(
    original,
  );
});

test('incompatible schemas and mismatched unit identities cannot be decoded as a valid replay base', () => {
  const wire = encodeOfflineReplay(fixture());
  expect(() =>
    decodeOfflineReplay({ ...wire, sdkVersion: 'old' } as unknown as typeof wire),
  ).toThrow('compatible');
  expect(() => decodeOfflineReplay({ ...wire, version: 2 } as unknown as typeof wire)).toThrow(
    'compatible',
  );
  expect(() => decodeOfflineReplay({ ...wire, unitId: 'another-generation' })).toThrow(
    'different document',
  );
  wire.data.sheetBlocks[0].data = '!invalid base64!';
  expect(() => decodeOfflineReplay(wire)).toThrow();
});
