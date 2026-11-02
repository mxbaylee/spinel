import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  analyzeSessionLog,
  collectSessionDiagnostics,
  diagnosticLimits,
  type SessionDiagnostics,
} from './browserstack-session-diagnostics.ts';

const sessionId = 'a'.repeat(40),
  sourceSha = 'b'.repeat(40),
  testedSha = 'c'.repeat(40);
const options = {
  sessionId,
  sourceSha,
  testedSha,
  username: 'fixture-user',
  accessKey: 'fixture-key',
  runId: '123',
  attempt: '2',
};
const stamp = '2026-11-02 04:01:12:345 - ';
const path = '/wd/hub/session/internal-session/execute/sync';
const command = 'POST session/{sessionId}/execute/sync';
const body = (error = 'unknown error', message = 'unknown error: tab crashed') => ({
  value: { error, message, stacktrace: 'private stack token=secret' },
});
function appiumFailure(payload: unknown = body(), wirePath = path, proxyPath = wirePath) {
  return [
    `${stamp}[HTTP] --> POST ${wirePath} ${JSON.stringify({ script: 'private script fixture-key /_desktop-login/token', args: [] })}`,
    `${stamp}[debug] [WD Proxy] Proxying [POST ${proxyPath}] to [POST http://127.0.0.1:9515${proxyPath}] with body: {"script":"unknown error: tab crashed"}`,
    `${stamp}[debug] [WD Proxy] Got response with status 500: ${JSON.stringify(payload)}`,
    `${stamp}[HTTP] <-- POST ${wirePath} 500 92 ms - 1000`,
  ].join('\n');
}
const unknownLog = appiumFailure(
  body('unknown error', 'an unrecognized private error fixture-key'),
);
const sessionFailure = [
  `2026-11-02 04:01:12:345 REQUEST [2026-11-02 04:01:12:345] POST /session/${sessionId}/execute/sync {"script":"private","args":[]}`,
  `2026-11-02 04:01:12:437 RESPONSE ${JSON.stringify({ status: 13, state: 'unknown error', ...body() })}`,
].join('\n');
const sessionLifecycle = [
  `2026-11-02 04:00:43:000 REQUEST [2026-11-02 04:00:43:000] POST /session {"private":"credentials"}`,
  '2026-11-02 04:00:43:001 START_SESSION',
  `2026-11-02 04:00:43:002 REQUEST [2026-11-02 04:00:43:002] GET /session/${sessionId}`,
  `2026-11-02 04:00:43:003 RESPONSE ${JSON.stringify({ status: 0, value: { browserVersion: '152.0.0.0', pageLoadStrategy: 'normal' } })}`,
  '',
].join('\n');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const privateValues =
  /fixture-user|fixture-key|private|secret|bootstrap|signed\.example|127\.0\.0\.1|"script"|stacktrace|Authorization/;

test('diagnostics require exact session and execution identities and credentials before any provider request', async () => {
  for (const changed of [
    { sessionId: undefined },
    { sessionId: 'https://signed.example/?token=secret' },
    { sessionId: 'a'.repeat(39) },
    { sourceSha: 'private' },
    { testedSha: undefined },
    { username: '' },
    { username: 'user:name' },
    { accessKey: 'key\nprivate' },
  ]) {
    let calls = 0;
    const writes: SessionDiagnostics[] = [];
    const report = await collectSessionDiagnostics({
      ...options,
      ...changed,
      fetcher: async () => {
        calls++;
        throw new Error('private request');
      },
      journal: async (value) => {
        writes.push(value);
      },
    });
    assert.equal(calls, 0);
    assert.equal(report.status, 'failed');
    assert.equal(report.stage, 'configuration');
    assert.equal(writes.length, 1);
    assert.equal(report.providerSessionsAllocated, 0);
    assert.doesNotMatch(JSON.stringify(report), privateValues);
  }
});

