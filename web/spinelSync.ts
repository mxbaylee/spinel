import {
  createNativeSyncClient,
  hashTouched,
  nativeSnapshot,
  validateNativeSnapshot,
} from '@spinel/sync-client';
import type { ClientState, ClientFailure, OutgoingFrame, Touched } from '@spinel/sync-client';
import { ICommandService, UniverInstanceType } from '@univerjs/core';
import type { IDocumentData, IWorkbookData, Univer } from '@univerjs/core';
import type { SaveState } from '../src/shared/autosave.ts';
import type { ItemAccess } from '../src/shared/workspace.ts';
import type { OfflineRecoveryState } from '../src/shared/offlineRecovery.ts';
import type { ConnectionState } from './connectionState.ts';
import { documentPath, documentSyncPath, guestItemId } from './documentAccess.ts';
import { revokeGuestView } from './guestRevocation.ts';
import { setSyncPresence } from './syncPresence.ts';
import type { SyncPresenceState, SyncPresenceMember } from './syncPresence.ts';
import { nativeMutationInventory } from './nativeMutationInventory.ts';
import type { OfflineSession } from './offline/OfflineSession.ts';
import { expirePreparedAccount } from './offline/offlineStore.ts';
import { within } from './offline/shell.ts';
import { signInPath } from './api.ts';
import { clearDashboardNavigation } from './dashboardNavigation.ts';
import { CreationUploadError } from './offline/creation.ts';

interface Watch {
  publish(state: SaveState): void;
  connection(state: ConnectionState): void;
  readonly(preserveInput?: boolean): Promise<void>;
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
  canRefresh?(): boolean;
  reload(reason: ClientFailure, clean?: boolean): void;
  offline?: OfflineSession;
  lock?(): void;
}

const bindings = new WeakMap<Univer, ReturnType<typeof bind>>();
const emptyPresence = (): SyncPresenceState => ({ selfId: '', members: [], connected: false });
const closed = () => new DOMException('The editor was closed.', 'AbortError');

