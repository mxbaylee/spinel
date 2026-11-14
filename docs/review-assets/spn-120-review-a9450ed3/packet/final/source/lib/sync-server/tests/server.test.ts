import { afterEach, expect, test, vi } from 'vitest';
import {
  getDocsEmptySnapshot,
  JSONX,
  LocaleType,
  TextXActionType,
  Univer,
  mergeWorksheetSnapshotWithDefault,
} from '@univerjs/core';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import type { Mutation } from '@spinel/sync-transform';
import type { DiagnosticEvent } from '@spinel/diagnostics';
import { docFormulas, formulaBody, parseFormula } from '@spinel/doc-formulas';
import type { FormulaDefinition } from '@spinel/doc-formulas';
import {
  hashTouched,
  materialize,
  snapshotCells,
  SyncServer,
  validateSnapshot,
  MAX_WORKSHEETS,
  MAX_RETAINED_BYTES,
  MAX_RETAINED_REVISIONS,
} from '../index.ts';
import type { SubmitRequest, SyncCommit, SyncRevision, SyncStorage, SyncUnit } from '../index.ts';
import { cellsAt } from '../src/cells.ts';
import { NativeModel } from '../src/native.ts';
import { applySheetOrder } from '../src/order.ts';

class MemoryStorage implements SyncStorage {
  units = new Map<string, SyncUnit>();
  edits: SyncRevision[] = [];
  fail = false;
  beforeGuard = () => {};
  load(id: string) {
    return structuredClone(this.units.get(id));
  }
  receipt(id: string, actor: string, mutation: string) {
    return structuredClone(
      this.edits.find(
        (edit) => edit.unitId === id && edit.actorId === actor && edit.mutationId === mutation,
      ),
    );
  }
  revisions(id: string, after: number, through: number) {
    return structuredClone(
      this.edits.filter(
        (edit) => edit.unitId === id && edit.revision > after && edit.revision <= through,
      ),
    );
  }
  commit(input: SyncCommit, guard: () => void) {
    this.beforeGuard();
    guard();
    if (this.fail) throw new Error('Simulated durable write failure');
    if (this.units.get(input.unit.unitId)?.revision !== input.expectedRevision)
      throw new Error('CAS');
    this.units.set(input.unit.unitId, structuredClone(input.unit));
    this.edits.push(structuredClone(input.edit));
  }
}

const open: SyncServer<void>[] = [];
afterEach(async () => {
  for (const server of open.splice(0)) await server.close();
  vi.restoreAllMocks();
});
function workbook(id = 'book'): IWorkbookData {
  return {
    id,
    name: 'Book',
    appVersion: '1.1.0',
    locale: LocaleType.EN_US,
    styles: { bold: { bl: 1 } },
    sheetOrder: ['first', 'second'],
    sheets: {
      first: {
        id: 'first',
        name: 'One',
        rowCount: 100,
        columnCount: 26,
        cellData: { 0: { 0: { v: 42, s: 'bold' } } },
      },
      second: { id: 'second', name: 'Two', rowCount: 100, columnCount: 26, cellData: {} },
    },
  };
}
const write = (value: Record<string, unknown>, row = 0, column = 0) => ({
  id: 'sheet.mutation.set-range-values',
  params: { unitId: 'book', subUnitId: 'first', cellValue: { [row]: { [column]: value } } },
});
const insertSheet = (id: string, index: number): Mutation => ({
  id: 'sheet.mutation.insert-sheet',
  params: {
    unitId: 'book',
    index,
    sheet: mergeWorksheetSnapshotWithDefault({
      id,
      name: id,
      rowCount: 10,
      columnCount: 5,
      cellData: {},
    }),
  },
});
const removeSheet = (subUnitId: string, index: number): Mutation => ({
  id: 'sheet.mutation.remove-sheet',
  params: { unitId: 'book', subUnitId, index },
});
const moveSheet = (subUnitId: string, fromOrder: number, toOrder: number): Mutation => ({
  id: 'sheet.mutation.set-worksheet-order',
  params: { unitId: 'book', subUnitId, fromOrder, toOrder },
});
function request(
  mutationId: string,
  mutations: Mutation[] = [write({ v: 99 })],
  baseRevision = 1,
): SubmitRequest {
  return { unitId: 'book', actorId: 'owner', mutationId, baseRevision, mutations };
}
function fixture(options: Partial<ConstructorParameters<typeof SyncServer<void>>[1]> = {}) {
  const storage = new MemoryStorage();
  storage.units.set('book', {
    unitId: 'book',
    kind: 'sheet',
    revision: 1,
    retainedFrom: 1,
    snapshot: materialize(workbook(), 'sheet'),
  });
  const server = new SyncServer<void>(storage, { authorize() {}, ...options });
  open.push(server);
  const cell = (row = 0, column = 0) =>
    snapshotCells(server.load('book', undefined).snapshot as IWorkbookData)(
      'book',
      'first',
      row,
      column,
    );
  return { storage, server, cell };
}

test('two simultaneous editors get consecutive durable revisions and keep unrelated cell keys', async () => {
  const f = fixture();
  const [first, second] = await Promise.all([
    f.server.submit(request('first', [write({ v: 99 })]), undefined),
    f.server.submit(
      { ...request('second', [write({ s: { it: 1 } })]), actorId: 'collaborator' },
      undefined,
    ),
  ]);
  expect([first.edit.revision, second.edit.revision]).toEqual([2, 3]);
  expect(second.missing.map((edit) => edit.revision)).toEqual([2, 3]);
  expect(f.cell()).toMatchObject({ v: 99, s: { bl: 1, it: 1 } });
  expect(f.storage.edits).toHaveLength(2);
  expect(second.edit.mutations).toEqual(f.storage.edits[1].mutations);
});

test('a receipt survives server restart and rejects reused identity with different content', async () => {
  const f = fixture();
  const sent = request('stable-id');
  const accepted = await f.server.submit(sent, undefined);
  await f.server.close();
  const restarted = new SyncServer<void>(f.storage, { authorize() {} });
  open.push(restarted);
  expect(await restarted.submit(sent, undefined)).toMatchObject({
    duplicate: true,
    edit: accepted.edit,
  });
  await expect(
    restarted.submit(request('stable-id', [write({ v: 5 })]), undefined),
  ).rejects.toMatchObject({ code: 'retry-conflict' });
  expect(f.storage.edits).toHaveLength(1);
});