test('only a matching Appium failed response supplies a cause; request echoes and successful return values cannot', () => {
  const create = [
    `${stamp}[HTTP] --> POST /wd/hub/session {"private":"credentials"}`,
    `${stamp}[debug] [JSONWP Proxy] Proxying [POST /session] to [POST http://127.0.0.1:9515/session] with body: {}`,
    `${stamp}[debug] [JSONWP Proxy] Got response with status 200: ${JSON.stringify({
      value: {
        browserVersion: '152.0.0.0',
        chrome: { chromedriverVersion: '152.0.1.2 (private hash)' },
        pageLoadStrategy: 'normal',
        userDataDir: 'private path',
      },
    })}`,
    `${stamp}[HTTP] <-- POST /wd/hub/session 200 16000 ms - 2500`,
  ].join('\n');
  const message =
    'unknown error: unhandled inspector error: ' +
    JSON.stringify({ code: -32000, message: 'Cannot find context with specified id' });
  const analyzed = analyzeSessionLog(
    create + '\n' + appiumFailure(body('unknown error', message)),
    'appiumlogs',
  );
  assert.deepEqual(analyzed.failures, [
    {
      command,
      httpStatus: 500,
      webdriverError: 'unknown error',
      cause: 'execution-context-unavailable',
    },
  ]);
  assert.deepEqual(analyzed.browserVersions, ['152.0.0.0']);
  assert.deepEqual(analyzed.chromeDriverVersions, ['152.0.1.2']);
  assert.deepEqual(analyzed.pageLoadStrategies, ['normal']);
  assert.doesNotMatch(JSON.stringify(analyzed), privateValues);
  const echoed = appiumFailure()
    .replaceAll('status 500:', 'status 200:')
    .replace(' 500 92 ms', ' 200 92 ms');
  assert.deepEqual(analyzeSessionLog(echoed, 'appiumlogs').failures, []);
  assert.equal(
    analyzeSessionLog(appiumFailure(body(), path, '/session/internal-session/title'), 'appiumlogs')
      .failures[0].cause,
    'unclassified',
  );
  assert.equal(
    analyzeSessionLog(appiumFailure({ status: 0, ...body() }), 'appiumlogs').failures[0].cause,
    'unclassified',
  );
});

test('cause classification uses allowlisted protocol codes and anchored driver messages, never arbitrary echoed text', () => {
  for (const [code, message, expected] of [
    ['unknown error', 'unknown error: tab crashed\nprivate stack', 'renderer-crashed'],
    ['unknown error', 'unknown error: target frame detached', 'target-detached'],
    [
      'unknown error',
      'unknown error: disconnected: not connected to DevTools',
      'devtools-disconnected',
    ],
    ['unknown error', 'unknown error: net::ERR_CONNECTION_REFUSED', 'navigation-network-error'],
    ['unknown error', 'unknown error: net::ERR_CERT_AUTHORITY_INVALID', 'certificate-error'],
    [
      'session not created',
      'session not created: This version of ChromeDriver only supports Chrome version 151',
      'driver-version-mismatch',
    ],
    ['javascript error', 'tab crashed', 'javascript-exception'],
    ['unknown error', 'script returned "tab crashed"', 'unclassified'],
    [
      'unknown error',
      'unknown error: unhandled inspector error: malformed private',
      'unclassified',
    ],
    ['private error code', 'tab crashed', 'unclassified'],
  ]) {
    const result = analyzeSessionLog(appiumFailure(body(code, message)), 'appiumlogs');
    assert.equal(result.failures[0].cause, expected);
    assert.doesNotMatch(JSON.stringify(result), privateValues);
  }
});

test('stale, overlapping or differently logged proxy responses cannot supply the final failed command cause', () => {
  const lines = appiumFailure().split('\n');
  for (const middle of [
    [lines[1], lines[2], lines[1], lines[2].replace('status 500:', 'status 200:')],
    [
      lines[1],
      lines[2],
      lines[1],
      `${stamp}[debug] [WD Proxy] Got response with status 500: {truncated`,
    ],
    [lines[1], lines[1], lines[2]],
    [lines[1], lines[2].replace('[WD Proxy]', '[JSONWP Proxy]')],
  ]) {
    const result = analyzeSessionLog([lines[0], ...middle, lines[3]].join('\n'), 'appiumlogs');
    assert.deepEqual(result.failures, [
      { command, httpStatus: 500, webdriverError: null, cause: 'unclassified' },
    ]);
    assert.equal(result.ambiguousTransactions, 1);
  }
});

