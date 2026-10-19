import { expect, test } from 'vitest';
import type { ILogContext } from '@univerjs-pro/collaboration';
import type { OfflineReplay } from '../../src/shared/offlineReplay.ts';
import { OfflineAccess } from '../../web/offline/OfflineAccess.ts';
import { LocalReplaySnapshot } from '../../web/offline/LocalReplaySnapshot.ts';

const context = {} as ILogContext;
function fixture(kind: 'doc' | 'sheet' = 'doc') {
  const type = kind === 'doc' ? 1 : 2;
  const scope = {
    origin: 'https://spinel.example',
    accountId: 'owner',
    itemId: 'item',
    unitId: 'unit',
    kind,
    access: 'owner' as const,
    sdkVersion: '1.1.0' as const,
    schema: 1 as const,
    revisionOffset: 7,
  };
  const access = new OfflineAccess(scope, async () => ({ ...scope, restoring: false }));
  let account: string | null = 'owner';
  const meta = {
    unitID: 'unit',
    rev: 2,
    creator: 'owner',
    name: 'Prepared document',
    resources: [{ id: 'known-resource', name: 'opaque', data: 'unchanged native resource' }],
    originalMeta: new Uint8Array([0, 255, 3]),
  };
  const bundle: OfflineReplay = {
    version: 1,
    sdkVersion: '1.1.0',
    accountId: 'owner',
    itemId: 'item',
    unitId: 'unit',
    access: 'owner',
    revisionOffset: 7,
    images: [],
    preservedResources: [
      { name: 'opaque', data: 'older copy' },
      { name: 'another', data: '字' },
    ],
    data: {
      targetRevision: 3,
      snapshot: {
        unitID: 'unit',
        type,
        rev: 2,
        slide: undefined,
        board: undefined,
        doc: type === 1 ? meta : undefined,
        workbook:
          type === 2
            ? {
                ...meta,
                sheetOrder: ['sheet'],
                sheets: {
                  sheet: {
                    type: 0,
                    id: 'sheet',
                    name: 'Sheet',
                    rowCount: 100,
                    columnCount: 26,
                    originalMeta: new Uint8Array([5]),
                  },
                },
                blockMeta: { sheet: { sheetID: 'sheet', blocks: ['block'] } },
              }
            : undefined,
      },
      sheetBlocks:
        type === 2
          ? [{ id: 'block', startRow: 0, endRow: 10, data: new Uint8Array([12, 13]) }]
          : [],
      changesets: [
        {
          unitID: 'unit',
          type,
          baseRev: 1,
          revision: 3,
          sid: 'original',
          reqId: 9,
          userID: 'owner',
          memberID: 'member',
          mutations: [{ id: 'fixture', data: '{"unitId":"unit"}' }],
        },
      ],
    },
  };
  return {
    access,
    bundle,
    type,
    setAccount: (value: string | null) => {
      account = value;
    },
    adapter: () => new LocalReplaySnapshot(access, bundle, () => account),
  };
}
test.each(['doc', 'sheet'] as const)(
  '%s returns isolated complete pinned data without changing original bytes or identities',
  async (kind) => {
    const f = fixture(kind),
      original = structuredClone(f.bundle),
      adapter = f.adapter();
    const request = { unitID: 'unit', type: f.type, revision: 3 };
    const first = await adapter.getUnitOnRev(context, request);
    expect(first.changesets).toEqual(original.data.changesets);
    const meta = (first.snapshot.doc ?? first.snapshot.workbook)!;
    expect(meta.resources.map((r) => r.data)).toEqual(['unchanged native resource', '字']);
    meta.originalMeta[0] = 100;
    first.changesets[0].reqId = 100;
    const second = await adapter.getUnitOnRev(context, request);
    expect((second.snapshot.doc ?? second.snapshot.workbook)!.originalMeta[0]).toBe(0);
    expect(second.changesets[0].reqId).toBe(9);
    expect(f.bundle).toEqual(original);
    const resources = await adapter.getResourcesRequest(context, {
      unitID: 'unit',
      type: f.type,
      resourceIDs: ['known-resource'],
    });
    expect(resources.resources['known-resource'].data).toBe('unchanged native resource');
    if (kind === 'sheet') {
      const block = await adapter.getDeserializedSheetBlock(context, {
        unitID: 'unit',
        type: 2,
        blockID: 'block',
      });
      block.block.data[0] = 99;
      expect(
        (await adapter.getSheetBlock(context, { unitID: 'unit', type: 2, blockID: 'block' })).block
          .data[0],
      ).toBe(12);
    }
  },
);
test('unknown resources, blocks and latest aliases cannot become guessed data or network requests', async () => {
  const f = fixture('sheet'),
    adapter = f.adapter();
  await expect(
    adapter.getUnitOnRev(context, { unitID: 'unit', type: 2, revision: 0 }),
  ).rejects.toThrow(/exact/);
  await expect(
    adapter.getResourcesRequest(context, { unitID: 'unit', type: 2, resourceIDs: ['missing'] }),
  ).rejects.toThrow(/uniquely/);
  await expect(
    adapter.getSheetBlock(context, { unitID: 'unit', type: 2, blockID: 'missing' }),
  ).rejects.toThrow(/not prepared/);
});
test.each([
  [1, 3],
  [2, 4],
  [2, 0],
  [3, 2],
  [2.5, 3],
])('uncovered changeset range %s..%s is refused', async (from, to) => {
  const adapter = fixture().adapter();
  await expect(
    adapter.fetchMissingChangesets(context, { unitID: 'unit', type: 1, from, to }),
  ).rejects.toThrow(/not prepared/);
});
test('a covered explicit range keeps every original changeset identity', async () => {
  const f = fixture(),
    adapter = f.adapter();
  expect(
    (await adapter.fetchMissingChangesets(context, { unitID: 'unit', type: 1, from: 2, to: 3 }))
      .changesets,
  ).toEqual(f.bundle.data.changesets);
});
test.each(['accountId', 'itemId', 'unitId', 'sdkVersion', 'access', 'revisionOffset'] as const)(
  'wrong %s cannot be admitted as this base',
  (key) => {
    const f = fixture();
    Object.assign(f.bundle, { [key]: key === 'revisionOffset' ? 8 : 'different' });
    expect(() => f.adapter()).toThrow(/scope/);
  },
);
test.each(['gap', 'missing tail', 'missing block', 'duplicate block'])(
  '%s does not earn complete replay-base status',
  (mode) => {
    const f = fixture('sheet');
    if (mode === 'gap') f.bundle.data.changesets[0].revision = 4;
    if (mode === 'missing tail') f.bundle.data = { ...f.bundle.data, changesets: [] };
    if (mode === 'missing block') f.bundle.data = { ...f.bundle.data, sheetBlocks: [] };
    if (mode === 'duplicate block')
      f.bundle.data = {
        ...f.bundle.data,
        sheetBlocks: [f.bundle.data.sheetBlocks[0], f.bundle.data.sheetBlocks[0]],
      };
    expect(() => f.adapter()).toThrow();
  },
);
test.each(['account', 'lock', 'dispose', 'unit', 'type'])(
  '%s changes stop local reads',
  async (mode) => {
    const f = fixture(),
      adapter = f.adapter();
    if (mode === 'account') f.setAccount('other');
    if (mode === 'lock') f.access.lock('Signed out');
    if (mode === 'dispose') f.access.dispose();
    await expect(
      adapter.getUnitOnRev(context, {
        unitID: mode === 'unit' ? 'other' : 'unit',
        type: mode === 'type' ? 2 : 1,
        revision: 3,
      }),
    ).rejects.toThrow(/scope|account/);
  },
);
test('reentrant account checks cannot release content after a local lock', async () => {
  const f = fixture();
  let lock = false;
  const adapter = new LocalReplaySnapshot(f.access, f.bundle, () => {
    if (lock) f.access.lock('Changed');
    return 'owner';
  });
  lock = true;
  await expect(
    adapter.getUnitOnRev(context, { unitID: 'unit', type: 1, revision: 3 }),
  ).rejects.toThrow();
});
test('local adapters never write snapshots, fabricate acknowledgements or answer remote identity lookups', async () => {
  const adapter = fixture().adapter();
  for (const method of [
    'saveSnapshot',
    'updateSnapshot',
    'saveSheetBlock',
    'saveChangeset',
    'copyFileMeta',
    'getLatestCsReqIdBySid',
  ] as const)
    await expect(adapter[method]()).rejects.toThrow(/read-only/);
});

