// Disposable child used only by the transport interruption regression test.
import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FilesystemStore } from './filesystem.ts';
import type { FilesystemConfig } from './config.ts';

const [configPath, source, key] = process.argv.slice(2);
if (!process.send || !configPath || !source || !key) process.exit(2);
const config = JSON.parse(await readFile(configPath, 'utf8')) as FilesystemConfig;
let announced = false;
const watcher = watch(join(config.root, config.prefix), (_event, name) => {
  if (String(name).startsWith('.pending-') && !announced) {
    announced = true;
    process.send!({ pending: true });
  }
});
try {
  await new FilesystemStore(config).put(key, source, '0'.repeat(64), AbortSignal.timeout(30_000));
} finally {
  watcher.close();
  process.disconnect?.();
}