test('text logs require an explicit failed response state and all overlapping or malformed records remain unclassified', () => {
  const parsed = analyzeSessionLog(sessionLifecycle + sessionFailure, 'logs');
  assert.deepEqual(parsed.failures, [
    { command, httpStatus: null, webdriverError: 'unknown error', cause: 'renderer-crashed' },
  ]);
  assert.equal(parsed.ambiguousTransactions, 0);
  assert.equal(parsed.unfinishedTransactions, 0);
  assert.deepEqual(parsed.browserVersions, ['152.0.0.0']);
  for (const payload of [
    body(),
    { status: 0, ...body() },
    { status: 13, state: 'success', ...body() },
  ]) {
    const echo =
      sessionFailure.split('\n')[0] +
      '\n2026-11-02 04:01:12:437 RESPONSE ' +
      JSON.stringify(payload);
    assert.deepEqual(analyzeSessionLog(echo, 'logs').failures, []);
  }
  const overlapping = [
    sessionFailure.split('\n')[0],
    sessionFailure.split('\n')[0],
    sessionFailure.split('\n')[1],
    sessionFailure.split('\n')[1],
  ].join('\n');
  assert.deepEqual(analyzeSessionLog(overlapping, 'logs').failures, []);
  assert.equal(analyzeSessionLog(overlapping, 'logs').ambiguousTransactions, 1);
  const resetAttempt = [
    sessionFailure.split('\n')[0],
    '2026-11-02 04:01:12:346 START_SESSION',
    sessionFailure.split('\n')[0],
    sessionFailure.split('\n')[1],
  ].join('\n');
  assert.deepEqual(analyzeSessionLog(resetAttempt, 'logs').failures, []);
  assert.equal(analyzeSessionLog(resetAttempt, 'logs').unfinishedTransactions, 1);
  const unknownCommand = analyzeSessionLog(
    sessionFailure.replace('/execute/sync', '/unrecognized-command'),
    'logs',
  );
  assert.deepEqual(unknownCommand.failures, [
    { command: null, httpStatus: null, webdriverError: 'unknown error', cause: 'unclassified' },
  ]);
  const appium = appiumFailure().split('\n');
  const overlapAppium = [appium[0], appium[0], ...appium.slice(1), appium.at(-1)].join('\n');
  assert.deepEqual(analyzeSessionLog(overlapAppium, 'appiumlogs').failures, []);
  const malformed = analyzeSessionLog(
    sessionFailure.split('\n')[0] + '\n2026-11-02 04:01:12:437 RESPONSE {truncated private',
    'logs',
  );
  assert.equal(malformed.malformedRecords, 1);
  assert.deepEqual(malformed.failures, []);
  const failedMalformed = analyzeSessionLog(
    appiumFailure().replace(
      /Got response with status 500: .+/,
      'Got response with status 500: {truncated',
    ),
    'appiumlogs',
  );
  assert.deepEqual(failedMalformed.failures, [
    { command, httpStatus: 500, webdriverError: null, cause: 'unclassified' },
  ]);
  assert.equal(
    analyzeSessionLog('arbitrary private tab crashed text', 'logs').format,
    'unrecognized',
  );
});

test('completed-session collection journals before the fixed GET, keeps only digests and skips fallback when the cause is classified', async () => {
  const writes: SessionDiagnostics[] = [];
  let calls = 0;
  const log = appiumFailure();
  const report = await collectSessionDiagnostics({
    ...options,
    journal: async (value) => {
      writes.push(value);
    },
    fetcher: async (url, init) => {
      calls++;
      assert.equal(url, `https://api.browserstack.com/automate/sessions/${sessionId}/appiumlogs`);
      assert.equal(init?.method, 'GET');
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.body, undefined);
      assert.equal(
        new Headers(init?.headers).get('Authorization'),
        'Basic ' + Buffer.from('fixture-user:fixture-key').toString('base64'),
      );
      assert.equal(writes[0].status, 'failed');
      assert.equal(writes[0].failure, 'collection-incomplete');
      assert.equal(writes.at(-1)?.retrievals[0].status, 'pending');
      assert.ok(init?.signal);
      return new Response(log);
    },
  });
  assert.equal(calls, 1);
  assert.equal(report.status, 'available');
  assert.equal(report.diagnosis, 'classified');
  assert.deepEqual(report.execution, { sourceSha, testedSha, runId: '123', attempt: '2' });
  assert.deepEqual(report.target, { sessionId });
  assert.equal(report.retrievals[0].bytes, Buffer.byteLength(log));
  assert.equal(report.retrievals[0].sha256, hash(log));
  assert.equal(writes.at(-1)?.finishedAt, report.finishedAt);
  assert.equal(report.capabilityAcceptance, 'not-assessed');
  assert.doesNotMatch(JSON.stringify(report), privateValues);
});