test.each([
  'unknown ordered sheet',
  'duplicate ordered sheet',
  'unlisted worksheet',
  'mismatched worksheet',
  'nonbinary worksheet',
  'negative row count',
  'sparse order',
  'inherited sheet name',
  'sparse mutations',
  'missing mutations',
  'malformed mutation id',
  'malformed mutation data',
  'sparse resources',
  'malformed resource',
  'duplicate resource name',
  'duplicate resource id',
  'duplicate preserved name',
  'sparse tail',
  'sparse blocks',
])('%s rejects an incomplete or ambiguous prepared bundle', (mode) => {
  const f = fixture('sheet'),
    workbook = f.bundle.data.snapshot.workbook!;
  if (mode === 'unknown ordered sheet') workbook.sheetOrder.push('unknown');
  if (mode === 'duplicate ordered sheet') workbook.sheetOrder.push('sheet');
  if (mode === 'unlisted worksheet')
    workbook.sheets.extra = { ...workbook.sheets.sheet, id: 'extra' };
  if (mode === 'mismatched worksheet') workbook.sheets.sheet.id = 'wrong';
  if (mode === 'nonbinary worksheet') Object.assign(workbook.sheets.sheet, { originalMeta: [5] });
  if (mode === 'negative row count') workbook.sheets.sheet.rowCount = -1;
  if (mode === 'sparse order') workbook.sheetOrder.length = 2;
  if (mode === 'inherited sheet name') workbook.sheetOrder = ['toString'];
  if (mode === 'sparse mutations') f.bundle.data.changesets[0].mutations.length = 2;
  if (mode === 'missing mutations')
    Object.assign(f.bundle.data.changesets[0], { mutations: undefined });
  if (mode === 'malformed mutation id')
    Object.assign(f.bundle.data.changesets[0].mutations[0], { id: 5 });
  if (mode === 'malformed mutation data')
    Object.assign(f.bundle.data.changesets[0].mutations[0], { data: {} });
  if (mode === 'sparse resources') workbook.resources.length = 2;
  if (mode === 'malformed resource') Object.assign(workbook.resources[0], { data: {} });
  if (mode === 'duplicate resource name')
    workbook.resources.push({ name: 'opaque', data: 'other' });
  if (mode === 'duplicate resource id')
    workbook.resources.push({ id: 'known-resource', name: 'other', data: '' });
  if (mode === 'duplicate preserved name')
    f.bundle.preservedResources.push({ name: 'another', data: 'other' });
  if (mode === 'sparse tail') Object.assign(f.bundle.data, { changesets: Array(1) });
  if (mode === 'sparse blocks') Object.assign(f.bundle.data, { sheetBlocks: Array(1) });
  expect(() => f.adapter()).toThrow();
});

