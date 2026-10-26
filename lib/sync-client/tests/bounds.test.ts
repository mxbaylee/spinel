import { ICommandService } from '@univerjs/core';
import { cellsAfter } from '@spinel/sync-transform';
import { expect, test } from 'vitest';
import { captureNative, NativeReplica } from '../index.ts';
import { byteBudget } from '../src/hash.ts';
import { book, write } from './fixture.ts';

test('native cell readers charge expanded shared styles and long addresses before retaining clones', () => {
  for (const longId of [false, true]) {
    const snapshot = book();
    const sheetId = longId ? 's'.repeat(30 * 1024) : 'one';
    const sheet = snapshot.sheets.one;
    snapshot.sheets = { [sheetId]: { ...sheet, id: sheetId } };
    snapshot.sheetOrder = [sheetId];
    snapshot.styles = { shared: { ff: 'f'.repeat(30 * 1024) } };
    snapshot.sheets[sheetId].cellData = Object.fromEntries(
      Array.from({ length: 400 }, (_, row) => [row, { 0: longId ? { v: row } : { s: 'shared' } }]),
    );
    const replica = new NativeReplica(snapshot, 'sheet');
    try {
      const read = replica.cells();
      let count = 0;
      expect(() => {
        for (let row = 0; row < 400; row++) {
          read('book', sheetId, row, 0);
          count++;
        }
      }).toThrow('Sync capacity');
      expect(count).toBeGreaterThan(100);
      expect(count).toBeLessThan(400);
    } finally {
      replica.dispose();
    }
  }
});

test('the pending base shares one budget across intermediate native merge caches', () => {
  const replica = new NativeReplica(book(), 'sheet');
  try {
    const large = { ff: 'f'.repeat(30 * 1024) };
    const edits = Array.from({ length: 180 }, (_, row) => write({ s: large }, row));
    const read = cellsAfter(replica.cells(), edits, byteBudget());
    expect(() => {
      for (let row = 0; row < 180; row++) read('book', 'one', row, 0);
    }).toThrow('Sync capacity');
  } finally {
    replica.dispose();
  }
});

test('native capture refuses a compact mutation before shared styles expand past its budget', () => {
  const snapshot = book();
  snapshot.styles = { shared: { ff: 'f'.repeat(30 * 1024) } };
  const replica = new NativeReplica(snapshot, 'sheet');
  const failures: string[] = [];
  let sent = false;
  const capture = captureNative({
    univer: replica.univer,
    unitId: 'book',
    onMutation() {
      sent = true;
    },
    onFailure: (reason) => failures.push(reason),
  });
  try {
    replica.univer
      .__getInjector()
      .get(ICommandService)
      .syncExecuteCommand(
        'sheet.mutation.set-range-values',
        {
          unitId: 'book',
          subUnitId: 'one',
          cellValue: Object.fromEntries(
            Array.from({ length: 400 }, (_, row) => [row, { 0: { s: 'shared' } }]),
          ),
        },
        { syncOnly: true },
      );
    expect(sent).toBe(false);
    expect(failures).toEqual(['capacity']);
  } finally {
    capture.dispose();
    replica.dispose();
  }
});

test('native snapshots are admitted before a runtime or clone is allocated', () => {
  const snapshot = book();
  snapshot.name = 'x'.repeat(11 * 1024 * 1024);
  expect(() => new NativeReplica(snapshot, 'sheet')).toThrow('Sync capacity');
});

test('compact merge snapshots cannot expand an unbounded native cache', () => {
  const snapshot = book();
  snapshot.sheets.one.mergeData = [{ startRow: 0, endRow: 1000, startColumn: 0, endColumn: 1000 }];
  expect(() => new NativeReplica(snapshot, 'sheet')).toThrow('Sync capacity');
  snapshot.sheets.one.mergeData = [{ startRow: 0, endRow: 499, startColumn: 0, endColumn: 499 }];
  snapshot.sheets.two.mergeData = [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }];
  expect(() => new NativeReplica(snapshot, 'sheet')).toThrow('Sync capacity');
});
