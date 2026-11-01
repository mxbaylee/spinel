import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Readable } from 'node:stream';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { AppProcessError, observeAppProcess, withFixtureCleanup } from '../../e2e/owned-process.ts';

const banner = 'Spinel is running at http://localhost:3999';
const ready = `console.log(${JSON.stringify(banner)});`;
function child(t: TestContext, source: string) {
  const process = spawn(globalThis.process.execPath, ['--input-type=module', '--eval', source], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (process.exitCode === null && process.signalCode === null) process.kill('SIGKILL');
  });
  return process;
}

function output(stream: Readable, marker: string) {
  return new Promise<void>((resolve, reject) => {
    let tail = '';
    const onData = (chunk: Buffer) => {
      tail = (tail + chunk.toString()).slice(-65_536);
      if (!tail.includes(marker)) return;
      stream.off('data', onData);
      stream.off('end', onEnd);
      resolve();
    };
    const onEnd = () => reject(new Error('The test child ended before its diagnostic marker.'));
    stream.on('data', onData);
    stream.once('end', onEnd);
  });
}

function monitor(process: ChildProcessWithoutNullStreams) {
  return observeAppProcess(process, banner, { readyTimeoutMs: 2_000, closeTimeoutMs: 1_000 });
}

test('only the complete exact readiness line admits work, including split writes', async (t) => {
  const process = child(
    t,
    `process.stdin.on('data', () => process.stdout.write(':3999\\n'));
     process.stdout.write('Spinel is running at http://localhost');`,
  );
  const partial = output(process.stdout, 'http://localhost');
  let resolved = false;
  const starting = monitor(process).then((app) => {
    resolved = true;
    return app;
  });
  await partial;
  assert.equal(resolved, false);
  process.stdin.write('finish readiness');
  const app = await starting;
  await withFixtureCleanup(async () => {
    assert.equal(app.evidence().ready, true);
    assert.equal(app.evidence().exited, false);
    assert.equal(await app.guard(async () => 'verified work'), 'verified work');
  }, app.close);
  assert.equal(app.evidence().expectedClose, true);
  assert.equal(app.evidence().closed, true);
});

test('post-readiness pipes keep bounded private tails and publish only safe diagnostics', async (t) => {
  const process = child(
    t,
    `${ready}
     process.stdin.on('data', () => {
       process.stdout.write('cookie=private-session document=private-content '.repeat(1000));
       process.stdout.write('\\nError: EIO private-body\\nSTDOUT_DONE\\n');
       process.stderr.write('Bearer private-token\\nECONNRESET\\n');
       process.stderr.write('FATAL ERROR: Lazy deopt after a fast API call with return value is unsupported\\n');
       process.stderr.write('    at write (node:internal/streams/writable:123:4)\\n');
       process.stderr.write('    at private-value (node:private-value:456:7)\\nSTDERR_DONE\\n');
     });`,
  );
  const app = await monitor(process);
  await withFixtureCleanup(async () => {
    const printed = Promise.all([
      output(process.stdout, 'STDOUT_DONE'),
      output(process.stderr, 'STDERR_DONE'),
    ]);
    process.stdin.write('emit post-readiness output');
    await printed;
    const evidence = app.evidence();
    assert.ok(evidence.stdout.bytes > 16_384);
    assert.ok(evidence.stdout.tail.length <= 16_384);
    assert.ok(evidence.stderr.tail.length <= 16_384);
    assert.match(evidence.stdout.tail, /EIO/);
    assert.match(evidence.stderr.tail, /ECONNRESET/);
    assert.match(evidence.stderr.tail, /Lazy deopt after a fast API call/);
    assert.match(evidence.stderr.tail, /node:internal\/streams\/writable:123:4/);
    assert.doesNotMatch(JSON.stringify(evidence), /private-|Bearer|cookie=|document=/);
  }, app.close);
});

