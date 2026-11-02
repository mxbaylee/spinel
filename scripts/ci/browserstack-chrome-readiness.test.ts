import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  chromeReadinessFailureScript,
  observeChromeReadinessFailure,
} from './browserstack-chrome-readiness.ts';

const expectedItemURL = 'https://bs-local.com:8176/?item=private-item';
const privateText = 'private token=secret https://signed.example/_desktop-login/bootstrap';
const privateValues = /private|secret|signed\.example|desktop-login|bootstrap|stacktrace|"script"/;
const modern = 'chrome-error://chromewebdata/';
const legacy = 'data:text/html,chromewebdata';
const now = Date.parse('2026-11-02T18:00:00Z');

function page(url: unknown, text: unknown = null, selectorThrows = false) {
  let selectors = 0;
  let forbiddenAccesses = 0;
  const forbidden = new Proxy(
    {},
    {
      get() {
        forbiddenAccesses++;
        assert.fail('document observation must not access location, storage, navigator or network');
      },
      set() {
        forbiddenAccesses++;
        assert.fail('document observation must not mutate browser state');
      },
    },
  );
  const document = {
    URL: url,
    get body() {
      forbiddenAccesses++;
      assert.fail('document observation must not inspect arbitrary page text');
    },
    querySelector(selector: string) {
      selectors++;
      assert.equal(selector, '.error-code');
      if (selectorThrows) throw new Error(privateText);
      return text === null ? null : { textContent: text };
    },
  };
  return {
    execute(script = chromeReadinessFailureScript, args: unknown[] = [expectedItemURL]) {
      const value = runInNewContext(`(function(){${script}}).apply(null, args)`, {
        document,
        args,
        location: forbidden,
        localStorage: forbidden,
        sessionStorage: forbidden,
        indexedDB: forbidden,
        navigator: forbidden,
        fetch: () => {
          forbiddenAccesses++;
          assert.fail('document observation must not make network requests');
        },
      });
      assert.equal(forbiddenAccesses, 0);
      return value;
    },
    selectors: () => selectors,
  };
}

test('the actual script classifies exact document URLs without scanning app pages or returning private content', () => {
  for (const [url, expected, selectors] of [
    [expectedItemURL, 'expected-item', 0],
    [`${expectedItemURL}&token=secret`, 'other', 0],
    [`${expectedItemURL}#chrome-error://chromewebdata/`, 'other', 0],
    ['https://signed.example/?token=secret', 'other', 0],
    ['chrome-error://chromewebdata', 'other', 0],
    [`${modern}#private`, 'other', 0],
    [`${legacy},private`, 'other', 0],
    [modern, 'chrome-error:ERR_CONNECTION_REFUSED', 1],
    [legacy, 'legacy-chrome-error:ERR_CONNECTION_REFUSED', 1],
  ] as const) {
    const fixture = page(url, 'ERR_CONNECTION_REFUSED');
    const observed = fixture.execute();
    assert.equal(observed, expected);
    assert.equal(fixture.selectors(), selectors);
    assert.doesNotMatch(JSON.stringify(observed), privateValues);
  }
  for (const url of [undefined, null, 7, { toString: () => privateText }]) {
    const fixture = page(url, 'ERR_CONNECTION_REFUSED');
    assert.equal(fixture.execute(), null);
    assert.equal(fixture.selectors(), 0);
  }
});

test('the actual script returns only exact public allowlisted error text from an internal document', () => {
  for (const code of [
    'ERR_LOCAL_NETWORK_PERMISSION_MISSING',
    'ERR_CONNECTION_CLOSED',
    'ERR_CONNECTION_RESET',
    'ERR_CONNECTION_REFUSED',
    'ERR_NAME_NOT_RESOLVED',
    'ERR_INTERNET_DISCONNECTED',
    'ERR_SSL_PROTOCOL_ERROR',
    'ERR_TUNNEL_CONNECTION_FAILED',
    'ERR_CONNECTION_TIMED_OUT',
    'ERR_CERT_COMMON_NAME_INVALID',
    'ERR_CERT_DATE_INVALID',
    'ERR_CERT_AUTHORITY_INVALID',
  ]) {
    assert.equal(page(modern, code).execute(), `chrome-error:${code}`);
    assert.equal(page(legacy, code).execute(), `legacy-chrome-error:${code}`);
  }
  for (const text of [
    null,
    undefined,
    '',
    privateText,
    'ERR_PRIVATE_TOKEN',
    'DNS_PROBE_FINISHED_NXDOMAIN',
    'net::ERR_CONNECTION_REFUSED',
    ' ERR_CONNECTION_REFUSED',
    'ERR_CONNECTION_REFUSED\n',
    `ERR_CONNECTION_REFUSED ${privateText}`,
    '<div>ERR_CONNECTION_REFUSED</div>',
    { toString: () => assert.fail('error text must not be coerced') },
  ]) {
    assert.equal(page(modern, text).execute(), 'chrome-error');
    assert.equal(page(legacy, text).execute(), 'legacy-chrome-error');
  }
  assert.equal(page(modern, privateText, true).execute(), 'chrome-error');
});

