import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Browser, TestInfo } from '@playwright/test';
import { fixture as docFixture } from '../../e2e/doc-responsiveness-fixture.ts';
import { openDatabase } from '../../server/database.ts';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  callbackProgress,
  persistCallbackManifest,
  settleCallbackObservation,
} from '../../e2e/doc-responsiveness-callback-progress.ts';

function fixture(t: { after: (fn: () => void) => void }) {
  const directory = mkdtempSync(join(tmpdir(), 'spn134-progress-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'progress.json');
  return {
    path,
    progress: callbackProgress(path),
    read: () => JSON.parse(readFileSync(path, 'utf8')),
  };
}

test('missing input retains its exact pending paragraph and terminal timeout, never completion', (t) => {
  const { progress, read } = fixture(t);
  progress.phase('typed-paragraph', 7);
  progress.phase('typing-paragraph', 8);
  // No completed input promise or renderer round trip is needed to persist this.
  assert.equal(read().events.at(-1).count, 8);
  progress.terminal('timedOut');
  assert.equal(read().phase, 'typing-paragraph');
  assert.equal(read().firstFailure.kind, 'timedOut');
  assert.equal(read().terminal, 'timedOut');
  assert.equal(read().passed, undefined);
});

test('a stalled trace is distinguishable from completed typing without accepting partial trace data', (t) => {
  const { progress, read } = fixture(t);
  progress.phase('behavior-complete');
  progress.phase('trace-end-request');
  progress.phase('trace-completion');
  progress.terminal('timedOut');
  assert.equal(read().firstFailure.phase, 'trace-completion');
  assert.equal(
    read().events.some((event: { phase: string }) => event.phase === 'behavior-complete'),
    true,
  );
  assert.equal(read().complete, undefined);
});

for (const lifecycle of [
  'page-close',
  'context-close',
  'browser-disconnected',
  'page-crash',
] as const)
  test(`unexpected ${lifecycle} remains the first cause through subsequent cleanup errors`, (t) => {
    const { progress, read } = fixture(t);
    progress.phase('typing-paragraph', 3);
    progress.lifecycle(lifecycle);
    progress.failed('operation');
    progress.phase('trace-completion');
    progress.failed('trace');
    progress.cleanup();
    progress.failed('fixture-cleanup');
    progress.terminal('failed');
    assert.deepEqual(read().firstFailure, progress.firstFailure);
    assert.equal(read().firstFailure.kind, lifecycle);
    assert.equal(read().firstFailure.phase, 'typing-paragraph');
    assert.equal(read().events.at(-1).kind, 'failed');
  });

test('ordinary owned cleanup closure is recorded but not misclassified as the original failure', (t) => {
  const { progress, read } = fixture(t);
  progress.cleanup();
  progress.lifecycle('page-close');
  progress.lifecycle('context-close');
  progress.phase('fixture-cleanup-complete');
  progress.terminal('passed');
  assert.equal(read().firstFailure, null);
  assert.equal(read().events.filter((event: { expected?: boolean }) => event.expected).length, 2);
});

test('crashes remain unexpected during cleanup and the observation buffer is bounded', (t) => {
  const { progress, read } = fixture(t);
  progress.cleanup();
  progress.lifecycle('page-crash');
  for (let index = 0; index < 512; index++) progress.lifecycle('context-close');
  assert.equal(read().firstFailure.kind, 'page-crash');
  assert.equal(read().events.length, 128);
  assert.ok(read().droppedEvents > 0);
  assert.ok(JSON.stringify(read()).length < 32 * 1024);
});

test('real Playwright timeout runs the terminal hook without waiting for a stalled observation', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'spn134-timeout-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const require = createRequire(import.meta.url);
  const playwright = require.resolve('@playwright/test');
  const helper = fileURLToPath(
    new URL('../../e2e/doc-responsiveness-callback-progress.ts', import.meta.url),
  );
  const evidence = join(directory, 'progress.json');
  writeFileSync(
    join(directory, 'playwright.config.ts'),
    `export default { timeout: 200, retries: 0, workers: 1, reporter: 'json', outputDir: ${JSON.stringify(join(directory, 'results'))} };`,
  );
  writeFileSync(
    join(directory, 'timeout.spec.ts'),
    `
import { test } from ${JSON.stringify(playwright)};
import { callbackProgress, settleCallbackObservation } from ${JSON.stringify(helper)};
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
let progress: ReturnType<typeof callbackProgress>;
let running: Promise<void>;
let rejectRunning: (error: Error) => void;
let cleanupCalls = 0;
test.afterEach(async ({}, info) => {
  info.setTimeout(30_000);
  await settleCallbackObservation({
    progress, detach: () => {}, done: running,
    abort() { rejectRunning(new Error('original deadline')); },
    async interrupt() {
      const early = JSON.parse(readFileSync(${JSON.stringify(evidence)}, 'utf8'));
      assert.equal(early.terminal, 'timedOut');
      assert.equal(early.firstFailure.phase, 'trace-completion');
      cleanupCalls++;
      progress.cleanup();
      await Promise.resolve();
      progress.phase('fixture-cleanup-complete');
    },
  }, info.status ?? 'unknown');
  assert.equal(cleanupCalls, 1);
});
test('stalled collection', async () => {
  progress = callbackProgress(${JSON.stringify(evidence)});
  progress.phase('behavior-complete');
  progress.phase('trace-completion');
  running = new Promise<void>((_resolve, reject) => { rejectRunning = reject; });
  await running;
});
`,
  );
  const result = spawnSync(
    process.execPath,
    [
      join(dirname(require.resolve('@playwright/test/package.json')), 'cli.js'),
      'test',
      '--config',
      join(directory, 'playwright.config.ts'),
    ],
    { encoding: 'utf8', timeout: 15_000, env: { ...process.env, FORCE_COLOR: '0' } },
  );
  assert.equal(
    result.error,
    undefined,
    result.error?.message ?? 'Playwright runner exited normally',
  );
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.stats.unexpected, 1);
  assert.equal(report.suites[0].specs[0].tests[0].results[0].status, 'timedOut');
  const retained = JSON.parse(readFileSync(evidence, 'utf8'));
  assert.equal(retained.phase, 'fixture-cleanup-complete');
  assert.equal(retained.firstFailure.phase, 'trace-completion');
  assert.equal(retained.terminal, 'timedOut');
  assert.equal(retained.firstFailure.kind, 'timedOut');
});

