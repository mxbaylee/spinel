/** Disposable process fixture only; never selected by the production launcher. */
import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../../server/database.ts';
import { connectMaintenance } from './supervisor-client.ts';

if (!process.send || !process.env.DATABASE_PATH) throw new Error('Private test fixture required.');
const bridge = await connectMaintenance();
const database = openDatabase(process.env.DATABASE_PATH);
const child =
  process.env.SPINEL_TEST_WAL_CHILD === '1'
    ? fork(fileURLToPath(new URL('./wal-fixture.ts', import.meta.url)), [], {
        env: process.env,
        execArgv: [],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      })
    : undefined;
if (child) await new Promise<void>((resolve) => child.once('message', () => resolve()));
const server = createServer((_request, response) => {
  if (bridge.status().phase !== 'running') {
    response.writeHead(503).end();
    return;
  }
  database.prepare('INSERT INTO writes(value) VALUES(?)').run('accepted');
  response.end('accepted');
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
bridge.subscribe((status) => {
  if (status.phase === 'draining' && process.env.SPINEL_TEST_NEVER_DRAIN !== '1')
    setTimeout(() => bridge.drained(status.epoch), Number(process.env.SPINEL_TEST_DRAIN_MS ?? 5));
});
const timer = setInterval(() => {
  if (bridge.status().phase === 'running')
    database.prepare('INSERT INTO writes(value) VALUES(?)').run('job');
}, 20);
bridge.ready();
if (process.env.SPINEL_TEST_IGNORE_STOP === '1') process.on('SIGTERM', () => {});
else {
  let stopping = false;
  process.on('SIGTERM', () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    server.closeAllConnections();
    server.close();
    database.close();
    bridge.close();
    if (process.connected) process.disconnect?.();
  });
}
