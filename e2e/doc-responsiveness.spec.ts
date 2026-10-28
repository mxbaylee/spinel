import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import {
  compositionCpu,
  DOC_RESPONSIVENESS_BASELINE_HISTORY_LIMIT,
  DOC_RESPONSIVENESS_BUDGETS,
  DOC_RESPONSIVENESS_CANDIDATE_HISTORY_LIMIT,
  DOC_RESPONSIVENESS_GROUP_LIMIT,
  DOC_RESPONSIVENESS_SCHEMA,
  distribution,
  observeDocReloads,
  observeInput,
  readDocResponsiveness,
} from './doc-responsiveness.ts';
import type {
  CpuProfile,
  DocDrainDiagnostics,
  DocDrainWitness,
  DocIntegritySnapshot,
  DocNativeIntegrity,
  DocPreUndoIntegrity,
  DocReloadEvidence,
  DocReloadObserverStatus,
  DocResponsivenessEvidence,
  DocUndoRedoEvidence,
  ProfilerClockBracket,
} from './doc-responsiveness.ts';
import { registerDocResponsivenessBoundaries } from './doc-responsiveness-boundaries.ts';
import { fixture, focusEmptyDoc, exactText, saved, online } from './doc-responsiveness-fixture.ts';

// Recorded before the production fix. These are responsiveness budgets for this
// fixed workload/runtime, not physical-device, INP, or arbitrary-document claims.
const budgets = DOC_RESPONSIVENESS_BUDGETS;
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

async function retainProfile(
  profile: CpuProfile,
  clock: ProfilerClockBracket | undefined,
  info: TestInfo,
) {
  const json = JSON.stringify(profile);
  const sha256 = createHash('sha256').update(json).digest('hex');
  await Promise.all([
    writeFile(info.outputPath('spn108-profile.cpuprofile'), json),
    writeFile(
      info.outputPath('spn108-profile-clock.json'),
      JSON.stringify(
        {
          bracket: clock ?? null,
          profileStartTimeUs: profile.startTime,
          profileEndTimeUs: profile.endTime,
          sha256,
        },
        null,
        2,
      ),
    ),
  ]);
  return sha256;
}

type DocFixture = Awaited<ReturnType<typeof fixture>>;
type ReloadObservers = Record<'sender' | 'peer', Awaited<ReturnType<typeof observeDocReloads>>>;
type ClockOrigins = Record<'sender' | 'peer', number>;
const now = (page: Page) => page.evaluate(() => performance.now());
const fingerprint = (text: string) => ({
  textLength: text.length,
  textSha256: createHash('sha256').update(text).digest('hex'),
});

async function readReloads(observers: ReloadObservers) {
  const [sender, peer] = await Promise.all([observers.sender.read(), observers.peer.read()]);
  const reloads: DocReloadEvidence[] = [];
  const status: DocReloadObserverStatus[] = [];
  for (const [surface, value] of [
    ['sender', sender],
    ['peer', peer],
  ] as const) {
    const offset = value.timeOrigin - sender.timeOrigin;
    status.push({
      surface,
      installedAt: value.installedAt + offset,
      sourceInstalledAt: value.installedAt,
      sourceTimeOrigin: value.timeOrigin,
      dropped: value.dropped,
      malformed: value.malformed,
    });
    for (const event of value.events)
      reloads.push({
        ...event,
        surface,
        observedAt: event.observedAt + offset,
        sourceObservedAt: event.observedAt,
        sourceTimeOrigin: value.timeOrigin,
      });
  }
  return {
    reloads: reloads.toSorted((a, b) => a.observedAt - b.observedAt),
    status,
    origins: { sender: sender.timeOrigin, peer: peer.timeOrigin },
  };
}

function completeReloadObservation(value: Awaited<ReturnType<typeof readReloads>>) {
  for (const status of value.status) {
    expect(status.dropped).toBe(0);
    expect(status.malformed).toBe(0);
  }
}

async function integrity(f: DocFixture, origins: ClockOrigins): Promise<DocIntegritySnapshot> {
  const [sender, peer, stored] = await Promise.all([
    readDocResponsiveness(f.page, true),
    readDocResponsiveness(f.other, true),
    f.readState(),
  ]);
  const native = (value: DocResponsivenessEvidence | null, offset: number): DocNativeIntegrity => {
    expect(value).not.toBeNull();
    expect(typeof value!.text).toBe('string');
    return {
      unitId: value!.unitId,
      observedAt: value!.observedAt + offset,
      ...fingerprint(value!.text!),
      selection: value!.selection,
      history: value!.history,
      pending: value!.pending,
      highWater: value!.highWater,
    };
  };
  expect(Number.isSafeInteger(stored.revision)).toBe(true);
  return {
    observedAt: await now(f.page),
    sender: native(sender, 0),
    peer: native(peer, origins.peer - origins.sender),
    saved: { revision: stored.revision, ...fingerprint(stored.snapshot.body!.dataStream) },
  };
}

function exactIntegrity(value: DocIntegritySnapshot, text: string, selection: number) {
  const expected = fingerprint(text);
  for (const current of [value.sender, value.peer, value.saved])
    expect(current).toMatchObject(expected);
  expect(value.sender.unitId).toBe(value.peer.unitId);
  expect(value.sender.selection).toMatchObject({ start: selection, end: selection });
  expect(value.peer.selection).toMatchObject({ start: 0, end: 0 });
  expect(value.sender.pending).toEqual({ history: 0, collaboration: 0 });
  expect(value.peer.pending).toEqual({ history: 0, collaboration: 0 });
}

