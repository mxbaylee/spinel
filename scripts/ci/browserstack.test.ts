import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkSession,
  clientFor,
  targetsFromInventory,
  webdriverErrorCode,
} from './browserstack.ts';

test('selects physical phones, excludes beta/tablet/emulator entries, and supports unlisted Firefox', () => {
  assert.deepEqual(
    targetsFromInventory([
      { os: 'android', os_version: '16', device: 'Google Pixel 10', real_mobile: true },
      { os: 'android', os_version: '17 beta', device: 'Google Pixel 11', real_mobile: true },
      { os: 'android', os_version: '99', device: 'Google Pixel 99', real_mobile: false },
      { os: 'ios', os_version: '26', device: 'iPad Pro 13', real_mobile: true },
      { os: 'ios', os_version: '26', device: 'iPhone 17', browser: 'iphone', real_mobile: 'true' },
      { os: 'ios', os_version: '18', device: 'iPhone 16', browser: 'iphone', real_mobile: true },
    ]),
    [
      { browser: 'chrome', device: 'Google Pixel 10', osVersion: '16' },
      { browser: 'firefox', device: 'Google Pixel 10', osVersion: '16' },
      { browser: 'safari', device: 'iPhone 17', osVersion: '26' },
    ],
  );
  assert.throws(() => targetsFromInventory([]), /missing-mobile-targets/);
});

test('credentials stay in the HTTPS authorization header and remote error text is discarded', async () => {
  const client = clientFor('fixture-user', 'fixture-key', async (url, init) => {
    assert.equal(url, 'https://api.browserstack.com/automate/plan.json');
    assert.equal(
      new Headers(init?.headers).get('Authorization'),
      'Basic Zml4dHVyZS11c2VyOmZpeHR1cmUta2V5',
    );
    assert.equal(init?.redirect, 'error');
    return new Response('fixture-user fixture-key sensitive server error', { status: 401 });
  });
  await assert.rejects(client.api('plan.json'), { message: 'http-401' });
  assert.equal(
    client.redact('fixture-user fixture-key Zml4dHVyZS11c2VyOmZpeHR1cmUta2V5'),
    '[redacted] [redacted] [redacted]',
  );
  assert.throws(() => clientFor('', 'fixture-key'), /missing-credentials/);
});

test('WebDriver failures preserve HTTP class and only allowlisted protocol codes without replay or remote details', async () => {
  for (const [status, code, expected] of [
    [500, 'javascript error', 'javascript error'],
    [404, 'no such window', 'no such window'],
    [500, 'private arbitrary provider value', undefined],
    [200, 'javascript error', 'javascript error'],
  ] as const) {
    let calls = 0;
    const client = clientFor('fixture-user', 'fixture-key', async () => {
      calls++;
      return Response.json(
        {
          value: {
            error: code,
            message: 'private message fixture-key',
            stacktrace: 'private stack',
            data: { url: 'https://private.example/?token=secret' },
          },
        },
        { status },
      );
    });
    await assert.rejects(
      client.command('session/test-session/execute/sync', 'POST', { script: 'private script' }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, status === 200 ? 'webdriver-error' : `http-${status}`);
        assert.equal(webdriverErrorCode(error), expected);
        assert.doesNotMatch(JSON.stringify(error), /private|fixture-key|secret|stack|url|message/);
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});

test('WebDriver error diagnostics bound body bytes and discard malformed or oversized payloads', async () => {
  const payload = JSON.stringify({ value: { error: 'javascript error', message: 'private' } });
  for (const [body, expected] of [
    [payload.padEnd(8192, ' '), 'javascript error'],
    [payload.padEnd(8193, ' '), undefined],
    ['not JSON private details', undefined],
    ['{"value":null}', undefined],
    [null, undefined],
  ] as const) {
    const client = clientFor(
      'fixture-user',
      'fixture-key',
      async () => new Response(body, { status: 500 }),
    );
    await assert.rejects(
      client.command('session/test-session/execute/sync', 'POST'),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'http-500');
        assert.equal(webdriverErrorCode(error), expected);
        assert.doesNotMatch(JSON.stringify(error), /private/);
        return true;
      },
    );
  }
});

test(
  'a stalled error body is cancelled without replacing the original HTTP failure',
  { timeout: 2000 },
  async () => {
    let cancelled = false;
    const client = clientFor(
      'fixture-user',
      'fixture-key',
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { status: 500 },
        ),
    );
    await assert.rejects(
      client.command('session/test-session/execute/sync', 'POST'),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'http-500');
        assert.equal(webdriverErrorCode(error), undefined);
        return true;
      },
    );
    assert.equal(cancelled, true);
  },
);

