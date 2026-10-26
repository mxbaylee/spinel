import { afterEach, expect, test, vi } from 'vitest';
import { getDocsEmptySnapshot, JSONX, LocaleType, TextXActionType } from '@univerjs/core';
import type { IWorkbookData } from '@univerjs/core';
import type { Mutation } from '@spinel/sync-transform';
import { docFormulas, formulaBody } from '@spinel/doc-formulas';
import { hashTouched, materialize, snapshotCells, SyncServer } from '../index.ts';
import type { SubmitRequest, SyncCommit, SyncRevision, SyncStorage, SyncUnit } from '../index.ts';
import { cellsAt } from '../src/cells.ts';
import { NativeModel } from '../src/native.ts';

class MemoryStorage implements SyncStorage {
  units = new Map<string, SyncUnit>();
  edits: SyncRevision[] = [];
  fail = false;
  beforeGuard = () => {};
  load(id: string) { return structuredClone(this.units.get(id)); }
  receipt(id: string, actor: string, mutation: string) {
    return structuredClone(this.edits.find((edit) => edit.unitId === id && edit.actorId === actor && edit.mutationId === mutation));
  }
  revisions(id: string, after: number, through: number) {
    return structuredClone(this.edits.filter((edit) => edit.unitId === id && edit.revision > after && edit.revision <= through));
  }
  commit(input: SyncCommit, guard: () => void) {
    this.beforeGuard();
    guard();
    if (this.fail) throw new Error('Simulated durable write failure');
    if (this.units.get(input.unit.unitId)?.revision !== input.expectedRevision) throw new Error('CAS');
    this.units.set(input.unit.unitId, structuredClone(input.unit));
    this.edits.push(structuredClone(input.edit));
  }
}

const open: SyncServer<void>[] = [];
afterEach(async () => { for (const server of open.splice(0)) await server.close(); vi.restoreAllMocks(); });
function workbook(id = 'book'): IWorkbookData {
  return {
    id, name: 'Book', appVersion: '1.1.0', locale: LocaleType.EN_US,
    styles: { bold: { bl: 1 } }, sheetOrder: ['first', 'second'],
    sheets: {
      first: { id: 'first', name: 'One', rowCount: 100, columnCount: 26, cellData: { 0: { 0: { v: 42, s: 'bold' } } } },
      second: { id: 'second', name: 'Two', rowCount: 100, columnCount: 26, cellData: {} },
    },
  };
}
const write = (value: Record<string, unknown>, row = 0, column = 0) => ({
  id: 'sheet.mutation.set-range-values', params: { unitId: 'book', subUnitId: 'first', cellValue: { [row]: { [column]: value } } },
});
function request(mutationId: string, mutations: Mutation[] = [write({ v: 99 })], baseRevision = 1): SubmitRequest {
  return { unitId: 'book', actorId: 'owner', mutationId, baseRevision, mutations };
}
function fixture(options: Partial<ConstructorParameters<typeof SyncServer<void>>[1]> = {}) {
  const storage = new MemoryStorage();
  storage.units.set('book', { unitId: 'book', kind: 'sheet', revision: 1, retainedFrom: 1, snapshot: materialize(workbook(), 'sheet') });
  const server = new SyncServer<void>(storage, { authorize() {}, ...options });
  open.push(server);
  const cell = (row = 0, column = 0) => snapshotCells(server.load('book', undefined).snapshot as IWorkbookData)('book', 'first', row, column);
  return { storage, server, cell };
}

