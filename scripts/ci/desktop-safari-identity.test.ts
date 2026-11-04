import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { identifySafari, safariRequestScript } from './desktop-safari-identity.ts';

type LoaderFailure =
  | 'nil bundle'
  | 'bundle lookup throws'
  | 'failed load'
  | 'load throws'
  | 'nil class'
  | 'class lookup throws';

function fixture(changes: Record<string, unknown> = {}, loaderFailure?: LoaderFailure) {
  const trace: string[] = [];
  const calls: unknown[][] = [];
  const failure = new Error(loaderFailure);
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
  const page = {
    url: 'http://localhost:8176/probe',
    title: 'Capability probe',
    readyState: 'complete',
    visibility: 'visible',
    hasFocus: true,
    text: 'Retained sentinel',
  };
  const tab = {
    index: () => 1,
    name: () => page.title,
    url: () => page.url,
  };
  const window = {
    miniaturized: () => true,
    currentTab: () => tab,
    id: () => 19,
    bounds: () => [0, 25, 1280, 900],
  };
  const document = {
    name: ({ timeout }: { timeout: number }) => {
      calls.push(['title', timeout]);
      return page.title;
    },
  };
  const foundation = Object.assign((value: string) => ({ stringValue: value }), {
    NSBundle: {
      bundleWithPath(path: string) {
        calls.push(['bundle', path]);
        if (loaderFailure === 'bundle lookup throws') throw failure;
        return {
          isNil: () => loaderFailure === 'nil bundle',
          get load() {
            calls.push(['load']);
            if (loaderFailure === 'load throws') throw failure;
            return loaderFailure !== 'failed load';
          },
        };
      },
    },
    NSClassFromString(name: { stringValue: string }) {
      // C function arguments require an explicit NSString wrapper in JXA.
      assert.deepEqual(name, { stringValue: 'NSRunningApplication' });
      calls.push(['class', name.stringValue]);
      if (loaderFailure === 'class lookup throws') throw failure;
      return {
        isNil: () => loaderFailure === 'nil class',
        runningApplicationWithProcessIdentifier(pid: number) {
          calls.push(['lookup', pid]);
          return running;
        },
      };
    },
  });
  return {
    trace,
    calls,
    failure,
    page,
    window,
    quit: () => quit,
    execute(args: string[]) {
      return runInNewContext(
        safariRequestScript + '; run(args)',
        {
          args,
          console: { log: (line: string) => trace.push(line) },
          ObjC: {
            import: () => {
              throw new Error('A full framework import must not be used.');
            },
            unwrap: (value: unknown) => value,
          },
          $: foundation,
          Application: (pid: number) => {
            calls.push(['application', pid]);
            return {
              documents: [document],
              windows: [window],
              frontmost: () => false,
              activate: () => calls.push(['activate']),
              doJavaScript: (
                source: string,
                options: { in: unknown },
                request?: { timeout: number },
              ) => {
                if (options.in === document) {
                  calls.push(['evaluate', source, request?.timeout]);
                  return 'Evaluated sentinel';
                }
                assert.equal(options.in, tab);
                assert.match(source, /document\.hasFocus\(\)/);
                assert.match(source, /document\.body\.innerText/);
                calls.push(['baseline-page']);
                return JSON.stringify(page);
              },
              quit: () => {
                calls.push(['quit']);
                quit = true;
              },
            };
          },
        },
        { timeout: 100 },
      );
    },
  };
}

const loadingCalls = [
  ['bundle', '/System/Library/Frameworks/AppKit.framework'],
  ['load'],
  ['class', 'NSRunningApplication'],
  ['lookup', 42],
];

test('the checked system executable and class establish identity without any Apple Event', () => {
  const f = fixture();
  const result = JSON.parse(f.execute(['42', '', 'identify']));
  assert.deepEqual(result, {
    pid: 42,
    bundleIdentifier: 'com.apple.Safari',
    executablePath: '/Applications/Safari.app/Contents/MacOS/Safari',
    launchedAt: 1234,
  });
  assert.deepEqual(f.calls, loadingCalls);
  assert.deepEqual(
    f.trace
      .slice(0, 6)
      .map((line) => JSON.parse(line.slice('Safari request phase: '.length)).phase),
    [
      'appkit-bundle-create-begin',
      'appkit-bundle-create-end',
      'appkit-executable-load-begin',
      'appkit-executable-load-end',
      'running-application-class-begin',
      'running-application-class-end',
    ],
  );
  assert.match(f.trace.at(-1)!, /identity-validation-end/);
  assert.ok(!f.quit());
});

