/** Disposable process fixture only; never selected by the production launcher. */
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { openDatabase } from '../../../server/database.ts';
import { connectMaintenance, MAINTENANCE_CHANNEL } from './supervisor-client.ts';
import { inheritedWorkspaceOwnership, shareWorkspaceOwnership } from './ownership.ts';
import { assertRestoreAuthority } from './restore-authority.ts';
import { captureTerminalRestoreFingerprint } from '../backup/restore-drain.ts';

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
if (child) {
  const opened = new Promise<void>((resolve) =>
    child.on('message', (value: unknown) => {
      if (value && typeof value === 'object' && 'opened' in value) resolve();
    }),
  );
  await shareWorkspaceOwnership(child, inheritedWorkspaceOwnership());
  await opened;
}
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
bridge.onRestoreAuthority!((proof) => {
  if (process.env.SPINEL_TEST_REVOKE_RESTORE_AUTHORITY === '1') {
    const result = database
      .prepare('UPDATE auth_users SET disabled=1 WHERE id=?')
      .run(proof.actorId);
    if (result.changes !== 1)
      throw new Error('Authority revocation fixture did not update its user.');
    process.send!({ revokedRestoreAuthority: proof.actorId });
  }
  assertRestoreAuthority(database, proof);
});
bridge.ready();
let stopping = false;
bridge.onRestoreStop!(async (request) => {
  if (stopping) throw new Error('Already stopping.');
  stopping = true;
  if (process.env.SPINEL_TEST_NEVER_WITNESS === '1') await new Promise(() => {});
  clearInterval(timer);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  database.prepare('INSERT INTO writes(value) VALUES(?)').run('final restore flush');
  const fingerprint = captureTerminalRestoreFingerprint(database);
  try {
    if (process.env.SPINEL_TEST_WITNESS_STALE === '1')
      process.send!({
        channel: MAINTENANCE_CHANNEL,
        kind: 'restore-witness',
        request: { ...request, challengeId: randomUUID() },
        fingerprint: '0'.repeat(64),
      });
    const accepted = bridge.acceptRestoreWitness!(request, fingerprint);
    if (process.env.SPINEL_TEST_WITNESS_DUPLICATE === '1')
      process.send!({
        channel: MAINTENANCE_CHANNEL,
        kind: 'restore-witness',
        request,
        fingerprint,
      });
    if (process.env.SPINEL_TEST_WITNESS_CONFLICT === '1') {
      process.send!({
        channel: MAINTENANCE_CHANNEL,
        kind: 'restore-witness',
        request,
        fingerprint: '0'.repeat(64),
      });
      // Keep the old process present until both messages can be consumed.
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await accepted;
    if (process.env.SPINEL_TEST_WITNESS_ACK_FILE)
      await writeFile(process.env.SPINEL_TEST_WITNESS_ACK_FILE, 'accepted', { mode: 0o600 });
  } finally {
    database.close();
    bridge.close();
    if (process.connected) process.disconnect?.();
  }
});
if (process.env.SPINEL_TEST_IGNORE_STOP === '1') process.on('SIGTERM', () => {});
else {
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