for (const readiness of ['no readiness', `${banner}0\n`, banner]) {
  test(`withheld readiness (${JSON.stringify(readiness)}) fails and closes within its budget`, async (t) => {
    const process = child(
      t,
      `process.stdout.write(${JSON.stringify(readiness)}); process.stdin.resume();`,
    );
    const started = performance.now();
    await assert.rejects(
      observeAppProcess(process, banner, { readyTimeoutMs: 250, closeTimeoutMs: 1_000 }),
      (error: unknown) => {
        assert.ok(error instanceof AppProcessError);
        assert.equal(error.message, 'App startup timed out.');
        assert.equal(error.evidence.ready, false);
        assert.equal(error.evidence.expectedClose, true);
        assert.equal(error.evidence.closed, true);
        return true;
      },
    );
    assert.ok(performance.now() - started < 2_000);
  });
}

test('a crash before readiness preserves the actual exit and its first diagnostic', async (t) => {
  const process = child(t, "console.error('ECONNREFUSED private-request'); process.exitCode = 17;");
  await assert.rejects(monitor(process), (error: unknown) => {
    assert.ok(error instanceof AppProcessError);
    assert.match(error.message, /App exited before ready \(code 17/);
    assert.equal(error.evidence.exitCode, 17);
    assert.equal(error.evidence.closed, true);
    assert.match(error.evidence.stderr.tail, /ECONNREFUSED/);
    assert.doesNotMatch(JSON.stringify(error.evidence), /private-request/);
    return true;
  });
});

test('a wrapper can cancel startup without waiting for the readiness deadline', async (t) => {
  const process = child(t, "console.log('starting'); process.stdin.resume();");
  const beginning = output(process.stdout, 'starting');
  const controller = new AbortController();
  const starting = observeAppProcess(process, banner, {
    readyTimeoutMs: 2_000,
    closeTimeoutMs: 500,
    signal: controller.signal,
  });
  const rejected = assert.rejects(starting, (error: unknown) => {
    assert.ok(error instanceof AppProcessError);
    assert.equal(error.message, 'App startup cancelled.');
    assert.equal(error.evidence.ready, false);
    assert.equal(error.evidence.expectedClose, true);
    assert.equal(error.evidence.closed, true);
    assert.equal(error.evidence.unexpectedExit, false);
    return true;
  });
  await beginning;
  const stopped = performance.now();
  controller.abort();
  await rejected;
  assert.ok(performance.now() - stopped < 1_000);
});

test('a post-readiness exit interrupts pending work and forbids another operation', async (t) => {
  const process = child(
    t,
    `${ready} process.stdin.on('data', () => {
       console.error('ECONNRESET private-request'); process.exit(19);
     });`,
  );
  const app = await monitor(process);
  const pending = app.guard(() => new Promise<void>(() => {}));
  const rejected = assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof AppProcessError);
    assert.match(error.message, /App exited unexpectedly \(code 19/);
    return true;
  });
  process.stdin.write('terminate now');
  await rejected;
  const failure = await app.failure;
  await app.finished;
  assert.equal(failure.evidence.exitCode, 19);
  assert.equal(failure.evidence.unexpectedExit, true);
  assert.equal(failure.evidence.ready, true);
  assert.match(failure.evidence.stderr.tail, /ECONNRESET/);
  let invoked = false;
  await assert.rejects(
    app.guard(async () => {
      invoked = true;
    }),
    (error: unknown) => error === failure,
  );
  assert.equal(invoked, false);
  await app.close();
  await app.close();
  assert.equal(app.evidence().closed, true);
  assert.equal(app.evidence().unexpectedExit, true);
  assert.match(app.evidence().firstFailure!, /App exited unexpectedly/);
});

test('repeated wrapper cancellation closes a ready child without inventing a crash', async (t) => {
  const process = child(t, `${ready} process.stdin.resume();`);
  const controller = new AbortController();
  const app = await observeAppProcess(process, banner, {
    readyTimeoutMs: 2_000,
    closeTimeoutMs: 500,
    signal: controller.signal,
  });
  controller.abort();
  controller.abort();
  await app.finished;
  assert.equal(app.evidence().closed, true);
  assert.equal(app.evidence().expectedClose, true);
  assert.equal(app.evidence().unexpectedExit, false);
  assert.equal(app.evidence().firstFailure, null);
});

