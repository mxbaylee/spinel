import {
  getDocsEmptySnapshot,
  IAuthzIoService,
  ICommandService,
  IConfigService,
  ILogService,
  IPermissionService,
  IResourceLoaderService,
  IUniverInstanceService,
  LocaleService,
  LocaleType,
  LogLevel,
  OBJECT_PERMISSION_CONFIG_KEY,
  ObjectPermissionService,
  Univer,
  UniverInstanceType,
  UserManagerService,
} from '@univerjs/core';
import type { DocumentDataModel, IDocumentData, IWorkbookData, Workbook } from '@univerjs/core';
import {
  createDocumentPermissionPoint,
  getDocumentParagraphPermissionObjectId,
  UniverDocsPlugin,
} from '@univerjs/docs';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { UnitAction, UnitObject, UnitRole } from '@univerjs/protocol';
import {
  EditStateEnum,
  RangeProtectionPermissionEditPoint,
  SheetPermissionInitController,
  UniverSheetsPlugin,
  ViewStateEnum,
  WorkbookCopyPermission,
  WorkbookEditablePermission,
  WorksheetEditPermission,
} from '@univerjs/sheets';
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { expect, test, vi } from 'vitest';
import type { ItemAccess } from '../shared/workspace.ts';
import { nativeSyncPermissions } from '../../web/nativeSyncPermissions.ts';

const member = { userID: '0293e191-5753-40c7-b520-7089ac25f3a0', name: 'Member', avatar: '' };
const guest = { userID: 'guest-session-42', name: 'Guest', avatar: '' };
const authzResource = 'SHEET_AuthzIoMockService_PLUGIN';
const rangeResource = 'SHEET_RANGE_PROTECTION_PLUGIN';
const docResource = 'DOC_OBJECT_PERMISSION_PLUGIN';
type Resources = NonNullable<IWorkbookData['resources']>;

function workbook(resources: Resources = []): IWorkbookData {
  return {
    id: 'book',
    name: 'Book',
    appVersion: '1.1.0',
    locale: LocaleType.EN_US,
    sheetOrder: ['one'],
    styles: {},
    resources,
    sheets: {
      one: {
        id: 'one',
        name: 'One',
        rowCount: 12,
        columnCount: 6,
        cellData: { 0: { 0: { v: 'original' } } },
      },
    },
  };
}

function document(resources: Resources = []): IDocumentData {
  const snapshot = getDocsEmptySnapshot('doc');
  snapshot.resources = resources;
  snapshot.body = {
    dataStream: 'Hello\r\n',
    paragraphs: [{ startIndex: 5, paragraphId: 'paragraph-1' }],
    sectionBreaks: [{ startIndex: 6, sectionId: 'section-1' }],
  };
  return snapshot;
}

async function settle() {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
}

