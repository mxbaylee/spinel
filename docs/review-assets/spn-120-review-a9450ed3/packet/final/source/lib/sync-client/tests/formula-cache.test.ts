import {
  BooleanNumber,
  FormulaType,
  IUniverInstanceService,
  UniverInstanceType,
} from '@univerjs/core';
import type { IWorkbookData, Workbook } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import '@univerjs/sheets/facade';
import '@univerjs/engine-formula/facade';
import '@univerjs/sheets-formula/facade';
import { expect, test } from 'vitest';
import { hashTouched } from '../index.ts';
import { book, turns } from './fixture.ts';
import { nativeSession } from './native-session.ts';

test.each(['before acknowledgment', 'after acknowledgment'] as const)(
  'native scalar, shared and array calculation %s preserves authored verification',
  async (timing) => {
    const initial = book();
    initial.sheets.one.cellData = { 0: { 0: { v: 12 } }, 1: { 0: { v: 7 } } };
    const f = nativeSession(initial, 'sheet');
    const peer = f.client('author');
    const api = FUniver.newAPI(peer.live.univer);
    const calculate = async () => {
      api.getFormula().executeCalculation();
      await api.getFormula().onCalculationResultApplied(5000);
    };
    try {
      expect(
        await peer.commands.executeCommand('sheet.command.set-range-values', {
          unitId: 'book',
          subUnitId: 'one',
          range: { startRow: 0, endRow: 3, startColumn: 1, endColumn: 2 },
          value: {
            0: {
              1: { f: '=A1*2', si: 'shared-result', ft: FormulaType.SHARED },
              2: { f: '=A1*3' },
            },
            1: { 1: { si: 'shared-result' } },
            3: {
              1: {
                f: '={1,2;3,4}',
                ft: FormulaType.ARRAY,
                fd: BooleanNumber.TRUE,
                ref: 'B4:C5',
              },
            },
          },
        }),
      ).toBe(true);
      const request = await f.request(peer);
      const accepted = await f.submit(peer, request);
      if (timing === 'before acknowledgment') await calculate();
      await f.acknowledge(peer, accepted);
      if (timing === 'after acknowledgment') {
        await calculate();
        peer.sync.setConnected(false);
        f.resume(peer);
        await turns();
      }
      const sheet = peer.live.univer
        .__getInjector()
        .get(IUniverInstanceService)
        .getUnit<Workbook>('book', UniverInstanceType.UNIVER_SHEET)!
        .getSheetBySheetId('one')!;
      expect(sheet.getCell(0, 1)?.v).toBe(24);
      expect(sheet.getCell(0, 2)?.v).toBe(36);
      expect(sheet.getCell(1, 1)?.v).toBe(14);
      expect(sheet.getCell(3, 1)?.v).toBe(1);
      expect(sheet.getCell(4, 2)?.v).toBe(4);
      // Pinned Univer serves array spill values from an interceptor. They must
      // not erase an ordinary raw value merely because it lies in that range.
      expect(sheet.getCellRaw(4, 2)?.v).toBeUndefined();
      const stored = f.storage.unit.snapshot as IWorkbookData;
      expect(stored.sheets.one.cellData![0][1]).toMatchObject({
        f: '=A1*2',
        si: 'shared-result',
      });
      expect(stored.sheets.one.cellData![0][1].v ?? null).toBeNull();
      expect(stored.sheets.one.cellData![3][1]).toMatchObject({
        f: '={1,2;3,4}',
        ft: FormulaType.ARRAY,
        fd: BooleanNumber.TRUE,
        ref: 'B4:C5',
      });
      const visibleHash = await hashTouched(peer.live.snapshot(), accepted.edit.touched);
      expect(visibleHash).toBe(accepted.edit.hash);
      expect(f.server.verify('book', accepted.edit.revision, visibleHash, undefined)).toBe(true);
      const verification = peer.outgoing.findLast((frame) => frame.type === 'verify');
      expect(verification).toMatchObject({
        revision: accepted.edit.revision,
        hash: accepted.edit.hash,
      });
      expect(peer.failures).toEqual([]);
      expect(peer.sync.state).toMatchObject({ pending: false, resyncing: false });
      for (const sent of peer.outgoing.filter((frame) => frame.type === 'submit'))
        expect(sent).toEqual(request);
    } finally {
      f.close();
    }
  },
);
