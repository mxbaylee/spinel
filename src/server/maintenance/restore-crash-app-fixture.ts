/** Actual entrypoint, with a test-only stop immediately before its first genuine
 * private readiness send. Reaching this cut proves permit consumption and the
 * application's startup fingerprint check, not just ownership dispatch. */
import { closeSync, fsyncSync, openSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

if (!process.send || !process.env.SPINEL_TEST_CRASH_MARKER)
  throw new Error('Private crash fixture required.');
const send = process.send.bind(process);
process.send = ((message: unknown, ...args: unknown[]) => {
  if (
    message &&
    typeof message === 'object' &&
    'kind' in message &&
    message.kind === 'restore-trial-ready'
  ) {
    const fd = openSync(process.env.SPINEL_TEST_CRASH_MARKER!, 'wx', 0o600);
    try {
      writeFileSync(fd, JSON.stringify({ cut: 'private-open', pid: process.pid }));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const directory = openSync(dirname(process.env.SPINEL_TEST_CRASH_MARKER!), 'r');
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
    // The external test kills the controller; restart must reap this held child.
    // No readiness message or final shutdown witness has been sent.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  }
  return Reflect.apply(send, process, [message, ...args]);
}) as typeof process.send;
await import('../../../server/index.ts');
