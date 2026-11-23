import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';
import { IPermissionService } from '@univerjs/core';
import type { Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import { IEditorBridgeService } from '@univerjs/sheets-ui';
import { RangeProtectionRuleModel, WorksheetProtectionRuleModel } from '@univerjs/sheets';
import { observeMobileSheetCell, readMobileSheetCell } from '../../web/mobileSheetCell.ts';

// Test the adapter's authority and lifecycle contract without loading a browser
// renderer. Native API return values/notifications remain the integration boundary.
vi.mock('@univerjs/core', () => ({ IPermissionService: Symbol('permission') }));
vi.mock('@univerjs/sheets-ui', () => ({ IEditorBridgeService: Symbol('editor') }));
vi.mock('@univerjs/sheets', () => ({
  RangeProtectionRuleModel: Symbol('range protection'),
  WorksheetProtectionRuleModel: Symbol('worksheet protection'),
}));

function fixture() {
  const state = {
    view: true,
    edit: true,
    row: 4,
    column: 1,
    formula: '',
    value: undefined as unknown,
  };
  const value = vi.fn(() => state.value);
  const formula = vi.fn(() => state.formula);
  const startEditing = vi.fn();
  const nativeEvents = new Map<string, () => void>();
  const visibility = new BehaviorSubject({ visible: false });
  const permissions = new Subject();
  const ranges = new Subject();
  const worksheets = new Subject();
  const services = new Map<unknown, unknown>([
    [IEditorBridgeService, { visible$: visibility, isVisible: () => visibility.value }],
    [IPermissionService, { permissionPointUpdate$: permissions }],
    [RangeProtectionRuleModel, { ruleChange$: ranges }],
    [WorksheetProtectionRuleModel, { ruleChange$: worksheets }],
  ]);
  const univer = {
    __getInjector: () => ({ get: (token: unknown) => services.get(token) }),
  } as unknown as Univer;
  const sheet = {
    getSheetId: () => 'sheet',
    getSelection: () => ({
      getCurrentCell: () => ({ actualRow: state.row, actualColumn: state.column }),
    }),
    getWorksheetPermission: () => ({
      canViewCell: () => state.view,
      canEditCell: () => state.edit,
    }),
    getRange: () => ({
      getA1Notation: () => `${String.fromCharCode(65 + state.column)}${state.row + 1}`,
      getFormula: formula,
      getValue: value,
    }),
  };
  const book = {
    getId: () => 'book',
    getActiveSheet: () => sheet,
    getWorkbookPermission: () => ({ canEdit: () => state.edit }),
    startEditing,
    onSelectionChange: (callback: () => void) => {
      nativeEvents.set('selection', callback);
      return { dispose: () => nativeEvents.delete('selection') };
    },
  };
  const api = {
    getActiveWorkbook: () => book,
    Event: {
      ActiveSheetChanged: 'sheet',
      SheetValueChanged: 'value',
    },
    addEvent: (name: string, callback: () => void) => {
      nativeEvents.set(name, callback);
      return { dispose: () => nativeEvents.delete(name) };
    },
  } as unknown as FUniver;
  return {
    state,
    value,
    formula,
    startEditing,
    nativeEvents,
    visibility,
    permissions,
    ranges,
    worksheets,
    univer,
    api,
  };
}

describe('mobile selected-cell readout', () => {
  it.each([
    [undefined, ''],
    [null, ''],
    [0, '0'],
    [false, 'false'],
    [{ toPlainText: () => 'Rich text' }, 'Rich text'],
  ])('reads native scalar/rich text including empty %s', (value, expected) => {
    const f = fixture();
    f.state.value = value;
    expect(readMobileSheetCell(f.api, false)).toMatchObject({
      address: 'B5',
      text: expected,
      editable: true,
    });
    f.state.formula = '=SUM(A:A)';
    f.state.value = 71;
    expect(readMobileSheetCell(f.api, false).text).toBe('=SUM(A:A)');
  });

  it('clears protected text when range bounds move without a permission-point update', () => {
    const f = fixture();
    f.state.value = 'Private';
    const update = vi.fn();
    const observer = observeMobileSheetCell(f.univer, f.api, update);
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'Private' }));
    f.value.mockClear();
    f.formula.mockClear();
    f.state.view = false;
    f.ranges.next({});
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: '', editable: false, viewable: false }),
    );
    expect(f.value).not.toHaveBeenCalled();
    expect(f.formula).not.toHaveBeenCalled();
    f.state.view = true;
    f.worksheets.next({});
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: 'Private', viewable: true }),
    );
    observer.dispose();
  });

  it('revalidates activation, follows the primary/edit state and removes every observer', () => {
    const f = fixture();
    const update = vi.fn();
    const observer = observeMobileSheetCell(f.univer, f.api, update);
    f.state.edit = false; // Grant changed after render, before its notification.
    observer.edit();
    expect(f.startEditing).not.toHaveBeenCalled();
    f.permissions.next({});
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ editable: false }));
    f.state.edit = true;
    f.state.column = 2;
    f.nativeEvents.get('selection')!();
    observer.edit();
    expect(f.startEditing).toHaveBeenCalledTimes(1);
    f.visibility.next({ visible: true });
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ address: 'C5', editing: true }),
    );
    observer.dispose();
    update.mockClear();
    f.permissions.next({});
    f.ranges.next({});
    f.worksheets.next({});
    f.visibility.next({ visible: false });
    expect(update).not.toHaveBeenCalled();
    expect(f.nativeEvents.size).toBe(0);
  });
});
