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
const terminal =
  'Encountered internal error running command: UnknownError: An unknown server-side error occurred while processing the command. Original error: unknown error: Cannot find context with specified id';
const terminalLine = (logger = 'W3C (internal)', message = terminal) =>
  `${stamp}[debug] [${logger}] ${message}`;
function terminalFailure(logger = 'W3C (internal)', association?: string) {
  const lines = appiumFailure().split('\n');
  return [
    lines[0],
    ...(association
      ? [
          `${stamp}[debug] [${association}] Calling AppiumDriver.execute() with args: ["private script"]`,
        ]
      : []),
    lines[1],
    `${stamp}[debug] [WD Proxy] Got response with status 500: {truncated private`,
    terminalLine(logger),
    lines[3],
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
      source: 'proxy-response',
      errorClass: null,
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

test('Chromium function and result failures are classified only from correlated source-anchored errors', () => {
  const messages = [
    [
      'Runtime.callFunctionOn threw exception: TypeError: private fixture-key',
      'driver-function-exception',
    ],
    [
      'result.deepSerializedValue.value list is missing or empty in Runtime.callFunctionOn response',
      'driver-result-deserialization-failed',
    ],
    [
      'first element in result.deepSerializedValue.value list must be a dictionary',
      'driver-result-deserialization-failed',
    ],
    [
      'first element in result.deepSerializedValue.value list must contain a string',
      'driver-result-deserialization-failed',
    ],
    [
      'cannot deserialize the result value received from Runtime.callFunctionOn',
      'driver-result-deserialization-failed',
    ],
    [
      'deserialized Runtime.callFunctionOn result is not a dictionary',
      'driver-result-deserialization-failed',
    ],
    ["call function result missing int 'status'", 'driver-result-deserialization-failed'],
  ];
  for (const [message, expected] of messages) {
    const logs = [
      appiumFailure(body('unknown error', `unknown error: ${message}\nprivate stack`)),
      terminalFailure().replace(
        terminal,
        `Encountered internal error running command: UnknownError: unknown error: ${message}`,
      ),
    ];
    for (const log of logs) {
      const result = analyzeSessionLog(log, 'appiumlogs');
      assert.equal(result.failures[0].cause, expected);
      assert.equal(result.failures[0].command, command);
      assert.doesNotMatch(JSON.stringify(result), privateValues);
    }
    for (const [code, unrelated] of [
      ['no such frame', message],
      ['unknown error', `script returned "${message}"`],
      ['unknown error', `unrecognized private failure\n${message}`],
      ['unknown error', `unhandled inspector error: ${JSON.stringify({ code: -32000, message })}`],
      ...(expected === 'driver-result-deserialization-failed'
        ? [['unknown error', `${message} private suffix`]]
        : [['unknown error', 'Runtime.callFunctionOn threw exception: ']]),
    ]) {
      const result = analyzeSessionLog(appiumFailure(body(code, unrelated)), 'appiumlogs');
      assert.equal(result.failures[0].cause, 'unclassified');
      assert.doesNotMatch(JSON.stringify(result), privateValues);
    }
  }

  const message = messages[0][0];
  const lines = appiumFailure(body('unknown error', message)).split('\n');
  // A script echo and a successful returned object can contain the same text.
  // Neither is a driver error; a foreign command's failed result is unrelated.
  const echoed = [
    lines[0],
    `${stamp}[debug] [WD Proxy] Proxying [POST ${path}] to [POST http://127.0.0.1:9515${path}] with body: ${JSON.stringify({ script: message })}`,
    lines[2].replace('status 500:', 'status 200:'),
    lines[3].replace('500 92 ms', '200 92 ms'),
  ].join('\n');
  assert.deepEqual(analyzeSessionLog(echoed, 'appiumlogs').failures, []);
  assert.equal(
    analyzeSessionLog(
      appiumFailure(body('unknown error', message), path, '/session/internal-session/title'),
      'appiumlogs',
    ).failures[0].cause,
    'unclassified',
  );
});

test('one session-bound terminal error can classify execute HTTP500 while retaining malformed proxy evidence', () => {
  for (const log of [
    terminalFailure(),
    terminalFailure('AndroidUiautomator2Driver@a1b2', 'AndroidUiautomator2Driver@a1b2'),
  ]) {
    const result = analyzeSessionLog(log, 'appiumlogs');
    assert.deepEqual(result.failures, [
      {
        command,
        httpStatus: 500,
        webdriverError: 'unknown error',
        cause: 'execution-context-unavailable',
        source: 'terminal-error',
        errorClass: 'UnknownError',
      },
    ]);
    assert.equal(result.malformedRecords, 1);
    assert.equal(result.terminalRecords, 1);
    assert.equal(result.rejectedTerminalRecords, 0);
    assert.equal(result.ambiguousTransactions, 0);
    assert.doesNotMatch(JSON.stringify(result), privateValues);
  }
});

test('terminal evidence rejects echoes, foreign or unassociated loggers, duplicates, stale records and incompatible completions', () => {
  const lines = appiumFailure().split('\n');
  const direct = (middle: string[]) => [lines[0], ...middle, lines[3]].join('\n');
  const positive = direct([terminalLine()]);
  const negative = [
    direct([
      `${stamp}[debug] [WD Proxy] Proxying [POST ${path}] to [POST http://127.0.0.1:9515${path}] with body: ${JSON.stringify({ script: terminalLine() })}`,
    ]),
    direct([terminalLine('W3C (foreign1)')]),
    direct([terminalLine('W3C')]),
    direct([terminalLine('AndroidUiautomator2Driver@a1b2')]),
    terminalFailure('AndroidUiautomator2Driver@a1b2', 'AndroidUiautomator2Driver@c3d4'),
    terminalFailure('AndroidUiautomator2Driver@a1b2', 'AndroidUiautomator2Driver@a1b2').replace(
      '.execute()',
      '.getTitle()',
    ),
    direct([terminalLine(), terminalLine()]),
    direct([terminalLine(), lines[1], lines[2]]),
    direct([lines[1], lines[2], terminalLine()]),
    positive.replaceAll('/execute/sync', '/title'),
    positive.replaceAll('/execute/sync', '/unrecognized-command'),
    positive.replace('500 92 ms', '405 92 ms'),
    positive.replace('500 92 ms', '200 92 ms') + '\n' + [lines[0], lines[3]].join('\n'),
    [terminalLine(), lines[0], lines[3]].join('\n'),
    direct([
      terminalLine(
        'W3C (internal)',
        'Encountered internal error running command: TypeError: tab crashed',
      ),
    ]),
    direct([
      terminalLine(
        'W3C (internal)',
        'Encountered internal error running command: UnknownError: private text Original error: tab crashed',
      ),
    ]),
    direct([
      terminalLine(
        'W3C (internal)',
        'Encountered internal error running command: UnknownError: tab crashed ' + 'x'.repeat(8192),
      ),
    ]),
  ];
  for (const log of negative) {
    const result = analyzeSessionLog(log, 'appiumlogs');
    assert.ok(result.failures.every((failure) => failure.cause === 'unclassified'));
    assert.doesNotMatch(JSON.stringify(result), privateValues);
  }
  const mismatch = analyzeSessionLog(
    [lines[0], terminalLine(), lines[3].replace('/execute/sync', '/source')].join('\n'),
    'appiumlogs',
  );
  assert.deepEqual(mismatch.failures, []);
  assert.equal(mismatch.ambiguousTransactions, 1);
  const duplicate = analyzeSessionLog(direct([terminalLine(), terminalLine()]), 'appiumlogs');
  assert.equal(duplicate.terminalRecords, 2);
  assert.equal(duplicate.ambiguousTransactions, 1);
  const current = analyzeSessionLog(
    direct([
      `${stamp}[debug] [AndroidUiautomator2Driver@a1b2] Calling AppiumDriver.execute() with args: []`,
      terminalLine(
        'AndroidUiautomator2Driver@a1b2',
        'Encountered internal error running command: UnknownError: unknown error: tab crashed\nprivate stack',
      ),
    ]),
    'appiumlogs',
  );
  assert.equal(current.failures[0].cause, 'renderer-crashed');
  assert.equal(current.failures[0].source, 'terminal-error');
  assert.doesNotMatch(JSON.stringify(current), privateValues);
});

test('terminal classification preserves unknown405 and malformed evidence and still retrieves the fallback', async () => {
  const lines = appiumFailure().split('\n');
  const rejected = [lines[0], lines[3].replace('500 92 ms', '405 92 ms')].join('\n');
  let calls = 0;
  const report = await collectSessionDiagnostics({
    ...options,
    fetcher: async () => {
      calls++;
      return new Response(
        calls === 1 ? rejected + '\n' + terminalFailure() : 'private unknown text',
      );
    },
  });
  assert.equal(calls, 2);
  assert.equal(report.status, 'available');
  assert.equal(report.diagnosis, 'partially-classified');
  assert.equal(report.retrievals[0].analysis?.malformedRecords, 1);
  assert.deepEqual(
    report.retrievals[0].analysis?.failures.map((failure) => [
      failure.httpStatus,
      failure.source,
      failure.cause,
    ]),
    [
      [405, 'unclassified', 'unclassified'],
      [500, 'terminal-error', 'execution-context-unavailable'],
    ],
  );
  assert.equal(report.providerSessionsAllocated, 0);
  assert.doesNotMatch(JSON.stringify(report), privateValues);
});

test('response structure retains only MIME and shape enums, counts and BOM without private headers, keys or values', async () => {
  for (const [text, contentType, expectedShape, expectedMime, newlineStyle] of [
    [sessionFailure, 'text/plain; token=private', 'line-text', 'plain-text', 'lf'],
    [
      JSON.stringify(sessionFailure),
      'application/json; token=secret',
      'json-string',
      'json',
      'none',
    ],
    [
      JSON.stringify({ privateKey: 'fixture-key', logs: sessionFailure }),
      'application/json',
      'json-object',
      'json',
      'none',
    ],
    [
      JSON.stringify([{ privateKey: 'fixture-key' }]),
      'application/json',
      'json-array',
      'json',
      'none',
    ],
    ['true', 'application/json', 'json-primitive', 'json', 'none'],
    [
      '<!doctype html><html><body>fixture-key</body></html>',
      'text/html; private=secret',
      'html',
      'html',
      'none',
    ],
    [
      '\ufeffprivate unknown text\r\nprivate',
      'private/type; secret=value',
      'line-text',
      'other',
      'crlf',
    ],
    ['private\rprivate', 'text/plain', 'line-text', 'plain-text', 'cr'],
    ['private\r\nprivate\nprivate', 'text/plain', 'line-text', 'plain-text', 'mixed'],
  ]) {
    const report = await collectSessionDiagnostics({
      ...options,
      fetcher: async () => new Response(text, { headers: { 'content-type': contentType } }),
    });
    assert.equal(report.retrievals.length, 2);
    const structure = report.retrievals[1].structure!;
    assert.equal(structure.bodyShape, expectedShape);
    assert.equal(structure.mime, expectedMime);
    assert.equal(structure.lineCount, text.split(/\r\n|\r|\n/).length);
    assert.equal(structure.bom, text.charCodeAt(0) === 0xfeff);
    assert.equal(structure.newlineStyle, newlineStyle);
    if (expectedShape === 'json-string') {
      assert.equal(structure.decodedString?.counts.request, 1);
      assert.equal(structure.decodedString?.counts.response, 1);
      assert.equal(report.retrievals[1].analysis?.recognizedRequests, 0);
    }
    assert.doesNotMatch(JSON.stringify(report), privateValues);
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
      {
        command,
        httpStatus: 500,
        webdriverError: null,
        cause: 'unclassified',
        source: 'unclassified',
        errorClass: null,
      },
    ]);
    assert.equal(result.ambiguousTransactions, 1);
  }
});

