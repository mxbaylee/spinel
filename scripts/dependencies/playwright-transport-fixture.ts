import express from 'express';
import { createServer as createTlsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { createHttpServer } from '../../server/http.ts';

// A separate event loop is essential: the client must send while the server is
// stalled. No browser, database, credentials, endpoint mocking or forced reset
// is involved in the idle-timeout reproduction.
const app = express();
const server =
  process.argv[2] === 'https'
    ? createTlsServer(
        { key: readFileSync(process.argv[3]), cert: readFileSync(process.argv[4]) },
        app,
      )
    : createHttpServer(app);
const sockets = new WeakMap<object, number>();
let nextSocket = 0;
const send = (kind: string, facts: object = {}) =>
  process.send?.({ kind, at: Date.now(), ...facts });
server.on('connection', (socket) => {
  const connection = ++nextSocket;
  sockets.set(socket, connection);
  send('connection', { connection });
  socket.on('timeout', () => send('idle-timeout', { connection }));
  socket.on('close', (hadError) => send('connection-closed', { connection, hadError }));
});
let requests = 0;
app.all('/{*path}', (request, response) => {
  requests++;
  send('request', { connection: sockets.get(request.socket), requests, method: request.method });
  if (request.path === '/reset') {
    request.socket.resetAndDestroy();
    return;
  }
  response.status(request.path === '/unavailable' ? 503 : 200).json({ requests });
});
process.on('message', (message) => {
  if (message === 'stall') {
    send('stall-start');
    // Explicit fault injection: exceed the unchanged 5s idle timeout + 1s buffer.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 6_200);
    send('stall-end');
  } else if (message === 'flush') {
    send('flushed');
  } else if (message === 'stop') {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  }
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  send('ready', {
    port: address.port,
    keepAliveTimeout: server.keepAliveTimeout,
    keepAliveTimeoutBuffer: server.keepAliveTimeoutBuffer,
  });
});