function fixture(
  kind: 'sheet' | 'doc',
  access: ItemAccess,
  options: {
    bind?: boolean;
    resources?: Resources;
    identity?: typeof member;
  } = {},
) {
  const unitId = kind === 'sheet' ? 'book' : 'doc';
  const objectType = kind === 'sheet' ? UnitObject.Workbook : UnitObject.Document;
  const binding = nativeSyncPermissions(unitId, access);
  const univer = new Univer({
    locale: LocaleType.EN_US,
    override: options.bind === false ? [] : binding.override,
  });
  const injector = univer.__getInjector();
  injector.get(ILogService).setLogLevel(LogLevel.SILENT);
  const users = injector.get(UserManagerService);
  users.setCurrentUser(options.identity ?? member);
  injector
    .get(IConfigService)
    .setConfig(OBJECT_PERMISSION_CONFIG_KEY, [
      UnitObject.Document,
      UnitObject.DocumentSection,
      UnitObject.DocumentParagraph,
      UnitObject.DocumentEntity,
    ]);
  univer.registerPlugin(UniverRenderEnginePlugin);
  univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverSheetsFormulaPlugin);
  univer.registerPlugin(UniverDocsPlugin);
  injector.get(LocaleService).load({ [LocaleType.EN_US]: {} });
  // Register the real provider's resource hook before the snapshot is loaded.
  const authz = injector.get(IAuthzIoService);
  const permissions = injector.get(IPermissionService);
  if (kind === 'sheet')
    univer.createUnit(UniverInstanceType.UNIVER_SHEET, workbook(options.resources));
  else univer.createUnit(UniverInstanceType.UNIVER_DOC, document(options.resources));
  injector.get(IUniverInstanceService).focusUnit(unitId);
  const sheetController =
    kind === 'sheet' ? injector.get(SheetPermissionInitController) : undefined;
  sheetController?.initPermission();
  const editId =
    kind === 'sheet'
      ? new WorkbookEditablePermission(unitId).id
      : createDocumentPermissionPoint(unitId, unitId, UnitAction.Edit).id;
  const copyId =
    kind === 'sheet'
      ? new WorkbookCopyPermission(unitId).id
      : createDocumentPermissionPoint(unitId, unitId, UnitAction.Copy).id;
  return {
    univer,
    injector,
    authz,
    permissions,
    users,
    binding,
    unitId,
    objectType,
    editId,
    copyId,
    async refresh() {
      if (sheetController) await sheetController.initWorkbookPermissionChange(unitId);
      else await injector.get(ObjectPermissionService).refreshUnit(unitId);
      await settle();
    },
    async edit(row = 0) {
      const commands = injector.get(ICommandService);
      if (kind === 'sheet')
        return commands.executeCommand('sheet.command.set-range-values', {
          unitId,
          subUnitId: 'one',
          range: { startRow: row, endRow: row, startColumn: 0, endColumn: 0 },
          value: { v: 'edited' },
        });
      return commands.executeCommand('doc.command.insert-text', {
        unitId,
        body: { dataStream: 'edited' },
        range: { startOffset: 0, endOffset: 0, collapsed: true },
        debounce: false,
        noNeedSetTextRange: true,
      });
    },
    content() {
      const instances = injector.get(IUniverInstanceService);
      if (kind === 'sheet')
        return instances
          .getUnit<Workbook>(unitId, UniverInstanceType.UNIVER_SHEET)
          ?.getSheetBySheetId('one')
          ?.getCellRaw(0, 0)?.v;
      return instances.getUnit<DocumentDataModel>(unitId, UniverInstanceType.UNIVER_DOC)?.getBody()
        ?.dataStream;
    },
    resource(name: string) {
      const snapshot = injector
        .get(IResourceLoaderService)
        .saveUnit<IWorkbookData | IDocumentData>(unitId);
      const data = snapshot?.resources?.find((resource) => resource.name === name)?.data;
      return data ? (JSON.parse(data) as unknown) : undefined;
    },
    dispose: () => univer.dispose(),
  };
}

test('the OSS local provider denies an ordinary member after native workbook permission initialization', async () => {
  const host = fixture('sheet', 'editor', { bind: false });
  try {
    await host.refresh();
    expect(host.permissions.getPermissionPoint(host.editId)?.value).toBe(false);
    expect(host.permissions.getPermissionPoint(host.copyId)?.value).toBe(false);
    expect(await host.edit()).toBe(false);
    expect(host.content()).toBe('original');
    expect(host.users.getCurrentUser()).toEqual(member);
  } finally {
    host.dispose();
  }
});

test.each(['sheet', 'doc'] as const)(
  '%s binds all Spinel grants before native points are exposed and retains real identities',
  async (kind) => {
    for (const [access, identity] of [
      ['owner', member],
      ['editor', member],
      ['editor', guest],
      ['viewer', member],
      ['viewer', guest],
    ] as const) {
      const host = fixture(kind, access, { identity });
      try {
        const canEdit = access !== 'viewer';
        expect(host.permissions.getPermissionPoint(host.editId)?.value).toBe(canEdit);
        expect(host.permissions.getPermissionPoint(host.copyId)?.value).toBe(true);
        await host.refresh();
        expect(host.permissions.getPermissionPoint(host.editId)?.value).toBe(canEdit);
        expect(host.permissions.getPermissionPoint(host.copyId)?.value).toBe(true);
        const actions = [
          UnitAction.Edit,
          UnitAction.View,
          UnitAction.Copy,
          UnitAction.Print,
          UnitAction.ManageCollaborator,
          UnitAction.Share,
          UnitAction.CreatePermissionObject,
          UnitAction.Delete,
        ];
        const expected = actions.map((action, index) => ({
          action,
          allowed: index === 0 ? canEdit : index < 4,
        }));
        const request = {
          unitID: host.unitId,
          objectID: host.unitId,
          objectType: host.objectType,
          actions,
        };
        expect(await host.authz.allowed(request)).toEqual(expected);
        expect(await host.authz.batchAllowed([request])).toEqual([
          { unitID: host.unitId, objectID: host.unitId, actions: expected },
        ]);
        expect(
          await host.authz.list({ unitID: host.unitId, objectIDs: [host.unitId], actions }),
        ).toMatchObject([
          { objectID: host.unitId, objectType: host.objectType, actions: expected },
        ]);
        expect(await host.edit()).toBe(canEdit);
        expect(host.content()).toBe(
          kind === 'sheet'
            ? canEdit
              ? 'edited'
              : 'original'
            : canEdit
              ? 'editedHello\r\n'
              : 'Hello\r\n',
        );
        expect(host.users.getCurrentUser()).toEqual(identity);
      } finally {
        host.dispose();
      }
    }
  },
);