test('failed persistence never acknowledges or contaminates the next materialized candidate', async () => {
  const f = fixture();
  f.storage.fail = true;
  await expect(f.server.submit(request('failed'), undefined)).rejects.toThrow(
    'Simulated durable write failure',
  );
  expect(f.storage.edits).toHaveLength(0);
  expect(f.cell()?.v).toBe(42);
  f.storage.fail = false;
  const next = await f.server.submit(request('next', [write({ s: { it: 1 } })]), undefined);
  expect(next.edit.revision).toBe(2);
  expect(f.cell()).toMatchObject({ v: 42, s: { bl: 1, it: 1 } });
});

test('expanded long-ID footprints refuse before commit and leave the next valid edit usable', async () => {
  const f = fixture();
  const sheetId = 's'.repeat(30 * 1024);
  const inserted = insertSheet(sheetId, 2);
  inserted.params.sheet.name = 'Long ID';
  await f.server.submit(request('long-sheet', [inserted]), undefined);
  const range = (end: number): Mutation => ({
    id: 'sheet.mutation.remove.numfmt',
    params: {
      unitId: 'book',
      subUnitId: sheetId,
      ranges: [{ startRow: 0, endRow: end, startColumn: 0, endColumn: end }],
    },
  });
  const oversized = request('expanded-footprint', [range(19)], 2);
  expect(Buffer.byteLength(JSON.stringify(oversized))).toBeLessThan(64 * 1024);
  await expect(f.server.submit(oversized, undefined)).rejects.toMatchObject({ code: 'capacity' });
  expect(f.storage.load('book')?.revision).toBe(2);
  expect(f.storage.receipt('book', 'owner', 'expanded-footprint')).toBeUndefined();
  expect(f.server.load('book', undefined).revision).toBe(2);
  const accepted = await f.server.submit(request('bounded-footprint', [range(1)], 2), undefined);
  expect(accepted.edit.revision).toBe(3);
  expect(accepted.edit.touched).toMatchObject({ kind: 'sheet', cells: expect.any(Array) });
  expect(f.storage.edits).toHaveLength(2);
  await f.server.submit(request('ordinary-after-capacity', [write({ v: 123 })], 3), undefined);
  expect(f.cell()?.v).toBe(123);
});

test('a large admitted cell does not prevent a neighboring edit from reaching persistence or retrying', async () => {
  const f = fixture();
  const large = 'v'.repeat(6 * 1024 * 1024);
  await f.server.submit(request('large-cell', [write({ v: large })]), undefined);
  const neighbor = request('neighbor', [write({ v: 'nearby' }, 0, 1)], 2);
  f.storage.fail = true;
  await expect(f.server.submit(neighbor, undefined)).rejects.toThrow(
    'Simulated durable write failure',
  );
  expect(f.storage.load('book')?.revision).toBe(2);
  expect(f.storage.receipt('book', 'owner', 'neighbor')).toBeUndefined();
  f.storage.fail = false;
  const accepted = await f.server.submit(neighbor, undefined);
  expect(accepted.edit.revision).toBe(3);
  expect(f.cell()?.v).toBe(large);
  expect(f.cell(0, 1)?.v).toBe('nearby');
});

async function outcomeFixture() {
  const events: DiagnosticEvent[] = [];
  const f = fixture({ diagnostics: (event) => events.push(event) });
  await f.server.submit(request('earlier-cell', [write({ v: 100 })]), undefined);
  await f.server.submit(
    request(
      'earlier-shift',
      [
        write({ v: 200 }, 0, 1),
        {
          id: 'sheet.mutation.move-range',
          params: {
            unitId: 'book',
            fromRange: { startRow: 1, endRow: 2, startColumn: 0, endColumn: 0 },
            toRange: { startRow: 2, endRow: 3, startColumn: 0, endColumn: 0 },
            from: { subUnitId: 'first', value: { 1: { 0: null }, 2: { 0: null } } },
            to: { subUnitId: 'first', value: { 2: { 0: null }, 3: { 0: null } } },
            shift: { axis: 'row', kind: 'insert', at: 1, count: 1 },
          },
        },
      ],
      2,
    ),
    undefined,
  );
  events.length = 0;
  const incoming = request('stale-outcomes', [
    write({ v: 'overwritten once' }),
    write({ v: 'overwritten twice' }, 0, 1),
    write({ v: 'beside clipped band' }, 2, 1),
  ]);
  const outcomes = () =>
    events.filter((event) => /^sync\.edit\.(dropped|offset)(\.log)?$/.test(event.name));
  return { ...f, events, incoming, outcomes };
}

test('drop and offset outcomes count only a committed retry, once across all transforms', async () => {
  const f = await outcomeFixture();
  f.storage.fail = true;
  await expect(f.server.submit(f.incoming, undefined)).rejects.toThrow(
    'Simulated durable write failure',
  );
  expect(f.outcomes()).toEqual([]);
  expect(f.events.some((event) => event.name === 'sync.edit.transformed')).toBe(true);
  expect(f.events.some((event) => event.name === 'sync.transform.duration')).toBe(true);
  expect(f.storage.load('book')?.revision).toBe(3);
  expect(f.cell(2, 1)).toBeNull();
  f.storage.fail = false;
  const accepted = await f.server.submit(f.incoming, undefined);
  expect(accepted.duplicate).toBe(false);
  expect(f.outcomes()).toEqual([
    {
      name: 'sync.edit.dropped',
      details: { rule: 'cell-overwritten' },
      metric: { kind: 'counter', unit: 'count', value: 2 },
    },
    { name: 'sync.edit.dropped.log', details: { rule: 'cell-overwritten' }, level: 'debug' },
    {
      name: 'sync.edit.offset',
      details: {},
      metric: { kind: 'counter', unit: 'count', value: 1 },
    },
    { name: 'sync.edit.offset.log', details: {}, level: 'debug' },
  ]);
  expect(f.cell(2, 1)?.v).toBe('beside clipped band');
  expect((await f.server.submit(f.incoming, undefined)).duplicate).toBe(true);
  expect(f.outcomes()).toHaveLength(4);
  expect(f.storage.edits).toHaveLength(3);
});

test('a final invariant refusal emits no drop or offset outcome from its earlier transforms', async () => {
  const f = await outcomeFixture();
  f.incoming.mutations.push(
    ...['first', 'second'].map((subUnitId) => ({
      id: 'sheet.mutation.set-worksheet-hidden',
      params: { unitId: 'book', subUnitId, hidden: 1 },
    })),
  );
  await expect(f.server.submit(f.incoming, undefined)).rejects.toMatchObject({ code: 'invariant' });
  expect(f.outcomes()).toEqual([]);
  expect(f.events).toContainEqual({
    name: 'sync.invariant.failed',
    details: { invariant: 'no-visible-sheet' },
    metric: { kind: 'counter', unit: 'count', value: 1 },
  });
  expect(f.events.some((event) => event.name === 'sync.transform.duration')).toBe(true);
  expect(f.storage.load('book')?.revision).toBe(3);
  expect(f.cell(2, 1)).toBeNull();
});