test('one command runs the actual script and keeps only document and public code observations', async (context) => {
  context.mock.method(Date, 'now', () => now);
  context.mock.method(performance, 'now', () => 0);
  for (const [url, code, expectedDocument, expectedCode] of [
    [expectedItemURL, 'ERR_CONNECTION_REFUSED', 'expected-item', null],
    ['https://signed.example/?token=secret', 'ERR_CONNECTION_REFUSED', 'other', null],
    [modern, 'ERR_CERT_AUTHORITY_INVALID', 'chrome-error', 'ERR_CERT_AUTHORITY_INVALID'],
    [legacy, 'ERR_TUNNEL_CONNECTION_FAILED', 'legacy-chrome-error', 'ERR_TUNNEL_CONNECTION_FAILED'],
    [modern, privateText, 'chrome-error', null],
  ] as const) {
    let calls = 0;
    const fixture = page(url, code);
    const observed = await observeChromeReadinessFailure(
      async (script, args, timeout) => {
        calls++;
        assert.equal(script, chromeReadinessFailureScript);
        assert.deepEqual(args, [expectedItemURL]);
        assert.equal(timeout, 5_000);
        return fixture.execute(script, args);
      },
      { expectedItemURL, deadline: now + 180_000 },
    );
    assert.deepEqual(observed, {
      operation: 'chrome-readiness-document-observation',
      status: 'observed',
      commandAttempted: true,
      timeoutMilliseconds: 5_000,
      document: expectedDocument,
      errorCode: expectedCode,
      failure: null,
    });
    assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(observed), privateValues);
  }
});

test('malformed and echoed protocol responses cannot become observations or leak raw data', async (context) => {
  context.mock.method(Date, 'now', () => now);
  context.mock.method(performance, 'now', () => 0);
  for (const value of [
    null,
    undefined,
    true,
    7,
    [modern],
    { value: 'expected-item', stacktrace: privateText },
    { toString: () => assert.fail('response must not be coerced') },
    expectedItemURL,
    modern,
    legacy,
    'ERR_CONNECTION_REFUSED',
    'expected-item:ERR_CONNECTION_REFUSED',
    'other:ERR_CONNECTION_REFUSED',
    'chrome-error:ERR_PRIVATE_TOKEN',
    'chrome-error:ERR_CONNECTION_REFUSED\n',
    `chrome-error:ERR_CONNECTION_REFUSED ${privateText}`,
    `chrome-error:${'ERR_CONNECTION_REFUSED'.repeat(1000)}`,
    `private ${chromeReadinessFailureScript}`,
    'legacy-chrome-error:ERR_CONNECTION_REFUSED:ERR_CONNECTION_RESET',
  ]) {
    let calls = 0;
    const observed = await observeChromeReadinessFailure(
      async () => {
        calls++;
        return value;
      },
      { expectedItemURL, deadline: now + 180_000 },
    );
    assert.equal(observed.status, 'failed');
    assert.equal(observed.failure, 'invalid-response');
    assert.equal(observed.document, null);
    assert.equal(observed.errorCode, null);
    assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(observed), privateValues);
  }
});

test('invalid item inputs and elapsed deadlines dispatch no command', async (context) => {
  context.mock.method(Date, 'now', () => now);
  context.mock.method(performance, 'now', () => 0);
  for (const [url, deadline, failure] of [
    ['https://signed.example/?item=private', now + 1000, 'invalid-input'],
    ['https://bs-local.com:8176/_desktop-login/bootstrap', now + 1000, 'invalid-input'],
    [`${expectedItemURL}&token=secret`, now + 1000, 'invalid-input'],
    ['https://bs-local.com:8176/?item=', now + 1000, 'invalid-input'],
    [expectedItemURL, Number.NaN, 'invalid-input'],
    [expectedItemURL, Number.POSITIVE_INFINITY, 'invalid-input'],
    [expectedItemURL, now, 'deadline'],
    [expectedItemURL, now - 1, 'deadline'],
  ] as const) {
    const observed = await observeChromeReadinessFailure(
      async () => assert.fail('no command may run for an invalid or expired observation'),
      { expectedItemURL: url, deadline },
    );
    assert.equal(observed.status, 'not-attempted');
    assert.equal(observed.commandAttempted, false);
    assert.equal(observed.timeoutMilliseconds, 0);
    assert.equal(observed.failure, failure);
    assert.doesNotMatch(JSON.stringify(observed), privateValues);
  }
});

