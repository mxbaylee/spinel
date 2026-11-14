import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import type { Browser, BrowserContext, TestInfo } from '@playwright/test';
import {
  assertServerHealthy,
  closeFixtureContexts,
  closeFixtureResources,
  fixturePhase,
  serverEvidencePath,
  withFixtureServer,
  withinFixtureBudget,
} from '../../e2e/fixture-evidence.ts';
import type { ServerEvidence } from '../../e2e/fixture-evidence.ts';
import { withFixtureCleanup } from '../../e2e/owned-process.ts';

function info(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-fixture-controls-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return {
    testId: 'negative-control',
    retry: 0,
    repeatEachIndex: 0,
    project: { name: 'negative-control' },
    outputPath: (...parts: string[]) => join(directory, ...parts),
  } as TestInfo;
}
function state(pid = process.pid): ServerEvidence {
  return {
    ownerPid: process.pid,
    pid,
    runId: randomUUID(),
    updatedAt: Date.now(),
    ready: true,
    expectedClose: false,
    exited: false,
    closed: false,
    unexpectedExit: false,
    firstFailure: null,
    exitCode: null,
    signal: null,
    stdout: { bytes: 0, tail: '' },
    stderr: { bytes: 0, tail: '' },
  };
}
const context = (close: () => Promise<void>) => ({ close }) as BrowserContext;

test('readiness, source ownership, stale evidence and recorded fatal state fail closed', () => {
  const ready = state();
  assert.doesNotThrow(() => assertServerHealthy(ready));
  for (const changed of [
    { ready: false },
    { expectedClose: true },
    { exited: true },
    { closed: true },
    { unexpectedExit: true },
    { firstFailure: 'App exited unexpectedly' },
    { updatedAt: Date.now() - 3_000 },
    { updatedAt: Date.now() + 10_000 },
  ])
    assert.throws(() => assertServerHealthy({ ...ready, ...changed }), /unavailable/);
  assert.throws(() => assertServerHealthy(ready, randomUUID()), /unavailable/);
});

test('a terminated owned server interrupts an active scenario and closes its contexts', async (t) => {
  const child = spawn(
    process.execPath,
    ['--input-type=module', '--eval', "console.log('ready'); process.stdin.resume();"],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  t.after(() => child.kill('SIGKILL'));
  await new Promise<void>((resolve) => child.stdout.once('data', () => resolve()));
  const origin = 'http://localhost:3997';
  const path = serverEvidencePath(origin);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state(child.pid)));
  t.after(() => rmSync(path, { force: true }));
  let closed = 0;
  let releaseWork!: () => void;
  const cleanupFailure = new Error('interrupted scenario database cleanup failed');
  const browser = {
    contexts: () => [
      context(async () => {
        closed++;
        releaseWork();
      }),
    ],
  } as unknown as Browser;
  const evidence = info(t);
  const started = performance.now();
  await assert.rejects(
    withFixtureServer(browser, origin, evidence, async () => {
      child.kill('SIGKILL');
      await new Promise<void>((resolve) => {
        releaseWork = resolve;
      });
      throw cleanupFailure;
    }),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.errors[0].message, /Owned fixture server exited/);
      assert.equal(error.cause, error.errors[0]);
      assert.equal(error.errors[1], cleanupFailure);
      return true;
    },
  );
  assert.equal(closed, 1);
  assert.ok(performance.now() - started < 2_000);
  const recorded = JSON.parse(readFileSync(evidence.outputPath('fixture-evidence.json'), 'utf8'));
  assert.equal(recorded.events.at(-1).phase, 'server-failure');
  assert.equal(recorded.retry, 0);
});

test('bounded diagnostics cannot prevent independent context and database cleanup', async (t) => {
  const primary = new Error('original content assertion');
  const closing: string[] = [];
  const evidence = info(t);
  const started = performance.now();
  await assert.rejects(
    withFixtureCleanup(
      async () => {
        throw primary;
      },
      () =>
        closeFixtureResources(evidence, {
          capture: () => new Promise<void>(() => {}),
          contexts: [
            context(async () => {
              closing.push('context');
            }),
          ],
          dispose: () => {
            closing.push('database');
          },
        }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, primary);
      assert.equal(error.errors[0], primary);
      assert.match(error.errors[1].errors[0].message, /diagnostic capture exceeded/);
      return true;
    },
  );
  assert.deepEqual(closing, ['context', 'database']);
  assert.ok(performance.now() - started < 2_500);
});

test('every cleanup is attempted, already-closed contexts are tolerated, and real failures remain', async (t) => {
  const calls: string[] = [];
  const failure = new Error('close transport failed');
  await assert.rejects(
    closeFixtureResources(info(t), {
      capture: async () => {
        throw new Error('capture failed');
      },
      contexts: [
        context(async () => {
          calls.push('already-closed');
          throw new Error('Target page, context or browser has been closed');
        }),
        context(async () => {
          calls.push('broken');
          throw failure;
        }),
        context(async () => {
          calls.push('healthy');
        }),
      ],
      dispose: () => {
        calls.push('database');
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 2);
      assert.equal(error.errors[1].errors[0], failure);
      return true;
    },
  );
  assert.deepEqual(calls, ['already-closed', 'broken', 'healthy', 'database']);
});

test('a context that never confirms closure fails within the shared close budget', async () => {
  const started = performance.now();
  await assert.rejects(
    closeFixtureContexts([context(() => new Promise<void>(() => {}))]),
    /context cleanup failed/,
  );
  assert.ok(performance.now() - started < 4_000);
});

test('a failed product assertion is returned unchanged when cleanup succeeds', async () => {
  const original = new assert.AssertionError({ message: 'saved content differs' });
  await assert.rejects(
    withFixtureCleanup(
      async () => {
        throw original;
      },
      async () => {},
    ),
    (error: unknown) => error === original,
  );
});

test('phase evidence is bounded and records dropped events without retaining account values', (t) => {
  const evidence = info(t);
  for (let index = 0; index < 140; index++)
    fixturePhase(evidence, 'authenticated-setup', { attempt: 1, identityMatch: true });
  const recorded = JSON.parse(readFileSync(evidence.outputPath('fixture-evidence.json'), 'utf8'));
  assert.equal(recorded.events.length, 128);
  assert.equal(recorded.dropped, 12);
  assert.equal(recorded.repeatEachIndex, 0);
  assert.equal(recorded.retry, 0);
  assert.equal(recorded.events[0].identityMatch, true);
});

test('bounded operation preserves its actual failure instead of replacing it with a timeout', async () => {
  const original = new Error('first failure');
  await assert.rejects(
    withinFixtureBudget(
      async () => {
        throw original;
      },
      100,
      'control',
    ),
    (error: unknown) => error === original,
  );
});
