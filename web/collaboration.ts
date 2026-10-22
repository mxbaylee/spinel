import { guestItemId, documentPath, documentProtocolPath } from './documentAccess.ts';
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
  SessionStatus,
  CollaborationSessionService,
  CollaborationUIEventService,
  CollaborationUIEventId,
  UniverCollaborationClientPlugin,
  ILocalCacheService,
} from '@univerjs-pro/collaboration-client';
import type { ICollaborationSocket } from '@univerjs-pro/collaboration-client';
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
import { createEditorConnection, reduceEditorConnection } from './connectionState.ts';
import type { ConnectionState, RoomConnectionStatus } from './connectionState.ts';
import type { DocPendingChanges } from './docPending.ts';

export { ClientEnglish, UIEnglish };
export function collaborationPlugins(
  unitID: string,
  override?: DependencyOverride,
  keepDocumentUI = false,
  space?: { spaceId: string; itemId: string },
): NonNullable<Parameters<typeof createUniver>[0]['plugins']> {
  const guest = guestItemId();
  const base = location.origin + documentProtocolPath(space);
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
        // Space review does not prepare documents for offline use. Every native
        // request still carries the exact Space/child scope when reconnecting.
        enableOfflineEditing: !guest && !space,
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
export async function prepareCollaboration(id: string, spaceId?: string) {
  const response = await fetch(`${documentPath(id, spaceId)}/collaboration`, {
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
  publishConnection: (state: ConnectionState) => void = () => {},
  spaceId?: string,
  native?: DocPendingChanges,
) {
  const collaboration = api.getCollaboration();
  let denied = false;
  let lastDirty = false;
  let disposed = false;
  let checking = false;
  let statusGeneration = 0;
  let accessUnreachable = false;
  let connection = createEditorConnection(navigator.onLine);
  const sessions = univer.__getInjector().get(CollaborationSessionService);
  let activeSocket: ICollaborationSocket | null = null;
  const sockets = sessions.socket$.subscribe((socket) => {
    activeSocket = socket ?? null;
  });
  const connectionEvent = (event: Parameters<typeof reduceEditorConnection>[1]) => {
    if (disposed) return;
    connection = reduceEditorConnection(connection, event);
    publishConnection(accessUnreachable ? 'offline' : connection.state);
  };
  const cache = univer.__getInjector().get(ILocalCacheService);
  const abort = new AbortController();
  const checkAccess = async () => {
    if (checking || disposed || denied) return;
    checking = true;
    try {
      // The browser can report online while the server is unreachable. Reuse
      // this existing access round trip, with a bound even for silent outages.
      const response = await fetch(documentPath(itemId, spaceId), {
        cache: 'no-store',
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(2500)]),
      });
      const data = response.ok ? await response.json() : undefined;
      const restored =
        data?.live?.unitId !== undefined && (data.live.unitId !== id || data.live.restoring);
      const changed =
        [401, 403, 404].includes(response.status) ||
        (data && data.item.access !== access) ||
        restored;
      if (disposed) return;
      if (!changed) {
        if (!response.ok) {
          accessUnreachable = true;
          publishConnection('offline');
        } else if (accessUnreachable) {
          accessUnreachable = false;
          // Remove the reachability veto, retaining the public room's actual
          // lifecycle. A metadata-only outage need not interrupt its socket.
          reconnect();
        }
        return;
      }
      denied = true;
      connectionEvent({ type: 'sync', status: 'offline' });
      publish({
        dirty: lastDirty,
        failed: true,
        message: restored
          ? 'A version is being restored or has been restored. Copy unsaved changes, then reload to continue.'
          : 'Access changed. Copy unsaved changes before reloading.',
      });
      await readonly();
    } catch {
      // A network outage is not evidence that access was revoked; keep edits
      // and access intact, but stop claiming that the connection is ready.
      if (!disposed && !abort.signal.aborted) {
        accessUnreachable = true;
        publishConnection('offline');
      }
    } finally {
      checking = false;
    }
  };
  const update = (status = collaboration.getCollaborationStatus(id)) => {
    if (denied || disposed) return;
    const generation = ++statusGeneration;
    connectionEvent({
      type: 'sync',
      status:
        status === CollaborationStatus.OFFLINE
          ? 'offline'
          : status === CollaborationStatus.NOT_COLLAB
            ? 'not-started'
            : 'active',
    });
    const dirty = status !== CollaborationStatus.SYNCED || Boolean(native?.pending());
    // Acknowledgement precedes the SDK's delayed recovery-cache write. A reload
    // in that gap can replay an already committed insert as a new operation.
    // Keep the navigation guard until the public cache flush finishes; never
    // clear pending data, and never let an older flush hide a newer edit.
    lastDirty = true;
    publish({
      dirty: true,
      failed: dirty,
      message: dirty
        ? 'Changes not saved yet — keep this tab open.'
        : 'Finishing save — keep this tab open.',
    });
    if (!dirty)
      void cache.exhaustSavingTask().then(
        () => {
          if (
            disposed ||
            denied ||
            generation !== statusGeneration ||
            native?.pending() ||
            collaboration.getCollaborationStatus(id) !== CollaborationStatus.SYNCED
          )
            return;
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
  // A local Doc mutation can still be in its native 300 ms batching queue while
  // collaboration says SYNCED. Invalidate any older asynchronous clean result
  // synchronously, including when this hook attaches to an already pending Doc.
  const stopNative = native?.subscribe(() => update());
  let stopStatus = () => {};
  let entityGeneration = 0;
  const roomStates: Record<SessionStatus, RoomConnectionStatus> = {
    [SessionStatus.IDLE]: 'idle',
    [SessionStatus.JOINING]: 'joining',
    [SessionStatus.OFFLINE]: 'offline',
    [SessionStatus.ONLINE]: 'online',
  };
  // The public entity stream reports every synchronization transition, including
  // changes originating in embedded cell editors and reconnect replay.
  const entities = univer
    .__getInjector()
    .get(CollaborationController)
    .getCollabEntity$(id)
    .subscribe((entity) => {
      stopStatus();
      const generation = ++entityGeneration;
      connection = createEditorConnection(navigator.onLine);
      publishConnection(accessUnreachable ? 'offline' : connection.state);
      const status = entity.status$.subscribe((value) => {
        if (generation === entityGeneration) update(value);
      });
      // Public per-document session state: a socket alone does not prove that
      // this document's room has been rejoined. Held-JOIN E2E covers the contract.
      const room = entity.session.sessionStatus$.subscribe((value) => {
        if (generation === entityGeneration)
          connectionEvent({ type: 'room', status: roomStates[value] });
      });
      stopStatus = () => {
        status.unsubscribe();
        room.unsubscribe();
      };
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
    // Retry can be a no-op on an already joined socket. Only actual room/browser
    // transitions invalidate its proof; pending saves do not imply disconnection.
    sessions.reconnect();
    update();
  };
  const online = () => {
    connectionEvent({ type: 'browser', online: true });
    // Browser offline mode can leave a WebSocket alive. We discarded its proof,
    // so explicitly close the public socket to guarantee a fresh room lifecycle.
    activeSocket?.close();
    reconnect();
  };
  const offline = () => connectionEvent({ type: 'browser', online: false });
  window.addEventListener('online', online);
  window.addEventListener('offline', offline);
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
      sockets.unsubscribe();
      entities.unsubscribe();
      stopStatus();
      events.unsubscribe();
      stopNative?.();
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    },
  };
}