test('authorization is repeated after asynchronous preparation and inside the durable boundary', async () => {
  let authorized = true;
  const f = fixture({
    authorize() {
      if (!authorized) throw new Error('revoked');
    },
  });
  f.storage.beforeGuard = () => {
    authorized = false;
  };
  await expect(f.server.submit(request('revoked'), undefined)).rejects.toThrow('revoked');
  expect(f.storage.edits).toHaveLength(0);
  authorized = true;
  f.storage.beforeGuard = () => {};
  await f.server.submit(request('accepted'), undefined);
  authorized = false;
  await expect(f.server.submit(request('accepted'), undefined)).rejects.toThrow('revoked');
});

test('beforeSubmit may read the accepted head without deadlocking', async () => {
  let server: SyncServer<void>;
  const f = fixture({
    async beforeSubmit(id) {
      expect(server.load(id, undefined).revision).toBe(1);
    },
  });
  server = f.server;
  expect((await server.submit(request('read-first'), undefined)).edit.revision).toBe(2);
});

test('revocation during beforeSubmit is refused before native work', async () => {
  let authorized = true;
  const f = fixture({
    authorize() {
      if (!authorized) throw new Error('revoked');
    },
    async beforeSubmit() {
      await Promise.resolve();
      authorized = false;
    },
  });
  await expect(f.server.submit(request('revoked-before'), undefined)).rejects.toThrow('revoked');
  expect(f.storage.edits).toHaveLength(0);
});

test('exact-revision assistant writes reject stale work but a lost acknowledgement retries once', async () => {
  const f = fixture();
  const assistant = { ...request('assistant'), exactRevision: true };
  await f.server.submit(assistant, undefined);
  await expect(
    f.server.submit({ ...request('stale'), exactRevision: true }, undefined),
  ).rejects.toMatchObject({ code: 'stale' });
  expect((await f.server.submit(assistant, undefined)).duplicate).toBe(true);
  expect(f.storage.edits).toHaveLength(1);
});

test('offline replay admission fences a raced head without changing the durable retry identity', async () => {
  const f = fixture();
  const original = request('offline-retry', [write({ v: 'offline' })]);
  const first = await f.server.submit({ ...original, expectedRevision: 1 }, undefined);
  expect(first.edit.revision).toBe(2);
  // A post-crash replay is conservative even when the advance was our own
  // accepted edit. The host retains it for attention rather than replaying.
  await expect(
    f.server.submit({ ...original, expectedRevision: 1 }, undefined),
  ).rejects.toMatchObject({ code: 'stale' });
  expect((await f.server.submit(original, undefined)).duplicate).toBe(true);
  expect((await f.server.submit({ ...original, expectedRevision: 2 }, undefined)).duplicate).toBe(
    true,
  );
  const peer = request('peer-before-replay', [write({ v: 'peer' }, 1)], 2);
  await f.server.submit(peer, undefined);
  await expect(
    f.server.submit({ ...request('offline-after-peer'), expectedRevision: 2 }, undefined),
  ).rejects.toMatchObject({ code: 'stale' });
  expect(f.cell()?.v).toBe('offline');
  expect(f.storage.edits).toHaveLength(2);
});

test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null])(
  'offline replay guard rejects invalid expected revision %s',
  async (expectedRevision) => {
    const f = fixture();
    await expect(
      f.server.submit(
        { ...request('bad-replay'), expectedRevision: expectedRevision as number },
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'malformed' });
    expect(f.storage.edits).toHaveLength(0);
  },
);

test('before-images reconstruct exact style-resolved bases after insertion, changes and removal', async () => {
  const f = fixture();
  await f.server.submit(
    request('insert', [
      {
        id: 'sheet.mutation.insert-row',
        params: {
          unitId: 'book',
          subUnitId: 'first',
          range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 25 },
        },
      },
    ]),
    undefined,
  );
  await f.server.submit(request('style-old-base', [write({ s: { it: 1 } })]), undefined);
  expect(f.cell(1)).toMatchObject({ v: 42, s: { bl: 1, it: 1 } });
  const head = f.storage.load('book')!;
  const base = cellsAt(head, 1, f.storage.revisions('book', 1, head.revision));
  expect(base('book', 'first', 0, 0)).toMatchObject({ v: 42, s: { bl: 1 } });
  expect(base('book', 'first', 1, 0)).toBeNull();
  await f.server.submit(
    request(
      'remove',
      [
        {
          id: 'sheet.mutation.remove-sheet',
          params: { unitId: 'book', subUnitId: 'first', index: 0 },
        },
      ],
      3,
    ),
    undefined,
  );
  const removed = f.storage.load('book')!;
  const original = cellsAt(removed, 1, f.storage.revisions('book', 1, removed.revision));
  expect(original('book', 'first', 0, 0)).toMatchObject({ v: 42, s: { bl: 1 } });
});

test('unbounded worksheet positions are rejected before transformation or native replay', async () => {
  const events: { name: string }[] = [];
  const f = fixture({
    diagnostics: (event) => {
      events.push(event);
    },
  });
  await f.server.submit(request('earlier-insert', [insertSheet('new', 1)]), undefined);
  const apply = vi.spyOn(NativeModel.prototype, 'apply');
  events.length = 0;
  for (const [i, mutation] of [
    insertSheet('malicious', 1_000_000_000),
    removeSheet('first', 1_000_000_000),
    moveSheet('first', 1_000_000_000, 1),
    moveSheet('first', 0, 1_000_000_000),
  ].entries()) {
    await expect(
      f.server.submit(request(`bad-position-${i}`, [mutation]), undefined),
    ).rejects.toMatchObject({ code: 'capacity' });
  }
  expect(apply).not.toHaveBeenCalled();
  expect(events.some((event) => event.name === 'sync.edit.transformed')).toBe(false);
  expect(f.storage.edits).toHaveLength(1);
});

