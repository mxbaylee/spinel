import { IPermissionService, IUniverInstanceService, UniverInstanceType } from '@univerjs/core';
import type { Univer, Workbook } from '@univerjs/core';
import { IDrawingManagerService, ISheetDrawingService } from '@univerjs/preset-sheets-drawing';
import { IRenderManagerService } from '@univerjs/engine-render';
import { WorkbookEditablePermission, WorksheetEditPermission } from '@univerjs/sheets';
import { filter, map, of, startWith, switchMap } from 'rxjs';

/** The generic image renderer reads its own flag after asynchronous image loading. */
export function bindSheetDrawingPermissions(univer: Univer, unitId: string) {
  const injector = univer.__getInjector();
  const drawings = injector.get(IDrawingManagerService);
  const permissions = injector.get(IPermissionService);
  const workbook = injector
    .get(IUniverInstanceService)
    .getUnit<Workbook>(unitId, UniverInstanceType.UNIVER_SHEET);
  drawings.setDrawingEditable(false);
  if (!workbook) throw new Error('Could not load this spreadsheet.');
  const subscription = workbook.activeSheet$
    .pipe(
      switchMap((sheet) => {
        if (!sheet) return of(false);
        const ids = [
          new WorkbookEditablePermission(unitId).id,
          new WorksheetEditPermission(unitId, sheet.getSheetId()).id,
        ];
        // Points may be registered after unit creation or replaced by a native
        // user change. Stay fenced until both exist, then observe their values.
        return permissions.permissionPointUpdate$.pipe(
          filter((point) => ids.includes(point.id)),
          startWith(null),
          switchMap(() =>
            ids.every((id) => permissions.getPermissionPoint(id))
              ? permissions
                  .composePermission$(ids)
                  .pipe(map((points) => points.every((point) => point.value === true)))
              : of(false),
          ),
        );
      }),
    )
    .subscribe((editable) => drawings.setDrawingEditable(editable));
  return () => {
    subscription.unsubscribe();
    drawings.setDrawingEditable(false);
  };
}

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