test.each(['sheet', 'doc'] as const)(
  '%s readonly fences a true response already requested by the real controller',
  async (kind) => {
    const host = fixture(kind, 'editor');
    try {
      await host.refresh();
      expect(host.permissions.getPermissionPoint(host.editId)?.value).toBe(true);
      const allowed = host.authz.allowed.bind(host.authz);
      const release = Promise.withResolvers<void>();
      const requested = Promise.withResolvers<void>();
      const spy = vi.spyOn(host.authz, 'allowed').mockImplementationOnce(async (request) => {
        const result = await allowed(request);
        expect(result.find((action) => action.action === UnitAction.Edit)?.allowed).toBe(true);
        requested.resolve();
        await release.promise;
        return result;
      });
      const refresh = host.refresh();
      await requested.promise;
      host.binding.readonly();
      expect(host.permissions.getPermissionPoint(host.editId)?.value).toBe(false);
      const observed: unknown[] = [];
      const subscription = host.permissions.permissionPointUpdate$.subscribe((point) => {
        if (point.id === host.editId) observed.push(point.value);
      });
      release.resolve();
      await refresh;
      spy.mockRestore();
      expect(host.permissions.getPermissionPoint(host.editId)?.value).toBe(false);
      expect(await host.edit()).toBe(false);
      // Sheet recreates its permission cache on identity changes. Doc's public
      // controller refresh is exercised as well, after the exact same downgrade.
      host.users.setCurrentUser(guest);
      expect(host.permissions.getPermissionPoint(host.editId)?.value).toBe(false);
      await host.refresh();
      expect(host.permissions.getPermissionPoint(host.editId)?.value).toBe(false);
      expect(host.permissions.getPermissionPoint(host.copyId)?.value).toBe(true);
      expect(await host.edit()).toBe(false);
      expect(observed.length).toBeGreaterThan(0);
      expect(observed.every((value) => value === false)).toBe(true);
      expect(host.users.getCurrentUser()).toEqual(guest);
      subscription.unsubscribe();
    } finally {
      host.dispose();
    }
  },
);

test('an editor can write unprotected cells while retained native range policies remain denied and unchanged', async () => {
  const policies = {
    book: {
      unitID: 'book',
      objectType: UnitObject.Workbook,
      name: 'Book',
      strategies: [{ action: UnitAction.Edit, role: UnitRole.Owner }],
    },
    protected: {
      unitID: 'book',
      objectType: UnitObject.SelectRange,
      name: 'Protected',
      strategies: [{ action: UnitAction.Edit, role: UnitRole.Owner }],
    },
  };
  const rules = {
    one: [
      {
        id: 'rule',
        permissionId: 'protected',
        unitType: UnitObject.SelectRange,
        unitId: 'book',
        subUnitId: 'one',
        ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }],
        viewState: ViewStateEnum.OthersCanView,
        editState: EditStateEnum.OnlyMe,
      },
    ],
  };
  const host = fixture('sheet', 'editor', {
    resources: [
      { name: authzResource, data: JSON.stringify(policies) },
      { name: rangeResource, data: JSON.stringify(rules) },
    ],
  });
  try {
    const rangeEditId = new RangeProtectionPermissionEditPoint('book', 'one', 'protected').id;
    expect(host.permissions.getPermissionPoint(rangeEditId)?.value).toBe(false);
    await host.refresh();
    expect(host.permissions.getPermissionPoint(host.editId)?.value).toBe(true);
    expect(host.permissions.getPermissionPoint(rangeEditId)?.value).toBe(false);
    expect(await host.edit()).toBe(false);
    expect(await host.edit(1)).toBe(true);
    expect(host.content()).toBe('original');
    for (const request of [
      { unitID: 'book', objectID: 'protected', objectType: UnitObject.SelectRange },
      { unitID: 'book', objectID: 'one', objectType: UnitObject.Worksheet },
      { unitID: 'other', objectID: 'other', objectType: UnitObject.Workbook },
      { unitID: 'other', objectID: 'book', objectType: UnitObject.Workbook },
      { unitID: 'book', objectID: 'book', objectType: UnitObject.UNRECOGNIZED },
    ])
      expect(await host.authz.allowed({ ...request, actions: [UnitAction.Edit] })).toEqual([
        { action: UnitAction.Edit, allowed: false },
      ]);
    expect(
      await host.authz.list({
        unitID: 'book',
        objectIDs: ['protected'],
        actions: [UnitAction.Edit],
      }),
    ).toMatchObject([
      {
        objectID: 'protected',
        objectType: UnitObject.SelectRange,
        actions: [{ action: UnitAction.Edit, allowed: false }],
      },
    ]);
    const sheetPoint = new WorksheetEditPermission('book', 'one').id;
    host.permissions.updatePermissionPoint(sheetPoint, false);
    expect(host.permissions.getPermissionPoint(sheetPoint)?.value).toBe(false);
    host.binding.readonly();
    expect(host.permissions.getPermissionPoint(rangeEditId)?.value).toBe(false);
    expect(host.permissions.getPermissionPoint(sheetPoint)?.value).toBe(false);
    expect(host.resource(authzResource)).toEqual(policies);
    expect(host.resource(rangeResource)).toEqual(rules);
  } finally {
    host.dispose();
  }
});