test('stale removal uses its exact base order and retains transformed position metadata', async () => {
  const f = fixture();
  await f.server.submit(request('insert-middle', [insertSheet('new', 1)]), undefined);
  // The original second sheet was index1, but is now index2. Checking only the
  // current order would refuse this honest stale edit or accept a forged one.
  const accepted = await f.server.submit(
    request('stale-remove', [removeSheet('second', 1)]),
    undefined,
  );
  expect(accepted.edit.mutations).toEqual([removeSheet('second', 2)]);
  expect((f.server.load('book', undefined).snapshot as IWorkbookData).sheetOrder).toEqual([
    'first',
    'new',
  ]);
});

test('false base positions that happen to match the live order are rejected before transform', async () => {
  const f = fixture();
  await f.server.submit(request('earlier-move', [moveSheet('second', 1, 0)]), undefined);
  const apply = vi.spyOn(NativeModel.prototype, 'apply');
  await expect(
    f.server.submit(request('false-remove', [removeSheet('first', 1)]), undefined),
  ).rejects.toMatchObject({ code: 'malformed' });
  await expect(
    f.server.submit(request('false-move', [moveSheet('first', 1, 0)]), undefined),
  ).rejects.toMatchObject({ code: 'malformed' });
  expect(apply).not.toHaveBeenCalled();
  expect(f.storage.edits).toHaveLength(1);
  expect((f.server.load('book', undefined).snapshot as IWorkbookData).sheetOrder).toEqual([
    'second',
    'first',
  ]);
});

test('concurrent insert and reorder retain the native IDs and exact current positions', async () => {
  const f = fixture();
  await f.server.submit(request('insert-first', [insertSheet('new', 0)]), undefined);
  const accepted = await f.server.submit(
    request('stale-move', [moveSheet('second', 1, 0)]),
    undefined,
  );
  expect(accepted.edit.mutations).toEqual([moveSheet('second', 2, 1)]);
  const snapshot = f.server.load('book', undefined).snapshot as IWorkbookData;
  expect(snapshot.sheetOrder).toEqual(['new', 'second', 'first']);
  expect((materialize(snapshot, 'sheet') as IWorkbookData).sheetOrder).toEqual(snapshot.sheetOrder);
});

test('concurrent remove and insertion transform against the original position', async () => {
  const f = fixture();
  await f.server.submit(request('remove-first', [removeSheet('first', 0)]), undefined);
  const accepted = await f.server.submit(
    request('stale-insert', [insertSheet('new', 2)]),
    undefined,
  );
  expect(accepted.edit.mutations).toEqual([insertSheet('new', 1)]);
  expect((f.server.load('book', undefined).snapshot as IWorkbookData).sheetOrder).toEqual([
    'second',
    'new',
  ]);
});

test('worksheet positions are validated at each step of one submitted batch', async () => {
  const f = fixture();
  await expect(
    f.server.submit(
      request('false-second-index', [removeSheet('first', 0), removeSheet('second', 1)]),
      undefined,
    ),
  ).rejects.toMatchObject({ code: 'malformed' });
  expect(f.storage.edits).toHaveLength(0);
  await f.server.submit(
    request('valid-steps', [
      removeSheet('first', 0),
      moveSheet('second', 0, 0),
      insertSheet('new', 1),
    ]),
    undefined,
  );
  expect((f.server.load('book', undefined).snapshot as IWorkbookData).sheetOrder).toEqual([
    'second',
    'new',
  ]);
});

test('exact base order rolls back a retained sequence of insertion, reorder and removal', async () => {
  const f = fixture();
  await f.server.submit(request('insert', [insertSheet('new', 1)]), undefined);
  await f.server.submit(request('move', [moveSheet('second', 2, 0)], 2), undefined);
  await f.server.submit(request('remove-new', [removeSheet('new', 2)], 3), undefined);
  const accepted = await f.server.submit(
    request('old-base-insert', [insertSheet('last', 2)]),
    undefined,
  );
  expect(accepted.edit.revision).toBe(5);
  expect((f.server.load('book', undefined).snapshot as IWorkbookData).sheetOrder).toEqual([
    'second',
    'first',
    'last',
  ]);
});

test('worksheet-count limits are checked without constructing oversized native instances', () => {
  const order = Array.from({ length: MAX_WORKSHEETS }, (_, index) => `s${index}`);
  expect(() => applySheetOrder(order, [insertSheet('overflow', order.length)])).toThrow();
  const snapshot = workbook();
  snapshot.sheetOrder = [...order, 'overflow'];
  expect(() => validateSnapshot(snapshot, 'sheet')).toThrow();
});

test('expired transform retention resyncs new submissions while old receipts stay idempotent', async () => {
  const f = fixture();
  const sent = request('retained-receipt');
  await f.server.submit(sent, undefined);
  f.storage.units.get('book')!.retainedFrom = 2;
  f.storage.edits[0].beforeCells = null;
  await expect(f.server.submit(request('too-old'), undefined)).rejects.toMatchObject({
    code: 'stale',
  });
  expect(await f.server.submit(sent, undefined)).toMatchObject({ duplicate: true, missing: [] });
});

test('replay returns each exact accepted edit in durable order and supports an empty current-head replay', async () => {
  const f = fixture();
  const first = await f.server.submit(
    request('replay-first', [
      {
        ...write({ v: 101 }),
        params: { ...write({ v: 101 }).params, trigger: 'sheet.command.set-range-values' },
      },
    ]),
    undefined,
  );
  const second = await f.server.submit(
    request('replay-second', [write({ s: { it: 1 } })]),
    undefined,
  );
  expect(f.server.replay('book', 1, undefined)).toEqual({
    revision: 3,
    edits: [first.edit, second.edit],
  });
  expect(f.server.replay('book', 2, undefined)).toEqual({ revision: 3, edits: [second.edit] });
  expect(f.server.replay('book', 3, undefined)).toEqual({ revision: 3, edits: [] });
});

test('replay fails closed on missing, out-of-order, foreign or pruned retained rows', async () => {
  const f = fixture();
  await f.server.submit(request('replay-first'), undefined);
  await f.server.submit(request('replay-second', [write({ v: 2 })], 2), undefined);
  const edits = structuredClone(f.storage.edits);
  const revisions = vi.spyOn(f.storage, 'revisions');
  for (const invalid of [
    [edits[1]],
    [edits[1], edits[0]],
    [edits[0], { ...edits[1], unitId: 'foreign' }],
    [{ ...edits[0], beforeCells: null }, edits[1]],
  ]) {
    revisions.mockReturnValueOnce(invalid);
    expect(() => f.server.replay('book', 1, undefined)).toThrow(/stale/);
  }
});

