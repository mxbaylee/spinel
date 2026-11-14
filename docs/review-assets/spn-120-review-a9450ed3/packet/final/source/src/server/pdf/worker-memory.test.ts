import { fork } from 'node:child_process';
import { expect, test } from 'vitest';

test.skipIf(process.platform !== 'linux')(
  'worker peak excludes the Linux pre-exec parent high-water mark',
  async () => {
    const fixture = fork(new URL('./worker-memory-fixture.ts', import.meta.url), [], {
      detached: true,
      env: { LANG: 'C.UTF-8', TZ: 'UTC' },
      execArgv: ['--max-old-space-size=64', '--max-semi-space-size=4'],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (fixture.pid === undefined) return;
      try {
        process.kill(-fixture.pid, 'SIGKILL');
      } catch {
        fixture.kill('SIGKILL');
      }
    };
    try {
      const result = await new Promise<{ peak: number; lifetime: number }>((resolve, reject) => {
        let report: unknown;
        fixture.once('message', (message) => {
          report = message;
        });
        fixture.once('error', reject);
        fixture.once('close', (code) => {
          if (code !== 0 || !report) reject(new Error('Worker memory fixture failed.'));
          else resolve(report as { peak: number; lifetime: number });
        });
        timer = setTimeout(() => {
          stop();
          reject(new Error('Worker memory fixture timed out.'));
        }, 15_000);
      });
      // This is an actual fork/exec regression: a small worker must not be charged
      // for the parent's retained native/Buffer allocation.
      expect(result.lifetime).toBeGreaterThan(384 * 1024 * 1024);
      expect(result.peak).toBeGreaterThan(0);
      expect(result.peak).toBeLessThan(128 * 1024 * 1024);
    } finally {
      clearTimeout(timer);
      stop();
    }
  },
  20_000,
);
