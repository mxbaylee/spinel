import { PreparedNetworkCondition } from './offline/PreparedNetworkCondition.ts';
import { RecoveryCommands } from './offline/RecoveryCommands.ts';
import { prepareRecoveryLedgerProbe } from './offline/RecoveryLedgerProbe.ts';
import type { RecoveryLedgerProbe } from './offline/RecoveryLedgerProbe.ts';
import { ProbeLocalCache } from './ProbeLocalCache.ts';
import { prepareTransportProbe } from './offline/transportProbe.ts';
import type { OfflineAccess } from './offline/OfflineAccess.ts';
import { ScopedHTTP } from './offline/ScopedHTTP.ts';
import { scopedSocketService } from './offline/ScopedSocketService.ts';
import { UniverNetworkPlugin, IHTTPImplementation, XHRHTTPImplementation } from '@univerjs/network';
import { ProbeReplayCommands } from './ProbeReplayCommands.ts';
import { RevisionService } from '@univerjs-pro/collaboration';
import { guestItemId, documentPath } from './documentAccess.ts';
import { CollaborationSessions } from './CollaborationSessions.ts';
import { UserManagerService } from '@univerjs/core';
import { ICommandService, Injector, ILogService, IConfigService } from '@univerjs/core';
import type { Univer, DependencyOverride } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import type { createUniver, IPreset } from '@univerjs/presets';
import { UniverLicensePlugin } from '@univerjs-pro/license';
import { UniverCollaborationPlugin } from '@univerjs-pro/collaboration';
import {
  CollaborationController,
  CollaborationStatus,
  CollaborationSessionService,
  CollaborationUIEventService,
  CollaborationUIEventId,
  UniverCollaborationClientPlugin,
  ILocalCacheService,
  INetworkConditionService,
} from '@univerjs-pro/collaboration-client';
import {
  BrowserCollaborationSocketService,
  UniverCollaborationClientUIPlugin,
} from '@univerjs-pro/collaboration-client-ui';
import ClientEnglish from '@univerjs-pro/collaboration-client/locale/en-US';
import UIEnglish from '@univerjs-pro/collaboration-client-ui/locale/en-US';
import '@univerjs-pro/collaboration-client/facade';
import '@univerjs-pro/collaboration-client-ui/lib/index.css';
import type { SaveState } from '../src/shared/autosave.ts';
import type { ItemAccess } from '../src/shared/workspace.ts';

