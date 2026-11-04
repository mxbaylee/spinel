import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  identifySafari,
  requestSafari,
  safariRequestScript,
  waitForSafariValue,
  observeSafariTitle,
  readSafariBaseline,
} from './desktop-safari-identity.ts';

type LoaderFailure =
  | 'nil bundle'
  | 'bundle lookup throws'
  | 'failed load'
  | 'load throws'
  | 'nil class'
  | 'class lookup throws';

function fixture(
  changes: Record<string, unknown> = {},
  loaderFailure?: LoaderFailure,
  options: {
    constructorFailures?: Error[];
    actionFailure?: Error;
    afterConstructor?: (running: Record<string, unknown>, attempt: number) => void;
  } = {},
) {
  const trace: string[] = [];
  const calls: unknown[][] = [];
  const failure = new Error(loaderFailure);
  let quit = false;
  let constructors = 0;
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
    title: 'Spinel desktop profile probe',
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
    bounds: () => ({ x: 0, y: 25, width: 1280, height: 900 }),
  };
  const document = {
    name: ({ timeout }: { timeout: number }) => {
      calls.push(['title', timeout]);
      if (options.actionFailure) throw options.actionFailure;
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
            constructors++;
            options.afterConstructor?.(running, constructors);
            const failure = options.constructorFailures?.[constructors - 1];
            if (failure) throw failure;
            return {
              documents: [document],
              windows: [window],
              frontmost: () => false,
              activate: () => calls.push(['activate']),
              doJavaScript: (
                source: string,
                destination: { in: unknown },
                request?: { timeout: number },
              ) => {
                if (destination.in === document) {
                  calls.push(['evaluate', source, request?.timeout]);
                  if (options.actionFailure) throw options.actionFailure;
                  return 'Evaluated sentinel';
                }
                assert.equal(destination.in, tab);
                assert.match(source, /document\.hasFocus\(\)/);
                assert.match(source, /document\.body\.innerText/);
                calls.push(['baseline-page']);
                if (options.actionFailure) throw options.actionFailure;
                return JSON.stringify(page);
              },
              quit: () => {
                calls.push(['quit']);
                quit = true;
                if (options.actionFailure) throw options.actionFailure;
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

const notFound = () =>
  Object.assign(new Error("Application can't be found."), { errorNumber: -2700 });

for (const mode of ['title', 'evaluate', 'quit', 'baseline']) {
  test(`${mode} permits one constructor-only recovery with the same revalidated identity`, () => {
    const first = notFound();
    const f = fixture({}, undefined, { constructorFailures: [first] });
    f.execute(['42', '1234', mode, 'sentinel', '5']);
    assert.deepEqual(
      f.calls.filter(([name]) => name === 'application'),
      [
        ['application', 42],
        ['application', 42],
      ],
    );
    assert.equal(f.calls.filter(([name]) => name === 'lookup').length, 3);
    assert.equal(
      f.calls.filter(([name]) => name === (mode === 'baseline' ? 'baseline-page' : mode)).length,
      1,
    );
    assert.ok(
      f.trace.some(
        (line) => line.includes('Safari constructor failure:') && line.includes('-2700'),
      ),
    );
    assert.ok(f.trace.some((line) => line.includes('application-constructor-second-end')));
    assert.equal(f.trace.filter((line) => line.includes('action-dispatch-begin')).length, 1);
  });

  test(`${mode} never repeats an action that throws the same native error after dispatch`, () => {
    const failure = notFound();
    const f = fixture({}, undefined, { actionFailure: failure });
    assert.throws(
      () => f.execute(['42', '1234', mode, 'sentinel', '5']),
      (error) => error === failure,
    );
    assert.equal(f.calls.filter(([name]) => name === 'application').length, 1);
    assert.equal(
      f.calls.filter(([name]) => name === (mode === 'baseline' ? 'baseline-page' : mode)).length,
      1,
    );
    assert.ok(!f.trace.some((line) => line.includes('Safari constructor failure:')));
  });
}

for (const failure of [
  new Error("Application can't be found."),
  Object.assign(new Error('Not authorized'), { errorNumber: -1743 }),
  Object.assign(new Error('Unknown failure'), { errorNumber: -2700 }),
])
  test(`unclassified constructor failure is fatal: ${String(failure)}`, () => {
    const f = fixture({}, undefined, { constructorFailures: [failure] });
    assert.throws(
      () => f.execute(['42', '1234', 'quit']),
      (error) => error === failure,
    );
    assert.equal(f.calls.filter(([name]) => name === 'application').length, 1);
    assert.ok(!f.quit());
  });

test('a repeated constructor failure retains both attempts and throws the original cause', () => {
  const first = notFound();
  const second = new Error('second failure');
  const f = fixture({}, undefined, {
    constructorFailures: [first, second, new Error('must not reach')],
  });
  assert.throws(
    () => f.execute(['42', '1234', 'quit']),
    (error) => error === first,
  );
  assert.equal(f.calls.filter(([name]) => name === 'application').length, 2);
  assert.ok(f.trace.some((line) => line.includes('second failure')));
  assert.ok(!f.quit());
});

for (const changed of [
  { terminated: true },
  { bundleIdentifier: 'other.app' },
  { launchDate: { timeIntervalSince1970: 5678 } },
  { executableURL: { path: '/other/Safari' } },
]) {
  test(`changed identity prevents constructor recovery: ${JSON.stringify(changed)}`, () => {
    const first = notFound();
    const f = fixture({}, undefined, {
      constructorFailures: [first],
      afterConstructor: (running) => Object.assign(running, changed),
    });
    assert.throws(
      () => f.execute(['42', '1234', 'quit']),
      (error) => error === first,
    );
    assert.equal(f.calls.filter(([name]) => name === 'application').length, 1);
    assert.ok(f.trace.some((line) => line.includes('Safari constructor recovery failure:')));
    assert.ok(!f.quit());
  });
}

test('identity replacement during a successful constructor is rejected before dispatch', () => {
  const f = fixture({}, undefined, {
    afterConstructor: (running) =>
      Object.assign(running, { launchDate: { timeIntervalSince1970: 5678 } }),
  });
  assert.throws(() => f.execute(['42', '1234', 'quit']), /PID has been reused/);
  assert.ok(!f.quit());
});

test('the host-observed executable is checked before resolving an application', () => {
  const f = fixture();
  assert.throws(
    () => f.execute(['42', '1234', 'quit', '', '5', '/different/Safari']),
    /executable changed/,
  );
  assert.ok(!f.calls.some(([name]) => name === 'application'));
});

const target = {
  pid: 42,
  bundleIdentifier: 'com.apple.Safari',
  launchedAt: 1234,
  executablePath: '/Applications/Safari.app/Contents/MacOS/Safari',
};

for (const failure of [
  new Error('identity changed'),
  Object.assign(new Error('denied'), { code: -1743 }),
  notFound(),
  Object.assign(new Error('host timeout'), { killed: true }),
])
  test(`value polling propagates ${failure.message} without a second native request`, async () => {
    let invocations = 0;
    await assert.rejects(
      waitForSafariValue(
        () =>
          requestSafari(target, 'evaluate', 'document.title', 8000, {}, async () => {
            invocations++;
            throw failure;
          }),
        Boolean,
      ),
      (error) => error === failure,
    );
    assert.equal(invocations, 1);
  });

test('readiness still polls successful values until the requested state arrives', async () => {
  let reads = 0;
  assert.equal(
    await waitForSafariValue(async () => (++reads === 1 ? '' : 'ready'), Boolean),
    'ready',
  );
  assert.equal(reads, 2);
});

test('normal consent can inspect one pending request and observe its eventual success', async () => {
  let resolve!: (value: string) => void;
  const entry: Record<string, unknown> = {};
  const observation = observeSafariTitle(
    new Promise<string>((done) => {
      resolve = done;
    }),
    entry,
  );
  assert.equal(observation.value(), undefined);
  assert.equal(entry.finishedAt, undefined);
  resolve('Spinel desktop profile probe');
  await observation.promise;
  assert.equal(observation.value(), 'Spinel desktop profile probe');
  assert.equal(typeof entry.finishedAt, 'string');
});

test('the consent-loop observation throws the original failed request before it can be renewed', async () => {
  const failure = Object.assign(new Error('denied after dispatch'), {
    stderr: 'action-dispatch-begin',
  });
  let invocations = 0;
  const entry: Record<string, unknown> = {};
  const observation = observeSafariTitle(
    requestSafari(target, 'title', '', 60000, {}, async () => {
      invocations++;
      throw failure;
    }),
    entry,
  );
  await observation.promise;
  assert.throws(
    () => observation.value(),
    (error) => error === failure,
  );
  assert.equal(invocations, 1);
  assert.equal((entry.error as { stderr: string }).stderr, failure.stderr);
});

test('a valid required baseline is retained before optional capture diagnostics', async () => {
  const f = fixture();
  const entry: Record<string, unknown> = {};
  const state = await readSafariBaseline(
    async () => f.execute(['42', '1234', 'baseline', '', '5']),
    entry,
  );
  assert.equal(state.title, 'Spinel desktop profile probe');
  assert.deepEqual(state.bounds, { x: 0, y: 25, width: 1280, height: 900 });
  assert.equal(entry.state, state);
});

for (const value of [
  'not json',
  '{}',
  JSON.stringify({ title: 'wrong', bounds: { x: 0, y: 0, width: 1, height: 1 } }),
  JSON.stringify({
    title: 'Spinel desktop profile probe',
    bounds: { x: 0, y: 0, width: 0, height: 1 },
  }),
])
  test(`invalid baseline cannot become passed evidence: ${value}`, async () => {
    const entry: Record<string, unknown> = {};
    await assert.rejects(readSafariBaseline(async () => value, entry));
    assert.equal(entry.state, undefined);
    assert.ok(entry.error);
  });

test('a post-dispatch baseline failure is fatal and preserves its cause without another request', async () => {
  const failure = notFound();
  const f = fixture({}, undefined, { actionFailure: failure });
  const entry: Record<string, unknown> = {};
  await assert.rejects(
    readSafariBaseline(async () => f.execute(['42', '1234', 'baseline', '', '5']), entry),
    (error) => error === failure,
  );
  assert.equal(f.calls.filter(([name]) => name === 'baseline-page').length, 1);
  assert.equal(entry.state, undefined);
  assert.ok(entry.error);
});
test('successful host request retains constructor trace and exact original timeout/target', async () => {
  const entry: Record<string, unknown> = {};
  const trace =
    'Safari constructor failure: {"attempt":1,"errorNumber":-2700}\nSafari request phase: {"phase":"action-dispatch-begin"}\n';
  let calls = 0;
  assert.equal(
    await requestSafari(
      target,
      'evaluate',
      'sentinel',
      8000,
      entry,
      async (_file, args, options) => {
        calls++;
        assert.equal(options.timeout, 8000);
        assert.deepEqual(args.slice(4), [
          '42',
          '1234',
          'evaluate',
          'sentinel',
          '8',
          target.executablePath,
        ]);
        return { stdout: 'retained\n', stderr: trace };
      },
    ),
    'retained',
  );
  assert.equal(calls, 1);
  assert.equal(entry.trace, trace);
  assert.equal(entry.status, 'passed');
  assert.equal(entry.target, target);
});

test('host timeout is never retried and preserves the first failure plus constructor trace', async () => {
  const entry: Record<string, unknown> = {};
  const failure = Object.assign(new Error('timeout'), {
    killed: true,
    signal: 'SIGTERM',
    stderr: 'application-constructor-second-begin',
  });
  let calls = 0;
  await assert.rejects(
    requestSafari(target, 'quit', '', 5000, entry, async (_file, _args, options) => {
      calls++;
      assert.equal(options.timeout, 5000);
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(calls, 1);
  assert.equal(entry.trace, failure.stderr);
  assert.equal(entry.status, 'failed');
});

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
  assert.deepEqual(f.calls, [...loadingCalls, ['application', 42], ['lookup', 42], ['quit']]);
  assert.ok(f.quit());
});

test('title preserves the PID and supplied Apple Event timeout after checked loading', () => {
  const f = fixture();
  assert.equal(f.execute(['42', '1234', 'title', '', '25']), f.page.title);
  assert.deepEqual(f.calls, [...loadingCalls, ['application', 42], ['lookup', 42], ['title', 25]]);
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
    ['lookup', 42],
    ['evaluate', 'localStorage.getItem("sentinel")', 8],
  ]);
});

test('baseline preserves native window, tab and page state after checked loading', () => {
  const f = fixture();
  assert.deepEqual(JSON.parse(f.execute(['42', '1234', 'baseline', '', '5'])), {
    windowId: 19,
    bounds: { x: 0, y: 25, width: 1280, height: 900 },
    tabIndex: 1,
    title: f.page.title,
    url: f.page.url,
    page: f.page,
  });
  assert.equal(f.window.miniaturized, false);
  assert.deepEqual(f.calls, [
    ...loadingCalls,
    ['application', 42],
    ['lookup', 42],
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
