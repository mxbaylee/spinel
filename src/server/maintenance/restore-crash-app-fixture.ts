/** Actual entrypoint, with a test-only stop immediately before its first genuine
 * private readiness send. Reaching this cut proves permit consumption and the
 * application's startup fingerprint check, not just ownership dispatch. */
import { closeSync, fsyncSync, openSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

if (!process.send || !process.env.SPINEL_TEST_CRASH_MARKER)
  throw new Error('Private crash fixture required.');
const offset = Number(process.env.SPINEL_TEST_CLOCK_OFFSET ?? 0);
if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid fixture clock.');
const realNow = Date.now;
Date.now = () => realNow() + offset;
if (
  process.env.SPINEL_RESTORE_TRIAL === '1' &&
  process.env.SPINEL_TEST_COLD_CRASH_CUT === 'cold-trial-planned'
)
  // The recorded child exists before main adopts it. Hold before any database
  // import/open, including after IPC disconnect, until exact-group recovery stops it.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
const send = process.send.bind(process);
process.send = ((message: unknown, ...args: unknown[]) => {
  const cold = process.env.SPINEL_TEST_COLD_CRASH_CUT === 'cold-private-open';
  const cut = cold ? 'cold-private-open' : 'private-open';
  const marker = cold
    ? process.env.SPINEL_TEST_COLD_CRASH_MARKER
    : process.env.SPINEL_TEST_CRASH_MARKER;
  if (
    (cold || process.env.SPINEL_TEST_CRASH_CUT === 'private-open') &&
    message &&
    typeof message === 'object' &&
    'kind' in message &&
    message.kind === 'restore-trial-ready' &&
    (!cold ||
      ('reference' in message && (message.reference as { role: string }).role === 'original'))
  ) {
    if (!marker) throw new Error('Missing private crash marker.');
    const fd = openSync(marker, 'wx', 0o600);
    try {
      writeFileSync(fd, JSON.stringify({ cut, pid: process.pid, readiness: message }));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const directory = openSync(dirname(marker), 'r');
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
