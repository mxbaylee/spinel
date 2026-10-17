import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from 'vitest';
import { projectRoot } from './app.ts';

test('development watch mode stays running without a config-bundle restart loop', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-dev-'));
  const child = spawn(process.execPath, ['--watch', 'server/index.ts', '--dev', '--no-open'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: '0',
      HOST: '127.0.0.1',
      DATABASE_PATH: join(directory, 'spinel.sqlite'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data: Buffer) => {
    output += data.toString();
  });
  child.stderr.on('data', (data: Buffer) => {
    output += data.toString();
  });
  const exited = once(child, 'exit');
  try {
    const url = await new Promise<string>((resolveReady, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Development startup timed out: ${output}`)),
        8000,
      );
      child.once('error', reject);
      child.once('exit', () => {
        clearTimeout(timeout);
        reject(new Error(output));
      });
      child.stdout.on('data', () => {
        const match = output.match(/Spinel is running at (http:\/\/[^\s]+)/);
        if (match) {
          clearTimeout(timeout);
          resolveReady(match[1]);
        }
      });
    });
    expect((await fetch(url)).status).toBe(200);
    // Vite's default bundled config is deleted after import, which made Node's
    // watcher restart repeatedly. Observe beyond several former restart cycles.
    await delay(2500);
    expect(output.match(/Spinel is running at/g)).toHaveLength(1);
    expect(output).not.toContain('Restarting');
    expect((await fetch(`${url}/api/health`)).status).toBe(401);
  } finally {
    child.kill('SIGTERM');
    const forceStop = setTimeout(() => child.kill('SIGKILL'), 3000);
    await exited;
    clearTimeout(forceStop);
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
