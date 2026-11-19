import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock, test } from 'node:test';
import type { TestCase, TestResult } from '@playwright/test/reporter';
import ResetDiagnosticsReporter from '../../e2e/reset-diagnostics-reporter.ts';
import type { ServerEvidence } from '../../e2e/fixture-evidence.ts';
import {
  appendDiagnostic,
  isReset,
  resetDiagnostic,
  resetRequest,
} from '../../e2e/reset-diagnostics.ts';

const callLog =
  'Error: apiRequestContext.get: read ECONNRESET\nCall log:\n  - → GET http://localhost:3100/api/items/9610e443-6c9e-4936-9821-3c0996311241/sheet?token=secret\n    - user-agent: Mozilla/5.0';
const evidence: ServerEvidence = {
  ownerPid: 10,
  runId: '11111111-1111-1111-1111-111111111111',
  updatedAt: 9_750,
  pid: 11,
  ready: true,
  expectedClose: false,
  exited: false,
  unexpectedExit: false,
  closed: false,
  firstFailure: null,
  exitCode: null,
  signal: null,
  stdout: { bytes: 120, tail: 'SECRET stdout' },
  stderr: { bytes: 7, tail: 'SECRET stderr' },
};
const input = {
  project: 'development',
  file: 'restore.spec.ts',
  line: 94,
  attempt: 1,
  status: 'failed',
  errors: [{ message: callLog }],
  evidence,
  now: 10_000,
};

test('a reset names the call without ids, queries or server output', () => {
  assert.equal(resetRequest(callLog), 'GET /api/items/<id>/sheet');
  const diagnostic = resetDiagnostic(input)!;
  assert.equal(diagnostic.request, 'GET /api/items/<id>/sheet');
  assert.deepEqual(diagnostic.server, {
    available: true,
    pid: 11,
    ownerPid: 10,
    ready: true,
    exited: false,
    unexpectedExit: false,
    closed: false,
    exitCode: null,
    signal: null,
    failed: false,
    stderrBytes: 7,
    stdoutBytes: 120,
    evidenceAgeMs: 250,
  });
  const text = JSON.stringify(diagnostic);
  for (const secret of ['SECRET', 'SECRETFAIL', evidence.runId, 'secret', '9610e443', 'user-agent'])
    assert.ok(!text.includes(secret));
});

test('other failures and passing text produce no diagnostic', () => {
  assert.equal(isReset([{ message: 'expect(received).toBe(expected)' }]), false);
  assert.equal(
    resetDiagnostic({ ...input, errors: [{ message: 'Timeout 5000ms exceeded' }] }),
    undefined,
  );
  assert.equal(resetDiagnostic({ ...input, errors: [] }), undefined);
});

test('a recorded failure is a flag, its text is not kept', () => {
  const diagnostic = resetDiagnostic({
    ...input,
    evidence: { ...evidence, firstFailure: 'App exited unexpectedly SECRETFAIL' },
  })!;
  assert.equal(diagnostic.server.available && diagnostic.server.failed, true);
  assert.ok(!JSON.stringify(diagnostic).includes('SECRETFAIL'));
});

test('a missing server evidence file is reported, not hidden', () => {
  const diagnostic = resetDiagnostic({ ...input, evidence: undefined })!;
  assert.deepEqual(diagnostic.server, { available: false });
});

test('an exited server and the browser-side reset form are both recognised', () => {
  const diagnostic = resetDiagnostic({
    ...input,
    errors: [{ message: 'page.goto: net::ERR_CONNECTION_RESET at http://localhost:3100/' }],
    evidence: { ...evidence, exited: true, unexpectedExit: true, signal: 'SIGABRT' },
  })!;
  assert.equal(diagnostic.request, null);
  assert.equal(diagnostic.server.available && diagnostic.server.unexpectedExit, true);
  assert.equal(diagnostic.server.available && diagnostic.server.signal, 'SIGABRT');
});

test('long and absolute-URL requests are normalized and capped', () => {
  const id = '9610e443-6c9e-4936-9821-3c0996311241';
  assert.equal(
    resetRequest(`x\n  - → POST https://example.test:8443/api/items/${id}/collaboration?a=1`),
    'POST /api/items/<id>/collaboration',
  );
  assert.equal(resetRequest(`→ GET /${'a'.repeat(500)}`)!.length, 160);
});

test('saved diagnostics keep the newest 50 and tolerate a damaged file', () => {
  const next = resetDiagnostic(input)!;
  const full = Array.from({ length: 60 }, () => next);
  assert.equal(appendDiagnostic(full, { ...next, line: 1 }).length, 50);
  assert.equal(appendDiagnostic(full, { ...next, line: 1 }).at(-1)!.line, 1);
  assert.deepEqual(appendDiagnostic('{bad', next), [next]);
});

test('the reporter writes only for resets, caps the file and never throws', () => {
  const before = process.cwd();
  process.chdir(mkdtempSync(join(tmpdir(), 'reset-reporter-')));
  const log = mock.method(console, 'error', () => {});
  try {
    const reporter = new ResetDiagnosticsReporter();
    const testCase = {
      location: { file: '/x/e2e/restore.spec.ts', line: 95 },
      parent: { project: () => ({ name: 'development', use: {} }) },
    } as unknown as TestCase;
    const result = (status: string, message: string) =>
      ({ status, retry: 0, errors: [{ message }] }) as unknown as TestResult;
    const file = join('playwright-report', 'reset-diagnostics-development.json');

    reporter.onTestEnd(testCase, result('passed', 'read ECONNRESET'));
    reporter.onTestEnd(testCase, result('failed', 'Timeout 5000ms exceeded'));
    assert.equal(existsSync(file), false);

    for (let i = 0; i < 55; i++) reporter.onTestEnd(testCase, result('failed', 'read ECONNRESET'));
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { server: { available: boolean } }[];
    assert.equal(saved.length, 50);
    assert.equal(saved[0].server.available, false);
    assert.equal(log.mock.callCount(), 55);

    assert.doesNotThrow(() =>
      reporter.onTestEnd({} as TestCase, result('failed', 'read ECONNRESET')),
    );
  } finally {
    log.mock.restore();
    process.chdir(before);
  }
});
