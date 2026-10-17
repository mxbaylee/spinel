// Isolated manual acceptance fixture. Never imported by the application server.
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.ts';
import { openDatabase } from '../server/database.ts';
import { AuthStore, COOKIE_NAME, randomToken } from '../src/server/auth/store.ts';

const directory = await mkdtemp(join(tmpdir(), 'spinel-passkey-check-'));
const databasePath = join(directory, 'fixture.sqlite');
const database = openDatabase(databasePath);
const store = new AuthStore(database);
const user = store.createUser('Passkey acceptance check');
const { token, session } = store.createSession(user.id);
const entry = `/fixture/${randomToken()}`;
const deadline = Date.now() + 5 * 60_000;
let used = false;
database.close();
const app = await createApp({ databasePath, origin: 'http://localhost:3102' });
const server = createServer((request, response) => {
  if (!used && Date.now() < deadline && request.method === 'GET' && request.url === entry) {
    used = true;
    response.writeHead(303, {
      'Set-Cookie': `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=${new Date(session.expires_at).toUTCString()}`,
      Location: '/settings',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    response.end();
    return;
  }
  app.server.emit('request', request, response);
});
server.listen(3102, '127.0.0.1', () => {
  console.log(`Isolated passkey check: http://localhost:3102${entry}`);
  console.log(
    'Open this one-use link within five minutes. Add browser, 1Password and Proton Pass passkeys, then sign out and sign in with each.',
  );
  console.log(`Disposable fixture data: ${directory}`);
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.closeAllConnections();
  server.close();
  await app.close();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
