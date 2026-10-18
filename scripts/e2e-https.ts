import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../server/app.ts';

// Disposable loopback HTTPS fixture, never a deployment command. It uses the real
// configured origin and request/upgrade handlers without changing auth headers.
const directory = await mkdtemp(join(tmpdir(), 'spinel-e2e-tls-'));
const key = join(directory, 'key.pem'),
  cert = join(directory, 'cert.pem');
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    key,
    '-out',
    cert,
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
    '-addext',
    'subjectAltName=DNS:localhost,IP:127.0.0.1',
  ],
  { stdio: 'ignore' },
);
const app = await createApp({
  origin: 'https://localhost:3103',
  databasePath: resolve('test-results/mobile-https/app.sqlite'),
});
const tls = createServer({ key: await readFile(key), cert: await readFile(cert) });
tls.on('request', (request, response) => app.server.emit('request', request, response));
tls.on('upgrade', (request, socket, head) => app.server.emit('upgrade', request, socket, head));
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    await app.close();
    await new Promise<void>((resolveClose, reject) => {
      tls.close((error) => (error ? reject(error) : resolveClose()));
      tls.closeAllConnections();
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
try {
  await new Promise<void>((resolveListen, reject) => {
    tls.once('error', reject);
    tls.listen(3103, '127.0.0.1', () => {
      tls.removeListener('error', reject);
      resolveListen();
    });
  });
  console.log('Disposable Spinel HTTPS fixture: https://localhost:3103');
} catch (error) {
  await shutdown();
  throw error;
}