for (const [name, expected, phase, callCount] of [
  ['nil bundle', /AppKit bundle is unavailable/, 'appkit-bundle-create-begin', 1],
  ['bundle lookup throws', /bundle lookup throws/, 'appkit-bundle-create-begin', 1],
  ['failed load', /AppKit executable could not be loaded/, 'appkit-executable-load-begin', 2],
  ['load throws', /load throws/, 'appkit-executable-load-begin', 2],
  ['nil class', /NSRunningApplication class is unavailable/, 'running-application-class-begin', 3],
  ['class lookup throws', /class lookup throws/, 'running-application-class-begin', 3],
] as const)
  test(`${name} preserves the first loading failure before lookup or teardown authority`, () => {
    const f = fixture({}, name);
    assert.throws(
      () => f.execute(['42', '1234', 'quit']),
      name.endsWith('throws') ? (error: unknown) => error === f.failure : expected,
    );
    assert.deepEqual(f.calls, loadingCalls.slice(0, callCount));
    assert.equal(JSON.parse(f.trace.at(-1)!.slice('Safari request phase: '.length)).phase, phase);
    assert.ok(!f.quit());
  });

for (const [name, changes, expected] of [
  ['wrong PID', { processIdentifier: 99 }, /not the expected Safari/],
  ['wrong bundle', { bundleIdentifier: 'other.app' }, /not the expected Safari/],
  ['missing process', { isNil: () => true }, /process exited/],
  ['exited', { terminated: true }, /process exited/],
  ['missing launch date', { launchDate: { timeIntervalSince1970: 0 } }, /not the expected Safari/],
  ['PID reuse', { launchDate: { timeIntervalSince1970: 5678 } }, /PID has been reused/],
] as const)
  test(`${name} refuses teardown before sending a quit event`, () => {
    const f = fixture(changes);
    assert.throws(() => f.execute(['42', '1234', 'quit']), expected);
    assert.deepEqual(f.calls, loadingCalls);
    assert.ok(!f.quit());
  });

test('positively matched identity permits teardown', () => {
  const f = fixture();
  assert.equal(f.execute(['42', '1234', 'quit']), 'Quit requested');
  assert.deepEqual(f.calls, [...loadingCalls, ['application', 42], ['quit']]);
  assert.ok(f.quit());
});

test('title preserves the PID and supplied Apple Event timeout after checked loading', () => {
  const f = fixture();
  assert.equal(f.execute(['42', '1234', 'title', '', '25']), f.page.title);
  assert.deepEqual(f.calls, [...loadingCalls, ['application', 42], ['title', 25]]);
});

test('evaluate preserves the source, document and supplied timeout after checked loading', () => {
  const f = fixture();
  assert.equal(
    f.execute(['42', '1234', 'evaluate', 'localStorage.getItem("sentinel")', '8']),
    'Evaluated sentinel',
  );
  assert.deepEqual(f.calls, [
    ...loadingCalls,
    ['application', 42],
    ['evaluate', 'localStorage.getItem("sentinel")', 8],
  ]);
});

test('baseline preserves native window, tab and page state after checked loading', () => {
  const f = fixture();
  assert.deepEqual(JSON.parse(f.execute(['42', '1234', 'baseline', '', '5'])), {
    windowId: 19,
    bounds: [0, 25, 1280, 900],
    tabIndex: 1,
    title: f.page.title,
    url: f.page.url,
    page: f.page,
  });
  assert.equal(f.window.miniaturized, false);
  assert.deepEqual(f.calls, [
    ...loadingCalls,
    ['application', 42],
    ['activate'],
    ['baseline-page'],
  ]);
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
  assert.deepEqual(f.calls, loadingCalls);
  assert.ok(!f.quit());
});

test('eight-second process timeout preserves its first cause and last phase', async () => {
  const entry: Record<string, unknown> = {};
  const failure = Object.assign(new Error('terminated'), {
    signal: 'SIGTERM',
    killed: true,
    stderr: 'Safari request phase: {"phase":"appkit-executable-load-begin"}\n',
  });
  const execute = async (_file: string, args: readonly string[], options: { timeout?: number }) => {
    assert.equal(options.timeout, 8000);
    assert.equal(args[6], 'identify');
    throw failure;
  };
  await assert.rejects(identifySafari('42', entry, execute), (error) => error === failure);
  assert.equal(entry.phase, 'appkit-executable-load-begin');
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

for (const [name, stdout, phase] of [
  ['invalid JSON', 'invalid json', 'host-identity-parse'],
  [
    'wrong bundle',
    JSON.stringify({
      pid: 42,
      bundleIdentifier: 'other.app',
      launchedAt: 1234,
      executablePath: '/other',
    }),
    'host-identity-validation',
  ],
  [
    'relative executable',
    JSON.stringify({
      pid: 42,
      bundleIdentifier: 'com.apple.Safari',
      launchedAt: 1234,
      executablePath: 'Safari.app/Contents/MacOS/Safari',
    }),
    'host-identity-validation',
  ],
])
  test(`${name} retains the command's output and trace at ${phase}`, async () => {
    const entry: Record<string, unknown> = {};
    const stderr = 'Safari request phase: {"phase":"identity-validation-end"}\n';
    await assert.rejects(identifySafari('42', entry, async () => ({ stdout, stderr })));
    assert.equal(entry.phase, phase);
    assert.equal(entry.trace, stderr);
    assert.equal(entry.stdout, stdout);
    assert.equal(entry.identity, undefined);
  });
