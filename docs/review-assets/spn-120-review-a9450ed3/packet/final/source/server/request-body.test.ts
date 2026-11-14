import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

test.each(['trailing compressed bytes', 'JSON and access compatibility'])(
  'request-body subprocess: %s',
  async (scenario) => {
    const directory = await mkdtemp(join(tmpdir(), 'spinel-request-body-'));
    // An uncaught decoder error must kill this disposable server, not be
    // intercepted by Vitest or take down the other regression tests.
    const child = spawn(
      process.execPath,
      [
        '--max-old-space-size=256',
        '--max-semi-space-size=8',
        fileURLToPath(new URL('./request-body-process-fixture.ts', import.meta.url)),
        directory,
        scenario,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'test' } },
    );
    let output = '';
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => {
        output = (output + String(chunk)).slice(-20_000);
      });
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    try {
      const result = await new Promise<{ code: number | null; signal: string | null }>(
        (resolve, reject) => {
          child.once('error', reject);
          child.once('close', (code, signal) => resolve({ code, signal }));
        },
      );
      expect(result, output).toEqual({ code: 0, signal: null });
      expect(output).toContain(`Passed: ${scenario}`);
    } finally {
      clearTimeout(timer);
      await rm(directory, { recursive: true, force: true });
    }
  },
  25_000,
);
