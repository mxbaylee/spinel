import { IUniverInstanceService, UniverInstanceType } from '@univerjs/core';
import type { DocumentDataModel, Univer, Workbook } from '@univerjs/core';
import type { GuestPendingBuffer } from './guestRevocation.ts';

/**
 * Capture public native models before disposal. Sheet's uncommitted cell editor
 * is itself a Doc unit, so saving only the workbook would lose active typing.
 * The focused input also retains any composition text not yet in that model.
 * This data has no consumer: it remains inaccessible in the guest tab's memory.
 */
export function guestPendingBuffer(univer: Univer): GuestPendingBuffer {
  const instances = univer.__getInjector().get(IUniverInstanceService);
  const active = document.activeElement;
  const focusedInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
    ? active.value
    : active instanceof HTMLElement && active.isContentEditable
      ? active.textContent
      : null;
  const units = [
    ...instances.getAllUnitsForType<DocumentDataModel>(UniverInstanceType.UNIVER_DOC),
    ...instances.getAllUnitsForType<Workbook>(UniverInstanceType.UNIVER_SHEET),
  ];
  return { snapshots: units.map((unit) => structuredClone(unit.getSnapshot())), focusedInput };
}
