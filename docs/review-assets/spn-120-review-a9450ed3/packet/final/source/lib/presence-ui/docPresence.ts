import { DOC_RANGE_TYPE, type IDisposable, type Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import { DocSkeletonManagerService } from '@univerjs/docs';
import { DocCanvasPopManagerService, getTextRangeFromCharIndex } from '@univerjs/docs-ui';
import { Documents, IRenderManagerService } from '@univerjs/engine-render';
import { ComponentManager } from '@univerjs/ui';
import type { ComponentType } from 'react';
import type { PresenceRenderColors } from './renderColors.ts';
import { parseDocSelection } from './selection.ts';

/** Independent canvas ranges; no command, document edit or local selection replacement. */
export function drawDocPresence(
  univer: Univer,
  api: FUniver,
  unitId: string,
  selection: string,
  color: string,
  label: ComponentType,
  renderColors?: PresenceRenderColors,
  popupOptions?: { zIndex?: number },
): IDisposable {
  const owned: IDisposable[] = [];
  const dispose = () => {
    for (const item of owned.reverse()) item.dispose();
    owned.length = 0;
  };
  try {
    const document = api.getActiveDocument?.();
    if (document?.getId() !== unitId) return { dispose };
    const offsets = parseDocSelection(
      selection,
      document.getDocumentDataModel().getSnapshot().body?.dataStream.length ?? 0,
    );
    if (!offsets) return { dispose };
    const injector = univer.__getInjector();
    const render = injector.get(IRenderManagerService).getRenderUnitById(unitId);
    if (!render || !(render.mainComponent instanceof Documents)) return { dispose };
    const skeleton = render.with(DocSkeletonManagerService).getSkeleton();
    if (!skeleton) return { dispose };
    const { stroke, fill } = renderColors ?? { stroke: color, fill: color + '28' };
    const range = getTextRangeFromCharIndex(
      offsets.startOffset,
      offsets.endOffset,
      render.scene,
      render.mainComponent,
      skeleton,
      // Equal resting/active strokes keep remote carets steady, without an SDK patch.
      { strokeWidth: 2, stroke, strokeActive: stroke, fill },
      '',
      -1,
    );
    if (!range) return { dispose };
    owned.push(range);
    const key = `spinel-presence-${crypto.randomUUID()}`;
    owned.push(injector.get(ComponentManager).register(key, label));
    owned.push(
      injector.get(DocCanvasPopManagerService).attachPopupToRange(
        {
          ...offsets,
          collapsed: offsets.startOffset === offsets.endOffset,
          segmentId: '',
          segmentPage: -1,
          rangeType: DOC_RANGE_TYPE.TEXT,
        },
        {
          componentKey: key,
          direction: 'top-left',
          hideOnInvisible: true,
          constrainToCanvas: true,
          requiresStableLayout: false,
          zIndex: popupOptions?.zIndex,
        },
        unitId,
      ),
    );
  } catch (error) {
    dispose();
    throw error;
  }
  return { dispose };
}
