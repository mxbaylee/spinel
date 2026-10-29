// Real application subprocess for SPN-105. No uncaught-exception handler:
// the parent's exit-code assertion must observe a late decoder crash.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createConnection, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { brotliCompressSync, deflateSync, gzipSync, zstdCompressSync } from 'node:zlib';
import { defaultProfile } from '../src/profile/profile.ts';
import { AuthStore, COOKIE_NAME } from '../src/server/auth/store.ts';
import { createApp } from './app.ts';
import { openDatabase } from './database.ts';

const [directory, scenario] = process.argv.slice(2);
if (!directory || !scenario) throw new Error('Fixture arguments are required.');
await writeFile(join(directory, 'index.html'), 'Request-body fixture');
const databasePath = join(directory, 'app.sqlite');
const origin = 'http://localhost:3000';
const app = await createApp({ databasePath, staticDirectory: directory, origin });
const db = openDatabase(databasePath);
const auth = new AuthStore(db);
const owner = auth.createUser('Parser owner');
const cookie = `${COOKIE_NAME}=${auth.createSession(owner.id).token}`;

try {
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = (app.server.address() as AddressInfo).port;
  const root = `http://127.0.0.1:${port}`;
  const headers = { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie };
  const compressions = [
    ['gzip', gzipSync],
    ['deflate', deflateSync],
    ['br', brotliCompressSync],
    ['zstd', zstdCompressSync],
  ] as const;
  const post = (body: string | Uint8Array, extra: Record<string, string> = {}) =>
    fetch(`${root}/api/auth/profile`, {
      method: 'POST',
      headers: { ...headers, ...extra },
      body: typeof body === 'string' ? body : new Uint8Array(body),
      signal: AbortSignal.timeout(5_000),
    });
  const health = async () => {
    const response = await fetch(`${root}/api/health`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  };

  if (scenario === 'trailing compressed bytes') {
    for (const [encoding, compress] of compressions.slice(0, 3)) {
      const first = Buffer.concat([compress(Buffer.from('{}')), Buffer.from([0])]);
      const trailing = Buffer.alloc(100 * 1024, 0x58);
      const result = await new Promise<string>((resolve, reject) => {
        const socket = createConnection({ host: '127.0.0.1', port });
        let reply = '';
        let sentTrailing = false;
        socket.setTimeout(5_000, () => socket.destroy(new Error('Compressed request stalled.')));
        socket.once('error', reject);
        socket.once('connect', () => {
          // The configured Origin reaches the real auth JSON parser. No cookie
          // is sent: a completed parse must still enforce authentication.
          socket.write(
            `POST /api/auth/profile HTTP/1.1\r\nHost: localhost\r\n` +
              `Origin: ${origin}\r\nContent-Type: application/json\r\n` +
              `Content-Encoding: ${encoding}\r\n` +
              `Content-Length: ${first.length + trailing.length}\r\n` +
              'Connection: keep-alive\r\n\r\n',
          );
          socket.write(first);
        });
        socket.on('data', (chunk) => {
          reply += String(chunk);
          if (sentTrailing || !reply.includes('\r\n\r\n')) return;
          if (!reply.startsWith('HTTP/1.1 401 ')) {
            socket.destroy(new Error(`The ${encoding} request did not reach session checking.`));
            return;
          }
          sentTrailing = true;
          // Wait for the response so these bytes reach an already-finished
          // decoder. A one-shot invalid body can miss the advisory's crash.
          socket.write(trailing);
          socket.write(
            `GET /api/health HTTP/1.1\r\nHost: localhost\r\nCookie: ${cookie}\r\n` +
              'Connection: close\r\n\r\n',
          );
        });
        socket.once('end', () => resolve(reply));
        socket.once('close', () => reject(new Error('Connection closed before its response.')));
      });
      // The second response proves the whole malformed body drained before
      // this ordinary authenticated request on the same connection succeeded.
      assert.deepEqual(result.match(/HTTP\/1\.1 \d{3}/g), ['HTTP/1.1 401', 'HTTP/1.1 200']);
      assert.ok(result.endsWith('{"status":"ok"}'));
      await health();
    }
  } else if (scenario === 'JSON and access compatibility') {
    const profile = defaultProfile('Compressed profile');
    const json = JSON.stringify(profile);
    const plain = await post(json);
    assert.equal(plain.status, 200);
    assert.deepEqual(await plain.json(), profile);
    for (const [encoding, compress] of compressions) {
      const response = await post(compress(Buffer.from(json)), { 'Content-Encoding': encoding });
      assert.equal(response.status, 200, encoding);
      assert.deepEqual(await response.json(), profile);
      // Limits count decoded bytes. Whitespace keeps this a valid profile at
      // the exact 64 KiB boundary without introducing another product field.
      const atLimit = await post(compress(Buffer.from(json.padEnd(64 * 1024))), {
        'Content-Encoding': encoding,
      });
      assert.equal(atLimit.status, 200, `${encoding} at the limit`);
      assert.deepEqual(await atLimit.json(), profile);
      const tooLarge = await post(compress(Buffer.from(json.padEnd(64 * 1024 + 1))), {
        'Content-Encoding': encoding,
      });
      // Auth intentionally returns its generic 400 for parser failures.
      assert.equal(tooLarge.status, 400, `${encoding} over the limit`);
      assert.deepEqual(await tooLarge.json(), { error: 'Invalid request. Try again.' });
    }
    for (const body of ['null', '{']) {
      const response = await post(gzipSync(body), { 'Content-Encoding': 'gzip' });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'Invalid request. Try again.' });
    }
    for (const [extra, status] of [
      [{ Cookie: '' }, 401],
      [{ Cookie: `${COOKIE_NAME}=invalid` }, 401],
      [{ Origin: 'https://untrusted.example' }, 403],
      [{ Origin: '' }, 403],
      [{ 'Content-Type': 'text/plain' }, 403],
    ] as const) {
      const response = await post(gzipSync(json), { 'Content-Encoding': 'gzip', ...extra });
      assert.equal(response.status, status);
      await response.arrayBuffer();
    }
    const saved = await fetch(`${root}/api/auth/profile`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), profile);
    await health();
  } else {
    throw new Error('Unknown request-body scenario.');
  }
  console.log(`Passed: ${scenario}`);
} finally {
  db.close();
  await app.close();
}
