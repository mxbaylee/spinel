import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createPhoneObserver, phoneReport, phoneError } from './startup-phone-observer.ts';
import { instrumentPhoneSource } from './startup-phone-instrumentation.ts';

test('bounded phone observations redact extra fields and preserve page/request identity', () => {
  let saved = '';
  let at = 0;
  const observation = createPhoneObserver({
    now: () => at++,
    page: () => 42,
    read: () => null,
    write: (s) => {
      saved = s;
    },
  });
  const id = observation.next();
  for (let i = 0; i < 130; i++) observation.mark('headers', id, 200);
  const report = phoneReport(JSON.parse(saved))!;
  assert.equal(report.rows.length, 128);
  assert.equal(report.dropped, 2);
  assert.deepEqual(report.rows[0], { event: 'headers', page: 42, at: 2, request: 1, value: 200 });
  const untrusted = {
    rows: [{ ...report.rows[0], content: 'secret', cookie: 'secret' }],
    dropped: 0,
  };
  assert.ok(!JSON.stringify(phoneReport(untrusted)).includes('secret'));
  assert.equal(phoneReport({ ...untrusted, rows: [{ ...report.rows[0], event: 'secret' }] }), null);
  const restored = createPhoneObserver({
    now: () => 0,
    page: () => 43,
    read: () => saved,
    write: () => {},
  });
  restored.mark('page');
  assert.equal(restored.read().rows.at(-1)!.page, 43);
});

test('storage/clock failure is nonthrowing and disclosed; error messages never escape', () => {
  const fail = () => {
    throw new Error('private');
  };
  for (const dependencies of [
    { now: () => 1, read: fail, write: fail },
    { now: fail, read: () => null, write: () => {} },
  ]) {
    const observer = createPhoneObserver({ ...dependencies, page: () => 42 });
    assert.doesNotThrow(() => observer.mark('page'));
    assert.equal(observer.read().unavailable, true);
    assert.ok(!JSON.stringify(observer.read()).includes('private'));
  }
  assert.equal(phoneError(new DOMException('private', 'TimeoutError')), 1);
  assert.equal(phoneError(new TypeError('private')), 2);
  assert.equal(phoneError(new DOMException('private', 'AbortError')), 3);
  assert.equal(phoneError(new Error('private')), 4);
});

test('an invalid clock remains unavailable after later writes and navigation', () => {
  let now = 10;
  let saved = '';
  const observer = createPhoneObserver({
    now: () => now,
    page: () => 42,
    read: () => null,
    write: (s) => {
      saved = s;
    },
  });
  observer.mark('page');
  now = 9;
  observer.mark('online');
  now = 11;
  observer.mark('done');
  const next = createPhoneObserver({
    now: () => 0,
    page: () => 43,
    read: () => saved,
    write: () => {},
  });
  assert.equal(next.read().unavailable, true);
});

test('source instrumentation requires every exact seam and retains original timeout/authority calls', () => {
  const contracts = {
    'api.ts': ['AbortSignal.timeout(checkingSession ? SESSION_REQUEST_DEADLINE_MS : 15_000)'],
    'App.tsx': [
      'verifySession();',
      'expirePreparedAccount();',
      'requireBrowserOnline(globalThis.navigator);',
    ],
    'startupStage.ts': ['export function startupStage(name: string) {'],
  };
  for (const [file, calls] of Object.entries(contracts)) {
    const source = readFileSync(new URL(`../../web/${file}`, import.meta.url), 'utf8');
    const observed = instrumentPhoneSource(source, file, './observer.ts')!;
    assert.ok(observed.includes('phoneMark'));
    for (const call of calls) {
      assert.ok(source.includes(call), `Missing source contract: ${file}: ${call}`);
      assert.equal(observed.split(call).length, source.split(call).length);
    }
    assert.throws(() => instrumentPhoneSource('', file, './observer.ts'), /seam changed/);
  }
});