test('failed checkpoint replacement preserves the previous bytes and cannot bypass cleanup', (t) => {
  const { progress, read, path } = fixture(t);
  progress.phase('trace-stream-read');
  const previous = readFileSync(path, 'utf8');
  mkdirSync(`${path}.tmp`);
  let detached = false,
    closed = false;
  assert.doesNotThrow(() => {
    progress.failed('trace');
    progress.phase('cdp-detach');
    detached = true;
    progress.cleanup();
    closed = true;
    progress.lifecycle('context-close');
    progress.terminal('failed');
  });
  assert.equal(detached && closed, true);
  assert.equal(progress.firstFailure?.kind, 'trace');
  assert.equal(progress.firstFailure?.phase, 'trace-stream-read');
  assert.equal(progress.persistenceFailure?.code, 'EISDIR');
  assert.equal(readFileSync(path, 'utf8'), previous);
  rmSync(`${path}.tmp`, { recursive: true });
  progress.terminal('failed');
  assert.equal(read().persistenceFailure.code, 'EISDIR');
  assert.equal(read().firstFailure.kind, 'trace');
});

for (const primary of [new Error('original operation failure'), undefined])
  test(`manifest persistence failure ${primary ? 'preserves the original error' : 'rejects otherwise successful acceptance'} after cleanup`, async (t) => {
    const { path } = fixture(t);
    const previous = readFileSync(path, 'utf8');
    mkdirSync(`${path}.tmp`);
    const evidence: Record<string, unknown> = { passed: true };
    let failure: unknown = primary;
    let cleaned = false;
    try {
      failure = await persistCallbackManifest(path, evidence, failure);
    } finally {
      cleaned = true;
      failure = await persistCallbackManifest(path, evidence, failure);
    }
    assert.equal(cleaned, true);
    assert.equal(evidence.passed, false);
    assert.equal(evidence.manifestPersistenceError, true);
    assert.equal(readFileSync(path, 'utf8'), previous);
    if (primary) assert.equal(failure, primary);
    else assert.match(String(failure), /manifest could not be persisted/);
    rmSync(`${path}.tmp`, { recursive: true });
    assert.equal(await persistCallbackManifest(path, evidence, failure), failure);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).manifestPersistenceError, true);
  });

