import type { BrowserContext, WebSocketRoute } from '@playwright/test';
import { CmdRspCode, CombCmd } from '@univerjs/protocol';

// Chromium's HTTP offline switch alone can leave an established WebSocket alive.
// Drop both sides explicitly so reconnect tests exercise real offline edits.
export async function interruptibleNetwork(context: BrowserContext) {
  type Socket = { client: WebSocketRoute; server: WebSocketRoute };
  const sockets = new Set<Socket>();
  const heldJoins = new Map<Socket, Parameters<WebSocketRoute['send']>[0][]>();
  let holdJoins = false;
  let offline = false;
  let loseNextCommit = false;
  let suppressCommittedFrames = false;
  let lost = false;
  let connectionCount = 0;
  const setOffline = async (value: boolean) => {
    offline = value;
    await context.setOffline(value);
    if (value) {
      await Promise.all(
        [...sockets].flatMap(({ client, server }) => [client.close(), server.close()]),
      );
      sockets.clear();
      heldJoins.clear();
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
    connectionCount++;
    const socket = { client, server };
    sockets.add(socket);
    server.onMessage((message) => {
      if (holdJoins) {
        // Hold the real room response, after the socket and HELLO have succeeded.
        // Its public wire command/code distinguish JOIN from HTTP reachability.
        try {
          const frame = JSON.parse(String(message));
          if (frame.cmd === CombCmd.JOIN && frame.code === CmdRspCode.OK) {
            const pending = heldJoins.get(socket) ?? [];
            pending.push(message);
            heldJoins.set(socket, pending);
            return;
          }
        } catch {
          // Non-JSON frames retain the existing transparent forwarding behavior.
        }
      }
      // Drop the committed response/broadcast before the client sees it.
      if (suppressCommittedFrames && String(message).includes('changeset')) {
        void client.close();
        void server.close();
        sockets.delete(socket);
      } else client.send(message);
    });
    client.onClose((code, reason) => {
      sockets.delete(socket);
      heldJoins.delete(socket);
      void server.close({ code, reason });
    });
    server.onClose((code, reason) => {
      sockets.delete(socket);
      heldJoins.delete(socket);
      void client.close({ code, reason });
    });
  });
  return {
    connectionCount() {
      return connectionCount;
    },
    holdJoinAcknowledgements() {
      holdJoins = true;
    },
    joinAcknowledgementHeld() {
      return heldJoins.size > 0;
    },
    releaseJoinAcknowledgements() {
      holdJoins = false;
      for (const [socket, messages] of heldJoins)
        if (sockets.has(socket)) for (const message of messages) socket.client.send(message);
      heldJoins.clear();
    },
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
