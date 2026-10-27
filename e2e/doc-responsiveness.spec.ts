import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  compositionCpu,
  distribution,
  observeInput,
  readDocResponsiveness,
} from './doc-responsiveness.ts';
import type { DocResponsivenessEvidence } from './doc-responsiveness.ts';
import { registerDocResponsivenessBoundaries } from './doc-responsiveness-boundaries.ts';
import { fixture, focusEmptyDoc, exactText, saved, online } from './doc-responsiveness-fixture.ts';

// Recorded before the production fix. These are responsiveness budgets for this
// fixed workload/runtime, not physical-device, INP, or arbitrary-document claims.
const budgets = {
  desktop: { inputP95Ms: 100, longTaskMaxMs: 200, flushP95Ms: 16, flushMaxMs: 50 },
  mobile: { inputP95Ms: 200, longTaskMaxMs: 500, flushP95Ms: 50, flushMaxMs: 100 },
} as const;
const paragraphs = Array.from(
  { length: 16 },
  (_, index) =>
    `Line ${index + 1}: Read the whole paragraph, including the far right edge. ` +
    'Keep the original page size and all of this text when navigating.',
);
const expectedText = paragraphs.join('\r') + '\r\n';
const expectedInputCount = paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0) + 15;
const baseline = process.env.SPN108_BASELINE === '1';
// Every scheduled sample is retained. CPU profiling has its own samples so its
// overhead never contaminates the primary frame-latency measurements.
test.use({ trace: 'off', screenshot: 'only-on-failure' });
test.describe.configure({ retries: 0, mode: 'default' });

async function verifyUndoRedo(
  page: Page,
  other: Page,
  native: DocResponsivenessEvidence,
  all: boolean,
) {
  const groups = all ? native.history.undos : 1;
  expect(groups).toBeGreaterThan(0);
  expect(native.history.undos).toBeLessThanOrEqual(50);
  await page.keyboard.press('Control+z');
  await saved(page);
  const undone = (await readDocResponsiveness(page, true))!;
  expect(undone.text).not.toBe(expectedText);
  expect(undone.text!.endsWith('\r\n')).toBe(true);
  expect(expectedText.startsWith(undone.text!.slice(0, -2))).toBe(true);
  expect(undone.selection).toMatchObject({
    start: undone.text!.length - 2,
    end: undone.text!.length - 2,
  });
  await exactText(other, undone.text!);
  for (let group = 1; group < groups; group++) await page.keyboard.press('Control+z');
  await saved(page);
  if (all) {
    await exactText(page, '\r\n');
    await exactText(other, '\r\n');
    expect((await readDocResponsiveness(page))?.selection).toMatchObject({ start: 0, end: 0 });
  }
  for (let group = 0; group < groups; group++) await page.keyboard.press('Control+Shift+z');
  await saved(page);
  await exactText(page, expectedText);
  await exactText(other, expectedText);
  expect((await readDocResponsiveness(page))?.selection).toMatchObject({
    start: expectedText.length - 2,
    end: expectedText.length - 2,
  });
}

