import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boundedClock, boundedJson, ControlError } from './browserstack-bounded-http.ts';
import { capabilityLimits, runIphoneCapability } from './browserstack-capability.ts';

type Options = Parameters<typeof runIphoneCapability>[0];
const sessionId = 'c'.repeat(40);
const origin = 'https://spinel-synthetic-test.trycloudflare.com';

test('a backward wall clock cannot renew elapsed cleanup or publication budgets', () => {
  let wall = 10000;
  let steady = 200;
  const now = boundedClock(
    () => wall,
    () => steady,
  );
  assert.equal(now(), 10000);
  wall = 5000;
  steady += 180000;
  assert.equal(now(), 190000);
  wall = 300000;
  assert.equal(now(), 300000);
  wall = 1000;
  steady += 5;
  assert.equal(now(), 300005);
  const deadline = now() + 30000;
  steady += 30000;
  assert.equal(now(), deadline);
});
function fixture() {
  let clock = Date.parse('2026-10-30T04:00:00Z');
  const startedAt = clock;
  const trace: string[] = [];
  const calls: { url: string; method: string; body: Record<string, unknown>; aborted: boolean }[] =
    [];
  const controller = new AbortController();
  const behavior = {
    lostCreate: false,
    refuseReservation: false,
    abortOffline: false,
    afterRetainMs: 0,
    terminalStatus: 'done' as unknown,
    rejectDeletion: false,
    targetEvidence: {
      deviceName: 'iPhone 16',
      platformName: 'iOS',
      platformVersion: '18.0',
      realMobile: true,
    } as Record<string, unknown>,
  };
  let offline = false;
  let installed = false;
  let activeCalls = 0;
  let element = 0;
  const elements = new Map<string, string>();
  const fetcher: typeof fetch = async (url, init) => {
    const address = String(url);
    const method = init?.method ?? 'GET';
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ url: address, method, body, aborted: init?.signal?.aborted ?? false });
    trace.push(method + ' ' + new URL(address).pathname);
    if (address.endsWith('/wd/hub/session')) {
      assert.equal(trace[0], 'verified-preview');
      assert.equal(trace[1], 'durable-reservation');
      if (behavior.lostCreate) throw new Error('private-provider-secret');
      return Response.json({
        value: {
          sessionId,
          capabilities: {
            browserName: 'safari',
            acceptInsecureCerts: false,
            ...behavior.targetEvidence,
          },
        },
      });
    }
    if (address.endsWith('/update_network.json')) {
      offline = body.networkProfile === 'no-network';
      if (offline && behavior.abortOffline) controller.abort();
      return Response.json({ success: true });
    }
    if (address.endsWith(`/${sessionId}.json`))
      return Response.json({
        automation_session: {
          hashed_id: sessionId,
          browserstack_status: behavior.terminalStatus,
          duration: 22,
          name: 'private-provider-name',
          logs: 'private-provider-url',
        },
      });
    if (method === 'DELETE')
      return Response.json({
        value: behavior.rejectDeletion
          ? { error: 'unknown error', message: 'private-provider-secret' }
          : null,
      });
    const path = address.split(`${sessionId}/`)[1];
    let value: unknown = null;
    if (path === 'contexts') value = ['NATIVE_APP', 'WEBVIEW_1'];
    if (path === 'element') {
      const id = String(++element);
      elements.set(id, body.value as string);
      value = { 'element-6066-11e4-a52e-4f735466cecf': id };
    }
    if (
      path?.startsWith('element/') &&
      path.endsWith('/click') &&
      elements.get(path.split('/')[1]) === 'Spinel'
    )
      installed = true;
    if (path === 'execute/sync' || path === 'execute/async') {
      if (body.script === 'mobile: activeAppInfo') {
        activeCalls++;
        value =
          activeCalls === 1
            ? { bundleId: 'com.apple.mobilesafari', pid: 9 }
            : { bundleId: 'com.apple.webapp.fixture', pid: activeCalls === 2 ? 11 : 22 };
      } else if (body.script === 'mobile: terminateApp') value = true;
      else if (body.script === 'mobile: queryAppState') value = 1;
      else if (body.script === 'test-only-network-state') value = !offline;
      else if (typeof body.script === 'string' && body.script.startsWith('return {origin:'))
        value = { origin, secure: true, standalone: installed, worker: true };
    }
    return Response.json({ value });
  };
  const options: Options = {
    run: 'https://github.com/mxbaylee/spinel/actions/runs/41000000000',
    attempt: 1,
    sourceSha: 'a'.repeat(40),
    testedSha: 'b'.repeat(40),
    quotaEvidence: new Uint8Array(), // Fake custody adapter; real evidence admission is tested separately.
    username: 'private-user',
    accessKey: 'private-access-key',
    target: { device: 'iPhone 16', osVersion: '18' },
    signal: controller.signal,
    now: () => clock,
    fetcher,
    ledger: (signal, deadline) => ({
      async reserve(input) {
        assert.equal(signal.aborted, false);
        assert(clock < deadline);
        assert.equal(input.reservedSeconds, 180);
        if (behavior.refuseReservation) throw new ControlError('ledger-publication-unconfirmed');
        trace.push('durable-reservation');
        return {
          reservationId: '12345678-1234-4123-8123-123456789abc',
          run: input.run,
          attempt: input.attempt,
        };
      },
      async retainUncertainty(_identity, knownId) {
        assert.equal(signal.aborted, false);
        assert(clock < deadline);
        if (knownId) assert.equal(knownId, sessionId);
        trace.push('retained-session-identity');
        if (behavior.afterRetainMs) {
          clock = startedAt + behavior.afterRetainMs;
          behavior.afterRetainMs = 0;
        }
      },
    }),
    preview: {
      origin,
      async verify() {
        trace.push('verified-preview');
      },
      // These deterministic transport callbacks are not provider/auth evidence.
      async authenticateAndPrepare() {
        return {
          accountId: '11111111-1111-4111-8111-111111111111',
          authentication: 'platform-passkey',
          preparedDocId: '22222222-2222-4222-8222-222222222222',
          preparedSheetId: '33333333-3333-4333-8333-333333333333',
          imageSha256: 'd'.repeat(64),
        };
      },
      async verifyOffline(driver) {
        assert.equal(
          await driver.command('execute/async', 'POST', {
            script: 'test-only-network-state',
            args: [],
          }),
          false,
        );
      },
      async verifyReconnected(driver) {
        assert.equal(
          await driver.command('execute/async', 'POST', {
            script: 'test-only-network-state',
            args: [],
          }),
          true,
        );
      },
    },
  };
  return { options, behavior, calls, trace, controller };
}

