import { parseSheetSelection } from './selection.ts';
// Public Sheet selection rendering; no transport or profile storage.
import type { IDisposable, Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import type { ComponentType } from 'react';
import '@univerjs/sheets-ui/facade';

/** Draw an ephemeral remote selection. Never writes formatting into the document. */
export function drawPresence(
  _univer: Univer,
  api: FUniver,
  unitId: string,
  selection: string,
  color: string,
  label: ComponentType,
): IDisposable {
  const owned: IDisposable[] = [];
  const dispose = () => {
    for (const item of owned.reverse()) item.dispose();
    owned.length = 0;
  };
  try {
    const book = api.getActiveWorkbook?.();
    if (book?.getId() === unitId) {
      const parsed = parseSheetSelection(selection);
      if (!parsed) return { dispose };
      const sheet = book.getSheetBySheetId(parsed.sheetId);
      if (!sheet || book.getActiveSheet().getSheetId() !== parsed.sheetId) return { dispose };
      const address = parsed.address;
      const range = sheet.getRange(address);
      owned.push(range.highlight({ stroke: color, fill: color + '28' }));
      const popup = range.attachPopup({
        componentKey: label,
        direction: 'top-left',
        hideOnInvisible: true,
        constrainToCanvas: true,
      });
      if (popup) owned.push(popup);
    }
  } catch (error) {
    dispose();
    throw error;
  }
  return { dispose };
}

export { setLocalSelectionColor } from './localSelection.ts';

export { boundedSheetRange } from './selection.ts';
