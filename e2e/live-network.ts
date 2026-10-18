import type { BrowserContext, WebSocketRoute } from '@playwright/test';

// Chromium's HTTP offline switch alone can leave an established WebSocket alive.
// Drop both sides explicitly so reconnect tests exercise real offline edits.
export async function interruptibleNetwork(context: BrowserContext) {
  const sockets = new Set<{ client: WebSocketRoute; server: WebSocketRoute }>();
  let offline = false;
  let loseNextCommit = false;
  let suppressCommittedFrames = false;
  let lost = false;
  const setOffline = async (value: boolean) => {
    offline = value;
    await context.setOffline(value);
    if (value) {
      await Promise.all(
        [...sockets].flatMap(({ client, server }) => [client.close(), server.close()]),
      );
      sockets.clear();
    } else suppressCommittedFrames = false;
  };
  await context.route('**/universer-api/comb/*/unit/*/new_changes', async (route) => {
    if (!loseNextCommit) return route.continue();
    loseNextCommit = false;
    suppressCommittedFrames = true;
    // Let the real server commit, but deliver neither its HTTP response nor its
    // corresponding WebSocket acknowledgement. Hold the client offline until
    // the test explicitly reconnects, so it must recover an uncertain commit.
    const response = await route.fetch();
    if (!response.ok()) {
      suppressCommittedFrames = false;
      return route.fulfill({ response });
    }
    await setOffline(true);
    await route.abort('failed');
    await response.dispose();
    lost = true;
  });
  await context.routeWebSocket('**/universer-api/comb/connect*', (client) => {
    if (offline) {
      void client.close();
      return;
    }
    const server = client.connectToServer();
    const socket = { client, server };
    sockets.add(socket);
    server.onMessage((message) => {
      // Drop the committed response/broadcast before the client sees it.
      if (suppressCommittedFrames && String(message).includes('changeset')) {
        void client.close();
        void server.close();
        sockets.delete(socket);
      } else client.send(message);
    });
    client.onClose((code, reason) => {
      sockets.delete(socket);
      void server.close({ code, reason });
    });
    server.onClose((code, reason) => {
      sockets.delete(socket);
      void client.close({ code, reason });
    });
  });
  return {
    loseAcknowledgement() {
      loseNextCommit = true;
      lost = false;
    },
    acknowledgementLost() {
      return lost;
    },
    setOffline,
  };
}
