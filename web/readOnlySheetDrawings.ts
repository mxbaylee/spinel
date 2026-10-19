import type { Univer } from '@univerjs/core';
import { IDrawingManagerService, ISheetDrawingService } from '@univerjs/preset-sheets-drawing';
import { IRenderManagerService } from '@univerjs/engine-render';

/** Local presentation fence; never writes shared document permissions or data. */
export function readOnlySheetDrawings(univer: Univer, unitId: string) {
  const injector = univer.__getInjector();
  const drawings = injector.get(IDrawingManagerService);
  injector.get(ISheetDrawingService).setDrawingEditable(false);
  // The generic renderer checks a separate flag when an image finishes loading.
  // Command rejection alone happens after a drag has already moved the canvas.
  drawings.setDrawingEditable(false);
  const scene = injector.get(IRenderManagerService).getRenderUnitById(unitId)?.scene;
  if (!scene) return;
  for (const object of scene.getAllObjectsByOrder())
    if (drawings.getDrawingOKey(object.oKey)?.unitId === unitId)
      scene.detachTransformerFrom(object);
  scene.getTransformer()?.clearSelectedObjects();
}