test('one bounded session follows durable reservation, install, process replacement, network restoration and confirmed terminal evidence', async () => {
  const f = fixture();
  const result = await runIphoneCapability(f.options);
  assert.equal(result.status, 'capability-observed');
  assert.equal(result.fullOfflineAcceptance, false);
  assert.deepEqual(result.actualTarget, {
    browser: 'safari',
    device: 'iPhone 16',
    os: 'iOS',
    osVersion: '18.0',
    realMobile: true,
    evidence: 'new-session-capabilities',
  });
  assert(Object.values(result.checks).every(Boolean));
  assert.equal(result.cleanup.network, 'restored-and-reachability-verified');
  assert.equal(result.cleanup.deletion, 'request-accepted');
  assert.equal(result.cleanup.terminal, 'confirmed');
  assert.equal(result.cleanup.reservation, 'unsettled');
  assert.equal(result.terminalDurationSeconds, 22);
  assert(result.commandAttempts <= capabilityLimits.commandCount);
  assert(result.cleanupAttempts <= capabilityLimits.cleanupRequests);
  assert.equal(f.calls.filter(({ url }) => url.endsWith('/wd/hub/session')).length, 1);
  assert(!JSON.stringify(result).includes('private-'));
});

test('unproved preview or ambiguous reservation publication cannot dispatch a device allocation', async () => {
  const f = fixture();
  f.options.preview.verify = async () => {
    throw new ControlError('capability-preview-unproved');
  };
  await assert.rejects(runIphoneCapability(f.options), /capability-preview-unproved/);
  assert.equal(f.calls.length, 0);
  const ambiguous = fixture();
  ambiguous.behavior.refuseReservation = true;
  await assert.rejects(runIphoneCapability(ambiguous.options), /ledger-publication-unconfirmed/);
  assert.equal(ambiguous.calls.length, 0);
});

test('unknown or contradictory actual device evidence stops before installed-context actions', async () => {
  for (const invalid of [
    {},
    { deviceName: 'iPhone 15' },
    { platformVersion: '17' },
    { realMobile: false },
    { realMobile: undefined },
    { isSimulator: true },
    { isSimulator: 'true' },
    { simulator: 'true' },
    { 'appium:isSimulator': 'true' },
    { isSimulator: 'unknown' },
  ]) {
    const f = fixture();
    f.behavior.targetEvidence = Object.keys(invalid).length
      ? { ...f.behavior.targetEvidence, ...invalid }
      : {};
    const result = await runIphoneCapability(f.options);
    assert.equal(result.actualTarget, null);
    assert.equal(result.status, 'capability-incomplete');
    assert.equal(result.failure, 'capability-target-unproved');
    assert.equal(result.checks.nativeContext, false);
    assert.equal(
      f.calls.some(({ url }) => url.endsWith('/url')),
      false,
    );
    assert.equal(result.cleanup.terminal, 'confirmed');
    assert(f.trace.includes('retained-session-identity'));
  }
});