test('unclassified complete text permits exactly one documented fallback and does not fabricate a capability pass', async () => {
  const classifiedFallback = sessionLifecycle + sessionFailure;
  for (const fallback of [classifiedFallback, 'unknown private format']) {
    const urls: string[] = [];
    const report = await collectSessionDiagnostics({
      ...options,
      runId: 'private',
      attempt: '0',
      fetcher: async (url, init) => {
        assert.equal(init?.method, 'GET');
        urls.push(String(url));
        return new Response(urls.length === 1 ? unknownLog : fallback);
      },
    });
    assert.deepEqual(
      urls,
      ['appiumlogs', 'logs'].map(
        (endpoint) => `https://api.browserstack.com/automate/sessions/${sessionId}/${endpoint}`,
      ),
    );
    assert.equal(report.status, 'available');
    assert.equal(
      report.diagnosis,
      fallback === classifiedFallback ? 'partially-classified' : 'unclassified',
    );
    assert.equal(report.execution.runId, null);
    assert.equal(report.execution.attempt, null);
    assert.equal(report.providerSessionsAllocated, 0);
    assert.doesNotMatch(JSON.stringify(report), privateValues);
  }
});

test('a malformed or unfinished later record requires fallback and prevents fully classified status even after a classified failure', async () => {
  const malformed = [
    `${stamp}[HTTP] --> GET /wd/hub/session/internal-session/title {}`,
    `${stamp}[debug] [WD Proxy] Proxying [GET /title] to [GET http://127.0.0.1:9515/title] with no body`,
    `${stamp}[debug] [WD Proxy] Got response with status 200: {truncated`,
    `${stamp}[HTTP] <-- GET /wd/hub/session/internal-session/title 200 20 ms - 100`,
  ].join('\n');
  for (const mode of ['malformed', 'unfinished']) {
    let calls = 0;
    const report = await collectSessionDiagnostics({
      ...options,
      fetcher: async () => {
        calls++;
        const tail = mode === 'malformed' ? malformed : malformed.split('\n')[0];
        return new Response(calls === 1 ? appiumFailure() + '\n' + tail : sessionFailure);
      },
    });
    assert.equal(calls, 2);
    assert.equal(report.status, 'available');
    assert.equal(report.retrievals[0].analysis?.malformedRecords, mode === 'malformed' ? 1 : 0);
    assert.equal(
      report.retrievals[0].analysis?.unfinishedTransactions,
      mode === 'unfinished' ? 1 : 0,
    );
    assert.equal(report.diagnosis, 'partially-classified');
  }
});

test('orphan and mismatched framed responses retain uncertainty and require fallback after an earlier classified failure', async () => {
  const mismatched = [
    `${stamp}[HTTP] --> GET /wd/hub/session/internal-session/title {}`,
    `${stamp}[HTTP] <-- GET /wd/hub/session/internal-session/source 500 20 ms - 100`,
  ].join('\n');
  const orphan = `${stamp}[HTTP] <-- GET /wd/hub/session/internal-session/source 500 20 ms - 100`;
  for (const tail of [mismatched, orphan]) {
    let calls = 0;
    const report = await collectSessionDiagnostics({
      ...options,
      fetcher: async () => {
        calls++;
        return new Response(calls === 1 ? appiumFailure() + '\n' + tail : sessionFailure);
      },
    });
    assert.equal(calls, 2);
    assert.equal(report.status, 'available');
    assert.equal(report.retrievals[0].analysis?.ambiguousTransactions, 1);
    assert.equal(report.diagnosis, 'partially-classified');
  }
  let calls = 0;
  const report = await collectSessionDiagnostics({
    ...options,
    fetcher: async () => {
      calls++;
      return new Response(
        calls === 1 ? unknownLog : sessionFailure + '\n' + sessionFailure.split('\n')[1],
      );
    },
  });
  assert.equal(calls, 2);
  assert.equal(report.status, 'available');
  assert.equal(report.retrievals[1].analysis?.ambiguousTransactions, 1);
  assert.equal(report.diagnosis, 'partially-classified');
});

