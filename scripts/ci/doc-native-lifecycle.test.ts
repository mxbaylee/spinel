import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  callbackProgress,
  runOwnedObservation,
} from '../../e2e/doc-responsiveness-callback-progress.ts';

test('recording a source-retention failure before cleanup preserves its actual phase', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spn146-source-failure-'));
  try {
    const path = join(root, 'progress.json');
    const progress = callbackProgress(path);
    const primary = new Error('missing declared source map');
    await assert.rejects(
      runOwnedObservation(
        async () => {
          progress.phase('loaded-source-retention');
          try {
            throw primary;
          } catch (error) {
            progress.failed('operation');
            throw error;
          } finally {
            progress.cleanup();
          }
        },
        { progress, primaryFailure: () => primary, detach: async () => {}, close: async () => {} },
      ),
      (error) => error === primary,
    );
    const receipt = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(receipt.firstFailure.phase, 'loaded-source-retention');
    assert.equal(receipt.firstFailure.kind, 'operation');
    assert.equal(receipt.phase, 'fixture-cleanup');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const stage of [
  'partial-setup',
  'profile-retention',
  'observer-disposal',
  'detach',
  'fixture-close',
] as const)
  test(`native diagnostic owns both resources through ${stage} failure`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'spn146-owned-'));
    try {
      const progress = callbackProgress(join(root, 'progress.json'));
      const primary = new Error('first observation failure');
      const secondary = new Error(stage);
      const calls: string[] = [];
      await assert.rejects(
        runOwnedObservation(
          async () => {
            if (stage === 'partial-setup') throw primary;
            if (stage === 'profile-retention' || stage === 'observer-disposal') throw secondary;
          },
          {
            progress,
            primaryFailure: () =>
              stage === 'profile-retention' || stage === 'observer-disposal' ? primary : undefined,
            detach: async () => {
              calls.push('detach');
              if (stage === 'detach') throw secondary;
            },
            close: async () => {
              calls.push('close');
              if (stage === 'fixture-close') throw secondary;
            },
          },
        ),
        (error) =>
          error === (stage === 'detach' || stage === 'fixture-close' ? secondary : primary),
      );
      assert.deepEqual(calls.sort(), ['close', 'detach']);
      assert.ok(progress.firstFailure);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

test('actual Playwright deadline interrupts and joins diagnostic work before the terminal hook returns', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spn146-timeout-'));
  try {
    const require = createRequire(import.meta.url);
    const playwright = require.resolve('@playwright/test');
    const helper = fileURLToPath(
      new URL('../../e2e/doc-responsiveness-callback-progress.ts', import.meta.url),
    );
    const retained = join(root, 'settled.json');
    await writeFile(
      join(root, 'playwright.config.ts'),
      `export default { timeout: 200, retries: 0, workers: 1, reporter: 'json', outputDir: ${JSON.stringify(join(root, 'results'))} };`,
    );
    await writeFile(
      join(root, 'timeout.spec.ts'),
      `
import { test } from ${JSON.stringify(playwright)};
import { callbackProgress, runOwnedObservation, settleCallbackObservation } from ${JSON.stringify(helper)};
import { writeFileSync } from 'node:fs';
let observation, rejectWork, running, settled = false, detached = 0, closed = 0;
const controller = new AbortController();
let detach, close;
const detachSession = () => detach ??= Promise.resolve().then(() => { detached++; rejectWork(new Error('session interrupted')); });
const closeFixture = () => close ??= Promise.resolve().then(() => { closed++; });
test.afterEach(async ({}, info) => {
  info.setTimeout(30000);
  await settleCallbackObservation(observation, info.status ?? 'unknown');
  writeFileSync(${JSON.stringify(retained)}, JSON.stringify({status: info.status, settled, detached, closed, aborted: controller.signal.aborted}));
});
test('owned diagnostic timeout', async () => {
  const progress = callbackProgress(${JSON.stringify(join(root, 'progress.json'))});
  observation = {progress, detach: () => {}, abort: () => controller.abort(), interrupt: () => Promise.allSettled([detachSession(), closeFixture()])};
  running = runOwnedObservation(async () => {
    try { await new Promise((_, reject) => { rejectWork = reject; }); }
    finally { settled = true; }
  }, {progress, primaryFailure: () => undefined, detach: detachSession, close: closeFixture});
  observation.done = running;
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
        join(root, 'playwright.config.ts'),
      ],
      { encoding: 'utf8', timeout: 15000, env: { ...process.env, FORCE_COLOR: '0' } },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stdout.trim().startsWith('{'), result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.stats.unexpected, 1);
    assert.equal(report.suites[0].specs[0].tests[0].results[0].status, 'timedOut');
    assert.deepEqual(JSON.parse(await readFile(retained, 'utf8')), {
      status: 'timedOut',
      settled: true,
      detached: 1,
      closed: 1,
      aborted: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