async function converge(f: DocFixture, text: string, origins: ClockOrigins) {
  await saved(f.page);
  await exactText(f.page, text);
  await exactText(f.other, text);
  await expect.poll(async () => (await f.read()).body!.dataStream, { timeout: 30_000 }).toBe(text);
  const value = await integrity(f, origins);
  exactIntegrity(value, text, text.length - 2);
  return value;
}

async function verifyUndoRedo(
  f: DocFixture,
  initial: DocPreUndoIntegrity,
  all: boolean,
  observers: ReloadObservers,
  origins: ClockOrigins,
  progress: Record<string, unknown>,
): Promise<DocUndoRedoEvidence> {
  const groups = all ? initial.sender.history.undos : 1;
  expect(groups).toBeGreaterThan(0);
  expect(initial.sender.history.undos).toBeLessThanOrEqual(
    baseline
      ? DOC_RESPONSIVENESS_BASELINE_HISTORY_LIMIT
      : DOC_RESPONSIVENESS_CANDIDATE_HISTORY_LIMIT,
  );
  expect(initial.sender.history.redos).toBe(0);
  progress.requestedGroups = groups;
  progress.phase = 'before-undo';
  const beforeUndoAt = await now(f.page);
  progress.beforeUndoAt = beforeUndoAt;
  await f.page.keyboard.press('Control+z');
  await saved(f.page);
  const undone = (await readDocResponsiveness(f.page, true))!;
  expect(undone.text).not.toBe(expectedText);
  expect(undone.text!.endsWith('\r\n')).toBe(true);
  expect(expectedText.startsWith(undone.text!.slice(0, -2))).toBe(true);
  expect(undone.selection).toMatchObject({
    start: undone.text!.length - 2,
    end: undone.text!.length - 2,
  });
  const firstUndo = await converge(f, undone.text!, origins);
  expect(firstUndo.sender.history).toEqual({
    undos: initial.sender.history.undos - 1,
    redos: 1,
  });
  progress.firstUndo = firstUndo;
  for (let group = 1; group < groups; group++) await f.page.keyboard.press('Control+z');
  await saved(f.page);
  let undo = firstUndo;
  if (all) {
    undo = await converge(f, '\r\n', origins);
    expect((await readDocResponsiveness(f.page))?.selection).toMatchObject({ start: 0, end: 0 });
  }
  expect(undo.sender.history).toEqual({
    undos: initial.sender.history.undos - groups,
    redos: groups,
  });
  progress.undo = undo;
  const afterUndoAt = await now(f.page);
  progress.afterUndoAt = afterUndoAt;
  const beforeRedoReloads = await readReloads(observers);
  completeReloadObservation(beforeRedoReloads);
  expect(beforeRedoReloads.reloads).toEqual([]);
  progress.phase = 'redo';
  const beforeRedoAt = await now(f.page);
  progress.beforeRedoAt = beforeRedoAt;
  // Pinned Univer's full-document SharedController binds Ctrl+Y off macOS;
  // the Shift+Z alternative is registered only for macOS.
  for (let group = 0; group < groups; group++) await f.page.keyboard.press('Control+y');
  // Observe a concrete outcome. A timeout or generic assertion error can never
  // select the documented baseline-only capacity-refusal branch.
  await expect
    .poll(
      async () => {
        const reloads = await readReloads(observers);
        completeReloadObservation(reloads);
        progress.reloads = reloads.reloads;
        if (reloads.reloads.length) return 'reload';
        const [sender, peer, stored] = await Promise.all([
          readDocResponsiveness(f.page, true),
          readDocResponsiveness(f.other, true),
          f.read(),
        ]);
        return sender?.text === expectedText &&
          sender.history.redos === 0 &&
          peer?.text === expectedText &&
          stored.body!.dataStream === expectedText
          ? 'converged'
          : 'pending';
      },
      { timeout: 30_000 },
    )
    .not.toBe('pending');
  const afterRedoAt = await now(f.page);
  progress.afterRedoAt = afterRedoAt;
  const observed = await readReloads(observers);
  completeReloadObservation(observed);
  let outcome: DocUndoRedoEvidence['outcome'] = 'passed';
  let final: DocIntegritySnapshot;
  if (observed.reloads.length) {
    expect(baseline, 'Candidate history must never reload or refuse an edit').toBe(true);
    expect(groups).toBe(1);
    expect(initial.sender.history.undos).toBe(1);
    expect(observed.reloads).toHaveLength(1);
    const [event] = observed.reloads;
    expect(event).toMatchObject({
      surface: 'sender',
      unitId: initial.sender.unitId,
      reason: 'capacity',
      clean: false,
    });
    expect(event!.observedAt).toBeGreaterThanOrEqual(beforeRedoAt);
    expect(event!.observedAt).toBeLessThanOrEqual(afterRedoAt);
    exactIntegrity(undo, '\r\n', 0);
    expect(undo.sender.history).toEqual({ undos: 0, redos: 1 });
    progress.phase = 'baseline-capacity-recovery';
    final = await converge(f, '\r\n', origins);
    expect(final.saved.revision).toBe(undo.saved.revision);
    expect(final.sender.history).toEqual({ undos: 0, redos: 0 });
    expect(final.sender.highWater).toEqual({ history: 0, collaboration: 0 });
    outcome = 'baseline-capacity-refusal';
  } else {
    final = await converge(f, expectedText, origins);
    expect(final.sender.history).toEqual({ undos: initial.sender.history.undos, redos: 0 });
  }
  progress.final = final;
  const last = await readReloads(observers);
  completeReloadObservation(last);
  expect(last.reloads).toEqual(observed.reloads);
  const result: DocUndoRedoEvidence = {
    outcome,
    requestedGroups: groups,
    beforeUndoAt,
    afterUndoAt,
    beforeRedoAt,
    afterRedoAt,
    finalObservedAt: final.observedAt,
    ...(outcome === 'baseline-capacity-refusal' ? { recoveredAt: final.observedAt } : {}),
    firstUndo,
    undo,
    final,
    reloads: last.reloads,
  };
  progress.phase = outcome;
  return result;
}