test('lost create identity remains uncertain and is never retried or replaced', async () => {
  const f = fixture();
  f.behavior.lostCreate = true;
  const result = await runIphoneCapability(f.options);
  assert.equal(result.status, 'capability-incomplete');
  assert.equal(result.sessionId, null);
  assert.equal(result.cleanup.deletion, 'session-id-unavailable');
  assert.equal(result.cleanup.reservation, 'unsettled');
  assert.equal(f.calls.length, 1);
  assert(!JSON.stringify(result).includes('private-'));
});

test('caller abort after network-disable dispatch still restores network and deletes using an independent signal', async () => {
  const f = fixture();
  f.behavior.abortOffline = true;
  const result = await runIphoneCapability(f.options);
  assert.equal(f.controller.signal.aborted, true);
  assert.equal(result.status, 'capability-incomplete');
  assert.equal(result.cleanup.network, 'restored-and-reachability-verified');
  assert.equal(result.cleanup.terminal, 'confirmed');
  const restoration = f.calls.find(({ body }) => body.networkProfile === '4g-lte-good');
  assert(restoration);
  assert.equal(restoration.aborted, false);
  assert.equal(f.calls.find(({ method }) => method === 'DELETE')?.aborted, false);
});

test('no action starts when its entire bound would overrun the 135-second action deadline', async () => {
  const f = fixture();
  f.behavior.afterRetainMs = 130000;
  const result = await runIphoneCapability(f.options);
  assert.equal(result.failure, 'control-deadline');
  assert.equal(result.cleanup.terminal, 'confirmed');
  assert.equal(
    f.calls.some(({ url }) => url.endsWith('/url')),
    false,
  );
  assert.equal(f.calls.filter(({ method }) => method === 'DELETE').length, 1);
});

test('unsupported genuine authentication stays incomplete after actual install transport, with bounded cleanup', async () => {
  const f = fixture();
  f.options.preview.authenticateAndPrepare = undefined;
  const result = await runIphoneCapability(f.options);
  assert.equal(result.checks.installedContext, true);
  assert.equal(result.checks.authenticatedPreparation, false);
  assert.equal(result.authentication, 'not-attempted');
  assert.equal(result.failure, 'capability-authentication-not-configured');
  assert.equal(result.cleanup.terminal, 'confirmed');
});

test('terminal status is a strict scalar and deletion errors cannot masquerade as accepted cleanup', async () => {
  const f = fixture();
  f.behavior.terminalStatus = ['done'];
  f.behavior.rejectDeletion = true;
  const result = await runIphoneCapability(f.options);
  assert.equal(result.status, 'capability-incomplete');
  assert.equal(result.cleanup.deletion, 'unconfirmed');
  assert.equal(result.cleanup.terminal, 'unconfirmed');
  assert(!JSON.stringify(result).includes('private-'));
});

test('a lost DELETE is visibly incomplete even when terminal measurement is available', async () => {
  const f = fixture();
  f.behavior.rejectDeletion = true;
  const result = await runIphoneCapability(f.options);
  assert.equal(result.cleanup.terminal, 'confirmed');
  assert.equal(result.cleanup.deletion, 'unconfirmed');
  assert.equal(result.status, 'capability-incomplete');
  assert.equal(result.failure, 'capability-cleanup-unconfirmed');
});

test('bounded transport refuses oversized request/response, redirects and malformed JSON without raw diagnostics', async () => {
  const base = {
    url: 'https://example.invalid',
    method: 'POST' as const,
    headers: {},
    signal: new AbortController().signal,
    deadline: Date.now() + 30000,
    timeoutMs: 8000,
    maximumBytes: 128,
  };
  let fetched = false;
  await assert.rejects(
    boundedJson({
      ...base,
      body: { text: 'x'.repeat(129) },
      fetcher: async () => {
        fetched = true;
        return Response.json({});
      },
    }),
    /control-request-too-large/,
  );
  assert.equal(fetched, false);
  await assert.rejects(
    boundedJson({ ...base, fetcher: async () => new Response('x'.repeat(129)) }),
    /control-response-too-large/,
  );
  await assert.rejects(
    boundedJson({
      ...base,
      fetcher: async (_url, init) => {
        assert.equal(init?.redirect, 'error');
        return new Response('private-invalid-json');
      },
    }),
    (error: unknown) => {
      assert.match(String(error), /control-request-failed/);
      assert(!String(error).includes('private'));
      return true;
    },
  );
});
