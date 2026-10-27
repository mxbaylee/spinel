import type { BrowserContext, WebSocketRoute } from '@playwright/test';

export interface NativeWrite {
  /** False means this exact server connection was already closed. */
  forward(): boolean;
  /** False means there was no live captured connection left to interrupt. */
  disconnect(): boolean;
}
const networks = new WeakMap<BrowserContext, Promise<Awaited<ReturnType<typeof install>>>>();

/** Install before navigation; later calls share controls for existing sockets. */
export function syncNetwork(context: BrowserContext) {
  let network = networks.get(context);
  if (!network) {
    network = install(context);
    networks.set(context, network);
  }
  return network;
}

/** Control the real versioned socket without changing document data or acknowledgments. */
async function install(context: BrowserContext) {
  type Connection = { client: WebSocketRoute; server: WebSocketRoute };
  const sockets = new Set<Connection>();
  const outgoing: Record<string, any>[] = [];
  const incoming: Record<string, any>[] = [];
  const resumes: { connection: Connection; message: string | Buffer }[] = [];
  let connectionCount = 0;
  let intercept: ((write: NativeWrite) => Promise<void> | void) | undefined;
  const pending = new Set<Promise<void>>();
  const failures: unknown[] = [];
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
    connectionCount++;
    const connection = { client, server };
    sockets.add(connection);
    client.onMessage((message) => {
      const frame = JSON.parse(String(message));
      outgoing.push(frame);
      if (frame.type === 'submit' && loseNext) {
        loseNext = false;
        losing = frame.mutationId;
      }
      if (frame.type === 'submit' && intercept) {
        const handler = intercept;
        const task = Promise.resolve()
          .then(() =>
            handler({
              forward: () => {
                if (!sockets.has(connection)) return false;
                server.send(message);
                return true;
              },
              disconnect: () => {
                if (!sockets.delete(connection)) return false;
                void client.close();
                void server.close();
                return true;
              },
            }),
          )
          .catch((error) => {
            failures.push(error);
          })
          .finally(() => pending.delete(task));
        pending.add(task);
      } else server.send(message);
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
    connectionCount: () => connectionCount,
    interceptWrites(handler: ((write: NativeWrite) => Promise<void> | void) | undefined) {
      intercept = handler;
    },
    async drainWrites() {
      await Promise.all(pending);
      if (failures.length) throw new AggregateError(failures, 'Native write interception failed.');
    },
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