export { ClientEnglish, UIEnglish };
export function probeCommandOverride(
  unitId: string,
  access: ItemAccess,
  recovery?: RecoveryLedgerProbe,
): DependencyOverride {
  if (recovery)
    return [
      [
        ICommandService,
        {
          useFactory: (injector: Injector, log: ILogService, config: IConfigService) =>
            new RecoveryCommands(
              injector,
              log,
              config,
              () => recovery.ledger,
              (mode, id, params, options) => recovery.observeDispatch(mode, id, params, options),
            ),
          deps: [Injector, ILogService, IConfigService],
        },
      ],
    ];
  return import.meta.env.SPINEL_RECOVERY_PROBE &&
    location.origin === 'https://localhost:3103' &&
    access === 'owner' &&
    new URLSearchParams(location.search).get('replay-identity') === '1'
    ? [
        [
          ICommandService,
          {
            useFactory: (
              injector: Injector,
              log: ILogService,
              config: IConfigService,
              users: UserManagerService,
            ) =>
              new ProbeReplayCommands(
                injector,
                log,
                config,
                unitId,
                () => users.getCurrentUser()?.userID ?? null,
              ),
            deps: [Injector, ILogService, IConfigService, UserManagerService],
          },
        ],
      ]
    : [];
}
/** Last preset configures the network plugin already supplied by core presets. */
export function preparedNetworkPreset(boundary?: OfflineAccess): IPreset {
  return {
    plugins: boundary
      ? [
          [
            UniverNetworkPlugin,
            {
              forceUseNewInstance: true,
              override: [
                [
                  IHTTPImplementation,
                  {
                    useFactory: (log: ILogService) =>
                      new ScopedHTTP(boundary, new XHRHTTPImplementation(log)),
                    deps: [ILogService],
                  },
                ],
              ],
            },
          ],
        ]
      : [],
  };
}
export function collaborationPlugins(
  unitID: string,
  override?: DependencyOverride,
  boundary?: OfflineAccess,
  recovery?: RecoveryLedgerProbe,
): NonNullable<Parameters<typeof createUniver>[0]['plugins']> {
  const guest = guestItemId();
  const base = location.origin + (guest ? `/guest-api/${guest}` : '') + '/universer-api';
  // Public URL extension point: scope is checked before the server accepts a socket.
  class DocumentSocketService extends BrowserCollaborationSocketService {
    protected override _createSocketURL(url: string, ticket: string) {
      const scoped = new URL(super._createSocketURL(url, ticket));
      scoped.searchParams.set('unitID', unitID);
      return scoped.toString();
    }
  }
  return [
    UniverLicensePlugin,
    UniverCollaborationPlugin,
    [
      UniverCollaborationClientPlugin,
      {
        override: [
          ...(override ?? []),
          [CollaborationSessionService, { useClass: CollaborationSessions }],
        ],
        socketService: boundary ? scopedSocketService(boundary) : DocumentSocketService,
        enableOfflineEditing: !guest,
        retryConnectingInterval: 1000,
        sendChangesetTimeout: 100,
        authzUrl: base + '/authz',
        snapshotServerUrl: base + '/snapshot',
        collabSubmitChangesetUrl: base + '/comb',
        collabWebSocketUrl: base.replace(/^http/, 'ws') + '/comb/connect',
        wsSessionTicketUrl: base + '/user/session-ticket?unitID=' + encodeURIComponent(unitID),
      },
    ],
    [
      UniverCollaborationClientUIPlugin,
      {
        enableUrlUnitLoader: false,
        override: [
          ...(boundary
            ? ([
                [INetworkConditionService, { useValue: new PreparedNetworkCondition(boundary) }],
              ] as DependencyOverride)
            : []),
          ...(import.meta.env.SPINEL_RECOVERY_PROBE &&
          location.origin === 'https://localhost:3103' &&
          new URLSearchParams(location.search).get('host-cache') === '1'
            ? [
                [
                  ILocalCacheService,
                  {
                    useFactory: (revisions: RevisionService, users: UserManagerService) =>
                      new ProbeLocalCache(
                        unitID,
                        () => users.getCurrentUser()?.userID ?? null,
                        () => revisions.getCurrentRevOfUnit(unitID),
                        recovery,
                      ),
                    deps: [RevisionService, UserManagerService],
                  },
                ],
              ]
            : []),
        ],
      },
    ],
  ];
}
export async function prepareCollaboration(id: string) {
  const response = await fetch(`${documentPath(id)}/collaboration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Could not open live editing.');
  return {
    ...(data as { unitId: string; access: ItemAccess; user: { id: string; name: string } }),
    boundary: await prepareTransportProbe(id),
    recovery: await prepareRecoveryLedgerProbe(id),
  };
}
export function identifyCollaborator(univer: Univer, user: { id: string; name: string }) {
  univer
    .__getInjector()
    .get(UserManagerService)
    .setCurrentUser({ userID: user.id, name: user.name, avatar: '' });
}
export function watchCollaboration(
  univer: Univer,
  api: FUniver,
  id: string,
  itemId: string,
  access: ItemAccess,
  publish: (state: SaveState) => void,
  readonly: () => Promise<void>,
) {
  const collaboration = api.getCollaboration();
  let denied = false;
  let lastDirty = false;
  let disposed = false;
  let checking = false;
  let statusGeneration = 0;
  const cache = univer.__getInjector().get(ILocalCacheService);
  const abort = new AbortController();
  const checkAccess = async () => {
    if (checking || disposed || denied) return;
    checking = true;
    try {
      const response = await fetch(documentPath(itemId), { signal: abort.signal });
      const data = response.ok ? await response.json() : undefined;
      const restored =
        data?.live?.unitId !== undefined && (data.live.unitId !== id || data.live.restoring);
      const changed =
        [401, 403, 404].includes(response.status) ||
        (data && data.item.access !== access) ||
        restored;
      if (!changed || disposed) return;
      denied = true;
      publish({
        dirty: lastDirty,
        failed: true,
        message: restored
          ? 'A version is being restored or has been restored. Copy unsaved changes, then reload to continue.'
          : 'Access changed. Copy unsaved changes before reloading.',
      });
      await readonly();
    } catch {
      /* A network outage is not evidence that access was revoked. */
    } finally {
      checking = false;
    }
  };
  const update = (status = collaboration.getCollaborationStatus(id)) => {
    if (denied || disposed) return;
    const generation = ++statusGeneration;
    const dirty = status !== CollaborationStatus.SYNCED;
    // Acknowledgement precedes the SDK's delayed recovery-cache write. A reload
    // in that gap can replay an already committed insert as a new operation.
    // Keep the navigation guard until the public cache flush finishes; never
    // clear pending data, and never let an older flush hide a newer edit.
    lastDirty = true;
    publish({
      dirty: true,
      failed: dirty,
      message: dirty
        ? 'Changes not saved yet — keep this tab open. Reconnecting automatically.'
        : 'Finishing save — keep this tab open.',
    });
    if (!dirty)
      void cache.exhaustSavingTask().then(
        () => {
          if (disposed || denied || generation !== statusGeneration) return;
          lastDirty = false;
          publish({
            dirty: false,
            failed: false,
            message:
              access === 'viewer'
                ? 'View only — reload after your access changes.'
                : 'All changes saved.',
          });
        },
        () => {
          if (disposed || denied || generation !== statusGeneration) return;
          publish({
            dirty: true,
            failed: true,
            message: 'Could not finish saving recovery data. Keep this tab open and retry.',
          });
        },
      );
    if (status === CollaborationStatus.OFFLINE) void checkAccess();
  };
  let stopStatus = () => {};
  // The public entity stream reports every synchronization transition, including
  // changes originating in embedded cell editors and reconnect replay.
  const entities = univer
    .__getInjector()
    .get(CollaborationController)
    .getCollabEntity$(id)
    .subscribe((entity) => {
      stopStatus();
      const status = entity.status$.subscribe(update);
      stopStatus = () => status.unsubscribe();
    });
  const events = univer
    .__getInjector()
    .get(CollaborationUIEventService)
    .event$.subscribe((event) => {
      if (event.unitID && event.unitID !== id) return;
      if (
        [
          CollaborationUIEventId.PERMISSION_DENIED,
          CollaborationUIEventId.CLOSE_ROOM,
          CollaborationUIEventId.JOIN_ROOM_FAILED,
        ].includes(event.id)
      ) {
        // User-scoped SDK eviction can also disconnect another still-valid login.
        // Confirm this tab's current access before making its editor read-only.
        void checkAccess();
      }
    });
  const reconnect = () => {
    univer.__getInjector().get(CollaborationSessionService).reconnect();
    update();
  };
  window.addEventListener('online', reconnect);
  const accessTimer = window.setInterval(() => {
    void checkAccess();
  }, 1000);
  update();
  return {
    retry: reconnect,
    dispose() {
      disposed = true;
      abort.abort();
      window.clearInterval(accessTimer);
      entities.unsubscribe();
      stopStatus();
      events.unsubscribe();
      window.removeEventListener('online', reconnect);
    },
  };
}

/** Probe only: correlate two public SDK promises with accounted/staged recovery. */
export async function finishRecoveryProbe(univer: Univer, unitId: string) {
  const cache = univer.__getInjector().get(ILocalCacheService);
  if (!(cache instanceof ProbeLocalCache) || !cache.recovery) return;
  cache.recovery.facadeLoaded = true;
  await univer.__getInjector().get(CollaborationController).readyForCollab(unitId);
  cache.recovery.collaborationReady = true;
  await cache.finishRecovery();
}