for (const preset of ['desktop', 'mobile'] as const)
  for (const sample of ['plain-1', 'plain-2', 'plain-3', 'profile'] as const)
    test(`${preset} sustained native typing ${sample}`, async ({ browser, baseURL }, info) => {
      // The first throttled baseline spent 255–266 s typing before its existing
      // native stall. Preserve that workload and allow collection to finish;
      // candidate case limits and all responsiveness budgets stay unchanged.
      test.setTimeout(baseline ? 600_000 : 300_000);
      const mobile = preset === 'mobile',
        profiled = sample === 'profile';
      const f = await fixture(browser, baseURL!, info, mobile);
      const cdp = await f.page.context().newCDPSession(f.page);
      let finishInput: Awaited<ReturnType<typeof observeInput>> | undefined;
      let profiling = false;
      let profilerClock: ProfilerClockBracket | undefined;
      let reloadObservers: ReloadObservers | undefined;
      let clockOrigins: ClockOrigins | undefined;
      const drainDiagnostics: DocDrainDiagnostics = {
        nodeTimeOrigin: performance.timeOrigin,
        polls: [],
        firstEmpty: null,
      };
      const evidence: Record<string, unknown> = {
        schema: DOC_RESPONSIVENESS_SCHEMA,
        role: baseline ? 'baseline-observation' : 'candidate',
        budgetEnforced: !baseline && !profiled,
        preset,
        sample,
        attempt: info.retry,
        caseObservationTimeoutMs: baseline ? 600_000 : 300_000,
        nativeDrainObservationTimeoutMs: baseline ? 120_000 : 30_000,
        drainDiagnostics,
        source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        dirtyPaths: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
        harnessSha256: Object.fromEntries(
          await Promise.all(
            [
              'e2e/doc-responsiveness.ts',
              'e2e/doc-responsiveness.spec.ts',
              'e2e/doc-responsiveness-fixture.ts',
              'e2e/doc-responsiveness-boundaries.ts',
              'web/docResponsivenessEvidence.ts',
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
        playwright: JSON.parse(await readFile('node_modules/@playwright/test/package.json', 'utf8'))
          .version,
        runtime: process.version,
        system: {
          platform: platform(),
          architecture: arch(),
          release: release(),
          cpu: cpus()[0]?.model,
          cpus: cpus().length,
          totalmem: totalmem(),
        },
        runner: {
          name: process.env.RUNNER_NAME ?? 'local',
          os: process.env.RUNNER_OS ?? platform(),
          arch: process.env.RUNNER_ARCH ?? arch(),
          run: process.env.GITHUB_RUN_ID ?? null,
          attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
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
          nativeDrainWitness: 'browser-local-events-microtask',
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
        const [senderReloads, peerReloads] = await Promise.all([
          observeDocReloads(f.page),
          observeDocReloads(f.other),
        ]);
        reloadObservers = { sender: senderReloads, peer: peerReloads };
        const installed = await readReloads(reloadObservers);
        completeReloadObservation(installed);
        expect(installed.reloads).toEqual([]);
        evidence.reloadObservers = installed.status;
        clockOrigins = installed.origins;
        await Promise.all([saved(f.page), saved(f.other), online(f.page), online(f.other)]);
        await focusEmptyDoc(f.other, mobile);
        await f.page.bringToFront();
        await focusEmptyDoc(f.page, mobile);
        const initialNative = (await readDocResponsiveness(f.page))!;
        expect(initialNative.mobile).toBe(mobile);
        expect(
          await f.page.evaluate(
            () => matchMedia('(pointer: coarse) and (max-width: 900px)').matches,
          ),
        ).toBe(mobile);
        evidence.browserEnvironment = {
          configured: {
            viewport: f.page.viewportSize(),
            isMobile: mobile,
            hasTouch: mobile,
            deviceScaleFactor: 1,
          },
          observed: await f.page.evaluate(() => ({
            viewport: { width: innerWidth, height: innerHeight },
            screen: { width: screen.width, height: screen.height },
            devicePixelRatio,
            coarsePointer: matchMedia('(pointer: coarse)').matches,
            touchEvent: 'ontouchstart' in window,
            maxTouchPoints: navigator.maxTouchPoints,
            userAgent: navigator.userAgent,
          })),
        };
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: mobile ? 4 : 1 });
        evidence.heapBefore = await cdp.send('Runtime.getHeapUsage');
        if (profiled) {
          await cdp.send('Profiler.enable');
          await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
          const beforeMs = await f.page.evaluate(() => performance.now());
          await cdp.send('Profiler.start');
          profiling = true;
          const afterMs = await f.page.evaluate(() => performance.now());
          profilerClock = { beforeMs, afterMs };
          evidence.profilerStartBracket = profilerClock;
        }
        const armedNative = await readDocResponsiveness(f.page, false, {
          action: 'arm',
          epoch: randomUUID(),
          unitId: initialNative.unitId,
          timeOrigin: clockOrigins.sender,
          expectedCompletedStates: expectedInputCount,
        });
        const drainArm = armedNative?.drainWitness;
        evidence.drainArm = drainArm;
        expect(drainArm).toBeTruthy();
        expect(drainArm!.invalidated).toBe(false);
        expect(drainArm!.invalidations).toEqual([]);
        expect(drainArm!.completedStates).toBe(0);
        expect(drainArm!.initial.pending).toEqual({ history: 0, collaboration: 0 });
        expect(drainArm!.initial.history).toEqual({ undos: 0, redos: 0 });
        expect(drainArm!.firstEmpty).toBeNull();
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
          .poll(
            async () => {
              const requestAt = performance.now();
              let snapshot: DocResponsivenessEvidence | null = null;
              try {
                snapshot = await readDocResponsiveness(f.page);
                return snapshot?.pending;
              } finally {
                const poll = {
                  index: drainDiagnostics.polls.length,
                  requestAt,
                  returnedAt: performance.now(),
                  snapshot: snapshot
                    ? {
                        unitId: snapshot.unitId,
                        observedAt: snapshot.observedAt,
                        pending: snapshot.pending,
                        highWater: snapshot.highWater,
                        history: snapshot.history,
                      }
                    : null,
                };
                drainDiagnostics.polls.push(poll);
                if (
                  !drainDiagnostics.firstEmpty &&
                  snapshot?.pending.history === 0 &&
                  snapshot.pending.collaboration === 0
                )
                  drainDiagnostics.firstEmpty = poll;
              }
            },
            {
              // A 4×-throttled observation of the existing 14.857 s pair may
              // exceed 30 s. Only baseline collection has this wider window;
              // candidate acceptance remains the separate <=1,000 ms drain gate.
              timeout: baseline ? 120_000 : 30_000,
              intervals: [25],
            },
          )
          .toEqual({ history: 0, collaboration: 0 });
        evidence.drainObservationMs = performance.now() - drainStarted;
        const finishInputRequestedAt = performance.now();
        const input = await finishInput();
        drainDiagnostics.finishInputNodeBracket = {
          requestAt: finishInputRequestedAt,
          returnedAt: performance.now(),
        };
        finishInput = undefined;
        const finalNativeRequestedAt = performance.now();
        const native = (await readDocResponsiveness(f.page))!;
        drainDiagnostics.finalNativeNodeBracket = {
          requestAt: finalNativeRequestedAt,
          returnedAt: performance.now(),
        };
        evidence.native = native;
        evidence.input = input;
        const frame = distribution(input.keyToFrameMs);
        const gaps = input.keydownAt.slice(1).map((at, index) => at - input.keydownAt[index]!);
        const longTasks = distribution(input.longTasks.map((task) => task.durationMs));
        const capacityFlushes = native.flushes.filter((entry) => entry.reason === 'capacity');
        const idleFlushes = native.flushes.filter((entry) => entry.reason === 'idle');
        const capacityFlush = capacityFlushes.length
          ? distribution(capacityFlushes.map((entry) => entry.durationMs))
          : null;
        const idleFlush = idleFlushes.length
          ? distribution(idleFlushes.map((entry) => entry.durationMs))
          : null;
        const flushMaximum = native.flushes.length
          ? Math.max(...native.flushes.map((entry) => entry.durationMs))
          : null;
        const drainUpperBoundMs = native.observedAt - input.keydownAt.at(-1)!;
        const localDrainMs = native.drainWitness?.firstEmpty
          ? native.drainWitness.firstEmpty.observedAt - input.keydownAt.at(-1)!
          : null;
        evidence.summary = {
          frameOpportunityMs: frame,
          interKeyGapMs: distribution(gaps),
          debounceBreakingGaps: gaps.filter((gap) => gap >= 300).length,
          longTaskMs: longTasks,
          totalBlockingMs: input.longTasks.reduce(
            (sum, task) => sum + Math.max(0, task.durationMs - 50),
            0,
          ),
          capacityFlushPairMs: capacityFlush,
          idleFlushPairMs: idleFlush,
          pairedFlushMaximumMs: flushMaximum,
          postFinalKeyDrainUpperBoundMs: drainUpperBoundMs,
          firstVerifiedBrowserLocalDrainMs: localDrainMs,
          lateReadMinusLocalWitnessMs:
            localDrainMs === null ? null : drainUpperBoundMs - localDrainMs,
          drainAcceptanceMetric: 'first-verified-browser-local-empty',
        };
        evidence.budgetResults = {
          inputP95: frame.p95 <= budgets[preset].inputP95Ms,
          longestTask: longTasks.max <= budgets[preset].longTaskMaxMs,
          capacityFlushP95: capacityFlush ? capacityFlush.p95 <= budgets[preset].flushP95Ms : null,
          idleFlushP95: idleFlush ? idleFlush.p95 <= budgets[preset].flushP95Ms : null,
          flushMaximum: flushMaximum === null ? null : flushMaximum <= budgets[preset].flushMaxMs,
          boundedHistory: native.highWater.history <= DOC_RESPONSIVENESS_GROUP_LIMIT,
          boundedCollaboration: native.highWater.collaboration <= DOC_RESPONSIVENESS_GROUP_LIMIT,
          observedCapacityFlushes: capacityFlushes.length > 0,
          browserLocalDrainedWithinOneSecond: localDrainMs === null ? null : localDrainMs <= 1000,
        };
        evidence.lateReadDiagnostic = {
          withinOneSecond: drainUpperBoundMs <= 1000,
          acceptanceGate: false,
        };
        evidence.heapAfter = await cdp.send('Runtime.getHeapUsage');
        if (profiling) {
          const { profile } = await cdp.send('Profiler.stop');
          profiling = false;
          evidence.profileSha256 = await retainProfile(profile, profilerClock, info);
          evidence.compositionCpu = compositionCpu(profile, profilerClock!, input.longTasks);
        }
        evidence.timingCompleteAt = await now(f.page);
        evidence.timingComplete = true;
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
        const initial = await integrity(f, clockOrigins);
        exactIntegrity(initial, expectedText, expectedInputCount);
        expect(initial.sender.history).toEqual(native.history);
        const initialReloads = await readReloads(reloadObservers);
        completeReloadObservation(initialReloads);
        expect(initialReloads.reloads).toEqual([]);
        const preUndoIntegrity: DocPreUndoIntegrity = {
          ...initial,
          passed: true,
          reloads: initialReloads.reloads,
        };
        evidence.preUndoIntegrity = preUndoIntegrity;
        const sealedNative = await readDocResponsiveness(f.page, false, {
          action: 'seal',
          epoch: drainArm!.epoch,
          generation: drainArm!.generation,
          unitId: drainArm!.unitId,
          timeOrigin: drainArm!.timeOrigin,
        });
        const drainWitness = sealedNative?.drainWitness as DocDrainWitness | null | undefined;
        evidence.drainWitness = drainWitness;
        expect(drainWitness).toBeTruthy();
        expect(drainWitness!.invalidated).toBe(false);
        expect(drainWitness!.invalidations).toEqual([]);
        expect(drainWitness!.epoch).toBe(drainArm!.epoch);
        expect(drainWitness!.generation).toBe(drainArm!.generation);
        expect(drainWitness!.unitId).toBe(native.unitId);
        expect(drainWitness!.timeOrigin).toBe(input.timeOrigin);
        expect(drainWitness!.expectedCompletedStates).toBe(expectedInputCount);
        expect(drainWitness!.completedStates).toBe(expectedInputCount);
        expect(drainWitness!.lastCompletedStateAt!).toBeGreaterThanOrEqual(input.keydownAt.at(-1)!);
        expect(drainWitness!.firstEmpty).toBeTruthy();
        expect(drainWitness!.firstEmpty).toEqual(native.drainWitness?.firstEmpty);
        expect(drainWitness!.firstEmpty!.observedAt).toBeGreaterThanOrEqual(
          drainWitness!.lastCompletedStateAt!,
        );
        expect(drainWitness!.firstEmpty!.pending).toEqual({ history: 0, collaboration: 0 });
        expect(drainWitness!.firstEmpty!.history).toEqual(native.history);
        expect(drainWitness!.firstEmpty!.highWater).toEqual(native.highWater);
        expect(drainWitness!.sealedAt!).toBeGreaterThanOrEqual(preUndoIntegrity.observedAt);
        const historyProgress: Record<string, unknown> = { phase: 'not-started' };
        evidence.undoRedoObservation = historyProgress;
        const undoRedo = await verifyUndoRedo(
          f,
          preUndoIntegrity,
          sample === 'plain-1',
          reloadObservers,
          clockOrigins,
          historyProgress,
        );
        evidence.undoRedo = undoRedo;
        expect(drainWitness!.sealedAt!).toBeLessThanOrEqual(undoRedo.beforeUndoAt);
        await expect
          .poll(async () => (await f.read()).body!.dataStream)
          .toBe(undoRedo.outcome === 'passed' ? expectedText : '\r\n');
        await Promise.all([online(f.page), online(f.other)]);
        expect(f.errors).toEqual([]);
        expect(input.keydownAt).toHaveLength(expectedInputCount);
        expect(input.keyToFrameMs).toHaveLength(expectedInputCount);
        evidence.correctness =
          undoRedo.outcome === 'passed'
            ? 'exact saved/live peer text, sender/peer selections, undo/redo and Online passed'
            : 'baseline redo refused at capacity; exact prior typing and Undo verified; recovered saved empty state';
        // Schema 4 retains the strict baseline history outcome and separately
        // observes capacity/idle work. Drain acceptance now uses the preregistered
        // browser-local witness; the unchanged late-read scalar remains descriptive.
        if (!baseline) {
          expect(native.highWater.history).toBeLessThanOrEqual(DOC_RESPONSIVENESS_GROUP_LIMIT);
          expect(native.highWater.collaboration).toBeLessThanOrEqual(
            DOC_RESPONSIVENESS_GROUP_LIMIT,
          );
          expect(capacityFlushes.length).toBeGreaterThan(0);
          for (const entry of native.flushes) {
            expect(['capacity', 'idle']).toContain(entry.reason);
            expect(Number.isInteger(entry.history) && entry.history >= 0).toBe(true);
            expect(Number.isInteger(entry.collaboration) && entry.collaboration >= 0).toBe(true);
            const pending = Math.max(entry.history, entry.collaboration);
            expect(pending).toBeGreaterThan(0);
            expect(pending).toBeLessThanOrEqual(DOC_RESPONSIVENESS_GROUP_LIMIT);
            if (entry.reason === 'capacity') expect(pending).toBe(DOC_RESPONSIVENESS_GROUP_LIMIT);
            if (entry.reason === 'idle') {
              expect(Number.isFinite(entry.quietForMs)).toBe(true);
              expect(entry.quietForMs!).toBeGreaterThanOrEqual(300);
            }
          }
          if (!profiled) {
            expect(frame.p95).toBeLessThanOrEqual(budgets[preset].inputP95Ms);
            expect(longTasks.max).toBeLessThanOrEqual(budgets[preset].longTaskMaxMs);
            // Idle samples must never dilute the registered capacity distribution.
            expect(capacityFlush!.p95).toBeLessThanOrEqual(budgets[preset].flushP95Ms);
            expect(capacityFlush!.max).toBeLessThanOrEqual(budgets[preset].flushMaxMs);
            if (idleFlush) {
              expect(idleFlush.p95).toBeLessThanOrEqual(budgets[preset].flushP95Ms);
              expect(idleFlush.max).toBeLessThanOrEqual(budgets[preset].flushMaxMs);
            }
            expect(flushMaximum!).toBeLessThanOrEqual(budgets[preset].flushMaxMs);
            expect(localDrainMs).not.toBeNull();
            expect(localDrainMs!).toBeLessThanOrEqual(1000);
          }
        }
        const finalReloads = await readReloads(reloadObservers);
        completeReloadObservation(finalReloads);
        expect(finalReloads.reloads).toEqual(undoRedo.reloads);
        evidence.reloadObservers = finalReloads.status;
        evidence.completed = true;
      } finally {
        if (finishInput)
          evidence.partialInput = await finishInput().catch((error) => ({ error: String(error) }));
        if (profiling) {
          const result = await cdp.send('Profiler.stop').catch(() => null);
          if (result)
            evidence.profileSha256 = await retainProfile(result.profile, profilerClock, info);
        }
        evidence.errors = f.errors;
        evidence.finalNative = await readDocResponsiveness(f.page).catch(() => null);
        if (reloadObservers) {
          const finalReloads = await readReloads(reloadObservers).catch(() => null);
          if (finalReloads) {
            evidence.reloadObservers = finalReloads.status;
            evidence.finalReloads = finalReloads.reloads;
          }
          await Promise.all([reloadObservers.sender.dispose(), reloadObservers.peer.dispose()]);
        }
        await writeFile(info.outputPath('spn108-metrics.json'), JSON.stringify(evidence, null, 2));
        await cdp.detach().catch(() => {});
        await f.close();
      }
    });

/** Only the separate continuation case reads native state at its final key's first frame. */
async function observeContinuationFrame(page: Page, unitId: string) {
  const handle = await page.evaluateHandle(
    ({ unitId, expectedKeys }) => {
      const installedAt = performance.now();
      let keyCount = 0;
      let frame: number | undefined;
      let result: {
        keyAt: number;
        frameAt: number;
        readStartedAt: number;
        readReturnedAt: number;
        responses: number;
        snapshot: DocResponsivenessEvidence | null;
      } | null = null;
      const keydown = (event: KeyboardEvent) => {
        if (
          !(event.target instanceof Element) ||
          !event.target.matches('[contenteditable="true"][data-u-comp="editor"]')
        )
          return;
        keyCount++;
        if (keyCount !== expectedKeys) return;
        const keyAt = performance.now();
        frame = requestAnimationFrame(() => {
          frame = undefined;
          const frameAt = performance.now();
          let snapshot: DocResponsivenessEvidence | null = null;
          let responses = 0;
          const read = (event: Event) => {
            const evidence = (event as CustomEvent<DocResponsivenessEvidence>).detail;
            if (evidence?.unitId !== unitId) return;
            responses++;
            snapshot = evidence;
          };
          window.addEventListener('spinel-doc-responsiveness-evidence', read);
          const readStartedAt = performance.now();
          try {
            window.dispatchEvent(
              new CustomEvent('spinel-doc-responsiveness-read', { detail: { includeText: true } }),
            );
          } finally {
            window.removeEventListener('spinel-doc-responsiveness-evidence', read);
            result = {
              keyAt,
              frameAt,
              readStartedAt,
              readReturnedAt: performance.now(),
              responses,
              snapshot,
            };
          }
        });
      };
      document.addEventListener('keydown', keydown, { capture: true, passive: true });
      return {
        read: () => ({ installedAt, unitId, expectedKeys, keyCount, result }),
        dispose() {
          document.removeEventListener('keydown', keydown, true);
          if (frame !== undefined) cancelAnimationFrame(frame);
        },
      };
    },
    { unitId, expectedKeys: expectedInputCount + 1 },
  );
  return {
    read: () => handle.evaluate((value) => value.read()),
    async dispose() {
      await handle.evaluate((value) => value.dispose()).catch(() => {});
      await handle.dispose();
    },
  };
}

for (const preset of ['desktop', 'mobile'] as const)
  test(`${preset} resumes native typing after a quiet pause`, async ({
    browser,
    baseURL,
  }, info) => {
    test.skip(baseline, 'The renewed-input regression is a candidate-only gate.');
    test.setTimeout(300_000);
    const mobile = preset === 'mobile';
    const f = await fixture(browser, baseURL!, info, mobile);
    const cdp = await f.page.context().newCDPSession(f.page);
    let finishInput: Awaited<ReturnType<typeof observeInput>> | undefined;
    let continuationFrameObserver: Awaited<ReturnType<typeof observeContinuationFrame>> | undefined;
    let reloadObservers: ReloadObservers | undefined;
    const evidence: Record<string, unknown> = {
      schema: DOC_RESPONSIVENESS_SCHEMA,
      scenario: 'resume-native-typing-after-quiet-pause',
      preset,
      attempt: info.retry,
      source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      browser: browser.version(),
      playwright: JSON.parse(await readFile('node_modules/@playwright/test/package.json', 'utf8'))
        .version,
      runtime: process.version,
      nodeTimeOrigin: performance.timeOrigin,
      system: {
        platform: platform(),
        architecture: arch(),
        release: release(),
        cpu: cpus()[0]?.model,
        cpus: cpus().length,
        totalmem: totalmem(),
      },
      runner: {
        name: process.env.RUNNER_NAME ?? 'local',
        run: process.env.GITHUB_RUN_ID ?? null,
        attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      },
      instrumentation: {
        cpuThrottle: mobile ? 4 : 1,
        profiler: false,
        playwrightTrace: false,
        physicalDevice: false,
      },
      fixture: {
        originalInputCount: expectedInputCount,
        continuation: 'x',
        totalInputCount: expectedInputCount + 1,
        originalTextSha256: createHash('sha256').update(expectedText).digest('hex'),
      },
      budgets: {
        requestedQuietPauseMs: 350,
        continuationRequestReturnMs: 1000,
        continuationKeyToFrameMs: budgets[preset].longTaskMaxMs,
        continuationKeyToNativeReadMs: budgets[preset].longTaskMaxMs,
        finalOriginalKeyToContinuationFrameMs: 350 + 1000 + budgets[preset].longTaskMaxMs,
        finalOriginalKeyToContinuationNativeReadMs: 350 + 1000 + budgets[preset].longTaskMaxMs,
      },
      harnessSha256: Object.fromEntries(
        await Promise.all(
          [
            'e2e/doc-responsiveness.ts',
            'e2e/doc-responsiveness.spec.ts',
            'e2e/doc-responsiveness-fixture.ts',
            'e2e/doc-responsiveness-boundaries.ts',
            'web/docResponsivenessEvidence.ts',
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
    };
    try {
      await Promise.all([f.page.goto(`/?item=${f.item.id}`), f.other.goto(`/?item=${f.item.id}`)]);
      const [senderReloads, peerReloads] = await Promise.all([
        observeDocReloads(f.page),
        observeDocReloads(f.other),
      ]);
      reloadObservers = { sender: senderReloads, peer: peerReloads };
      await Promise.all([saved(f.page), saved(f.other), online(f.page), online(f.other)]);
      await focusEmptyDoc(f.other, mobile);
      await f.page.bringToFront();
      await focusEmptyDoc(f.page, mobile);
      evidence.browserEnvironment = {
        configured: {
          viewport: f.page.viewportSize(),
          isMobile: mobile,
          hasTouch: mobile,
          deviceScaleFactor: 1,
        },
        observed: await f.page.evaluate(() => ({
          viewport: { width: innerWidth, height: innerHeight },
          screen: { width: screen.width, height: screen.height },
          devicePixelRatio,
          coarsePointer: matchMedia('(pointer: coarse)').matches,
          touchEvent: 'ontouchstart' in window,
          maxTouchPoints: navigator.maxTouchPoints,
          userAgent: navigator.userAgent,
          visibility: document.visibilityState,
          hasFocus: document.hasFocus(),
        })),
      };
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: mobile ? 4 : 1 });
      const initialNative = (await readDocResponsiveness(f.page))!;
      expect(initialNative.mobile).toBe(mobile);
      finishInput = await observeInput(f.page);
      continuationFrameObserver = await observeContinuationFrame(f.page, initialNative.unitId);
      const originalRequestedAt = performance.now();
      for (const [index, paragraph] of paragraphs.entries()) {
        if (index > 0) await f.page.keyboard.press('Enter');
        await f.page.keyboard.type(paragraph);
      }
      const originalReturnedAt = performance.now();
      evidence.originalTypingNodeBracket = {
        requestAt: originalRequestedAt,
        returnedAt: originalReturnedAt,
      };
      const pauseStartedAt = performance.now();
      // No browser read or evaluation separates the original input from this key.
      await new Promise<void>((resolve) => setTimeout(resolve, 350));
      const continuationRequestedAt = performance.now();
      await f.page.keyboard.type('x');
      const continuationReturnedAt = performance.now();
      evidence.quietPauseNodeBracket = {
        startedAt: pauseStartedAt,
        returnedAt: continuationRequestedAt,
        requestedMs: 350,
      };
      evidence.continuationNodeBracket = {
        requestAt: continuationRequestedAt,
        returnedAt: continuationReturnedAt,
      };
      const input = await finishInput();
      finishInput = undefined;
      evidence.input = input;
      const frameEvidence = await continuationFrameObserver.read();
      evidence.continuationFrame = frameEvidence;
      expect(frameEvidence.installedAt).toBeLessThanOrEqual(input.keydownAt[0]!);
      expect(frameEvidence.keyCount).toBe(expectedInputCount + 1);
      expect(frameEvidence.result).toBeTruthy();
      const observedFrame = frameEvidence.result!;
      const finalOriginalKeyAt = input.keydownAt[expectedInputCount - 1]!;
      const continuationKeyAt = input.keydownAt[expectedInputCount]!;
      const continuationFrameAt = observedFrame.frameAt;
      const continuationFrameMs = continuationFrameAt - continuationKeyAt;
      const continuationNativeReadMs = observedFrame.readReturnedAt - continuationKeyAt;
      const continuationRequestReturnMs = continuationReturnedAt - continuationRequestedAt;
      const finalOriginalKeyToContinuationFrameMs = continuationFrameAt - finalOriginalKeyAt;
      const finalOriginalKeyToContinuationNativeReadMs =
        observedFrame.readReturnedAt - finalOriginalKeyAt;
      evidence.summary = {
        finalOriginalKeyAt,
        continuationKeyAt,
        continuationFrameAt,
        browserQuietGapMs: continuationKeyAt - finalOriginalKeyAt,
        continuationKeyToFrameMs: continuationFrameMs,
        continuationKeyToNativeReadMs: continuationNativeReadMs,
        continuationRequestReturnMs,
        finalOriginalKeyToContinuationFrameMs,
        finalOriginalKeyToContinuationNativeReadMs,
      };
      const continuedText = expectedText.slice(0, -2) + 'x\r\n';
      expect(observedFrame.responses).toBe(1);
      expect(observedFrame.keyAt).toBeGreaterThanOrEqual(continuationKeyAt);
      expect(observedFrame.readStartedAt).toBeGreaterThanOrEqual(observedFrame.frameAt);
      expect(observedFrame.snapshot?.observedAt).toBeGreaterThanOrEqual(
        observedFrame.readStartedAt,
      );
      expect(observedFrame.snapshot?.observedAt).toBeLessThanOrEqual(observedFrame.readReturnedAt);
      expect(observedFrame.snapshot?.unitId).toBe(initialNative.unitId);
      expect(observedFrame.snapshot?.text).toBe(continuedText);
      expect(observedFrame.snapshot?.text?.length).toBe(2089);
      expect(observedFrame.snapshot?.selection).toMatchObject({ start: 2087, end: 2087 });
      await Promise.all([
        saved(f.page),
        saved(f.other),
        exactText(f.page, continuedText),
        exactText(f.other, continuedText),
      ]);
      await expect
        .poll(async () => (await f.read()).body!.dataStream, { timeout: 30_000 })
        .toBe(continuedText);
      const sender = (await readDocResponsiveness(f.page, true))!;
      const peer = (await readDocResponsiveness(f.other, true))!;
      evidence.native = sender;
      evidence.peer = {
        unitId: peer.unitId,
        observedAt: peer.observedAt,
        textLength: peer.text?.length,
        textSha256: createHash('sha256')
          .update(peer.text ?? '')
          .digest('hex'),
        selection: peer.selection,
      };
      const savedText = (await f.read()).body!.dataStream;
      expect(savedText).toBe(continuedText);
      evidence.saved = {
        textLength: savedText.length,
        textSha256: createHash('sha256').update(savedText).digest('hex'),
      };
      expect(input.keydownAt).toHaveLength(expectedInputCount + 1);
      expect(input.keyToFrameMs).toHaveLength(expectedInputCount + 1);
      expect(continuationKeyAt - finalOriginalKeyAt).toBeGreaterThanOrEqual(300);
      expect(continuationRequestReturnMs).toBeLessThanOrEqual(1000);
      expect(continuationFrameMs).toBeLessThanOrEqual(budgets[preset].longTaskMaxMs);
      expect(continuationNativeReadMs).toBeLessThanOrEqual(budgets[preset].longTaskMaxMs);
      expect(finalOriginalKeyToContinuationFrameMs).toBeLessThanOrEqual(
        350 + 1000 + budgets[preset].longTaskMaxMs,
      );
      expect(finalOriginalKeyToContinuationNativeReadMs).toBeLessThanOrEqual(
        350 + 1000 + budgets[preset].longTaskMaxMs,
      );
      expect(sender.text).toBe(continuedText);
      expect(sender.selection).toMatchObject({
        start: expectedInputCount + 1,
        end: expectedInputCount + 1,
      });
      expect(peer.text).toBe(continuedText);
      expect(peer.selection).toMatchObject({ start: 0, end: 0 });
      expect(f.errors).toEqual([]);
      await Promise.all([online(f.page), online(f.other)]);
      const finalReloads = await readReloads(reloadObservers);
      completeReloadObservation(finalReloads);
      evidence.reloadObservers = finalReloads.status;
      evidence.reloads = finalReloads.reloads;
      expect(finalReloads.reloads).toEqual([]);
      evidence.completed = true;
    } finally {
      if (finishInput)
        evidence.partialInput = await finishInput().catch((error) => ({ error: String(error) }));
      evidence.errors = f.errors;
      if (continuationFrameObserver) {
        const finalFrame = await continuationFrameObserver.read().catch(() => null);
        if (finalFrame) evidence.continuationFrame = finalFrame;
        await continuationFrameObserver.dispose();
      }
      if (reloadObservers) {
        const finalReloads = await readReloads(reloadObservers).catch(() => null);
        if (finalReloads) {
          evidence.reloadObservers = finalReloads.status;
          evidence.reloads = finalReloads.reloads;
        }
        await Promise.all([reloadObservers.sender.dispose(), reloadObservers.peer.dispose()]);
      }
      await writeFile(info.outputPath('spn108-post-burst.json'), JSON.stringify(evidence, null, 2));
      await cdp.detach().catch(() => {});
      await f.close();
    }
  });

// Keep candidate timing samples ahead of boundary-case server warm-up, matching
// the baseline sample order while retaining all artifacts in one test run.
registerDocResponsivenessBoundaries();