test('provider errors are suppressed into safe diagnostics without retry or raw error inspection', async (context) => {
  context.mock.method(Date, 'now', () => now);
  context.mock.method(performance, 'now', () => 0);
  for (const error of [
    new Error(privateText),
    privateText,
    {
      get message() {
        assert.fail('raw provider errors must not be inspected');
      },
    },
  ]) {
    for (const mode of ['synchronous', 'rejected-promise']) {
      let calls = 0;
      const observed = await observeChromeReadinessFailure(
        () => {
          calls++;
          if (mode === 'synchronous') throw error;
          return Promise.reject(error);
        },
        { expectedItemURL, deadline: now + 1000 },
      );
      assert.equal(observed.status, 'failed');
      assert.equal(observed.failure, 'command-failed');
      assert.equal(observed.commandAttempted, true);
      assert.equal(observed.timeoutMilliseconds, 1000);
      assert.equal(observed.document, null);
      assert.equal(observed.errorCode, null);
      assert.equal(calls, 1);
      assert.doesNotMatch(JSON.stringify(observed), privateValues);
    }
  }
});

test('client and lane deadlines bound stalled commands once and ignore a late response', async (context) => {
  context.mock.method(Date, 'now', () => now);
  context.mock.method(performance, 'now', () => 0);
  context.mock.timers.enable({ apis: ['setTimeout'] });
  for (const allowance of [5_000, 137]) {
    let calls = 0;
    let settle: (value: unknown) => void = () => assert.fail('command must have started');
    const pending = observeChromeReadinessFailure(
      (_script, _args, timeout) => {
        calls++;
        assert.equal(timeout, allowance);
        return new Promise((resolve) => {
          settle = resolve;
        });
      },
      { expectedItemURL, deadline: now + (allowance === 5_000 ? 180_000 : allowance) },
    );
    await Promise.resolve();
    assert.equal(calls, 1);
    context.mock.timers.tick(allowance);
    const observed = await pending;
    assert.equal(observed.status, 'failed');
    assert.equal(observed.failure, 'deadline');
    assert.equal(observed.commandAttempted, true);
    assert.equal(observed.document, null);
    const retained = JSON.stringify(observed);
    settle(`chrome-error:ERR_CONNECTION_REFUSED ${privateText}`);
    await Promise.resolve();
    assert.equal(JSON.stringify(observed), retained);
    assert.equal(calls, 1);
    assert.doesNotMatch(retained, privateValues);
  }
});

test('deadline changes before dispatch or before response prevent a late observation', async (context) => {
  let wall = now;
  let monotonic = 0;
  context.mock.method(Date, 'now', () => wall);
  context.mock.method(performance, 'now', () => monotonic);
  const expiredBeforeDispatch = observeChromeReadinessFailure(
    async () => assert.fail('an expired lane must not dispatch the diagnostic'),
    { expectedItemURL, deadline: now + 100 },
  );
  wall = now + 100;
  const notAttempted = await expiredBeforeDispatch;
  assert.equal(notAttempted.commandAttempted, false);
  assert.equal(notAttempted.status, 'not-attempted');
  assert.equal(notAttempted.failure, 'deadline');
  assert.equal(notAttempted.timeoutMilliseconds, 0);

  for (const mode of ['wall', 'monotonic']) {
    wall = now;
    monotonic = 0;
    let calls = 0;
    const observed = await observeChromeReadinessFailure(
      async () => {
        calls++;
        if (mode === 'wall') wall = now + 100;
        else {
          wall = now - 1000;
          monotonic = 100;
        }
        return 'expected-item';
      },
      { expectedItemURL, deadline: now + 100 },
    );
    assert.equal(observed.status, 'failed');
    assert.equal(observed.failure, 'deadline');
    assert.equal(observed.document, null);
    assert.equal(calls, 1);
  }
});
