import type { BrowserContext, WebSocketRoute } from '@playwright/test';

/** Control the real versioned socket without changing any document or server response. */
export async function syncNetwork(context: BrowserContext) {
  type Connection = { client: WebSocketRoute; server: WebSocketRoute };
  const sockets = new Set<Connection>();
  const outgoing: Record<string, any>[] = [];
  const incoming: Record<string, any>[] = [];
  const resumes: { connection: Connection; message: string | Buffer }[] = [];
  let offline = false;
  let holdResume = false;
  let loseNext = false;
  let losing: string | undefined;
  let lost: string | undefined;
  async function setOffline(value: boolean) {
    offline = value;
    await context.setOffline(value);
    if (value) {
      await Promise.all(
        [...sockets].flatMap(({ client, server }) => [client.close(), server.close()]),
      );
      sockets.clear();
      resumes.length = 0;
    }
  }
  await context.routeWebSocket('**/sync-api/**/socket*', (client) => {
    if (offline) {
      void client.close();
      return;
    }
    const server = client.connectToServer();
    const connection = { client, server };
    sockets.add(connection);
    client.onMessage((message) => {
      const frame = JSON.parse(String(message));
      outgoing.push(frame);
      if (frame.type === 'submit' && loseNext) {
        loseNext = false;
        losing = frame.mutationId;
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      incoming.push(frame);
      if (frame.type === 'resume' && holdResume) {
        resumes.push({ connection, message });
        return;
      }
      if (losing && (frame.type === 'edit' || frame.type === 'ack')) {
        if (frame.type === 'ack' && frame.mutationId === losing) {
          const id = losing;
          losing = undefined;
          void setOffline(true).then(() => {
            lost = id;
          });
        }
        return;
      }
      client.send(message);
    });
    client.onClose((code, reason) => {
      sockets.delete(connection);
      void server.close({ code, reason });
    });
    server.onClose((code, reason) => {
      sockets.delete(connection);
      void client.close({ code, reason });
    });
  });
  return {
    outgoing,
    incoming,
    setOffline,
    loseAcknowledgment() {
      loseNext = true;
      lost = undefined;
    },
    lostMutationId: () => lost,
    holdResume() {
      holdResume = true;
    },
    resumeHeld: () => resumes.length > 0,
    releaseResume() {
      holdResume = false;
      for (const { connection, message } of resumes.splice(0))
        if (sockets.has(connection)) connection.client.send(message);
    },
  };
}