test('a prepared zero-revision base remains readable with no invented tail', async () => {
  const f = fixture();
  f.bundle.data.snapshot.rev = 0;
  f.bundle.data.snapshot.doc!.rev = 0;
  Object.assign(f.bundle.data, { targetRevision: 0, changesets: [] });
  const result = await f.adapter().getUnitOnRev(context, { unitID: 'unit', type: 1, revision: 0 });
  expect(result.snapshot.rev).toBe(0);
  expect(result.changesets).toEqual([]);
});

test('inactive and empty worksheets retain their own metadata without requiring nonexistent blocks', async () => {
  const f = fixture('sheet'),
    workbook = f.bundle.data.snapshot.workbook!;
  workbook.sheetOrder.push('inactive');
  workbook.sheets.inactive = {
    ...workbook.sheets.sheet,
    id: 'inactive',
    name: 'Inactive',
    originalMeta: new Uint8Array([17]),
  };
  const result = await f.adapter().getUnitOnRev(context, { unitID: 'unit', type: 2, revision: 3 });
  expect(result.snapshot.workbook!.sheetOrder).toEqual(['sheet', 'inactive']);
  expect(result.snapshot.workbook!.sheets.inactive.originalMeta).toEqual(new Uint8Array([17]));
  expect(result.snapshot.workbook!.blockMeta.inactive).toBeUndefined();
});
