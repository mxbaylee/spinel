import { IPermissionService, LocaleType, Univer, UniverInstanceType } from '@univerjs/core';
import type { IWorkbookData, Workbook } from '@univerjs/core';
import { IDrawingManagerService, UniverDrawingPlugin } from '@univerjs/drawing';
import { WorkbookEditablePermission, WorksheetEditPermission } from '@univerjs/sheets';
import { expect, test } from 'vitest';
import { bindSheetDrawingPermissions } from '../../web/readOnlySheetDrawings.ts';
import { nativeSyncPermissions } from '../../web/nativeSyncPermissions.ts';

function fixture() {
  const unitId = 'drawing-policy-book';
  const nativePermissions = nativeSyncPermissions(unitId, 'viewer');
  const univer = new Univer({ locale: LocaleType.EN_US, override: nativePermissions.override });
  univer.registerPlugin(UniverDrawingPlugin);
  const workbook = univer.createUnit<IWorkbookData, Workbook>(UniverInstanceType.UNIVER_SHEET, {
    id: unitId,
    name: 'Drawing policies',
    appVersion: '1.1.0',
    locale: LocaleType.EN_US,
    sheetOrder: ['protected', 'editable'],
    styles: {},
    sheets: {
      protected: { id: 'protected', name: 'Protected', rowCount: 5, columnCount: 5, cellData: {} },
      editable: { id: 'editable', name: 'Editable', rowCount: 5, columnCount: 5, cellData: {} },
    },
  });
  const protectedSheet = workbook.getSheetBySheetId('protected')!;
  const editableSheet = workbook.getSheetBySheetId('editable')!;
  workbook.setActiveSheet(protectedSheet);
  const injector = univer.__getInjector();
  const permissions = injector.get(IPermissionService);
  const drawings = injector.get(IDrawingManagerService);
  const stop = bindSheetDrawingPermissions(univer, unitId);
  const root = new WorkbookEditablePermission(unitId);
  const protectedPoint = new WorksheetEditPermission(unitId, 'protected');
  const editablePoint = new WorksheetEditPermission(unitId, 'editable');
  protectedPoint.value = false;
  editablePoint.value = true;
  return {
    univer,
    workbook,
    nativePermissions,
    permissions,
    drawings,
    protectedSheet,
    editableSheet,
    root,
    protectedPoint,
    editablePoint,
    stop,
    register() {
      for (const point of [root, protectedPoint, editablePoint])
        permissions.addPermissionPoint(point);
    },
  };
}

test('late drawings retain the active worksheet fence across a live upgrade, sheet switches and policy changes', async () => {
  const f = fixture();
  try {
    // Initialization cannot allow image transforms before native points exist.
    expect(f.drawings.getDrawingEditable()).toBe(false);
    f.register();
    expect(f.drawings.getDrawingEditable()).toBe(false);
    f.nativePermissions.setAccess('editor');
    expect(f.permissions.getPermissionPoint(f.root.id)?.value).toBe(true);
    expect(f.permissions.getPermissionPoint(f.protectedPoint.id)?.value).toBe(false);
    expect(f.drawings.getDrawingEditable()).toBe(false);

    // Match the generic renderer's public flag read after its image load awaits.
    let finishImage!: () => void;
    const lateImage = new Promise<void>((resolve) => {
      finishImage = resolve;
    }).then(() => f.drawings.getDrawingEditable());
    f.workbook.setActiveSheet(f.editableSheet);
    expect(f.drawings.getDrawingEditable()).toBe(true);
    f.workbook.setActiveSheet(f.protectedSheet);
    finishImage();
    await expect(lateImage).resolves.toBe(false);

    f.permissions.updatePermissionPoint(f.protectedPoint.id, true);
    expect(f.drawings.getDrawingEditable()).toBe(true);
    f.permissions.updatePermissionPoint(f.protectedPoint.id, false);
    expect(f.drawings.getDrawingEditable()).toBe(false);
    // Updates from an inactive sheet cannot release the current sheet's fence.
    f.permissions.updatePermissionPoint(f.editablePoint.id, true);
    expect(f.drawings.getDrawingEditable()).toBe(false);
    f.workbook.setActiveSheet(f.editableSheet);
    expect(f.drawings.getDrawingEditable()).toBe(true);
    f.nativePermissions.readonly();
    expect(f.drawings.getDrawingEditable()).toBe(false);
    f.workbook.setActiveSheet(f.protectedSheet);
    f.permissions.updatePermissionPoint(f.protectedPoint.id, true);
    expect(f.drawings.getDrawingEditable()).toBe(false);
    f.nativePermissions.setAccess('editor');
    expect(f.drawings.getDrawingEditable()).toBe(true);
  } finally {
    f.stop();
    f.univer.dispose();
  }
});

test('disposing the drawing policy binding fences late loads and detaches permission and sheet observers', () => {
  const f = fixture();
  try {
    f.register();
    f.nativePermissions.setAccess('editor');
    f.workbook.setActiveSheet(f.editableSheet);
    expect(f.drawings.getDrawingEditable()).toBe(true);
    f.stop();
    expect(f.drawings.getDrawingEditable()).toBe(false);
    f.workbook.setActiveSheet(f.protectedSheet);
    f.permissions.updatePermissionPoint(f.protectedPoint.id, true);
    f.nativePermissions.readonly();
    f.nativePermissions.setAccess('editor');
    expect(f.drawings.getDrawingEditable()).toBe(false);
  } finally {
    f.stop();
    f.univer.dispose();
  }
});
