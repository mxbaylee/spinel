// Isolated manual acceptance fixture. Never imported by the application server.
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.ts';
import { openDatabase } from '../server/database.ts';
import { AuthStore, randomToken } from '../src/server/auth/store.ts';
import { InvitationService } from '../src/server/auth/invitations.ts';

const directory = await mkdtemp(join(tmpdir(), 'spinel-passkey-check-'));
const databasePath = join(directory, 'fixture.sqlite');
const database = openDatabase(databasePath);
const store = new AuthStore(database);
const operator = store.createUser('Passkey check operator', true);
const invite = new InvitationService(store, 'http://localhost:3102').create(operator.id, 1);
const entry = `/fixture/${randomToken()}`;
const deadline = Date.now() + 5 * 60_000;
let used = false;
database.prepare('UPDATE auth_invites SET expires_at=? WHERE id=?').run(deadline, invite.id);
database.close();
const app = await createApp({ databasePath, origin: 'http://localhost:3102' });
const server = createServer((request, response) => {
  if (!used && Date.now() < deadline && request.method === 'GET' && request.url === entry) {
    used = true;
    response.writeHead(303, {
      Location: invite.url,
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
    'Open this one-use link within five minutes and accept the invitation with your first passkey. In Your profile → Passkeys, add browser, 1Password and Proton Pass passkeys, then sign out and sign in with each. Stale sessions must verify again before adding a passkey.',
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