test('cleanup is idempotent and forces a child that ignores graceful termination', async (t) => {
  const process = child(t, `process.on('SIGTERM', () => {}); ${ready} process.stdin.resume();`);
  const app = await observeAppProcess(process, banner, {
    readyTimeoutMs: 2_000,
    closeTimeoutMs: 500,
  });
  const started = performance.now();
  const closing = app.close();
  assert.equal(app.close(), closing);
  await closing;
  assert.ok(performance.now() - started < 1_500);
  assert.equal(app.evidence().signal, 'SIGKILL');
  assert.equal(app.evidence().expectedClose, true);
  assert.equal(app.evidence().closed, true);
  await app.close();
});

test('failed spawn rejects promptly and does not await a nonexistent process forever', async () => {
  const process = spawn('/spinel-missing-executable-for-negative-control', [], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await assert.rejects(
    observeAppProcess(process, banner, { readyTimeoutMs: 500, closeTimeoutMs: 500 }),
    (error: unknown) => {
      assert.ok(error instanceof AppProcessError);
      assert.equal((error.cause as NodeJS.ErrnoException).code, 'ENOENT');
      assert.equal(error.evidence.pid, null);
      assert.equal(error.evidence.closed, true);
      return true;
    },
  );
});

test('an inherited pipe cannot keep cleanup pending beyond its original budget', async (t) => {
  const process = child(
    t,
    `import { spawn } from 'node:child_process';
     const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
       stdio: ['ignore', process.stdout, process.stderr],
     });
     console.log('descendant:' + descendant.pid);
     ${ready}
     process.stdin.resume();`,
  );
  let descendant: number | undefined;
  process.stdout.on('data', (chunk: Buffer) => {
    const match = chunk.toString().match(/descendant:(\d+)/);
    if (match) descendant = Number(match[1]);
  });
  t.after(() => {
    // This PID comes from the disposable child created above, not a process
    // search. It was started less than a second ago and is intentionally live.
    if (descendant) globalThis.process.kill(descendant, 'SIGKILL');
  });
  const app = await observeAppProcess(process, banner, {
    readyTimeoutMs: 2_000,
    closeTimeoutMs: 250,
  });
  assert.ok(descendant);
  const started = performance.now();
  await assert.rejects(app.close(), (error: unknown) => {
    assert.ok(error instanceof AppProcessError);
    assert.equal(error.message, 'App cleanup timed out.');
    return true;
  });
  assert.ok(performance.now() - started < 1_000);
  assert.equal(app.evidence().exited, true);
  assert.equal(app.evidence().firstFailure, 'App cleanup timed out.');
});

test('a feature error remains the original error when cleanup succeeds', async () => {
  const original = new Error('first feature failure');
  let cleaned = false;
  await assert.rejects(
    withFixtureCleanup(
      async () => {
        throw original;
      },
      async () => {
        cleaned = true;
      },
    ),
    (error: unknown) => error === original,
  );
  assert.equal(cleaned, true);
});

test('cleanup errors retain the initial failure first and as the cause', async () => {
  const original = new Error('first feature failure');
  const cleanup = new Error('later cleanup failure');
  await assert.rejects(
    withFixtureCleanup(
      async () => {
        throw original;
      },
      async () => {
        throw cleanup;
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [original, cleanup]);
      assert.equal(error.cause, original);
      return true;
    },
  );
});

test('cleanup alone remains a failure and a successful value survives successful cleanup', async () => {
  const cleanup = new Error('cleanup failure');
  await assert.rejects(
    withFixtureCleanup(
      async () => 'feature passed',
      async () => {
        throw cleanup;
      },
    ),
    (error: unknown) => error === cleanup,
  );
  assert.equal(
    await withFixtureCleanup(
      async () => 'complete',
      async () => {},
    ),
    'complete',
  );
});