/** Load the exact durable base before creating the native capture/confirmed-state pair. */
export async function loadSpinelDocument(options: Options) {
  const { univer, unitId, itemId, spaceId, kind, signal, isCurrent } = options;
  const current = () => isCurrent() && !signal.aborted && (options.offline?.current ?? true);
  const path = documentSyncPath(itemId, spaceId);
  const local = options.offline?.initial();
  const response = local
    ? undefined
    : await (options.offline?.fetch.bind(options.offline) ?? fetch)(
        `${path}/snapshot?unitId=${encodeURIComponent(unitId)}`,
        {
          cache: 'no-store',
          signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        },
      );
  if (!current()) throw closed();
  if (response && [401, 403, 404].includes(response.status)) revokeGuestView();
  if (response && !response.ok)
    throw new Error('Could not load this document. Reload to try again.');
  const data = (local ? { ...local, unitId, version: 1 } : await response!.json()) as {
    version: number;
    unitId: string;
    revision: number;
    snapshot: IWorkbookData | IDocumentData;
  };
  if (!current()) throw closed();
  if (
    data.version !== 1 ||
    data.unitId !== unitId ||
    !Number.isSafeInteger(data.revision) ||
    data.revision < 1 ||
    !data.snapshot ||
    data.snapshot.id !== unitId
  )
    throw new Error('This document needs to be reloaded.');
  // Persisted storage is not trusted native input. Check compact geometry
  // before the visible SDK can allocate its row/column/merge caches.
  validateNativeSnapshot(data.snapshot, kind);
  if (kind === 'sheet')
    univer.createUnit(
      UniverInstanceType.UNIVER_SHEET,
      (options.offline?.toVisible(data.snapshot) ??
        structuredClone(data.snapshot)) as IWorkbookData,
    );
  else
    univer.createUnit(
      UniverInstanceType.UNIVER_DOC,
      (options.offline?.toVisible(data.snapshot) ??
        structuredClone(data.snapshot)) as IDocumentData,
    );
  // Install viewer permissions in the same turn as unit creation, before the
  // canvas can take input or native capture can record a local mutation.
  await options.initializeAccess?.();
  if (!current()) throw closed();
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
  let refreshingClean = false;
  let authenticationEnded = false;
  let endingAuthentication = false;
  let recovery: OfflineRecoveryState | undefined;
  let recoveryRunning = false;
  let recoveryAttempted = false;
  let recoveryResolved = false;
  let clearMessages = () => {};
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
  const active = () =>
    !disposed && !signal.aborted && isCurrent() && (options.offline?.current ?? true);
  const request = (path: string, init?: RequestInit) =>
    options.offline ? options.offline.fetch(path, init) : fetch(path, init);
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
    if (mayRecover() && !recovery)
      recovery = {
        phase: 'ready',
        ...(options.offline?.creation ? { creation: true } : {}),
        originalHref: options.offline?.creation
          ? '/'
          : spaceId
            ? `/spaces/${encodeURIComponent(spaceId)}?item=${encodeURIComponent(itemId)}`
            : `/?item=${encodeURIComponent(itemId)}`,
      };
    if (recoveryResolved && recovery) {
      watcher.connection('offline');
      watcher.publish({
        local: 'attention',
        dirty: false,
        failed: true,
        retained: true,
        recovery,
        message:
          recovery.phase === 'created'
            ? `Your offline changes were saved as ${recovery.copyName}. The original was not changed.`
            : recovery.creation
              ? 'This new document was discarded from this device. Any upload already accepted by the server is unchanged.'
              : 'Your offline changes were discarded from this device. The original was not changed.',
      });
      return;
    }
    const connected = roomReady && state.connected && !accessUnreachable && navigator.onLine;
    if (options.offline) options.offline.online = connected && !denied && !state.resyncing;
    watcher.connection(
      denied || !navigator.onLine || accessUnreachable
        ? 'offline'
        : connected
          ? 'online'
          : connecting || !socket
            ? 'reconnecting'
            : 'offline',
    );
    if (options.offline?.enabled) {
      const attention = denied || state.resyncing || Boolean(options.offline.problem);
      const local =
        state.recoveryMissing || state.localPersistence === 'failed'
          ? 'failed'
          : state.localPersistence === 'saving'
            ? 'saving'
            : attention
              ? 'attention'
              : state.pending
                ? 'saved'
                : connected
                  ? 'synced'
                  : 'saved';
      watcher.publish({
        local,
        ...(authenticationEnded ? { signInRequired: true } : {}),
        ...(recovery ? { recovery } : {}),
        retained:
          state.pending || Boolean(state.recoveryMissing) || Boolean(options.offline.creation),
        dirty:
          Boolean(state.recoveryMissing) ||
          state.localPersistence === 'saving' ||
          state.localPersistence === 'failed',
        failed: attention || local === 'failed',
        message: state.recoveryMissing
          ? 'The latest visible changes could not be saved on this device. Keep this tab open and retry saving.'
          : local === 'failed'
            ? `Changes could not be saved on this device. Keep this tab open and retry saving.${attention ? ' Synchronization also needs attention.' : ''}`
            : local === 'saving'
              ? `Saving on this device…${attention ? ' Synchronization needs attention.' : ''}`
              : recovery?.phase === 'creating'
                ? 'Creating an offline copy in My files. Your saved device copy is retained until it finishes.'
                : attention
                  ? `Needs attention. ${options.offline.problem || denialMessage || 'The live document changed or an edit could not be synchronized. Your saved device copy is retained.'}`
                  : access === 'viewer'
                    ? 'View only on this device.'
                    : local === 'synced'
                      ? 'Synced. All changes are saved on the server and this device.'
                      : 'Saved on this device — waiting to sync.',
      });
      maybeRecover();
      return;
    }
    watcher.publish({
      ...(authenticationEnded ? { signInRequired: true } : {}),
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
          detail: {
            unitId,
            revision: state.revision,
            snapshot: structuredClone(snapshot),
            mutations: nativeMutationInventory(univer.__getInjector().get(ICommandService)),
          },
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
    ...(options.offline
      ? {
          checkpoint: options.offline.checkpoint,
          persist: (checkpoint: import('@spinel/sync-client').ClientCheckpoint) =>
            options.offline!.persist(checkpoint),
          preservePendingOnFailure: () => options.offline!.enabled,
          requireUnchangedResume: () => options.offline!.enabled,
          toCanonical: options.offline.toCanonical,
          toVisible: options.offline.toVisible,
        }
      : {}),
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
      if (active() && next.resyncing)
        void watcher
          ?.readonly(Boolean(options.offline?.enabled) || authenticationEnded)
          .catch(() => {});
      report();
    },
    onResync(reason) {
      if (!active() || denied) return;
      if (options.offline?.enabled) {
        options.offline.stopRemote(
          'The live document changed or an edit could not be synchronized. Your saved device copy is retained.',
        );
        endConnection();
        void watcher?.readonly(true);
        report();
        return;
      }
      dispose();
      options.reload(reason);
    },
  });
  if (options.offline) {
    options.offline.onChange = () => {
      if (options.offline?.readOnly) void watcher?.readonly(true);
      report();
    };
    options.offline.onLock = () => {
      dispose();
      options.lock?.();
    };
  }
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
    clearMessages();
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

  const cleanDownloaded = () =>
    Boolean(options.offline?.enabled) &&
    !state.pending &&
    !state.resyncing &&
    !state.recoveryMissing &&
    !options.offline!.pending &&
    options.canRefresh?.() !== false;

  async function endAuthentication(continueToSignIn = false) {
    if (!active() || endingAuthentication) return;
    endingAuthentication = true;
    authenticationEnded = true;
    denied = true;
    options.offline?.stopAuthenticationHTTP();
    endConnection();
    denialMessage = 'Your sign-in ended. Keep this tab open until your changes are saved.';
    options.offline?.stopRemote(denialMessage);
    let durable = false;
    try {
      clearDashboardNavigation();
      // Install this tab's local-recovery fence before yielding. A second
      // confirmed 401 then sees the same expired epoch instead of disposing
      // this tab while its native input or disk transaction is still pending.
      if (options.offline) options.offline.endAuthentication();
      else expirePreparedAccount();
      if (!active()) return;
      try {
        await within(
          (async () => {
            await watcher?.readonly(true);
            if (!active()) throw closed();
            await client.persistNow();
          })(),
          3000,
          'Local saving did not finish. Keep this tab open and retry saving.',
        );
        durable =
          !state.recoveryMissing &&
          state.localPersistence !== 'failed' &&
          state.localPersistence !== 'saving' &&
          options.canRefresh?.() !== false &&
          (!state.pending || Boolean(options.offline?.enabled));
      } catch {
        // Retain this frozen native model, including work that never reached IDB.
      }
      if (!active()) return;
      if (durable && (continueToSignIn || !options.offline?.pending)) {
        dispose();
        location.assign(signInPath());
      } else report();
    } finally {
      endingAuthentication = false;
    }
  }

  function mayRecover() {
    return Boolean(
      options.offline?.canRecover &&
      options.offline.pending &&
      (denied || state.resyncing || options.offline.problem),
    );
  }
  function maybeRecover() {
    if (
      options.offline?.creation ||
      !watcher ||
      !active() ||
      !mayRecover() ||
      recoveryRunning ||
      recoveryAttempted ||
      authenticationEnded ||
      !navigator.onLine ||
      state.recoveryMissing ||
      state.localPersistence === 'saving' ||
      state.localPersistence === 'failed' ||
      options.canRefresh?.() === false
    )
      return;
    // Set the latch synchronously: a local-save state callback may reenter report.
    recoveryAttempted = true;
    queueMicrotask(() => void recoverOffline());
  }
  async function prepareRecoveryAction(persist: boolean) {
    if (!active() || !mayRecover() || !recovery) throw closed();
    denied = true;
    endConnection();
    await watcher?.readonly(true);
    if (!active()) throw closed();
    if (options.canRefresh?.() === false)
      throw new Error('Copy or finish the unfinished input before recovering these changes.');
    if (persist) await client.persistNow();
    if (!active()) throw closed();
    if (
      persist &&
      (state.recoveryMissing ||
        state.localPersistence === 'failed' ||
        state.localPersistence === 'saving')
    )
      throw new Error('Retry saving the latest changes on this device before recovering them.');
  }
  function recoveryError(error: unknown) {
    if (!active() || !recovery) return;
    recovery = {
      ...recovery,
      phase: 'failed',
      message:
        error instanceof Error
          ? error.message
          : 'The copy could not be created. Your offline changes stay on this device.',
    };
    report();
  }
  async function recoverOffline() {
    if (
      options.offline?.creation ||
      recoveryRunning ||
      recoveryResolved ||
      !active() ||
      !mayRecover()
    )
      return;
    recoveryRunning = true;
    recoveryAttempted = true;
    try {
      await prepareRecoveryAction(true);
      recovery = { ...recovery!, phase: 'creating', message: undefined };
      report();
      const request = await options.offline!.prepareRecovery(client.checkpoint());
      if (!active()) throw closed();
      const item = await options.offline!.publishRecovery(request, abort.signal);
      if (!active()) throw closed();
      // Stop all future native writes before the durable outbox is removed.
      // A failed local commit leaves the exact request available for another retry.
      await options.offline!.finishRecovery(request.recoveryId);
      if (!active()) throw closed();
      client.dispose();
      recoveryResolved = true;
      recovery = {
        ...recovery!,
        phase: 'created',
        copyHref: `/?item=${encodeURIComponent(item.id)}`,
        copyName: item.name,
        message: undefined,
      };
      report();
    } catch (error) {
      if ((error as { status?: number })?.status === 401 && active()) await endAuthentication();
      recoveryError(error);
    } finally {
      recoveryRunning = false;
    }
  }
  async function exportRecovery() {
    if (recoveryRunning || recoveryResolved) return;
    recoveryRunning = true;
    recoveryAttempted = true;
    try {
      await prepareRecoveryAction(true);
      const snapshot = await options.offline!.exportSnapshot(client.checkpoint());
      if (!active()) throw closed();
      const { downloadOfflineFile, offlineCopyName } = await import('./offline/recovery.ts');
      if (!active()) throw closed();
      downloadOfflineFile(
        snapshot,
        `${offlineCopyName(options.offline!.bundle!.name)}.univer.json`,
      );
      recovery = {
        ...recovery!,
        phase: 'failed',
        message:
          'The Univer file was prepared for download. Check the download before discarding your offline changes. Formula sources are checked when imported.',
      };
      report();
    } catch (error) {
      recoveryError(error);
    } finally {
      recoveryRunning = false;
    }
  }
  async function discardRecovery() {
    if (recoveryRunning || recoveryResolved) return;
    recoveryRunning = true;
    recoveryAttempted = true;
    try {
      await prepareRecoveryAction(false);
      await options.offline!.finishRecovery();
      if (!active()) throw closed();
      client.dispose();
      recoveryResolved = true;
      recovery = { ...recovery!, phase: 'discarded', message: undefined };
      report();
    } catch (error) {
      recoveryError(error);
    } finally {
      recoveryRunning = false;
    }
  }

  /** A clean lifecycle change must not manufacture a retained edit checkpoint. */
  async function transitionClean(action: 'refresh' | 'remove') {
    if (!cleanDownloaded()) return false;
    refreshingClean = true;
    endConnection();
    const verifyClean = () => {
      if (!active() || !cleanDownloaded()) throw closed();
    };
    try {
      await watcher?.readonly();
      verifyClean();
      // This also drains an acknowledgement whose queue cleanup is still
      // being committed. Recheck the host and durable queue at each boundary.
      await client.persistNow();
      verifyClean();
      if (action === 'remove') await options.offline!.removeClean(verifyClean);
      else await options.offline!.refreshClean(verifyClean);
      if (!active()) return true;
      dispose();
      if (action === 'remove') options.lock?.();
      else options.reload('stale', true);
    } catch {
      if (!active()) return true;
      options.offline!.stopRemote(
        action === 'remove'
          ? 'Access changed. This device copy could not be removed. Reopen the document when connected.'
          : 'This saved copy needs a fresh download. Reopen the document when connected.',
      );
      // Native input may have completed while it was being frozen. Preserve
      // that work; a network or disk failure with no edits only needs a notice.
      if (!cleanDownloaded()) client.refuse('stale');
      report();
    }
    return true;
  }

  async function checkAccess() {
    if (!active() || checking || denied || refreshingClean || !navigator.onLine) return;
    checking = true;
    let recheck = false;
    try {
      if (options.offline?.creation) {
        const created = await options.offline.ensureCreated(
          AbortSignal.any([abort.signal, signal]),
        );
        if (!active()) return;
        if (!created) {
          accessUnreachable = true;
          report();
          return;
        }
      }
      const bundle = options.offline?.enabled ? options.offline.bundle : undefined;
      const response = await request(
        bundle ? `${documentPath(itemId, spaceId)}/collaboration` : documentPath(itemId, spaceId),
        {
          cache: 'no-store',
          ...(bundle
            ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
            : {}),
          signal: AbortSignal.any([abort.signal, signal, AbortSignal.timeout(2500)]),
        },
      );
      const data = response.ok ? await response.json() : undefined;
      if (!active() || refreshingClean) return;
      // Preparing or removing a copy can change the response contract while
      // this read is in flight. Check the new scope before acting on access;
      // an ordinary { item, live } response is not a collaboration response.
      if (bundle !== (options.offline?.enabled ? options.offline.bundle : undefined)) {
        recheck = true;
        return;
      }
      if (response.status === 401 && !guestItemId()) {
        await endAuthentication();
        return;
      }
      const lost = [401, 403, 404, 409].includes(response.status);
      const accountChanged =
        bundle &&
        (response.status === 409 || (data && data.user?.id !== options.offline!.accountId));
      const changed =
        data &&
        (bundle
          ? data.access !== bundle.access || data.user?.id !== options.offline!.accountId
          : data.item.access !== access);
      const restored = bundle
        ? data && data.unitId !== unitId
        : data?.live && (data.live.unitId !== unitId || data.live.restoring);
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
        if (options.offline?.enabled) {
          // The expected-account check precedes document authorization on the
          // server. A mismatch says nothing about the prior account's access.
          if (!accountChanged && (await transitionClean(lost ? 'remove' : 'refresh'))) return;
          options.offline.stopRemote(
            'Access or the document version changed. Your saved device copy is retained.',
          );
          if (!cleanDownloaded()) client.refuse('stale');
        }
        report();
        await watcher?.readonly(Boolean(options.offline?.enabled));
      } else {
        accessUnreachable = !response.ok;
        report();
      }
    } catch (error) {
      if (
        active() &&
        error instanceof CreationUploadError &&
        (error.status === 401 || error.code === 'account-changed')
      ) {
        await endAuthentication();
        return;
      }
      if (active() && !abort.signal.aborted) {
        accessUnreachable = true;
        report();
      }
    } finally {
      checking = false;
      if (recheck) await checkAccess();
    }
  }

  async function connect() {
    if (
      !active() ||
      denied ||
      state.resyncing ||
      refreshingClean ||
      options.offline?.problem ||
      connecting ||
      socket ||
      !navigator.onLine
    )
      return;
    connecting = true;
    roomReady = false;
    const current = ++generation;
    const same = () => active() && !denied && generation === current;
    report();
    try {
      if (options.offline?.enabled) {
        await checkAccess();
        if (!same() || accessUnreachable || options.offline.creation)
          throw new Error('Room unavailable');
      }
      const ticket = await request(`${path}/ticket?unitId=${encodeURIComponent(unitId)}`, {
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
      const messages: string[] = [];
      let messageBytes = 0;
      let readingMessages = false;
      const imageAbort = new AbortController();
      clearMessages = () => {
        messages.length = 0;
        messageBytes = 0;
        imageAbort.abort();
      };
      const receiveMessage = async (data: unknown) => {
        if (!same()) return;
        try {
          if (typeof data !== 'string' || data.length > 20 * 1024 * 1024)
            throw new Error('Invalid room message');
          const frame = JSON.parse(data);
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
          // A clean cached base can outlive the server's replay window. Freeze
          // native input and drain disk writes before replacing it; do not turn
          // this read-only refresh into a durable conflict marker.
          if (
            frame.type === 'resync' &&
            frame.reason === 'stale' &&
            !state.pending &&
            !state.resyncing &&
            !state.recoveryMissing &&
            options.offline?.enabled &&
            !options.offline.pending
          ) {
            // Native cell input, IME and image insertion can be dirty before
            // the sync capture hook emits a mutation. Keep that editor intact.
            if (options.canRefresh?.() === false) {
              reconnect();
              return;
            }
            await transitionClean('refresh');
            return;
          }
          if (options.offline?.enabled) {
            await options.offline.prepareImages(frame, imageAbort.signal);
            if (!same()) return;
          }
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
      opened.onmessage = (event) => {
        if (!same()) return;
        if (!options.offline?.enabled) {
          void receiveMessage(event.data);
          return;
        }
        // Bound before retaining transport data: native inbox limits run only
        // after image preparation, which can await a slow network response.
        if (
          typeof event.data !== 'string' ||
          messages.length >= 128 ||
          messageBytes + event.data.length * 2 > 20 * 1024 * 1024
        ) {
          reconnect();
          return;
        }
        messages.push(event.data);
        messageBytes += event.data.length * 2;
        if (readingMessages) return;
        readingMessages = true;
        void (async () => {
          try {
            while (same() && messages.length) {
              const message = messages.shift()!;
              messageBytes -= message.length * 2;
              await receiveMessage(message);
            }
          } finally {
            readingMessages = false;
          }
        })();
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
  const foreground = () => {
    if (document.visibilityState === 'visible') online();
  };
  const downloaded = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (
      !options.offline ||
      detail?.accountId !== options.offline.accountId ||
      detail?.itemId !== itemId ||
      !active() ||
      refreshingClean ||
      recoveryRunning ||
      recoveryResolved
    )
      return;
    void options.offline
      .reconcileAvailability(client.checkpoint())
      .then(() => client.persistNow())
      .then(report, report);
  };
  const prepared = (event: Event) => {
    if (options.offline && (event as CustomEvent).detail?.accountId === options.offline.accountId)
      downloaded(
        new CustomEvent('spinel-offline-changed', {
          detail: { accountId: options.offline.accountId, itemId },
        }),
      );
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
    options.offline?.dispose();
    unregisterPresence();
    presenceListeners.clear();
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
    window.removeEventListener('spinel-offline-changed', downloaded);
    window.removeEventListener('spinel-offline-prepared', prepared);
    document.removeEventListener('visibilitychange', foreground);
    signal.removeEventListener('abort', dispose);
    if (bindings.get(univer) === binding) bindings.delete(univer);
  }
  const binding = {
    watch(next: Watch) {
      watcher = next;
      if (evidence && !state.pending)
        observe(
          options.offline?.toCanonical(nativeSnapshot(univer, unitId)) ??
            nativeSnapshot(univer, unitId),
        );
      if (!started) {
        started = true;
        window.addEventListener('online', online);
        window.addEventListener('offline', offline);
        window.addEventListener('spinel-offline-changed', downloaded);
        window.addEventListener('spinel-offline-prepared', prepared);
        document.addEventListener('visibilitychange', foreground);
        accessTimer = setInterval(() => {
          void checkAccess();
          maybeRecover();
        }, 1000);
        void connect();
      }
      report();
      return {
        retry() {
          if (authenticationEnded) {
            void endAuthentication(true);
            return;
          }
          client.retry();
          retryDelay = 250;
          reconnect();
          void checkAccess();
        },
        recover: () => void recoverOffline(),
        exportRecovery: () => void exportRecovery(),
        discardRecovery: () => void discardRecovery(),
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
