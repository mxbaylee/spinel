import { guestItemId, documentPath } from './documentAccess.ts';
import { CollaborationSessions } from './CollaborationSessions.ts';
import { UserManagerService } from '@univerjs/core';
import type { Univer, DependencyOverride } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import type { createUniver } from '@univerjs/presets';
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
export function collaborationPlugins(
  unitID: string,
  override?: DependencyOverride,
  keepDocumentUI = false,
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
        socketService: DocumentSocketService,
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
        enableDocumentCollaborationUI: keepDocumentUI,
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
  return data as { unitId: string; access: ItemAccess; user: { id: string; name: string } };
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
