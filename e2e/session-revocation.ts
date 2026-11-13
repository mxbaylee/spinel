import assert from 'node:assert/strict';
import type { Frame, Page, WebSocket } from '@playwright/test';

type Checkpoint =
  | 'edit-held'
  | 'revocation-written'
  | 'closure-observed'
  | 'sign-in'
  | 'request-denied'
  | 'edit-released'
  | 'saved'
  | 'reloaded';
type EventKind =
  | Checkpoint
  | 'socket-created'
  | 'socket-opened'
  | 'socket-closed'
  | 'page-close'
  | 'navigation'
  | 'revocation-requested'
  | 'observer-lost';

/** Chromium owns this journey. Observe its real socket independently of
 * Playwright's per-document map, which navigation clears before a late close.
 * Never retain URLs, request IDs, credentials, frame payloads or document data. */
export async function observeSessionRevocation(page: Page, socketURL: string) {
  const expected = new URL(socketURL);
  const session = await page.context().newCDPSession(page);
  const started = performance.now();
  const sockets = new Map<string, { index: number; opened: boolean; closed: boolean }>();
  const pageSockets = new Map<WebSocket, () => void>();
  const events: { kind: EventKind; ms: number; socket?: number }[] = [];
  let targets: string[] | undefined;
  let received = 0;
  let overflow = false;
  let observerLost = false;
  let reopened = false;
  let stopped = false;
  const record = (kind: EventKind, socket?: number) => {
    if (events.length === 64) overflow = true;
    else
      events.push({ kind, ms: Math.round(performance.now() - started), ...(socket && { socket }) });
  };
  const matches = (url: string) => {
    try {
      const parsed = new URL(url);
      return parsed.origin === expected.origin && parsed.pathname === expected.pathname;
    } catch {
      return false;
    }
  };
  const created = ({ requestId, url }: { requestId: string; url: string }) => {
    if (!matches(url)) return;
    if (sockets.size === 16 || sockets.has(requestId)) {
      overflow = true;
      return;
    }
    const socket = { index: sockets.size + 1, opened: false, closed: false };
    sockets.set(requestId, socket);
    record('socket-created', socket.index);
  };
  const opened = ({ requestId, response }: { requestId: string; response: { status: number } }) => {
    const socket = sockets.get(requestId);
    if (!socket || response.status !== 101) return;
    socket.opened = true;
    if (targets) reopened = true;
    record('socket-opened', socket.index);
  };
  const closed = ({ requestId }: { requestId: string }) => {
    const socket = sockets.get(requestId);
    if (!socket) return;
    socket.closed = true;
    record('socket-closed', socket.index);
  };
  const frameReceived = ({ requestId }: { requestId: string }) => {
    if (sockets.has(requestId)) received++;
  };
  const navigated = (frame: Frame) => {
    if (frame === page.mainFrame()) record('navigation');
  };
  const pageSocket = (socket: WebSocket) => {
    if (!matches(socket.url())) return;
    if (pageSockets.size === 16) {
      overflow = true;
      return;
    }
    const onClose = () => record('page-close');
    pageSockets.set(socket, onClose);
    socket.on('close', onClose);
  };
  const lost = () => {
    observerLost = true;
    record('observer-lost');
  };
  session.on('Network.webSocketCreated', created);
  session.on('Network.webSocketHandshakeResponseReceived', opened);
  session.on('Network.webSocketClosed', closed);
  session.on('Network.webSocketFrameReceived', frameReceived);
  session.on('close', lost);
  page.on('framenavigated', navigated);
  page.on('websocket', pageSocket);

  async function stop() {
    if (stopped) return;
    stopped = true;
    session.off('Network.webSocketCreated', created);
    session.off('Network.webSocketHandshakeResponseReceived', opened);
    session.off('Network.webSocketClosed', closed);
    session.off('Network.webSocketFrameReceived', frameReceived);
    session.off('close', lost);
    page.off('framenavigated', navigated);
    page.off('websocket', pageSocket);
    for (const [socket, onClose] of pageSockets) socket.off('close', onClose);
    pageSockets.clear();
    await session.detach();
  }
  try {
    await session.send('Network.enable');
  } catch (error) {
    // Preserve the setup error, while still detaching every installed listener.
    await stop().catch(() => {});
    throw error;
  }
  const isClosed = () =>
    !stopped &&
    !overflow &&
    !observerLost &&
    !reopened &&
    !!targets?.length &&
    targets.every((id) => sockets.get(id)!.closed) &&
    ![...sockets.values()].some((socket) => socket.opened && !socket.closed);
  return {
    beforeRevoke() {
      assert(
        !stopped && !overflow && !observerLost && !targets,
        'Revocation observer is not ready.',
      );
      targets = [...sockets]
        .filter(([, socket]) => socket.opened && !socket.closed)
        .map(([id]) => id);
      assert(targets.length > 0, 'Revocation requires an observed established socket.');
      record('revocation-requested');
    },
    isClosed,
    assertRevoked(status: number) {
      assert.equal(status, 401, 'The revoked login must be denied by the server.');
      assert(isClosed(), 'The revoked login must have an observed socket close.');
    },
    frameCount: () => received,
    checkpoint: (kind: Checkpoint) => record(kind),
    snapshot: () => ({
      targetCount: targets?.length ?? 0,
      closedTargets: targets?.filter((id) => sockets.get(id)!.closed).length ?? 0,
      openSockets: [...sockets.values()].filter((socket) => socket.opened && !socket.closed).length,
      receivedFrames: received,
      overflow,
      observerLost,
      reopened,
      events: events.map((event) => ({ ...event })),
    }),
    stop,
  };
}

/** Cleanup has its own small bound within the unchanged test deadline. Every
 * owned phase runs even after an earlier failure; diagnostics cannot replace the
 * test's primary error. Callers report these finite phase names, never raw errors. */
export async function cleanupSessionRevocation(
  phases: {
    name: 'writes' | 'observer' | 'context' | 'database' | 'diagnostics';
    run: () => unknown | Promise<unknown>;
  }[],
) {
  const failed: string[] = [];
  for (const phase of phases) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(phase.run),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Owned cleanup deadline.')), 5000);
        }),
      ]);
    } catch {
      failed.push(phase.name);
    } finally {
      clearTimeout(timer);
    }
  }
  return failed;
}
