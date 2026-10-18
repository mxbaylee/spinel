import type { BrowserContext, WebSocketRoute } from '@playwright/test';

// Chromium's HTTP offline switch alone can leave an established WebSocket alive.
// Drop both sides explicitly so reconnect tests exercise real offline edits.
export async function interruptibleNetwork(context: BrowserContext) {
  const sockets = new Set<{ client: WebSocketRoute; server: WebSocketRoute }>();
  let offline = false;
  let loseNextCommit = false;
  let lost = false;
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
      if (loseNextCommit && String(message).includes('changeset')) {
        loseNextCommit = false;
        lost = true;
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
    },
    acknowledgementLost() {
      return lost;
    },
    async setOffline(value: boolean) {
      offline = value;
      await context.setOffline(value);
      if (value) {
        await Promise.all(
          [...sockets].flatMap(({ client, server }) => [client.close(), server.close()]),
        );
        sockets.clear();
      }
    },
  };
}