for (const preset of ['desktop', 'mobile'] as const)
  for (const sample of ['plain-1', 'plain-2', 'plain-3', 'profile'] as const)
    test(`${preset} sustained native typing ${sample}`, async ({ browser, baseURL }, info) => {
      test.setTimeout(300_000);
      const mobile = preset === 'mobile',
        profiled = sample === 'profile';
      const f = await fixture(browser, baseURL!, info, mobile);
      const cdp = await f.page.context().newCDPSession(f.page);
      let finishInput: Awaited<ReturnType<typeof observeInput>> | undefined;
      let profiling = false;
      const evidence: Record<string, unknown> = {
        schema: 1,
        role: baseline ? 'baseline-observation' : 'candidate',
        budgetEnforced: !baseline && !profiled,
        preset,
        sample,
        attempt: info.retry,
        source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        dirtyPaths: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
        harnessSha256: Object.fromEntries(
          await Promise.all(
            [
              'e2e/doc-responsiveness.ts',
              'e2e/doc-responsiveness.spec.ts',
              'e2e/doc-responsiveness-fixture.ts',
              'e2e/doc-responsiveness-boundaries.ts',
              'playwright.config.ts',
              'package-lock.json',
            ].map(async (path) => [
              path,
              createHash('sha256')
                .update(await readFile(path))
                .digest('hex'),
            ]),
          ),
        ),
        browser: browser.version(),
        runtime: process.version,
        system: {
          platform: platform(),
          release: release(),
          cpu: cpus()[0]?.model,
          cpus: cpus().length,
          totalmem: totalmem(),
        },
        fixture: {
          paragraphs: 16,
          typedCharacters: paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0),
          enterKeys: 15,
          nativeTextLength: expectedText.length,
          sha256: createHash('sha256').update(expectedText).digest('hex'),
          input: 'keyboard.type, zero requested delay; Enter between all sixteen paragraphs',
        },
        instrumentation: {
          profiler: profiled,
          cpuThrottle: mobile ? 4 : 1,
          longTaskObserver: true,
          perKeyRequestAnimationFrame: true,
          playwrightTrace: false,
          perMutationSnapshot: false,
          physicalDevice: false,
        },
        budgets: budgets[preset],
      };
      try {
        evidence.cgroupLimit = (
          await readFile('/sys/fs/cgroup/memory.max', 'utf8').catch(() => 'unavailable')
        ).trim();
        await Promise.all([
          f.page.goto(`/?item=${f.item.id}`),
          f.other.goto(`/?item=${f.item.id}`),
        ]);
        await Promise.all([saved(f.page), saved(f.other), online(f.page), online(f.other)]);
        await focusEmptyDoc(f.other, mobile);
        await f.page.bringToFront();
        await focusEmptyDoc(f.page, mobile);
        expect((await readDocResponsiveness(f.page))?.mobile).toBe(mobile);
        expect(
          await f.page.evaluate(
            () => matchMedia('(pointer: coarse) and (max-width: 900px)').matches,
          ),
        ).toBe(mobile);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: mobile ? 4 : 1 });
        evidence.heapBefore = await cdp.send('Runtime.getHeapUsage');
        if (profiled) {
          await cdp.send('Profiler.enable');
          await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
          await cdp.send('Profiler.start');
          profiling = true;
        }
        finishInput = await observeInput(f.page);
        const typingStarted = performance.now();
        for (const [index, paragraph] of paragraphs.entries()) {
          if (index > 0) await f.page.keyboard.press('Enter');
          // This is the retained SPN-072 reproducer. Never use insertText here.
          await f.page.keyboard.type(paragraph);
        }
        evidence.typingWallMs = performance.now() - typingStarted;
        const drainStarted = performance.now();
        await expect
          .poll(async () => (await readDocResponsiveness(f.page))?.pending, {
            timeout: 30_000,
            intervals: [25],
          })
          .toEqual({ history: 0, collaboration: 0 });
        evidence.drainObservationMs = performance.now() - drainStarted;
        const input = await finishInput();
        finishInput = undefined;
        const native = (await readDocResponsiveness(f.page))!;
        evidence.native = native;
        evidence.input = input;
        const frame = distribution(input.keyToFrameMs);
        const gaps = input.keydownAt.slice(1).map((at, index) => at - input.keydownAt[index]!);
        const longTasks = distribution(input.longTasks.map((task) => task.durationMs));
        const flush = distribution(native.flushes.map((entry) => entry.durationMs));
        const drainUpperBoundMs = native.observedAt - input.keydownAt.at(-1)!;
        evidence.summary = {
          frameOpportunityMs: frame,
          interKeyGapMs: distribution(gaps),
          debounceBreakingGaps: gaps.filter((gap) => gap >= 300).length,
          longTaskMs: longTasks,
          totalBlockingMs: input.longTasks.reduce(
            (sum, task) => sum + Math.max(0, task.durationMs - 50),
            0,
          ),
          flushPairMs: flush,
          postFinalKeyDrainUpperBoundMs: drainUpperBoundMs,
        };
        evidence.budgetResults = {
          inputP95: frame.p95 <= budgets[preset].inputP95Ms,
          longestTask: longTasks.max <= budgets[preset].longTaskMaxMs,
          flushP95: flush.p95 <= budgets[preset].flushP95Ms,
          flushMaximum: flush.max <= budgets[preset].flushMaxMs,
          boundedHistory: native.highWater.history <= 64,
          boundedCollaboration: native.highWater.collaboration <= 64,
          observedBoundedFlushes: native.flushes.length > 0,
          drainedWithinOneSecond: drainUpperBoundMs <= 1000,
        };
        evidence.heapAfter = await cdp.send('Runtime.getHeapUsage');
        if (profiling) {
          const { profile } = await cdp.send('Profiler.stop');
          profiling = false;
          evidence.compositionCpu = compositionCpu(profile);
          await writeFile(info.outputPath('spn108-profile.cpuprofile'), JSON.stringify(profile));
        }
        const savedStarted = performance.now();
        await saved(f.page);
        evidence.postFinalKeySavedUpperBoundMs =
          (await f.page.evaluate(() => performance.now())) - input.keydownAt.at(-1)!;
        await exactText(f.page, expectedText);
        await exactText(f.other, expectedText);
        evidence.postFinalKeyPeerUpperBoundMs =
          (await f.page.evaluate(() => performance.now())) - input.keydownAt.at(-1)!;
        await expect
          .poll(async () => (await f.read()).body!.dataStream, { timeout: 30_000 })
          .toBe(expectedText);
        evidence.convergenceObservationMs = performance.now() - savedStarted;
        expect(native.selection).toMatchObject({
          start: expectedInputCount,
          end: expectedInputCount,
        });
        expect((await readDocResponsiveness(f.other))?.selection).toMatchObject({
          start: 0,
          end: 0,
        });
        await verifyUndoRedo(f.page, f.other, native, sample === 'plain-1');
        await expect.poll(async () => (await f.read()).body!.dataStream).toBe(expectedText);
        await Promise.all([online(f.page), online(f.other)]);
        expect(f.errors).toEqual([]);
        expect(input.keydownAt).toHaveLength(expectedInputCount);
        expect(input.keyToFrameMs).toHaveLength(expectedInputCount);
        evidence.correctness =
          'exact saved/live peer text, sender/peer selections, undo/redo and Online passed';
        // Baselines deliberately retain failed-budget numbers as observations;
        // this environment flag changes no production policy or correctness gate.
        if (!baseline) {
          expect(native.highWater.history).toBeLessThanOrEqual(64);
          expect(native.highWater.collaboration).toBeLessThanOrEqual(64);
          expect(native.flushes.length).toBeGreaterThan(0);
          if (!profiled) {
            expect(frame.p95).toBeLessThanOrEqual(budgets[preset].inputP95Ms);
            expect(longTasks.max).toBeLessThanOrEqual(budgets[preset].longTaskMaxMs);
            expect(flush.p95).toBeLessThanOrEqual(budgets[preset].flushP95Ms);
            expect(flush.max).toBeLessThanOrEqual(budgets[preset].flushMaxMs);
            expect(drainUpperBoundMs).toBeLessThanOrEqual(1000);
          }
        }
      } finally {
        if (finishInput)
          evidence.partialInput = await finishInput().catch((error) => ({ error: String(error) }));
        if (profiling) {
          const result = await cdp.send('Profiler.stop').catch(() => null);
          if (result)
            await writeFile(
              info.outputPath('spn108-profile.cpuprofile'),
              JSON.stringify(result.profile),
            );
        }
        evidence.errors = f.errors;
        evidence.finalNative = await readDocResponsiveness(f.page).catch(() => null);
        await writeFile(info.outputPath('spn108-metrics.json'), JSON.stringify(evidence, null, 2));
        await cdp.detach().catch(() => {});
        await f.close();
      }
    });

// Keep candidate timing samples ahead of boundary-case server warm-up, matching
// the baseline sample order while retaining all artifacts in one test run.
registerDocResponsivenessBoundaries();
