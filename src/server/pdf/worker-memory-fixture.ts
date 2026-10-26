import { fork } from 'node:child_process';
import { pdfWorkerPeakRss } from './worker-memory.ts';

if (process.argv.includes('--child')) {
  process.send?.({ peak: pdfWorkerPeakRss(), lifetime: process.resourceUsage().maxRSS * 1024 });
  process.disconnect?.();
} else {
  // Touch every page and keep it live across fork/exec, as the development
  // compiler does. The child's current address space never owns this buffer.
  const retained = Buffer.alloc(384 * 1024 * 1024, 1);
  const child = fork(new URL(import.meta.url), ['--child'], {
    env: { LANG: 'C.UTF-8', TZ: 'UTC' },
    execArgv: ['--max-old-space-size=64', '--max-semi-space-size=4'],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  let report: unknown;
  child.once('message', (message) => {
    report = message;
  });
  child.once('error', () => {
    process.exitCode = 1;
  });
  child.once('close', (code) => {
    clearTimeout(timer);
    if (code !== 0 || !report || retained[retained.length - 1] !== 1) process.exitCode = 1;
    else process.send?.(report);
    process.disconnect?.();
  });
}
