import { fork } from 'node:child_process';
import { expect, test } from 'vitest';

test('two authenticated native editors remain responsive during an admitted PDF, cancellation, and recovery', async () => {
  // Use ordinary Node loading and the production heap bounds. Importing the
  // native app into Vitest's transformed graph adds substantial harness memory.
  const fixture = fork(new URL('./concurrency-fixture.ts', import.meta.url), [], {
    detached: true,
    env: { ...process.env, NODE_ENV: 'production', NODE_OPTIONS: '' },
    execArgv: ['--max-old-space-size=256', '--max-semi-space-size=8'],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  fixture.stderr?.on('data', (chunk: Buffer) => {
    if (stderr.length < 16_384) stderr += chunk.toString();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (fixture.pid === undefined) return;
    try {
      // This disposable fixture owns its group, including any PDF child still
      // alive after an assertion/deadline failure. Never leave it orphaned.
      process.kill(-fixture.pid, 'SIGKILL');
    } catch {
      fixture.kill('SIGKILL');
    }
  };
  try {
    const result = await new Promise<{
      peerEditAndHealthMs: number;
      pages: number;
      cancelledChildSignal: string;
    }>((accept, reject) => {
      let report: unknown;
      fixture.once('message', (message) => {
        report = message;
      });
      fixture.once('error', reject);
      fixture.once('close', (code, signal) => {
        if (code !== 0 || !report)
          reject(new Error(`PDF overlap fixture exited (${code ?? signal}): ${stderr}`));
        else
          accept(
            report as { peerEditAndHealthMs: number; pages: number; cancelledChildSignal: string },
          );
      });
      timer = setTimeout(() => {
        stop();
        reject(new Error(`PDF overlap fixture exceeded its deadline: ${stderr}`));
      }, 80_000);
    });
    expect(result.peerEditAndHealthMs).toBeLessThan(1000);
    expect(result.pages).toBeGreaterThan(1);
    expect(result.cancelledChildSignal).toBe('SIGKILL');
  } finally {
    clearTimeout(timer);
    stop();
  }
}, 90_000);
