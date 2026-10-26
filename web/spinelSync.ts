import { createNativeSyncClient, hashTouched, nativeSnapshot } from '@spinel/sync-client';
import type { ClientState, ClientFailure, OutgoingFrame, Touched } from '@spinel/sync-client';
import { UniverInstanceType } from '@univerjs/core';
import type { IDocumentData, IWorkbookData, Univer } from '@univerjs/core';
import type { SaveState } from '../src/shared/autosave.ts';
import type { ItemAccess } from '../src/shared/workspace.ts';
import type { ConnectionState } from './connectionState.ts';
import { documentPath, documentSyncPath, guestItemId } from './documentAccess.ts';
import { revokeGuestView } from './guestRevocation.ts';
import { setSyncPresence } from './syncPresence.ts';
import type { SyncPresenceState, SyncPresenceMember } from './syncPresence.ts';

interface Watch {
  publish(state: SaveState): void;
  connection(state: ConnectionState): void;
  readonly(): Promise<void>;
}

interface Options {
  univer: Univer;
  unitId: string;
  itemId: string;
  spaceId?: string;
  access: ItemAccess;
  kind: 'sheet' | 'doc';
  signal: AbortSignal;
  isCurrent(): boolean;
  initializeAccess?(): void | Promise<void>;
  onInitialPending?(): void;
  reload(reason: ClientFailure): void;
}

const bindings = new WeakMap<Univer, ReturnType<typeof bind>>();
const emptyPresence = (): SyncPresenceState => ({ selfId: '', members: [], connected: false });
const closed = () => new DOMException('The editor was closed.', 'AbortError');

