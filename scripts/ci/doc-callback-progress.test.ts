import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { callbackProgress } from '../../e2e/doc-responsiveness-callback-progress.ts';

function fixture(t: { after: (fn: () => void) => void }) {
  const directory = mkdtempSync(join(tmpdir(), 'spn134-progress-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'progress.json');
  return {
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
import { callbackProgress } from ${JSON.stringify(helper)};
let progress: ReturnType<typeof callbackProgress>;
test.afterEach(({}, info) => progress.terminal(info.status ?? 'unknown'));
test('stalled collection', async () => {
  progress = callbackProgress(${JSON.stringify(evidence)});
  progress.phase('behavior-complete');
  progress.phase('trace-completion');
  await new Promise(() => {});
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
  assert.equal(retained.phase, 'trace-completion');
  assert.equal(retained.terminal, 'timedOut');
  assert.equal(retained.firstFailure.kind, 'timedOut');
});