test('document root grants preserve existing protected paragraph bindings through real permission refresh', async () => {
  const objectId = getDocumentParagraphPermissionObjectId('', 'paragraph-1');
  const policies = {
    protected: {
      unitID: 'doc',
      objectType: UnitObject.DocumentParagraph,
      name: 'Protected paragraph',
      strategies: [{ action: UnitAction.Edit, role: UnitRole.Owner }],
    },
  };
  const rules = [{ objectId, objectType: UnitObject.DocumentParagraph, permissionId: 'protected' }];
  const host = fixture('doc', 'owner', {
    resources: [
      { name: authzResource, data: JSON.stringify(policies) },
      { name: docResource, data: JSON.stringify(rules) },
    ],
  });
  try {
    await host.refresh();
    expect(host.permissions.getPermissionPoint(host.editId)?.value).toBe(true);
    const id = createDocumentPermissionPoint('doc', objectId, UnitAction.Edit).id;
    expect(host.permissions.getPermissionPoint(id)?.value).toBe(false);
    expect(await host.edit()).toBe(false);
    expect(host.content()).toBe('Hello\r\n');
    expect(host.resource(authzResource)).toEqual(policies);
    expect(host.resource(docResource)).toEqual(rules);
  } finally {
    host.dispose();
  }
});

test('native policy writers cannot change server snapshot resources or collaborators', async () => {
  const policies = {
    book: {
      unitID: 'book',
      objectType: UnitObject.Workbook,
      name: 'Book',
      strategies: [{ action: UnitAction.Edit, role: UnitRole.Owner }],
    },
  };
  const host = fixture('sheet', 'owner', {
    resources: [{ name: authzResource, data: JSON.stringify(policies) }],
  });
  try {
    await host.refresh();
    const target = { unitID: 'book', objectID: 'book' };
    const writes = [
      () =>
        host.authz.create({
          objectType: UnitObject.SelectRange,
          selectRangeObject: { unitID: 'book', name: 'New', collaborators: [], scope: undefined },
        }),
      () =>
        host.authz.update({
          ...target,
          objectType: UnitObject.Workbook,
          name: 'Changed',
          strategies: [],
          share: undefined,
          scope: undefined,
          collaborators: undefined,
        }),
      () => host.authz.createCollaborator({ ...target, collaborators: [] }),
      () => host.authz.updateCollaborator({ ...target, collaborator: undefined }),
      () => host.authz.deleteCollaborator({ ...target, collaboratorID: member.userID }),
      () => host.authz.putCollaborators({ ...target, collaborators: [] }),
    ];
    for (const write of writes)
      await expect(write()).rejects.toThrow('Manage access through Spinel sharing.');
    expect(host.resource(authzResource)).toEqual(policies);
    expect(host.users.getCurrentUser()).toEqual(member);
  } finally {
    host.dispose();
  }
});
