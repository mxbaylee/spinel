import { maintenanceFetch as fetch } from './maintenanceFetch.ts';
/** Asks the connection probe and the offline replay owner to try again right now. */
export const CONNECTION_CHECK_EVENT = 'spinel-connection-check';
/** Sent when a check started by Try now has an answer. */
export const CONNECTION_CHECKED_EVENT = 'spinel-connection-checked';
export type ConnectionState = 'online' | 'offline' | 'reconnecting';
export type RoomConnectionStatus = 'idle' | 'joining' | 'offline' | 'online';
export type EditorSyncStatus = 'active' | 'offline' | 'not-started';

export interface EditorConnection {
  readonly browserOnline: boolean;
  readonly room: RoomConnectionStatus;
  readonly sync: EditorSyncStatus;
  readonly state: ConnectionState;
}

export type EditorConnectionEvent =
  | { type: 'browser'; online: boolean }
  | { type: 'room'; status: RoomConnectionStatus }
  | { type: 'sync'; status: EditorSyncStatus };

export function createEditorConnection(browserOnline: boolean): EditorConnection {
  return {
    browserOnline,
    room: 'idle',
    sync: 'not-started',
    state: browserOnline ? 'reconnecting' : 'offline',
  };
}

/** Connection proof belongs to a room subscription, independently of unsaved edits. */
export function reduceEditorConnection(
  current: EditorConnection,
  event: EditorConnectionEvent,
): EditorConnection {
  let { browserOnline, room, sync } = current;
  switch (event.type) {
    case 'browser':
      browserOnline = event.online;
      // The browser returning online cannot reuse the previous room's joined proof.
      room = browserOnline ? 'joining' : 'offline';
      break;
    case 'room':
      room = event.status;
      break;
    case 'sync':
      sync = event.status;
      break;
  }
  const state = !browserOnline
    ? 'offline'
    : room === 'idle' || room === 'joining'
      ? 'reconnecting'
      : room === 'offline' || sync === 'offline'
        ? 'offline'
        : sync === 'not-started'
          ? 'reconnecting'
          : 'online';
  return { browserOnline, room, sync, state };
}

/** Dashboard reachability only; a live editor must use its own room subscription. */
export function watchServerConnection(
  publish: (state: ConnectionState) => void,
  onSessionEnded?: () => void,
): () => void {
  let stopped = false;
  let browserOnline = navigator.onLine;
  let previous: ConnectionState | undefined;
  type Probe = { controller: AbortController; timeout: ReturnType<typeof setTimeout> };
  let pending: Probe | null = null;
  const report = (state: ConnectionState) => {
    if (stopped || state === previous) return;
    previous = state;
    publish(state);
  };
  const cancel = () => {
    if (!pending) return;
    const request = pending;
    pending = null;
    clearTimeout(request.timeout);
    request.controller.abort();
  };
  const probe = async () => {
    if (stopped || !browserOnline || pending) return;
    const request: Probe = {
      controller: new AbortController(),
      timeout: setTimeout(() => {
        if (pending !== request || stopped) return;
        cancel();
        report('offline');
      }, 2000),
    };
    pending = request;
    const current = () => !stopped && browserOnline && pending === request;
    try {
      const response = await fetch('/api/health', {
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
        signal: request.controller.signal,
      });
      if (!current()) return;
      if (response.status === 401) {
        // An authoritative session denial must never open offline account data.
        report('reconnecting');
        dispose();
        onSessionEnded?.();
        return;
      }
      if (!response.ok) {
        report('offline');
        return;
      }
      const body: unknown = await response.json();
      if (current())
        report(
          body !== null && typeof body === 'object' && 'status' in body && body.status === 'ok'
            ? 'online'
            : 'offline',
        );
    } catch {
      if (current()) report('offline');
    } finally {
      if (pending === request) cancel();
    }
  };
  const online = () => {
    browserOnline = true;
    cancel();
    report('reconnecting');
    void probe();
  };
  const offline = () => {
    browserOnline = false;
    cancel();
    report('offline');
  };
  /** Try now: forget what the browser last said and ask the server again. */
  const check = async () => {
    browserOnline = navigator.onLine;
    cancel();
    // Already online: keep saying so until the probe says otherwise, so syncing doesn't flicker.
    if (!browserOnline || previous !== 'online') report(browserOnline ? 'reconnecting' : 'offline');
    await probe();
    // A newer check replaced this probe: it will answer instead.
    if (!stopped && !pending) window.dispatchEvent(new Event(CONNECTION_CHECKED_EVENT));
  };
  const onCheck = () => void check();
  const polling = setInterval(() => void probe(), 3000);
  function dispose() {
    if (stopped) return;
    stopped = true;
    cancel();
    clearInterval(polling);
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
    window.removeEventListener(CONNECTION_CHECK_EVENT, onCheck);
  }
  window.addEventListener('online', online);
  window.addEventListener('offline', offline);
  window.addEventListener(CONNECTION_CHECK_EVENT, onCheck);
  report(browserOnline ? 'reconnecting' : 'offline');
  void probe();
  return dispose;
}
