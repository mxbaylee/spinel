import {
  BooleanNumber,
  FormulaType,
  IUniverInstanceService,
  UniverInstanceType,
} from '@univerjs/core';
import type { IWorkbookData, Workbook } from '@univerjs/core';
import { expect, test } from 'vitest';
import { hashTouched } from '../index.ts';
import { book, wire } from './fixture.ts';
import { nativeSession } from './native-session.ts';
import type { NativePeer } from './native-session.ts';

test('peer formulas and their dependencies calculate automatically on live delivery and resume without echo', async () => {
  const initial = book();
  initial.sheets.one.cellData = { 0: { 0: { v: 2 }, 4: { f: '=A1+100' } }, 1: { 0: { v: 3 } } };
  const f = nativeSession(initial, 'sheet');
  const author = f.client('author');
  const observer = f.client('observer');
  const sheet = (peer: NativePeer) =>
    peer.live.univer
      .__getInjector()
      .get(IUniverInstanceService)
      .getUnit<Workbook>('book', UniverInstanceType.UNIVER_SHEET)!
      .getSheetBySheetId('one')!;
  const values = (peer: NativePeer) => {
    const current = sheet(peer);
    return [
      [0, 1],
      [0, 2],
      [1, 1],
      [3, 1],
      [4, 2],
      [0, 4],
    ].map(([row, column]) => current.getCell(row, column)?.v);
  };
  try {
    await expect
      .poll(() => [sheet(author).getCell(0, 4)?.v, sheet(observer).getCell(0, 4)?.v])
      .toEqual([102, 102]);
    expect(
      await author.commands.executeCommand('sheet.command.set-range-values', {
        unitId: 'book',
        subUnitId: 'one',
        range: { startRow: 0, endRow: 4, startColumn: 1, endColumn: 2 },
        value: {
          0: { 1: { f: '=A1*2', si: 'shared-peer', ft: FormulaType.SHARED }, 2: { f: '=A1*3' } },
          1: { 1: { si: 'shared-peer' } },
          3: {
            1: { f: '={1,2;3,4}', ft: FormulaType.ARRAY, fd: BooleanNumber.TRUE, ref: 'B4:C5' },
          },
        },
      }),
    ).toBe(true);
    const first = await f.submit(author, await f.request(author));
    await f.acknowledge(author, first);
    observer.sync.receive({ type: 'edit', ...wire(first.edit) });
    // Do not force a calculation: the real remote mutation must register formulas
    // and trigger the native engine just as a local command does.
    await expect
      .poll(() => [values(author), values(observer)], { timeout: 2000 })
      .toEqual([
        [4, 6, 6, 1, 4, 102],
        [4, 6, 6, 1, 4, 102],
      ]);

    observer.sync.setConnected(false);
    expect(
      await author.commands.executeCommand('sheet.command.set-range-values', {
        unitId: 'book',
        subUnitId: 'one',
        range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 },
        value: { 0: { 0: { v: 5 } }, 1: { 0: { v: 7 } } },
      }),
    ).toBe(true);
    const second = await f.submit(author, await f.request(author));
    await f.acknowledge(author, second);
    f.resume(observer);
    await expect
      .poll(() => [values(author), values(observer)], { timeout: 2000 })
      .toEqual([
        [10, 15, 14, 1, 4, 105],
        [10, 15, 14, 1, 4, 105],
      ]);
    expect(observer.outgoing.filter((frame) => frame.type === 'submit')).toEqual([]);
    expect(author.outgoing.filter((frame) => frame.type === 'submit')).toHaveLength(2);
    for (const peer of [author, observer]) {
      expect(peer.failures).toEqual([]);
      expect(peer.sync.state).toMatchObject({ pending: false, resyncing: false });
      expect(await hashTouched(peer.live.snapshot(), second.edit.touched)).toBe(second.edit.hash);
    }
    const stored = f.storage.unit.snapshot as IWorkbookData;
    expect(stored.sheets.one.cellData![0][1].f).toBe('=A1*2');
    expect(stored.sheets.one.cellData![0][1].v ?? null).toBeNull();
    expect(stored.sheets.one.cellData![3][1].f).toBe('={1,2;3,4}');
  } finally {
    f.close();
  }
});