test('timeout is persisted before cleanup waits and terminal settlement cannot resurrect success', async (t) => {
  const { progress, read } = fixture(t);
  progress.phase('trace-completion');
  let releaseCleanup!: () => void;
  let releaseExecution!: () => void;
  const cleanup = new Promise<void>((resolve) => {
    releaseCleanup = resolve;
  });
  const done = new Promise<void>((resolve) => {
    releaseExecution = resolve;
  });
  let aborted = false;
  let completed = false;
  const settlement = settleCallbackObservation(
    {
      progress,
      detach: () => {},
      abort: () => {
        aborted = true;
      },
      interrupt: () => cleanup,
      done,
    },
    'timedOut',
  ).then(() => {
    completed = true;
  });
  assert.equal(aborted, true);
  assert.equal(read().firstFailure.phase, 'trace-completion');
  assert.equal(read().terminal, 'timedOut');
  assert.equal(completed, false);
  progress.phase('cdp-detach');
  releaseCleanup();
  await Promise.resolve();
  assert.equal(completed, false, 'Cleanup alone cannot abandon the running observation');
  progress.cleanup();
  progress.phase('fixture-cleanup-complete');
  releaseExecution();
  await settlement;
  assert.equal(read().terminal, 'timedOut');
  assert.equal(read().firstFailure.kind, 'timedOut');
});

test('failed teardown preserves the already durable original timeout', async (t) => {
  const { progress, read } = fixture(t);
  progress.phase('trace-completion');
  const error = new Error('owned teardown failed');
  await assert.rejects(
    settleCallbackObservation(
      {
        progress,
        detach: () => {},
        abort: () => {},
        interrupt: async () => {
          throw error;
        },
      },
      'timedOut',
    ),
    (actual) => actual === error,
  );
  assert.equal(read().firstFailure.kind, 'timedOut');
  assert.equal(read().firstFailure.phase, 'trace-completion');
  assert.equal(read().terminal, 'timedOut');
});

for (const scenario of [
  'complete',
  'close-fails',
  'page-setup-fails',
  'abort-late-context',
] as const)
  test(`document fixture ${scenario} owns all contexts and closes its database without masking first failure`, async (t) => {
    const project = `spn143-cleanup-${randomUUID()}`;
    const directory = join('test-results', project);
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const primary = new Error('original setup interruption');
    const secondary = new Error('first context close failed');
    const controller = new AbortController();
    const closes = [0, 0];
    let reached!: () => void;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const contexts = [0, 1].map((index) => ({
      addCookies: async () => {},
      newPage: async () => {
        if (scenario === 'page-setup-fails' && index === 0) throw primary;
        return new EventEmitter();
      },
      close: async () => {
        closes[index]++;
        if (index === 0 && (scenario === 'close-fails' || scenario === 'page-setup-fails'))
          throw secondary;
      },
    }));
    let index = 0;
    const browser = {
      async newContext() {
        const current = index++;
        if (scenario === 'abort-late-context' && current === 1) {
          reached();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return contexts[current];
      },
    } as unknown as Browser;
    const running = docFixture(
      browser,
      'https://spinel.test',
      { project: { name: project } } as TestInfo,
      false,
      controller.signal,
    );
    if (scenario === 'abort-late-context') {
      await pending;
      controller.abort(primary);
      release();
      await assert.rejects(running, (error) => error === primary);
    } else if (scenario === 'page-setup-fails') {
      await assert.rejects(running, (error) => error === primary);
    } else {
      const value = await running;
      const closing = value.close();
      assert.equal(value.close(), closing, 'Concurrent cleanup shares actual settlement');
      if (scenario === 'close-fails') await assert.rejects(closing, (error) => error === secondary);
      else await closing;
      assert.equal(value.workspace.auth.database.isOpen, false);
      await assert.rejects(value.account(), /fixture is closed/);
    }
    assert.deepEqual(closes, [1, 1]);
    const database = openDatabase(join(directory, 'app.sqlite'));
    try {
      assert.equal(database.prepare('SELECT count(*) AS count FROM auth_users').get()?.count, 0);
      assert.equal(
        database.prepare('SELECT count(*) AS count FROM workspace_items').get()?.count,
        0,
      );
    } finally {
      database.close();
    }
  });

test('timeout during an in-flight final write republishes failure only after that writer settles', async (t) => {
  const { progress, read } = fixture(t);
  const directory = mkdtempSync(join(tmpdir(), 'spn143-final-write-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'manifest.json');
  const manifest: Record<string, unknown> = {
    passed: true,
    cleanup: { sessionDetached: true, fixtureClosed: true },
  };
  let releaseWrite!: () => void;
  const pendingWrite = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const done = (async () => {
    const serialized = JSON.stringify(manifest);
    await pendingWrite;
    writeFileSync(path, serialized);
  })();
  const settling = settleCallbackObservation(
    {
      progress,
      detach: () => {},
      abort: () => {},
      interrupt: async () => {},
      done,
      async rejectManifest() {
        manifest.passed = false;
        await persistCallbackManifest(path, manifest, new Error('original deadline'));
      },
    },
    'timedOut',
  );
  assert.equal(read().terminal, 'timedOut');
  releaseWrite();
  await settling;
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).passed, false);
  assert.equal(read().firstFailure.kind, 'timedOut');
});
