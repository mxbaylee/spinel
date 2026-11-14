import { expect } from '@playwright/test';
import type { ICellData, IWorkbookData } from '@univerjs/core';

// Collaboration materialization allocates fresh style IDs on every read.
// Resolve each cell's complete style before comparing all workbook content;
// incidental dictionary keys are not formatting changes.
export function resolvedWorkbook(snapshot: IWorkbookData) {
  const { styles, ...workbook } = structuredClone(snapshot);
  for (const sheet of Object.values(workbook.sheets))
    for (const row of Object.values(sheet.cellData ?? {}))
      for (const cell of Object.values(row ?? {}) as (ICellData | null)[])
        if (cell && typeof cell.s === 'string') {
          expect(styles[cell.s], `Style ${cell.s} must resolve`).toBeDefined();
          cell.s = styles[cell.s];
        }
  return workbook;
}
