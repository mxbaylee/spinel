// SPN-036 feasibility prototype: public APIs only; no transport or profile storage.
import type { IDisposable, Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import type { ComponentType } from 'react';
import { DocSkeletonManagerService } from '@univerjs/docs';
import { DocCanvasPopManagerService, getTextRangeFromCharIndex } from '@univerjs/docs-ui';
import { Documents, IRenderManagerService } from '@univerjs/engine-render';
import { ComponentManager } from '@univerjs/ui';
import '@univerjs/sheets-ui/facade';
import { parseBodySelection } from './selection.ts';

/** Draw an ephemeral remote selection. Never writes formatting into the document. */
export function drawPresence(
  univer: Univer,
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
      const separator = selection.lastIndexOf('!');
      const sheet = book.getSheetBySheetId(selection.slice(0, separator));
      const address = selection.slice(separator + 1);
      if (!sheet || !/^[A-Z]+[1-9]\d*(?::[A-Z]+[1-9]\d*)?$/.test(address)) return { dispose };
      const range = sheet.getRange(address);
      owned.push(range.highlight({ stroke: color, fill: color + '28' }));
      const popup = range.attachPopup({
        componentKey: label,
        direction: 'top-left',
        hideOnInvisible: true,
        constrainToCanvas: true,
      });
      if (popup) owned.push(popup);
    } else {
      const range = parseBodySelection(selection);
      const doc = api.getActiveDocument?.();
      if (
        !range ||
        doc?.getId() !== unitId ||
        range.endOffset >= (doc.getDocumentDataModel().getSnapshot().body?.dataStream.length ?? 0)
      )
        return { dispose };
      const injector = univer.__getInjector();
      const render = injector.get(IRenderManagerService).getRenderUnitById(unitId);
      if (!render || !(render.mainComponent instanceof Documents)) return { dispose };
      const skeletons = render.with(DocSkeletonManagerService);
      let text = getTextRangeFromCharIndex(
        range.startOffset,
        range.endOffset,
        render.scene,
        render.mainComponent,
        skeletons.getSkeleton(),
        { strokeWidth: 2, stroke: color, strokeActive: color, fill: color + '38' },
        '',
        -1,
      );
      text?.activeStatic();
      const refresh = skeletons.currentSkeleton$.subscribe(() => text?.refresh());
      owned.push({
        dispose: () => {
          refresh.unsubscribe();
          text?.dispose();
          text = null;
        },
      });
      const key = 'spinel-presence-' + crypto.randomUUID();
      owned.push(injector.get(ComponentManager).register(key, label));
      owned.push(
        injector.get(DocCanvasPopManagerService).attachPopupToRange(
          range,
          {
            componentKey: key,
            direction: 'top-left',
            hideOnInvisible: true,
            constrainToCanvas: true,
            requiresStableLayout: false,
          },
          unitId,
        ),
      );
    }
  } catch (error) {
    dispose();
    throw error;
  }
  return { dispose };
}