test('two simultaneous editors get consecutive durable revisions and keep unrelated cell keys', async () => {
  const f = fixture();
  const [first, second] = await Promise.all([
    f.server.submit(request('first', [write({ v: 99 })]), undefined),
    f.server.submit({ ...request('second', [write({ s: { it: 1 } })]), actorId: 'collaborator' }, undefined),
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
  expect(await restarted.submit(sent, undefined)).toMatchObject({ duplicate: true, edit: accepted.edit });
  await expect(restarted.submit(request('stable-id', [write({ v: 5 })]), undefined)).rejects.toMatchObject({ code: 'retry-conflict' });
  expect(f.storage.edits).toHaveLength(1);
});

test('failed persistence never acknowledges or contaminates the next materialized candidate', async () => {
  const f = fixture();
  f.storage.fail = true;
  await expect(f.server.submit(request('failed'), undefined)).rejects.toThrow('Simulated durable write failure');
  expect(f.storage.edits).toHaveLength(0);
  expect(f.cell()?.v).toBe(42);
  f.storage.fail = false;
  const next = await f.server.submit(request('next', [write({ s: { it: 1 } })]), undefined);
  expect(next.edit.revision).toBe(2);
  expect(f.cell()).toMatchObject({ v: 42, s: { bl: 1, it: 1 } });
});

test('authorization is repeated after asynchronous preparation and inside the durable boundary', async () => {
  let authorized = true;
  const f = fixture({ authorize() { if (!authorized) throw new Error('revoked'); } });
  f.storage.beforeGuard = () => { authorized = false; };
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
  const f = fixture({ async beforeSubmit(id) { expect(server.load(id, undefined).revision).toBe(1); } });
  server = f.server;
  expect((await server.submit(request('read-first'), undefined)).edit.revision).toBe(2);
});

test('revocation during beforeSubmit is refused before native work', async () => {
  let authorized = true;
  const f = fixture({
    authorize() { if (!authorized) throw new Error('revoked'); },
    async beforeSubmit() { await Promise.resolve(); authorized = false; },
  });
  await expect(f.server.submit(request('revoked-before'), undefined)).rejects.toThrow('revoked');
  expect(f.storage.edits).toHaveLength(0);
});

test('exact-revision assistant writes reject stale work but a lost acknowledgement retries once', async () => {
  const f = fixture();
  const assistant = { ...request('assistant'), exactRevision: true };
  await f.server.submit(assistant, undefined);
  await expect(f.server.submit({ ...request('stale'), exactRevision: true }, undefined)).rejects.toMatchObject({ code: 'stale' });
  expect((await f.server.submit(assistant, undefined)).duplicate).toBe(true);
  expect(f.storage.edits).toHaveLength(1);
});

test('before-images reconstruct exact style-resolved bases after insertion, changes and removal', async () => {
  const f = fixture();
  await f.server.submit(request('insert', [{ id: 'sheet.mutation.insert-row', params: { unitId: 'book', subUnitId: 'first', range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 25 } } }]), undefined);
  await f.server.submit(request('style-old-base', [write({ s: { it: 1 } })]), undefined);
  expect(f.cell(1)).toMatchObject({ v: 42, s: { bl: 1, it: 1 } });
  const head = f.storage.load('book')!;
  const base = cellsAt(head, 1, f.storage.revisions('book', 1, head.revision));
  expect(base('book', 'first', 0, 0)).toMatchObject({ v: 42, s: { bl: 1 } });
  expect(base('book', 'first', 1, 0)).toBeNull();
  await f.server.submit(request('remove', [{ id: 'sheet.mutation.remove-sheet', params: { unitId: 'book', subUnitId: 'first', index: 0 } }], 3), undefined);
  const removed = f.storage.load('book')!;
  const original = cellsAt(removed, 1, f.storage.revisions('book', 1, removed.revision));
  expect(original('book', 'first', 0, 0)).toMatchObject({ v: 42, s: { bl: 1 } });
});

test('expired transform retention resyncs new submissions while old receipts stay idempotent', async () => {
  const f = fixture();
  const sent = request('retained-receipt');
  await f.server.submit(sent, undefined);
  f.storage.units.get('book')!.retainedFrom = 2;
  f.storage.edits[0].beforeCells = null;
  await expect(f.server.submit(request('too-old'), undefined)).rejects.toMatchObject({ code: 'stale' });
  expect(await f.server.submit(sent, undefined)).toMatchObject({ duplicate: true, missing: [] });
});

test.each([
  [{ id: 'sheet.mutation.remove-sheet', params: { unitId: 'book', subUnitId: 'first', index: 0 } }, { id: 'sheet.mutation.remove-sheet', params: { unitId: 'book', subUnitId: 'second', index: 0 } }],
  [{ id: 'sheet.mutation.set-worksheet-hidden', params: { unitId: 'book', subUnitId: 'first', hidden: 1 } }, { id: 'sheet.mutation.set-worksheet-hidden', params: { unitId: 'book', subUnitId: 'second', hidden: 2 } }],
  [{ id: 'sheet.mutation.set-worksheet-name', params: { unitId: 'book', subUnitId: 'second', name: 'oNe' } }],
].map((mutations) => ({ mutations })))('invalid final worksheet invariants refuse the whole batch', async ({ mutations }) => {
  const f = fixture();
  await expect(f.server.submit(request('invalid', mutations), undefined)).rejects.toMatchObject({ code: 'invariant' });
  expect(f.storage.edits).toHaveLength(0);
  expect((f.server.load('book', undefined).snapshot as IWorkbookData).sheetOrder).toEqual(['first', 'second']);
});

test('concurrent hides preserve the first accepted edit and refuse the last visible sheet', async () => {
  const f = fixture();
  const hide = (subUnitId: string) => ({ id: 'sheet.mutation.set-worksheet-hidden', params: { unitId: 'book', subUnitId, hidden: 1 } });
  await f.server.submit(request('hide-first', [hide('first')]), undefined);
  await expect(f.server.submit(request('hide-second', [hide('second')]), undefined)).rejects.toMatchObject({ code: 'invariant' });
  expect(f.storage.load('book')?.revision).toBe(2);
});

test('unknown commands, cross-unit payloads, forged claims and oversized ranges fail before commit', async () => {
  const f = fixture();
  await expect(f.server.submit(request('unknown', [{ id: 'secret-user-input', params: { unitId: 'book' } }]), undefined)).rejects.toMatchObject({ code: 'unsupported' });
  await expect(f.server.submit(request('cross-unit', [write({ p: { id: 'rich-doc', drawings: { a: { unitId: 'other' } } } })]), undefined)).rejects.toMatchObject({ code: 'malformed' });
  await expect(f.server.submit(request('claim', [{ id: 'sheet.mutation.set-range-values', params: { unitId: 'book', subUnitId: 'first', isOverrideStyle: true, cellValue: { 0: { 0: { v: 'forged', 'sync-transform.cells.claim': { v: 'different' } } } } } }]), undefined)).rejects.toMatchObject({ code: 'malformed' });
  await expect(f.server.submit(request('wide', [{ id: 'sheet.mutation.remove.numfmt', params: { unitId: 'book', subUnitId: 'first', ranges: [{ startRow: 0, endRow: 1_048_575, startColumn: 0, endColumn: 16_383 }] } }]), undefined)).rejects.toMatchObject({ code: 'capacity' });
  expect(f.storage.edits).toHaveLength(0);
});

test('divergence hashes ignore native derived cell keys and record only fixed diagnostics', async () => {
  const events: unknown[] = [];
  const f = fixture({ diagnostics: (event, context) => { events.push({ event, context }); } });
  const accepted = await f.server.submit(request('secret-id', [write({ v: 'private contents' })]), undefined);
  const snapshot = f.server.load('book', undefined).snapshot as IWorkbookData;
  expect(hashTouched(snapshot, accepted.edit.touched)).toBe(accepted.edit.hash);
  snapshot.sheets.first.cellData![0][0]!.t = 4;
  expect(hashTouched(snapshot, accepted.edit.touched)).toBe(accepted.edit.hash);
  snapshot.sheets.first.cellData![0][0]!.v = 'diverged';
  expect(f.server.verify('book', 2, hashTouched(snapshot, accepted.edit.touched), undefined)).toBe(false);
  expect(f.server.verify('book', 2, accepted.edit.hash, undefined)).toBe(true);
  expect(JSON.stringify(events)).not.toContain('private contents');
  expect(JSON.stringify(events)).not.toContain('secret-id');
  expect(events).toContainEqual(expect.objectContaining({ event: expect.objectContaining({ name: 'sync.divergence.detected' }) }));
});

test('native Docs keep Formula metadata, opaque resources and ordered concurrent text across reopen', async () => {
  const f = fixture();
  const formula = formulaBody('formula', { expression: '=1+1', references: [], format: 'general', version: 1 });
  const initial = getDocsEmptySnapshot('doc');
  initial.body = { ...formula, dataStream: `${formula.dataStream}\r\n` };
  initial.resources = [{ name: 'SPINEL_OPAQUE_PLUGIN', data: '{"kept":true}' }];
  f.storage.units.set('doc', { unitId: 'doc', kind: 'doc', revision: 1, retainedFrom: 1, snapshot: materialize(initial, 'doc') });
  const insertion = (text: string): SubmitRequest => ({
    unitId: 'doc', actorId: 'owner', mutationId: text, baseRevision: 1,
    mutations: [{ id: 'doc.mutation.rich-text-editing', params: { unitId: 'doc', textRanges: [], actions: JSONX.getInstance().editOp([{ t: TextXActionType.INSERT, len: text.length, body: { dataStream: text } }]) } }],
  });
  await f.server.submit(insertion('A'), undefined);
  await f.server.submit(insertion('B'), undefined);
  const loaded = f.server.load('doc', undefined);
  expect('body' in loaded.snapshot && loaded.snapshot.body?.dataStream).toBe('AB=1+1\r\n');
  const reopened = materialize(loaded.snapshot, 'doc');
  expect(docFormulas('body' in reopened ? reopened.body : undefined)).toMatchObject([{ id: 'formula', definition: { expression: '=1+1' } }]);
  expect(reopened.resources).toContainEqual(initial.resources[0]);
});

test('cache evicts at capacity and after idle time and disposes every remaining native instance', async () => {
  let now = 0;
  const dispose = vi.spyOn(NativeModel.prototype, 'dispose');
  const f = fixture({ maxLoadedUnits: 1, idleTimeoutMs: 10, now: () => now });
  const before = dispose.mock.calls.length;
  f.server.load('book', undefined);
  const second = materialize(workbook('other'), 'sheet');
  f.storage.units.set('other', { unitId: 'other', kind: 'sheet', revision: 1, retainedFrom: 1, snapshot: second });
  f.server.load('other', undefined);
  expect(dispose.mock.calls.length).toBe(before + 2); // preparation + capacity eviction
  now = 11;
  f.server.load('other', undefined);
  expect(dispose.mock.calls.length).toBe(before + 3);
  await f.server.close();
  expect(dispose.mock.calls.length).toBe(before + 4);
});