test('denied, redirect, missing, empty, invalid UTF8 and oversized responses fail visibly without retries or fallback', async () => {
  const cases: [() => Response, string][] = [
    [() => new Response('private denial', { status: 401 }), 'http-401'],
    [() => new Response('private missing', { status: 404 }), 'http-404'],
    [
      () =>
        new Response('private redirect', {
          status: 302,
          headers: { location: 'https://signed.example/?token=secret' },
        }),
      'redirect-blocked',
    ],
    [() => new Response(null), 'response-empty'],
    [() => new Response(' \n'), 'response-empty'],
    [() => new Response(new Uint8Array([255])), 'response-invalid-encoding'],
    [
      () =>
        new Response('private', {
          headers: { 'content-length': String(diagnosticLimits.responseBytes + 1) },
        }),
      'response-too-large',
    ],
    [() => new Response(new Uint8Array(diagnosticLimits.responseBytes + 1)), 'response-too-large'],
  ];
  for (const [response, expected] of cases) {
    let calls = 0;
    const report = await collectSessionDiagnostics({
      ...options,
      fetcher: async () => {
        calls++;
        return response();
      },
    });
    assert.equal(calls, 1);
    assert.equal(report.status, 'failed');
    assert.equal(report.failure, expected);
    assert.equal(report.retrievals[0].status, 'failed');
    assert.equal(report.retrievals[0].sha256, null);
    assert.doesNotMatch(JSON.stringify(report), privateValues);
  }
});

test('the response byte limit is inclusive and retained failure records are bounded', async () => {
  const log = appiumFailure().padEnd(diagnosticLimits.responseBytes, ' ');
  const report = await collectSessionDiagnostics({
    ...options,
    fetcher: async () => new Response(log),
  });
  assert.equal(report.status, 'available');
  assert.equal(report.retrievals[0].bytes, diagnosticLimits.responseBytes);
  const parsed = analyzeSessionLog(
    Array.from({ length: 20 }, () => appiumFailure()).join('\n'),
    'appiumlogs',
  );
  assert.equal(parsed.failures.length, diagnosticLimits.retainedFailures);
  assert.equal(parsed.omittedFailures, 4);
});

async function microtasks() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
test('request deadlines cover stalled headers and bodies, abort the read and never retry', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  for (const mode of ['headers', 'body']) {
    let calls = 0,
      cancelled = false;
    let signal: AbortSignal | undefined;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const pending = collectSessionDiagnostics({
      ...options,
      fetcher: async (_url, init) => {
        calls++;
        signal = init?.signal ?? undefined;
        return mode === 'headers' ? new Promise<Response>(() => {}) : new Response(stream);
      },
    });
    await microtasks();
    assert.equal(calls, 1);
    if (mode === 'body') assert.equal(stream.locked, true);
    context.mock.timers.tick(diagnosticLimits.requestMilliseconds);
    const report = await pending;
    assert.equal(report.failure, 'request-timeout');
    assert.equal(report.status, 'failed');
    assert.equal(signal?.aborted, true);
    assert.equal(calls, 1);
    if (mode === 'body') assert.equal(cancelled, true);
  }
});

test('empty-chunk streams cannot starve the monotonic deadline and failed initial persistence prevents fetching', async (context) => {
  let clock = 0,
    pulls = 0,
    cancelled = false;
  context.mock.method(performance, 'now', () => clock);
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls++;
        clock += 1000;
        controller.enqueue(new Uint8Array());
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const report = await collectSessionDiagnostics({
    ...options,
    fetcher: async () => new Response(stream),
  });
  assert.equal(report.failure, 'request-timeout');
  assert.ok(pulls <= 8);
  assert.equal(cancelled, true);
  let calls = 0;
  const failed = await collectSessionDiagnostics({
    ...options,
    journal: async () => {
      throw new Error('private disk detail');
    },
    fetcher: async () => {
      calls++;
      return new Response(appiumFailure());
    },
  });
  assert.equal(failed.failure, 'journal-failed');
  assert.equal(calls, 0);
  assert.doesNotMatch(JSON.stringify(failed), privateValues);
});

test('the overall deadline includes a stalled initial journal and makes no provider request', async (context) => {
  let clock = 0,
    calls = 0;
  context.mock.method(performance, 'now', () => clock);
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = collectSessionDiagnostics({
    ...options,
    journal: async () => new Promise<void>(() => {}),
    fetcher: async () => {
      calls++;
      return new Response(appiumFailure());
    },
  });
  await microtasks();
  clock = diagnosticLimits.overallMilliseconds;
  context.mock.timers.tick(diagnosticLimits.overallMilliseconds);
  const report = await pending;
  assert.equal(report.failure, 'overall-timeout');
  assert.equal(calls, 0);
});
