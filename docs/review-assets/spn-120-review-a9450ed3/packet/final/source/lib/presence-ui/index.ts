import { parseSheetSelection } from './selection.ts';
import { drawDocPresence } from './docPresence.ts';
// Public editor selection rendering; no transport or profile storage.
import type { IDisposable, Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import type { ComponentType } from 'react';
import type { PresenceRenderColors } from './renderColors.ts';
import '@univerjs/sheets-ui/facade';

/** Draw an ephemeral remote selection. Never writes formatting into the document. */
export function drawPresence(
  univer: Univer,
  api: FUniver,
  unitId: string,
  selection: string,
  color: string,
  label: ComponentType,
  renderColors?: PresenceRenderColors,
  popupOptions?: { zIndex?: number },
): IDisposable {
  if (api.getActiveDocument?.()?.getId() === unitId)
    return drawDocPresence(
      univer,
      api,
      unitId,
      selection,
      color,
      label,
      renderColors,
      popupOptions,
    );
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
      owned.push(range.highlight(renderColors ?? { stroke: color, fill: color + '28' }));
      const popup = range.attachPopup({
        componentKey: label,
        direction: 'top-left',
        hideOnInvisible: true,
        constrainToCanvas: true,
        zIndex: popupOptions?.zIndex,
      });
      if (popup) owned.push(popup);
    }
  } catch (error) {
    dispose();
    throw error;
  }
  return { dispose };
}

export { setLocalSelectionColor, setLocalDocSelectionColor } from './localSelection.ts';
export type { PresenceRenderColors } from './renderColors.ts';

export { boundedSheetRange, parseDocSelection } from './selection.ts';
