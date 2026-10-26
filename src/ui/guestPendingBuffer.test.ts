import { afterEach, expect, test, vi } from 'vitest';
import { DocumentDataModel, IUniverInstanceService, UniverInstanceType } from '@univerjs/core';
import type { Univer } from '@univerjs/core';
import { guestPendingBuffer } from '../../web/guestPendingBuffer.ts';

afterEach(() => vi.unstubAllGlobals());

test('guest retention includes the active cell Doc and composition before native disposal', () => {
  class Element {
    isContentEditable = false;
    textContent = '';
  }
  class Input extends Element {
    value = 'composition not yet committed';
  }
  class Textarea extends Input {}
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('HTMLInputElement', Input);
  vi.stubGlobal('HTMLTextAreaElement', Textarea);
  vi.stubGlobal('document', { activeElement: new Textarea() });
  const body = (text: string) => ({
    dataStream: text + '\r\n',
    paragraphs: [{ startIndex: text.length, paragraphId: 'pending-paragraph' }],
  });
  const live = new DocumentDataModel({ id: 'native-doc', body: body('Pending document edit') });
  const cell = new DocumentDataModel({ id: 'active-cell-editor', body: body('Uncommitted C3') });
  const workbook = {
    id: 'native-sheet',
    sheets: { tab: { cellData: { 1: { 1: { v: 'Unsent B2' } } } } },
  };
  const instances = {
    getAllUnitsForType(type: UniverInstanceType) {
      return type === UniverInstanceType.UNIVER_DOC
        ? [live, cell]
        : [{ getSnapshot: () => workbook }];
    },
  };
  const univer = {
    __getInjector: () => ({
      get: (token: unknown) => {
        expect(token).toBe(IUniverInstanceService);
        return instances;
      },
    }),
  } as unknown as Univer;
  const retained = guestPendingBuffer(univer);
  expect(JSON.stringify(retained.snapshots)).toContain('Pending document edit');
  expect(JSON.stringify(retained.snapshots)).toContain('Uncommitted C3');
  expect(JSON.stringify(retained.snapshots)).toContain('Unsent B2');
  expect(retained.focusedInput).toBe('composition not yet committed');
  // Disposing or changing native state cannot erase the retained private copy.
  live.dispose();
  cell.dispose();
  workbook.sheets.tab.cellData[1][1].v = 'Changed during cleanup';
  expect(JSON.stringify(retained.snapshots)).toContain('Uncommitted C3');
  expect(JSON.stringify(retained.snapshots)).toContain('Unsent B2');
  expect(JSON.stringify(retained.snapshots)).not.toContain('Changed during cleanup');
});