test('text logs require an explicit failed response state and all overlapping or malformed records remain unclassified', () => {
  const parsed = analyzeSessionLog(sessionLifecycle + sessionFailure, 'logs');
  assert.deepEqual(parsed.failures, [
    {
      command,
      httpStatus: null,
      webdriverError: 'unknown error',
      cause: 'renderer-crashed',
      source: 'session-response',
      errorClass: null,
    },
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
    {
      command: null,
      httpStatus: null,
      webdriverError: 'unknown error',
      cause: 'unclassified',
      source: 'session-response',
      errorClass: null,
    },
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
    {
      command,
      httpStatus: 500,
      webdriverError: null,
      cause: 'unclassified',
      source: 'unclassified',
      errorClass: null,
    },
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

test('a fulfilled final journal cannot report available diagnostics after the overall deadline', async (context) => {
  let clock = 0,
    calls = 0,
    finalWrites = 0;
  let finalSnapshot: SessionDiagnostics | undefined;
  context.mock.method(performance, 'now', () => clock);
  const report = await collectSessionDiagnostics({
    ...options,
    journal: async (value) => {
      if (value.stage === 'finished') {
        finalWrites++;
        finalSnapshot = value;
        clock = diagnosticLimits.overallMilliseconds + 1;
      }
    },
    fetcher: async () => {
      calls++;
      return new Response(appiumFailure());
    },
  });
  assert.equal(report.status, 'failed');
  assert.equal(report.failure, 'overall-timeout');
  assert.equal(report.stage, 'finished');
  assert.equal(report.providerSessionsAllocated, 0);
  assert.equal(calls, 1);
  assert.equal(finalWrites, 1);
  assert.equal(report.retrievals[0]?.status, 'available');
  assert.equal(finalSnapshot?.status, 'available');
  assert.equal(finalSnapshot?.capabilityAcceptance, 'not-assessed');
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
