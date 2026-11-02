import {
  AuthzIoLocalService,
  CommandService,
  IAuthzIoService,
  ICommandService,
  IConfigService,
  ILogService,
  IPermissionService,
  IResourceManagerService,
  IUniverInstanceService,
  Injector,
  PermissionService,
  UniverInstanceType,
  UserManagerService,
} from '@univerjs/core';
import type { DependencyOverride, IExecutionOptions, IPermissionPoint } from '@univerjs/core';
import { UnitAction, UnitObject } from '@univerjs/protocol';
import type { IAllowedRequest, IListPermPointRequest } from '@univerjs/protocol';
import type { BehaviorSubject } from 'rxjs';
import type { ItemAccess } from '../src/shared/workspace.ts';

const readActions = new Set([
  UnitAction.View,
  UnitAction.Copy,
  UnitAction.Print,
  UnitAction.SelectProtectedCells,
  UnitAction.SelectUnProtectedCells,
]);
const sharingActions = new Set([
  UnitAction.ManageCollaborator,
  UnitAction.Share,
  UnitAction.CreatePermissionObject,
  UnitAction.Delete,
]);
const rootTypes = new Set([UnitObject.Workbook, UnitObject.Document]);
const refusePolicyWrite = async (): Promise<never> => {
  throw new Error('Manage access through Spinel sharing.');
};

/** Bind a native unit's local controls to its server-authorized Spinel grant. */
export function nativeSyncPermissions(unitId: string, access: ItemAccess) {
  let viewer = access === 'viewer';
  let permissions: PermissionService | undefined;
  const allowed = (action: UnitAction) =>
    readActions.has(action) ||
    (!viewer &&
      action !== UnitAction.UNRECOGNIZED &&
      typeof UnitAction[action] === 'string' &&
      !sharingActions.has(action));
  const rootPoint = (point: IPermissionPoint<unknown>) =>
    rootTypes.has(point.type) && point.id === `${point.type}.${point.subType}_${unitId}`;

  const skipDocStartup = (id: string, params?: object) =>
    viewer &&
    id === 'doc.command.refresh-header-footer-fields' &&
    params !== null &&
    params !== undefined &&
    'unitId' in params &&
    params.unitId === unitId &&
    'onOpen' in params &&
    params.onOpen === true;

  // Refuse the automatic reader-only refresh before native permission listeners
  // report an edit denial. Every explicit command and mutation still uses the
  // original service, including its permission checks and denial notifications.
  class ReaderCommands extends CommandService {
    override executeCommand<P extends object = object, R = boolean>(
      id: string,
      params?: P,
      options?: IExecutionOptions,
    ): Promise<R> {
      return skipDocStartup(id, params)
        ? Promise.resolve(false as R)
        : super.executeCommand<P, R>(id, params, options);
    }

    override syncExecuteCommand<P extends object = object, R = boolean>(
      id: string,
      params?: P,
      options?: IExecutionOptions,
    ): R {
      return skipDocStartup(id, params)
        ? (false as R)
        : super.syncExecuteCommand<P, R>(id, params, options);
    }
  }

  // Native controllers re-add points on user changes and can complete a stale
  // async read after downgrade. Project at the public cache write boundary,
  // before observers see it; no document resource or protection rule is edited.
  class GrantPermissions extends PermissionService {
    override addPermissionPoint<T = boolean>(
      item: IPermissionPoint<T> | BehaviorSubject<IPermissionPoint<T>>,
    ) {
      const point = 'getValue' in item ? item.getValue() : item;
      if (rootPoint(point)) point.value = allowed(point.subType) as T;
      return super.addPermissionPoint(item);
    }

    override updatePermissionPoint<T = boolean>(id: string, value: T) {
      const point = this.getPermissionPoint<unknown>(id);
      super.updatePermissionPoint(id, point && rootPoint(point) ? allowed(point.subType) : value);
    }
  }

  const override: DependencyOverride = [
    [
      ICommandService,
      {
        deps: [Injector, ILogService, IConfigService],
        useFactory: (injector: Injector, log: ILogService, config: IConfigService) =>
          new ReaderCommands(injector, log, config),
      },
    ],
    [IPermissionService, { useFactory: () => (permissions = new GrantPermissions()) }],
    [
      IAuthzIoService,
      {
        deps: [IResourceManagerService, UserManagerService, IUniverInstanceService],
        useFactory: (
          resources: IResourceManagerService,
          users: UserManagerService,
          instances: IUniverInstanceService,
        ) => {
          class GrantAuthz extends AuthzIoLocalService {
            override async allowed(config: IAllowedRequest) {
              if (
                config.unitID === unitId &&
                config.objectID === unitId &&
                rootTypes.has(config.objectType)
              )
                return config.actions.map((action) => ({ action, allowed: allowed(action) }));
              return super.allowed(config);
            }

            override async list(config: IListPermPointRequest) {
              const objects = await super.list(config);
              const type = instances.getUnitType(unitId);
              const rootType =
                type === UniverInstanceType.UNIVER_SHEET
                  ? UnitObject.Workbook
                  : type === UniverInstanceType.UNIVER_DOC
                    ? UnitObject.Document
                    : undefined;
              return objects.map((object) =>
                config.unitID === unitId && object.objectID === unitId && rootType !== undefined
                  ? {
                      ...object,
                      objectType: rootType,
                      actions: config.actions.map((action) => ({
                        action,
                        allowed: allowed(action),
                      })),
                    }
                  : object,
              );
            }

            // The local provider keeps its existing resource loader/serializer.
            // Spinel does not admit mutations that change native shared policies.
            override create = refusePolicyWrite;
            override update = refusePolicyWrite;
            override createCollaborator = refusePolicyWrite;
            override updateCollaborator = refusePolicyWrite;
            override deleteCollaborator = refusePolicyWrite;
            override putCollaborators = refusePolicyWrite;
          }
          return new GrantAuthz(resources, users);
        },
      },
    ],
  ];

  function setAccess(next: ItemAccess) {
    viewer = next === 'viewer';
    if (!permissions) return;
    for (const [id, point] of permissions.getAllPermissionPoint()) {
      const current = point.getValue();
      if (rootPoint(current)) permissions.updatePermissionPoint(id, allowed(current.subType));
    }
  }
  return {
    override,
    setAccess,
    readonly() {
      setAccess('viewer');
    },
  };
}
