import {
  CommandType,
  ICommandService,
  Inject,
  Injector,
  IUniverInstanceService,
  Plugin,
  UniverInstanceType,
} from '@univerjs/core';
import type { ICellData, IObjectMatrixPrimitiveType, Nullable, Workbook } from '@univerjs/core';
import { CopySheetCommand, getSheetCommandTarget } from '@univerjs/sheets';
import type { ICopySheetCommandParams } from '@univerjs/sheets';
import {
  AddRangeProtectionFromContextMenuCommand,
  AddRangeProtectionFromSheetBarCommand,
  AddRangeProtectionFromToolbarCommand,
  ChangeSheetProtectionFromSheetBarCommand,
  DeleteRangeProtectionFromContextMenuCommand,
  DeleteWorksheetProtectionFormSheetBarCommand,
  SetRangeProtectionFromContextMenuCommand,
  ViewSheetPermissionFromContextMenuCommand,
  ViewSheetPermissionFromSheetBarCommand,
} from '@univerjs/sheets-ui';
import { IMenuManagerService } from '@univerjs/ui';
import type { MenuConfig } from '@univerjs/ui';
import type { Subscription } from 'rxjs';

// SPN-059: these controls can create mutations outside the reviewed sync
// inventory. Keep the name box, defined-name manager and cross-sheet cut/paste.
export const syncSheetMenuConfig: MenuConfig = Object.fromEntries(
  [
    AddRangeProtectionFromToolbarCommand.id,
    'sheet.contextMenu.permission',
    AddRangeProtectionFromContextMenuCommand.id,
    AddRangeProtectionFromSheetBarCommand.id,
    SetRangeProtectionFromContextMenuCommand.id,
    DeleteRangeProtectionFromContextMenuCommand.id,
    ChangeSheetProtectionFromSheetBarCommand.id,
    DeleteWorksheetProtectionFormSheetBarCommand.id,
    // The read panels include policy-changing actions, so they cannot offer a
    // supported interaction until protection mutations have a sync contract.
    ViewSheetPermissionFromContextMenuCommand.id,
    ViewSheetPermissionFromSheetBarCommand.id,
    'sheets-formula-ui.operation.calculation-options',
    CopySheetCommand.id,
  ].map((id) => [id, { hidden: true }]),
);

/** Match the pinned SDK's split threshold, including explicit empty cell keys. */
export function canCopySheet(cellData?: IObjectMatrixPrimitiveType<Nullable<ICellData>>): boolean {
  if (!cellData) return true;
  let cells = 0;
  for (const rowKey in cellData) {
    if (!Object.hasOwn(cellData, rowKey)) continue;
    const row = cellData[Number(rowKey)];
    if (!row) continue;
    for (const column in row) {
      if (Object.hasOwn(row, column) && ++cells >= 6000) return false;
    }
  }
  return true;
}

/** Public menu and command adapters; saved worksheet content stays untouched. */
export class SyncSheetMenuPlugin extends Plugin {
  static override pluginName = 'SPINEL_SYNC_SHEET_MENUS';
  static override type = UniverInstanceType.UNIVER_SHEET;
  protected _injector: Injector;

  constructor(_config: unknown, injector: Injector) {
    super();
    this._injector = injector;
  }

  override onRendered() {
    const commands = this._injector.get(ICommandService);
    const instances = this._injector.get(IUniverInstanceService);
    const menus = this._injector.get(IMenuManagerService);
    let active: Nullable<Workbook>;
    let sheetChanges: Subscription | undefined;
    let hidden: boolean | undefined;
    const update = () => {
      const sheet = active?.getActiveSheet();
      const next = !sheet || !canCopySheet(sheet.getCellMatrix().getMatrix());
      if (next === hidden) return;
      hidden = next;
      menus.updateMenuConfig({ [CopySheetCommand.id]: { hidden } });
    };
    this.disposeWithMe(
      instances
        .getCurrentTypeOfUnit$<Workbook>(UniverInstanceType.UNIVER_SHEET)
        .subscribe((book) => {
          sheetChanges?.unsubscribe();
          active = book;
          sheetChanges = book?.activeSheet$.subscribe(update);
          update();
        }),
    );
    this.disposeWithMe({ dispose: () => sheetChanges?.unsubscribe() });
    this.disposeWithMe(
      commands.onCommandExecuted((command) => {
        if (command.type === CommandType.MUTATION) update();
      }),
    );
    // Recheck the command target as well: a stale open menu or explicit native
    // API call must not begin the SDK's unsupported asynchronous copy sequence.
    commands.unregisterCommand(CopySheetCommand.id);
    this.disposeWithMe(
      commands.registerCommand({
        ...CopySheetCommand,
        handler: (accessor, params, options) => {
          const target = getSheetCommandTarget(instances, params as ICopySheetCommandParams);
          if (!target || !canCopySheet(target.worksheet.getCellMatrix().getMatrix())) return false;
          return CopySheetCommand.handler(accessor, params, options);
        },
      }),
    );
  }
}
Inject(Injector)(SyncSheetMenuPlugin, undefined, 1);
