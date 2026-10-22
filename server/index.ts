import { execFile } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { createApp, projectRoot } from './app.ts';

const development = process.argv.includes('--dev');
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('PORT must be an integer between 0 and 65535.');
}
const host = process.env.HOST ?? '127.0.0.1';
const app = await createApp({
  development,
  backupConfigPath: process.env.BACKUP_CONFIG_PATH,
  image: process.env.SPINEL_IMAGE,
  spaceReview: process.env.SPINEL_SPACE_REVIEW !== '0',
  origin: process.env.APP_ORIGIN ?? `http://localhost:${port}`,
  databasePath: resolve(process.env.DATABASE_PATH ?? resolve(projectRoot, 'data/spinel.sqlite')),
});

try {
  await new Promise<void>((resolveListen, reject) => {
    app.server.once('error', reject);
    app.server.listen(port, host, () => {
      app.server.removeListener('error', reject);
      resolveListen();
    });
  });
} catch (error) {
  await app.close();
  throw error;
}

const address = app.server.address() as AddressInfo;
const url = process.env.APP_ORIGIN ?? `http://localhost:${address.port}`;
console.log(`Spinel is running at ${url}`);

if (development && !process.argv.includes('--no-open')) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]];
  execFile(command, args, (error) => {
    if (error) console.log(`Open ${url} in your browser.`);
  });
}

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    await app.close();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