/** Load the exact durable base before creating the native capture/confirmed-state pair. */
export async function loadSpinelDocument(options: Options) {
  const { univer, unitId, itemId, spaceId, kind, signal, isCurrent } = options;
  const path = documentSyncPath(itemId, spaceId);
  const response = await fetch(`${path}/snapshot?unitId=${encodeURIComponent(unitId)}`, {
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (!isCurrent() || signal.aborted) throw closed();
  if ([401, 403, 404].includes(response.status)) revokeGuestView();
  if (!response.ok) throw new Error('Could not load this document. Reload to try again.');
  const data = (await response.json()) as {
    version: number;
    unitId: string;
    revision: number;
    snapshot: IWorkbookData | IDocumentData;
  };
  if (!isCurrent() || signal.aborted) throw closed();
  if (
    data.version !== 1 ||
    data.unitId !== unitId ||
    !Number.isSafeInteger(data.revision) ||
    data.revision < 1 ||
    !data.snapshot ||
    data.snapshot.id !== unitId
  )
    throw new Error('This document needs to be reloaded.');
  if (kind === 'sheet')
    univer.createUnit(
      UniverInstanceType.UNIVER_SHEET,
      structuredClone(data.snapshot as IWorkbookData),
    );
  else
    univer.createUnit(
      UniverInstanceType.UNIVER_DOC,
      structuredClone(data.snapshot as IDocumentData),
    );
  // Install viewer permissions in the same turn as unit creation, before the
  // canvas can take input or native capture can record a local mutation.
  await options.initializeAccess?.();
  if (!isCurrent() || signal.aborted) throw closed();
  const binding = bind(options, data.snapshot, data.revision);
  bindings.set(univer, binding);
}

export function getSpinelSync(univer: Univer) {
  return bindings.get(univer);
}

export function disposeSpinelSync(univer: Univer) {
  bindings.get(univer)?.dispose();
}

/** Sockets and scoped access stay in the application; the reusable client owns edits. */
function bind(options: Options, snapshot: IWorkbookData | IDocumentData, revision: number) {
  const { univer, unitId, itemId, spaceId, access, signal, isCurrent } = options;
  const path = documentSyncPath(itemId, spaceId);
  let disposed = false;
  let denied = false;
  let started = false;
  let watcher: Watch | undefined;
  let socket: WebSocket | undefined;
  let connecting = false;
  let generation = 0;
  let roomReady = false;
  let accessUnreachable = false;
  let checking = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let accessTimer: ReturnType<typeof setInterval> | undefined;
  let answerTimer: ReturnType<typeof setTimeout> | undefined;
  let readinessTimer: ReturnType<typeof setTimeout> | undefined;
  let requestId: string | undefined;
  let retryDelay = 250;
  let denialMessage = '';
  let state: ClientState = {
    revision,
    pending: false,
    pendingMutations: 0,
    connected: false,
    resyncing: false,
  };
  let presence = emptyPresence();
  const presenceListeners = new Set<(state: SyncPresenceState) => void>();
  const abort = new AbortController();
  const active = () => !disposed && !signal.aborted && isCurrent();
  const publishPresence = (next: SyncPresenceState) => {
    presence = next;
    for (const listener of presenceListeners) listener(next);
  };
  const report = () => {
    if (!active()) return;
    if (!watcher) {
      // Capture starts before native layout/readiness. Protect early typing
      // from navigation without applying remote edits to an unready renderer.
      if (state.pending) options.onInitialPending?.();
      return;
    }
    const connected = roomReady && state.connected && !accessUnreachable && navigator.onLine;
    watcher.connection(
      denied || !navigator.onLine || accessUnreachable
        ? 'offline'
        : connected
          ? 'online'
          : connecting || !socket
            ? 'reconnecting'
            : 'offline',
    );
    watcher.publish({
      dirty: state.pending,
      failed: denied || state.resyncing || Boolean(state.failure) || !connected,
      message: denied
        ? denialMessage
        : state.resyncing
          ? 'An edit could not be applied. Waiting for the server before reloading.'
          : state.pending
            ? 'Changes not saved yet — keep this tab open.'
            : connected
              ? access === 'viewer'
                ? 'View only — reload after your access changes.'
                : 'All changes saved.'
              : 'Connection interrupted. Reconnect to continue.',
    });
  };
  const send = (frame: OutgoingFrame | { type: 'cursor'; selection: string }) => {
    if (!active() || denied || socket?.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(frame));
      if (frame.type === 'submit') {
        requestId = frame.mutationId;
        clearTimeout(answerTimer);
        // An unanswered request remains immutable in the client. A fresh
        // connection resolves its durable receipt instead of inventing a new ID.
        answerTimer = setTimeout(() => reconnect(), 15_000);
      }
    } catch {
      reconnect();
    }
  };
  // Compiled out of normal builds. Tests observe the actual public native
  // snapshot without exposing an editor, command service or writable global.
  const evidence = import.meta.env.VITE_SYNC_EVIDENCE === '1';
  const observe = (snapshot: IWorkbookData | IDocumentData) => {
    if (evidence)
      window.dispatchEvent(
        new CustomEvent('spinel-sync-native-snapshot', {
          detail: { unitId, revision: state.revision, snapshot: structuredClone(snapshot) },
        }),
      );
  };
  const client = createNativeSyncClient({
    univer,
    unitId,
    kind: options.kind,
    snapshot,
    revision,
    send,
    ...(evidence
      ? {
          hash: (snapshot: IWorkbookData | IDocumentData, touched: Touched) => {
            observe(snapshot);
            return hashTouched(snapshot, touched);
          },
        }
      : {}),
    onState(next) {
      state = next;
      if (active() && next.resyncing) void watcher?.readonly().catch(() => {});
      report();
    },
    onResync(reason) {
      if (!active() || denied) return;
      dispose();
      options.reload(reason);
    },
  });
  const unregisterPresence = setSyncPresence(univer, unitId, {
    subscribe(listener) {
      presenceListeners.add(listener);
      listener(presence);
      return () => presenceListeners.delete(listener);
    },
    setCursor(selection) {
      if (roomReady && state.connected && !denied && selection.length <= 160)
        send({ type: 'cursor', selection });
    },
  });

  function endConnection() {
    generation++;
    connecting = false;
    roomReady = false;
    clearTimeout(readinessTimer);
    readinessTimer = undefined;
    clearTimeout(answerTimer);
    answerTimer = undefined;
    requestId = undefined;
    const previous = socket;
    socket = undefined;
    previous?.close();
    client.setConnected(false);
    publishPresence(emptyPresence());
  }

  function schedule() {
    if (!active() || denied || !started || !navigator.onLine || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void connect();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 5000);
  }

  function reconnect() {
    if (!active() || denied) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    endConnection();
    report();
    schedule();
  }

  async function checkAccess() {
    if (!active() || checking || denied) return;
    checking = true;
    try {
      const response = await fetch(documentPath(itemId, spaceId), {
        cache: 'no-store',
        signal: AbortSignal.any([abort.signal, signal, AbortSignal.timeout(2500)]),
      });
      const data = response.ok ? await response.json() : undefined;
      if (!active()) return;
      const lost = [401, 403, 404].includes(response.status);
      const changed = data && data.item.access !== access;
      const restored = data?.live && (data.live.unitId !== unitId || data.live.restoring);
      if (lost || changed || restored) {
        denied = true;
        endConnection();
        if (guestItemId() && (lost || changed)) {
          revokeGuestView();
          return;
        }
        denialMessage = restored
          ? 'A version is being restored or has been restored. Copy unsaved changes, then reload to continue.'
          : 'Access changed. Copy unsaved changes before reloading.';
        report();
        await watcher?.readonly();
      } else {
        accessUnreachable = !response.ok;
        report();
      }
    } catch {
      if (active() && !abort.signal.aborted) {
        accessUnreachable = true;
        report();
      }
    } finally {
      checking = false;
    }
  }

  async function connect() {
    if (!active() || denied || connecting || socket || !navigator.onLine) return;
    connecting = true;
    roomReady = false;
    const current = ++generation;
    const same = () => active() && !denied && generation === current;
    report();
    try {
      const ticket = await fetch(`${path}/ticket?unitId=${encodeURIComponent(unitId)}`, {
        method: 'POST',
        signal: AbortSignal.any([abort.signal, signal, AbortSignal.timeout(5000)]),
      });
      if (!same()) return;
      if (!ticket.ok) {
        if ([401, 403, 404].includes(ticket.status)) await checkAccess();
        throw new Error('Room unavailable');
      }
      const data = await ticket.json();
      if (!same()) return;
      if (data.version !== 1 || typeof data.ticket !== 'string')
        throw new Error('Room unavailable');
      const url = new URL(`${path}/socket`, location.origin);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('unitId', unitId);
      url.searchParams.set('ticket', data.ticket);
      url.searchParams.set('afterRevision', String(client.confirmedRevision));
      const opened = new WebSocket(url);
      socket = opened;
      // An upgrade or initial replay can stall before any submit starts its
      // answer timeout. Pending local work must still get a fresh connection.
      readinessTimer = setTimeout(() => {
        if (same()) reconnect();
      }, 15_000);
      opened.onopen = () => {
        if (!same()) return opened.close();
        client.setConnected(true);
        report();
      };
      opened.onmessage = (event) => {
        if (!same()) return;
        try {
          if (typeof event.data !== 'string' || event.data.length > 20 * 1024 * 1024)
            throw new Error('Invalid room message');
          const frame = JSON.parse(event.data);
          if (!frame || typeof frame !== 'object' || Array.isArray(frame))
            throw new Error('Invalid room message');
          if (frame.type === 'presence') {
            if (
              typeof frame.selfId !== 'string' ||
              !Array.isArray(frame.members) ||
              frame.members.length > 64 ||
              !frame.members.every(validMember)
            )
              throw new Error('Invalid room presence');
            publishPresence({ selfId: frame.selfId, members: frame.members, connected: roomReady });
            return;
          }
          if (frame.type === 'verified') return;
          if (!['resume', 'edit', 'ack', 'resync'].includes(frame.type))
            throw new Error('Invalid room message');
          if (frame.type === 'resume') {
            if (frame.unitId !== unitId || frame.version !== 1) throw new Error('Invalid room');
            client.receive(frame);
            if (!same()) return;
            clearTimeout(readinessTimer);
            readinessTimer = undefined;
            roomReady = !state.resyncing;
            connecting = false;
            retryDelay = 250;
            publishPresence({ ...presence, connected: roomReady });
          } else {
            if (
              (frame.type === 'ack' || frame.type === 'resync') &&
              frame.mutationId === requestId
            ) {
              clearTimeout(answerTimer);
              answerTimer = undefined;
              requestId = undefined;
            }
            client.receive(frame);
          }
          report();
        } catch {
          // Malformed/incomplete transport never overwrites the optimistic model.
          // The client's original envelope survives the fresh connection.
          reconnect();
        }
      };
      opened.onerror = () => opened.close();
      opened.onclose = () => {
        if (!same()) return;
        endConnection();
        report();
        void checkAccess();
        schedule();
      };
    } catch {
      if (!same()) return;
      connecting = false;
      report();
      schedule();
    }
  }

  const online = () => {
    retryDelay = 250;
    reconnect();
    void checkAccess();
  };
  const offline = () => {
    endConnection();
    report();
  };
  function dispose() {
    if (disposed) return;
    disposed = true;
    abort.abort();
    clearTimeout(reconnectTimer);
    clearTimeout(answerTimer);
    clearInterval(accessTimer);
    endConnection();
    client.dispose();
    unregisterPresence();
    presenceListeners.clear();
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
    signal.removeEventListener('abort', dispose);
    if (bindings.get(univer) === binding) bindings.delete(univer);
  }
  const binding = {
    watch(next: Watch) {
      watcher = next;
      if (evidence && !state.pending) observe(nativeSnapshot(univer, unitId));
      if (!started) {
        started = true;
        window.addEventListener('online', online);
        window.addEventListener('offline', offline);
        accessTimer = setInterval(() => void checkAccess(), 1000);
        void connect();
      }
      report();
      return {
        retry() {
          retryDelay = 250;
          reconnect();
          void checkAccess();
        },
        dispose,
      };
    },
    dispose,
  };
  signal.addEventListener('abort', dispose, { once: true });
  return binding;
}

function validMember(member: unknown): member is SyncPresenceMember {
  if (!member || typeof member !== 'object') return false;
  const value = member as Record<string, unknown>;
  return (
    typeof value.id === 'string' &&
    value.id.length <= 128 &&
    typeof value.name === 'string' &&
    value.name.length <= 512 &&
    typeof value.avatar === 'string' &&
    value.avatar.length <= 2048 &&
    (value.selection === undefined ||
      (typeof value.selection === 'string' && value.selection.length < 4096))
  );
}
