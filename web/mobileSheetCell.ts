import { IPermissionService } from '@univerjs/core';
import type { Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import { IEditorBridgeService } from '@univerjs/sheets-ui';

export interface MobileSheetCell {
  identity: string;
  address: string;
  text: string;
  viewable: boolean;
  editable: boolean;
  editing: boolean;
}

export const emptyMobileSheetCell: MobileSheetCell = {
  identity: '',
  address: '',
  text: '',
  viewable: false,
  editable: false,
  editing: false,
};

/** Read permissions before content. No snapshot mutation, draft mirror or save path. */
export function readMobileSheetCell(api: FUniver, editing: boolean): MobileSheetCell {
  const book = api.getActiveWorkbook();
  const sheet = book?.getActiveSheet();
  const primary = sheet?.getSelection()?.getCurrentCell();
  if (!book || !sheet || !primary) return { ...emptyMobileSheetCell, editing };
  const { actualRow: row, actualColumn: column } = primary;
  const range = sheet.getRange(row, column, 1, 1);
  const permission = sheet.getWorksheetPermission();
  const viewable = permission.canViewCell(row, column);
  let text = '';
  if (viewable) {
    const formula = range.getFormula();
    const value = formula ? null : range.getValue(true);
    text =
      formula ||
      (value === null ? '' : typeof value === 'object' ? value.toPlainText() : String(value));
  }
  return {
    identity: `${book.getId()}/${sheet.getSheetId()}/${row}/${column}`,
    address: range.getA1Notation(),
    text,
    viewable,
    editable:
      viewable && book.getWorkbookPermission().canEdit() && permission.canEditCell(row, column),
    editing,
  };
}

export function observeMobileSheetCell(
  univer: Univer,
  api: FUniver,
  update: (cell: MobileSheetCell) => void,
) {
  const bridge = univer.__getInjector().get(IEditorBridgeService);
  const refresh = () => update(readMobileSheetCell(api, bridge.isVisible().visible));
  const events = [
    api.addEvent(api.Event.SelectionChanged, refresh),
    api.addEvent(api.Event.ActiveSheetChanged, refresh),
    api.addEvent(api.Event.SheetValueChanged, refresh),
  ];
  const visibility = bridge.visible$.subscribe(refresh);
  const permission = univer
    .__getInjector()
    .get(IPermissionService)
    .permissionPointUpdate$.subscribe(refresh);
  refresh();
  return {
    edit() {
      // Revalidate the current primary and grant at activation, never a stale render.
      if (readMobileSheetCell(api, bridge.isVisible().visible).editable)
        api.getActiveWorkbook()?.startEditing();
    },
    dispose() {
      events.forEach((event) => event.dispose());
      visibility.unsubscribe();
      permission.unsubscribe();
    },
  };
}

/** Use the browser's visible bottom directly; never derive it from the moving input. */
export function bindMobileSheetViewport(host: HTMLElement) {
  const viewport = window.visualViewport;
  let frame = 0;
  const measure = () => {
    frame = 0;
    const box = host.getBoundingClientRect();
    const bottom = Math.max(
      0,
      window.innerHeight - ((viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight)),
    );
    const values = {
      '--sp-sheet-left': `${box.left}px`,
      '--sp-sheet-width': `${box.width}px`,
      '--sp-sheet-bottom': `${bottom}px`,
    };
    for (const [name, value] of Object.entries(values))
      if (host.style.getPropertyValue(name) !== value) host.style.setProperty(name, value);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(measure);
  };
  const resize = new ResizeObserver(schedule);
  resize.observe(host);
  window.addEventListener('resize', schedule);
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  measure();
  return () => {
    cancelAnimationFrame(frame);
    resize.disconnect();
    window.removeEventListener('resize', schedule);
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
    for (const name of ['--sp-sheet-left', '--sp-sheet-width', '--sp-sheet-bottom'])
      host.style.removeProperty(name);
  };
}