test('replay validates revisions and enforces retained count and byte bounds before delivery', async () => {
  const f = fixture();
  for (const invalid of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    expect(() => f.server.replay('book', invalid, undefined)).toThrow(/malformed/);
  expect(() => f.server.replay('', 1, undefined)).toThrow(/malformed/);
  expect(() => f.server.replay('x'.repeat(129), 1, undefined)).toThrow(/malformed/);
  expect(() => f.server.replay('book', 2, undefined)).toThrow(/stale/);
  f.storage.units.get('book')!.revision = MAX_RETAINED_REVISIONS + 2;
  const revisions = vi.spyOn(f.storage, 'revisions');
  expect(() => f.server.replay('book', 1, undefined)).toThrow(/stale/);
  expect(revisions).not.toHaveBeenCalled();
  f.storage.units.get('book')!.revision = 1;
  await f.server.submit(request('large-replay'), undefined);
  f.storage.edits[0].mutations[0].params.padding = 'x'.repeat(MAX_RETAINED_BYTES);
  expect(() => f.server.replay('book', 1, undefined)).toThrow(/stale/);
});

test('replay retention expiry leaves immutable old receipts retryable', async () => {
  const f = fixture();
  const sent = request('lost-ack');
  const accepted = await f.server.submit(sent, undefined);
  f.storage.units.get('book')!.retainedFrom = 2;
  f.storage.edits[0].beforeCells = null;
  expect(() => f.server.replay('book', 1, undefined)).toThrow(/stale/);
  expect(f.server.replay('book', 2, undefined)).toEqual({ revision: 2, edits: [] });
  expect(await f.server.submit(sent, undefined)).toMatchObject({
    duplicate: true,
    edit: { revision: accepted.edit.revision, hash: accepted.edit.hash },
    missing: [],
  });
});

test('replay rechecks read authorization after its storage read and refuses after shutdown', async () => {
  let allowed = true;
  const authorize = vi.fn((_unitId: string, _context: void, edit: boolean) => {
    expect(edit).toBe(false);
    if (!allowed) throw new Error('Read access changed');
  });
  const f = fixture({ authorize });
  const revisions = vi.spyOn(f.storage, 'revisions').mockImplementation(() => {
    allowed = false;
    return [];
  });
  expect(() => f.server.replay('book', 1, undefined)).toThrow('Read access changed');
  expect(authorize).toHaveBeenCalledTimes(2);
  revisions.mockClear();
  expect(() => f.server.replay('book', 1, undefined)).toThrow('Read access changed');
  expect(revisions).not.toHaveBeenCalled();
  await f.server.close();
  expect(() => f.server.replay('book', 1, undefined)).toThrow(/unavailable/);
});

test.each(
  [
    [
      {
        id: 'sheet.mutation.remove-sheet',
        params: { unitId: 'book', subUnitId: 'first', index: 0 },
      },
      {
        id: 'sheet.mutation.remove-sheet',
        params: { unitId: 'book', subUnitId: 'second', index: 0 },
      },
    ],
    [
      {
        id: 'sheet.mutation.set-worksheet-hidden',
        params: { unitId: 'book', subUnitId: 'first', hidden: 1 },
      },
      {
        id: 'sheet.mutation.set-worksheet-hidden',
        params: { unitId: 'book', subUnitId: 'second', hidden: 2 },
      },
    ],
    [
      {
        id: 'sheet.mutation.set-worksheet-name',
        params: { unitId: 'book', subUnitId: 'second', name: 'oNe' },
      },
    ],
  ].map((mutations) => ({ mutations })),
)('invalid final worksheet invariants refuse the whole batch', async ({ mutations }) => {
  const f = fixture();
  await expect(f.server.submit(request('invalid', mutations), undefined)).rejects.toMatchObject({
    code: 'invariant',
  });
  expect(f.storage.edits).toHaveLength(0);
  expect((f.server.load('book', undefined).snapshot as IWorkbookData).sheetOrder).toEqual([
    'first',
    'second',
  ]);
});

test('concurrent hides preserve the first accepted edit and refuse the last visible sheet', async () => {
  const f = fixture();
  const hide = (subUnitId: string) => ({
    id: 'sheet.mutation.set-worksheet-hidden',
    params: { unitId: 'book', subUnitId, hidden: 1 },
  });
  await f.server.submit(request('hide-first', [hide('first')]), undefined);
  await expect(
    f.server.submit(request('hide-second', [hide('second')]), undefined),
  ).rejects.toMatchObject({ code: 'invariant' });
  expect(f.storage.load('book')?.revision).toBe(2);
});

test('unknown commands, cross-unit payloads, forged claims and oversized ranges fail before commit', async () => {
  const f = fixture();
  await expect(
    f.server.submit(
      request('unknown', [{ id: 'secret-user-input', params: { unitId: 'book' } }]),
      undefined,
    ),
  ).rejects.toMatchObject({ code: 'unsupported' });
  await expect(
    f.server.submit(
      request('cross-unit', [
        write({ p: { id: 'rich-doc', drawings: { a: { unitId: 'other' } } } }),
      ]),
      undefined,
    ),
  ).rejects.toMatchObject({ code: 'malformed' });
  await expect(
    f.server.submit(
      request('drawing-other', [
        {
          id: 'sheet.mutation.set-drawing-apply',
          params: {
            unitId: 'book',
            subUnitId: 'first',
            op: ['other', 'first', { i: { data: {}, order: [] } }],
            objects: [],
            type: 0,
          },
        },
      ]),
      undefined,
    ),
  ).rejects.toMatchObject({ code: 'malformed' });
  await expect(
    f.server.submit(
      request('claim', [
        {
          id: 'sheet.mutation.set-range-values',
          params: {
            unitId: 'book',
            subUnitId: 'first',
            isOverrideStyle: true,
            cellValue: {
              0: { 0: { v: 'forged', 'sync-transform.cells.claim': { v: 'different' } } },
            },
          },
        },
      ]),
      undefined,
    ),
  ).rejects.toMatchObject({ code: 'malformed' });
  await expect(
    f.server.submit(
      request('wide', [
        {
          id: 'sheet.mutation.remove.numfmt',
          params: {
            unitId: 'book',
            subUnitId: 'first',
            ranges: [{ startRow: 0, endRow: 1_048_575, startColumn: 0, endColumn: 16_383 }],
          },
        },
      ]),
      undefined,
    ),
  ).rejects.toMatchObject({ code: 'capacity' });
  expect(f.storage.edits).toHaveLength(0);
});

test('known resource parse failures are refused rather than silently replaced with empty data', () => {
  const initial = workbook();
  initial.resources = [{ name: 'SHEET_DRAWING_PLUGIN', data: '{broken' }];
  expect(() => materialize(initial, 'sheet')).toThrow();
});

test('native logging cannot expose snapshot values or malformed resource content', () => {
  const sentinel = 'private-native-sentinel-8a741c';
  const logs = ['log', 'warn', 'error', 'debug', 'info'].map((method) =>
    vi.spyOn(console, method as 'log').mockImplementation(() => {}),
  );
  const invalidDate = workbook();
  Object.assign(invalidDate, { dateSystem: sentinel });
  expect((materialize(invalidDate, 'sheet') as IWorkbookData).dateSystem).toBe('date1900');
  const malformedResource = workbook();
  malformedResource.resources = [{ name: 'SHEET_DRAWING_PLUGIN', data: `${sentinel}{invalid` }];
  expect(() => materialize(malformedResource, 'sheet')).toThrow();
  const output = logs
    .flatMap((log) => log.mock.calls.flatMap((args) => args.map(String)))
    .join('\n');
  expect(output).not.toContain(sentinel);
  expect(output).toBe('');
});

test('axis-only and malformed range/count/metadata shapes are rejected before native work', async () => {
  const f = fixture();
  const apply = vi.spyOn(NativeModel.prototype, 'apply');
  const cases: Mutation[] = [
    {
      id: 'sheet.mutation.set-row-hidden',
      params: {
        unitId: 'book',
        subUnitId: 'first',
        ranges: [{ startRow: 0, endRow: 1_000_000_000 }],
      },
    },
    {
      id: 'sheet.mutation.set-col-hidden',
      params: {
        unitId: 'book',
        subUnitId: 'first',
        ranges: [{ startColumn: 0, endColumn: 1_000_000_000 }],
      },
    },
    {
      id: 'sheet.mutation.set-row-hidden',
      params: { unitId: 'book', subUnitId: 'first', ranges: [{ startRow: 0 }] },
    },
    {
      id: 'sheet.mutation.set-row-hidden',
      params: { unitId: 'book', subUnitId: 'first', ranges: [{ startRow: '0', endRow: '100' }] },
    },
    {
      id: 'sheet.mutation.set-row-hidden',
      params: { unitId: 'book', subUnitId: 'first', ranges: [{}] },
    },
    {
      id: 'sheet.mutation.set-row-hidden',
      params: {
        unitId: 'book',
        subUnitId: 'first',
        ranges: [
          { startRow: 0, endRow: 149_999 },
          { startRow: 0, endRow: 149_999 },
        ],
      },
    },
    {
      id: 'sheet.mutation.set-worksheet-row-count',
      params: { unitId: 'book', subUnitId: 'first', rowCount: 1_000_000_000 },
    },
    {
      id: 'sheet.mutation.set-worksheet-column-count',
      params: { unitId: 'book', subUnitId: 'first', columnCount: '100' },
    },
    {
      id: 'sheet.mutation.set-row-data',
      params: { unitId: 'book', subUnitId: 'first', rowData: { 1_000_000_000: { h: 20 } } },
    },
    {
      id: 'sheet.mutation.set-col-data',
      params: { unitId: 'book', subUnitId: 'first', columnData: { invalid: { w: 20 } } },
    },
  ];
  for (let i = 0; i < cases.length; i++)
    await expect(
      f.server.submit(request(`bounded-${i}`, [cases[i]]), undefined),
    ).rejects.toMatchObject({ resync: true });
  expect(apply).not.toHaveBeenCalled();
  expect(f.storage.edits).toHaveLength(0);
  // Ordinary axis-only ranges and frozen anchors still have native support.
  await f.server.submit(
    request('small-axis', [
      {
        id: 'sheet.mutation.set-row-hidden',
        params: { unitId: 'book', subUnitId: 'first', ranges: [{ startRow: 2, endRow: 3 }] },
      },
    ]),
    undefined,
  );
  expect(apply).toHaveBeenCalledOnce();
  await f.server.submit(
    request(
      'cancel-freeze',
      [
        {
          id: 'sheet.mutation.set-frozen',
          params: {
            unitId: 'book',
            subUnitId: 'first',
            startRow: -1,
            startColumn: -1,
            xSplit: 0,
            ySplit: 0,
          },
        },
      ],
      2,
    ),
    undefined,
  );
  expect((f.server.load('book', undefined).snapshot as IWorkbookData).sheets.first.freeze).toEqual({
    startRow: -1,
    startColumn: -1,
    xSplit: 0,
    ySplit: 0,
  });
});

test('forged Doc body edits cannot remove its mandatory terminal markers', async () => {
  const f = fixture();
  const initial = getDocsEmptySnapshot('doc');
  f.storage.units.set('doc', {
    unitId: 'doc',
    kind: 'doc',
    revision: 1,
    retainedFrom: 1,
    snapshot: materialize(initial, 'doc'),
  });
  const malformed: SubmitRequest = {
    unitId: 'doc',
    actorId: 'owner',
    mutationId: 'bad-body',
    baseRevision: 1,
    mutations: [
      {
        id: 'doc.mutation.rich-text-editing',
        params: {
          unitId: 'doc',
          textRanges: [],
          actions: ['body', 'dataStream', { r: '\r\n', i: 'unterminated' }],
        },
      },
    ],
  };
  await expect(f.server.submit(malformed, undefined)).rejects.toMatchObject({ code: 'malformed' });
  expect(f.storage.edits).toHaveLength(0);
  expect('body' in f.server.load('doc', undefined).snapshot).toBe(true);
});

test('the final candidate rejects count overflow without opening an oversized native model', () => {
  for (const [rowCount, columnCount] of [
    [1_048_577, 26],
    [100, 16_385],
    [0, 26],
    [100, NaN],
  ]) {
    const candidate = workbook();
    Object.assign(candidate.sheets.first, { rowCount, columnCount });
    expect(() => validateSnapshot(candidate, 'sheet')).toThrow();
  }
});

test('snapshot merge ranges are bounded before any native unit allocation', () => {
  const create = vi.spyOn(Univer.prototype, 'createUnit').mockImplementation(() => {
    throw new Error('Native allocation must not be reached');
  });
  const cases = [
    [{ startRow: 0, endRow: 1_000_000_000, startColumn: 0, endColumn: 0 }],
    [{ startRow: 0, endRow: 250_000, rangeType: 1 }],
    [{ startColumn: 0, endColumn: 1_000_000_000, rangeType: 2 }],
    [{ startRow: '0', endRow: '2', startColumn: 0, endColumn: 0 }],
    [{ startRow: 0, startColumn: 0, endColumn: 0 }],
    [
      { startRow: 0, endRow: 499, startColumn: 0, endColumn: 299 },
      { startRow: 500, endRow: 999, startColumn: 0, endColumn: 299 },
    ],
  ];
  for (const ranges of cases) {
    const snapshot = workbook();
    snapshot.sheets.first.mergeData = ranges as IWorkbookData['sheets'][string]['mergeData'];
    expect(() => materialize(snapshot, 'sheet')).toThrow();
  }
  const acrossSheets = workbook();
  acrossSheets.sheets.first.mergeData = [
    { startRow: 0, endRow: 499, startColumn: 0, endColumn: 299 },
  ];
  acrossSheets.sheets.second.mergeData = structuredClone(acrossSheets.sheets.first.mergeData);
  expect(() => materialize(acrossSheets, 'sheet')).toThrow();
  expect(create).not.toHaveBeenCalled();
});

test('separate bounded merge edits cannot overflow the live total before native replay', () => {
  const snapshot = workbook();
  Object.assign(snapshot.sheets.first, { rowCount: 1000, columnCount: 1000 });
  const model = new NativeModel(snapshot, 'sheet');
  const merge = (startRow: number, endRow: number): Mutation => ({
    id: 'sheet.mutation.add-worksheet-merge',
    params: {
      unitId: 'book',
      subUnitId: 'first',
      ranges: [{ startRow, endRow, startColumn: 0, endColumn: 299 }],
    },
  });
  try {
    model.apply([merge(0, 499)]);
    expect(() => model.apply([merge(500, 999)])).toThrow();
    expect((model.snapshot() as IWorkbookData).sheets.first.mergeData).toEqual([
      { startRow: 0, endRow: 499, startColumn: 0, endColumn: 299 },
    ]);
    model.apply([
      {
        id: 'sheet.mutation.remove-worksheet-merge',
        params: {
          unitId: 'book',
          subUnitId: 'first',
          ranges: [{ startRow: 0, endRow: 499, startColumn: 0, endColumn: 299 }],
        },
      },
      merge(500, 999),
    ]);
    expect((model.snapshot() as IWorkbookData).sheets.first.mergeData).toEqual([
      { startRow: 500, endRow: 999, startColumn: 0, endColumn: 299 },
    ]);
  } finally {
    model.dispose();
  }
});

test('managed defined-name resources survive changes, cache eviction and native reopen', async () => {
  const f = fixture();
  const addName: Mutation = {
    id: 'formula.mutation.set-defined-name',
    params: {
      unitId: 'book',
      id: 'N',
      name: 'budget',
      formulaOrRefString: 'One!$A$1',
      localSheetId: null,
    },
  };
  await f.server.submit(request('add-name', [addName]), undefined);
  const before = f.server.load('book', undefined).snapshot;
  expect(JSON.stringify(before.resources)).toContain('budget');
  f.server.invalidate('book');
  const reloaded = f.server.load('book', undefined).snapshot;
  expect(reloaded.resources).toEqual(before.resources);
  expect(materialize(reloaded, 'sheet').resources).toEqual(before.resources);
});

test('divergence hashes ignore native derived cell keys and record only fixed diagnostics', async () => {
  const events: unknown[] = [];
  const f = fixture({
    diagnostics: (event, context) => {
      events.push({ event, context });
    },
  });
  const accepted = await f.server.submit(
    request('secret-id', [write({ v: 'private contents' })]),
    undefined,
  );
  const snapshot = f.server.load('book', undefined).snapshot as IWorkbookData;
  expect(hashTouched(snapshot, accepted.edit.touched)).toBe(accepted.edit.hash);
  snapshot.sheets.first.cellData![0][0]!.t = 4;
  expect(hashTouched(snapshot, accepted.edit.touched)).toBe(accepted.edit.hash);
  snapshot.sheets.first.cellData![0][0]!.v = 'diverged';
  expect(f.server.verify('book', 2, hashTouched(snapshot, accepted.edit.touched), undefined)).toBe(
    false,
  );
  expect(f.server.verify('book', 2, accepted.edit.hash, undefined)).toBe(true);
  expect(JSON.stringify(events)).not.toContain('private contents');
  expect(JSON.stringify(events)).not.toContain('secret-id');
  expect(events).toContainEqual(
    expect.objectContaining({
      event: expect.objectContaining({ name: 'sync.divergence.detected' }),
    }),
  );
});

test('same-value writes still hash their touched cell without storing a needless before-image', async () => {
  const f = fixture();
  const accepted = await f.server.submit(request('unchanged', [write({ v: 42 })]), undefined);
  expect(accepted.edit.touched).toEqual({
    kind: 'sheet',
    cells: [{ sheetId: 'first', row: 0, column: 0 }],
  });
  const snapshot = f.server.load('book', undefined).snapshot as IWorkbookData;
  expect(hashTouched(snapshot, accepted.edit.touched)).toBe(accepted.edit.hash);
  snapshot.sheets.first.cellData![0][0]!.v = 'wrong';
  expect(f.server.verify('book', 2, hashTouched(snapshot, accepted.edit.touched), undefined)).toBe(
    false,
  );
});

test('cell footprints hash identically across locales with different Unicode collation', () => {
  const snapshot = workbook();
  snapshot.sheets['ä'] = { ...snapshot.sheets.first, id: 'ä', name: 'Accent' };
  snapshot.sheets.z = { ...snapshot.sheets.first, id: 'z', name: 'Zed' };
  const touched = {
    kind: 'sheet' as const,
    cells: [
      { sheetId: 'ä', row: 0, column: 0 },
      { sheetId: 'z', row: 0, column: 0 },
    ],
  };
  const nativeCompare = String.prototype.localeCompare;
  const collation = vi.spyOn(String.prototype, 'localeCompare');
  collation.mockImplementation(function (this: string, other) {
    return nativeCompare.call(this, other, 'en');
  });
  const english = hashTouched(snapshot, touched);
  collation.mockImplementation(function (this: string, other) {
    return nativeCompare.call(this, other, 'sv');
  });
  const swedish = hashTouched(snapshot, touched);
  expect(english).toBe(swedish);
});

function referencedFormula() {
  const expression = '=Budget.Sheet1.A1';
  const reference = parseFormula(expression)[0];
  const definition: FormulaDefinition = {
    expression,
    version: 1,
    format: 'currency',
    references: [
      {
        start: reference.start,
        end: reference.end,
        range: reference.range,
        itemId: 'budget-item',
        sheetId: 'first',
      },
    ],
  };
  const body = formulaBody('saved-total', definition);
  body.dataStream += '\r\n';
  return { body, definition };
}

test('a native Doc body replacement preserves Formula reference text named range', async () => {
  const f = fixture();
  const { body, definition } = referencedFormula();
  const initial = { ...getDocsEmptySnapshot('doc'), body };
  f.storage.units.set('doc', {
    unitId: 'doc',
    kind: 'doc',
    revision: 1,
    retainedFrom: 1,
    snapshot: materialize(initial, 'doc'),
  });
  const original = f.server.load('doc', undefined).snapshot as IDocumentData;
  const updated = { ...original.body!, dataStream: `${original.body!.dataStream}More text\r\n` };
  const accepted = await f.server.submit(
    {
      unitId: 'doc',
      actorId: 'owner',
      mutationId: 'formula-body-edit',
      baseRevision: 1,
      mutations: [
        {
          id: 'doc.mutation.rich-text-editing',
          params: {
            unitId: 'doc',
            textRanges: [],
            actions: new JSONX().replaceOp(['body'], original.body, updated),
          },
        },
      ],
    },
    undefined,
  );
  expect(accepted.edit.revision).toBe(2);
  f.server.invalidate('doc');
  const reopened = f.server.load('doc', undefined).snapshot as IDocumentData;
  expect(reopened.body?.dataStream).toBe(updated.dataStream);
  expect(docFormulas(reopened.body)[0].definition).toEqual(definition);
  expect(definition.references[0].range).toBe('A1');
});

test('Sheet rich text and opaque metadata stay distinct from bounded native geometry', async () => {
  const f = fixture();
  const apply = vi.spyOn(NativeModel.prototype, 'apply');
  const custom = {
    range: 'A1',
    ranges: 'Saved selection label',
    rowCount: 'A descriptive count',
    endRow: 'bottom',
    endColumn: 'right',
    columnData: { label: 'opaque' },
    rectangle: { startRow: 0, endRow: 1_000_000_000, startColumn: 0, endColumn: 0 },
  };
  const unsafe: Mutation[] = [
    {
      id: 'sheet.mutation.set-row-hidden',
      params: {
        unitId: 'book',
        subUnitId: 'first',
        custom,
        ranges: [{ startRow: 0, endRow: 1_000_000_000 }],
      },
    },
    write({ custom: { ...custom, nested: { unitId: 'another-unit' } } }),
    write({ custom: { ...custom, nested: JSON.parse('{"constructor":"reserved"}') } }),
    write({ custom: { ...custom, nested: { value: Infinity } } }),
  ];
  for (let i = 0; i < unsafe.length; i++)
    await expect(
      f.server.submit(request(`metadata-unsafe-${i}`, [unsafe[i]]), undefined),
    ).rejects.toMatchObject({ resync: true });
  expect(apply).not.toHaveBeenCalled();
  const isSafeInteger = Number.isSafeInteger;
  vi.spyOn(Number, 'isSafeInteger').mockImplementation((value) => {
    // If footprint code regresses to rectangle inference, stop before its loop.
    if (value === custom.rectangle.endRow) throw new Error('Opaque rectangle reached geometry');
    return isSafeInteger(value);
  });
  const { body, definition } = referencedFormula();
  const rich = { ...getDocsEmptySnapshot('embedded-doc'), body };
  const accepted = await f.server.submit(
    request('rich-metadata', [write({ p: rich, custom }, 4, 2)]),
    undefined,
  );
  expect(apply).toHaveBeenCalledOnce();
  expect(accepted.edit.touched).toEqual({
    kind: 'sheet',
    cells: [{ sheetId: 'first', row: 4, column: 2 }],
  });
  expect(docFormulas(f.cell(4, 2)?.p?.body)[0].definition).toEqual(definition);
  expect(f.cell(4, 2)?.custom).toEqual(custom);
});

test('native Docs keep Formula metadata, opaque resources and ordered concurrent text across reopen', async () => {
  const f = fixture();
  const formula = formulaBody('formula', {
    expression: '=1+1',
    references: [],
    format: 'general',
    version: 1,
  });
  const initial = getDocsEmptySnapshot('doc');
  initial.body = { ...formula, dataStream: `${formula.dataStream}\r\n` };
  initial.resources = [{ name: 'SPINEL_OPAQUE_PLUGIN', data: '{"kept":true}' }];
  f.storage.units.set('doc', {
    unitId: 'doc',
    kind: 'doc',
    revision: 1,
    retainedFrom: 1,
    snapshot: materialize(initial, 'doc'),
  });
  const insertion = (text: string): SubmitRequest => ({
    unitId: 'doc',
    actorId: 'owner',
    mutationId: text,
    baseRevision: 1,
    mutations: [
      {
        id: 'doc.mutation.rich-text-editing',
        params: {
          unitId: 'doc',
          textRanges: [],
          actions: JSONX.getInstance().editOp([
            { t: TextXActionType.INSERT, len: text.length, body: { dataStream: text } },
          ]),
        },
      },
    ],
  });
  await f.server.submit(insertion('A'), undefined);
  await f.server.submit(insertion('B'), undefined);
  const loaded = f.server.load('doc', undefined);
  expect('body' in loaded.snapshot && loaded.snapshot.body?.dataStream).toBe('AB=1+1\r\n');
  const reopened = materialize(loaded.snapshot, 'doc');
  expect(docFormulas('body' in reopened ? reopened.body : undefined)).toMatchObject([
    { id: 'formula', definition: { expression: '=1+1' } },
  ]);
  expect(reopened.resources).toContainEqual(initial.resources[0]);
});

test('cache evicts at capacity and after idle time and disposes every remaining native instance', async () => {
  let now = 0;
  const dispose = vi.spyOn(NativeModel.prototype, 'dispose');
  const f = fixture({ maxLoadedUnits: 1, idleTimeoutMs: 10, now: () => now });
  const before = dispose.mock.calls.length;
  f.server.load('book', undefined);
  const second = materialize(workbook('other'), 'sheet');
  f.storage.units.set('other', {
    unitId: 'other',
    kind: 'sheet',
    revision: 1,
    retainedFrom: 1,
    snapshot: second,
  });
  f.server.load('other', undefined);
  expect(dispose.mock.calls.length).toBe(before + 2); // preparation + capacity eviction
  now = 11;
  f.server.load('other', undefined);
  expect(dispose.mock.calls.length).toBe(before + 3);
  await f.server.close();
  expect(dispose.mock.calls.length).toBe(before + 4);
});
