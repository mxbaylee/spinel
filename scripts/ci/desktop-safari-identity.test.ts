import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { identifySafari, safariRequestScript } from './desktop-safari-identity.ts';

function fixture(changes: Record<string, unknown> = {}) {
  const trace: string[] = [];
  let quit = false;
  const running = {
    isNil: () => false,
    terminated: false,
    processIdentifier: 42,
    bundleIdentifier: 'com.apple.Safari',
    executableURL: { path: '/Applications/Safari.app/Contents/MacOS/Safari' },
    launchDate: { timeIntervalSince1970: 1234 },
    ...changes,
  };
  return {
    trace,
    quit: () => quit,
    execute(args: string[]) {
      return runInNewContext(
        safariRequestScript + '; run(args)',
        {
          args,
          console: { log: (line: string) => trace.push(line) },
          ObjC: { import: () => {}, unwrap: (value: unknown) => value },
          $: { NSRunningApplication: { runningApplicationWithProcessIdentifier: () => running } },
          Application: () => ({
            quit: () => {
              quit = true;
            },
          }),
        },
        { timeout: 100 },
      );
    },
  };
}

test('identity phases cover lookup through validation before any Apple Event', () => {
  const f = fixture();
  const result = JSON.parse(f.execute(['42', '', 'identify']));
  assert.equal(result.pid, 42);
  assert.equal(result.launchedAt, 1234);
  assert.match(f.trace[0], /appkit-import-begin/);
  assert.match(f.trace.at(-1)!, /identity-validation-end/);
  assert.ok(!f.quit());
});

for (const [name, changes, expected] of [
  ['wrong PID', { processIdentifier: 99 }, /not the expected Safari/],
  ['wrong bundle', { bundleIdentifier: 'other.app' }, /not the expected Safari/],
  ['exited', { terminated: true }, /process exited/],
  ['missing launch date', { launchDate: { timeIntervalSince1970: 0 } }, /not the expected Safari/],
  ['PID reuse', { launchDate: { timeIntervalSince1970: 5678 } }, /PID has been reused/],
] as const)
  test(`${name} refuses teardown before sending a quit event`, () => {
    const f = fixture(changes);
    assert.throws(() => f.execute(['42', '1234', 'quit']), expected);
    assert.ok(!f.quit());
  });

test('positively matched identity permits teardown', () => {
  const f = fixture();
  assert.equal(f.execute(['42', '1234', 'quit']), 'Quit requested');
  assert.ok(f.quit());
});

test('withheld launch identity records the exact unfinished phase', () => {
  const date = Object.defineProperty({}, 'timeIntervalSince1970', {
    get() {
      throw new Error('withheld');
    },
  });
  const f = fixture({ launchDate: date });
  assert.throws(() => f.execute(['42', '', 'identify']), /withheld/);
  assert.match(f.trace.at(-1)!, /launch-date-read-begin/);
  assert.ok(!f.quit());
});

test('eight-second process timeout preserves its first cause and last phase', async () => {
  const entry: Record<string, unknown> = {};
  const failure = Object.assign(new Error('terminated'), {
    signal: 'SIGTERM',
    killed: true,
    stderr: 'Safari request phase: {"phase":"appkit-import-begin"}\n',
  });
  const execute = async (_file: string, args: readonly string[], options: { timeout?: number }) => {
    assert.equal(options.timeout, 8000);
    assert.equal(args[6], 'identify');
    throw failure;
  };
  await assert.rejects(identifySafari('42', entry, execute), (error) => error === failure);
  assert.equal(entry.phase, 'appkit-import-begin');
  assert.equal(entry.identity, undefined);
  assert.equal((entry.error as { signal: string }).signal, 'SIGTERM');
});

test('no script output is explicitly an osascript startup failure, never an owned identity', async () => {
  const entry: Record<string, unknown> = {};
  await assert.rejects(
    identifySafari('42', entry, async () => {
      throw new Error('crashed');
    }),
    /crashed/,
  );
  assert.equal(entry.phase, 'osascript-startup');
  assert.equal(entry.identity, undefined);
});

test('malformed diagnostic output cannot replace the original process failure', async () => {
  const entry: Record<string, unknown> = {};
  const failure = Object.assign(new Error('original failure'), {
    stderr: 'Safari request phase: {malformed}\n',
  });
  await assert.rejects(
    identifySafari('42', entry, async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.match(String(entry.traceError), /SyntaxError/);
  assert.equal(entry.identity, undefined);
});