test(
  'diagnostic stream acquisition, failures and empty chunks cannot replace or indefinitely postpone the HTTP failure',
  { timeout: 2000 },
  async () => {
    for (const mode of ['locked', 'errored', 'empty-chunks', 'cancel-failure']) {
      let cancelled = false;
      let pulls = 0;
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            if (mode === 'errored') controller.error(new Error('private stream failure'));
            if (mode === 'cancel-failure') controller.enqueue(new Uint8Array(8193));
          },
          pull(controller) {
            if (mode === 'empty-chunks') {
              pulls++;
              controller.enqueue(new Uint8Array());
            }
          },
          cancel() {
            cancelled = true;
            if (mode === 'cancel-failure') throw new Error('private cancellation failure');
          },
        }),
        { status: 500 },
      );
      const heldReader = mode === 'locked' ? response.body!.getReader() : undefined;
      try {
        const client = clientFor('fixture-user', 'fixture-key', async () => response);
        await assert.rejects(
          client.command('session/test-session/execute/sync', 'POST'),
          (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.equal(error.message, 'http-500');
            assert.equal(webdriverErrorCode(error), undefined);
            assert.doesNotMatch(JSON.stringify(error), /private/);
            return true;
          },
        );
        if (mode === 'empty-chunks') assert.ok(pulls > 0);
        if (mode === 'empty-chunks' || mode === 'cancel-failure') assert.equal(cancelled, true);
      } finally {
        heldReader?.releaseLock();
      }
    }
  },
);

test('a wrong runner challenge fails and still deletes the allocated session', async () => {
  const calls: string[] = [];
  const client = clientFor('fixture-user', 'fixture-key', async (url, init) => {
    calls.push(`${init?.method} ${String(url).split('/wd/hub/')[1]}`);
    const value = String(url).endsWith('/session')
      ? {
          sessionId: 'test-session',
          capabilities: { browserName: 'chrome', browserVersion: '145.0' },
        }
      : String(url).endsWith('/title')
        ? 'a different runner'
        : null;
    return Response.json({ value });
  });
  const result = await checkSession(
    client,
    { browser: 'chrome', device: 'Google Pixel 10', osVersion: '16' },
    'expected',
    'local-id',
    'fixture-build',
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.failure, 'tunnel-challenge-mismatch');
  assert.equal(result.tunnelReached, false);
  assert.equal(result.teardown, 'passed');
  assert.equal(calls.at(-1), 'DELETE session/test-session');
});

test('real-browser evidence is required and a teardown failure cannot produce a pass', async () => {
  for (const teardownFails of [false, true]) {
    const client = clientFor('fixture-user', 'fixture-key', async (url, init) => {
      if (init?.method === 'DELETE' && teardownFails)
        return new Response('sensitive', { status: 500 });
      const path = String(url).split('/wd/hub/')[1];
      if (path === 'session') {
        const payload = JSON.parse(String(init?.body));
        assert.equal(payload.capabilities.alwaysMatch['bstack:options'].realMobile, true);
        assert.equal(
          payload.capabilities.alwaysMatch['bstack:options'].localIdentifier,
          'local-id',
        );
        return Response.json({
          value: {
            sessionId: 'test-session',
            capabilities: { browserName: 'android', browserVersion: '145' },
          },
        });
      }
      const value = path.endsWith('/title')
        ? 'expected'
        : path.endsWith('/execute/sync')
          ? 'Mozilla/5.0 (Android 16) Gecko/145.0 Firefox/145.0'
          : null;
      return Response.json({ value });
    });
    const result = await checkSession(
      client,
      { browser: 'firefox', device: 'Google Pixel 10', osVersion: '16' },
      'expected',
      'local-id',
      'fixture-build',
    );
    assert.equal(result.tunnelReached, true);
    assert.equal(result.returnedBrowserName, 'android');
    assert.equal(result.status, teardownFails ? 'failed' : 'passed');
    assert.equal(result.teardown, teardownFails ? 'failed' : 'passed');
  }
});

test('session creation failures never echo the remote exception or claim cleanup', async () => {
  const client = clientFor('fixture-user', 'fixture-key', async () => {
    throw new Error('fixture-key in a remote exception');
  });
  const result = await checkSession(
    client,
    { browser: 'safari', device: 'iPhone 17', osVersion: '26' },
    'expected',
    'local-id',
    'fixture-build',
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.failure, 'request-failed');
  assert.equal(result.teardown, 'session-id-unavailable');
  assert.doesNotMatch(JSON.stringify(result), /fixture-key/);
});

test('malformed success responses and a different Android browser do not pass', async () => {
  const malformed = clientFor('fixture-user', 'fixture-key', async () => Response.json({}));
  await assert.rejects(malformed.command('session/test-session', 'DELETE'), {
    message: 'invalid-response-shape',
  });
  const client = clientFor('fixture-user', 'fixture-key', async (url) => {
    const path = String(url).split('/wd/hub/')[1];
    const value =
      path === 'session'
        ? { sessionId: 'test-session', capabilities: { browserName: 'chrome' } }
        : path.endsWith('/title')
          ? 'expected'
          : path.endsWith('/execute/sync')
            ? 'Mozilla/5.0 (Android 16) Chrome/145.0 SamsungBrowser/28.0'
            : null;
    return Response.json({ value });
  });
  const result = await checkSession(
    client,
    { browser: 'chrome', device: 'Google Pixel 10', osVersion: '16' },
    'expected',
    'local-id',
    'fixture-build',
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.failure, 'unexpected-browser');
  assert.equal(result.teardown, 'passed');
});
