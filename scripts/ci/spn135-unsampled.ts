import assert from 'node:assert/strict';

export const diagnosticSamples = ['plain-1', 'plain-2'] as const;
export const diagnosticGrep = 'desktop sustained native typing plain-[12]$';
export const diagnosticDeadlineMs = 660_000;

/** Reject retries, a missing predecessor, or a restarted worker/browser. */
export function createDiagnosticSequence() {
  let first: { browser: object; worker: number; pid: number; complete: boolean } | undefined;
  return {
    begin(sample: string, attempt: number, browser: object, worker: number, pid: number) {
      assert.equal(attempt, 0, 'Diagnostic retries are forbidden');
      assert.ok(diagnosticSamples.includes(sample as (typeof diagnosticSamples)[number]));
      if (sample === 'plain-1') {
        assert.equal(first, undefined, 'First diagnostic case repeated');
        first = { browser, worker, pid, complete: false };
      } else {
        assert.ok(first?.complete, 'Second diagnostic case requires completed plain-1');
        assert.equal(first.browser, browser, 'Diagnostic browser changed');
        assert.equal(first.worker, worker, 'Diagnostic worker changed');
        assert.equal(first.pid, pid, 'Diagnostic process changed');
      }
      return {
        workerIndex: worker,
        processId: pid,
        ordinal: sample === 'plain-1' ? 1 : 2,
        browserIdentity: `${pid}:${worker}:first-browser`,
        previousCaseCompleted: first.complete,
      };
    },
    complete(sample: string) {
      assert.ok(first);
      if (sample === 'plain-1') first.complete = true;
    },
  };
}

/** Applied to the existing reviewed overlay, with exact anchors and no native edits. */
export function prepareUnsampledHarness(source: string) {
  const replace = (before: string, after: string) => {
    assert.equal(source.split(before).length, 2, 'Unexpected unsampled harness anchor: ' + before);
    source = source.replace(before, after);
  };
  replace(
    "import { startDiagnosticTrace } from './spn135-trace.ts';",
    "import { startDiagnosticTrace } from './spn135-trace.ts';\nimport { createDiagnosticSequence } from './spn135-unsampled.ts';\nconst diagnosticSequence = createDiagnosticSequence();",
  );
  replace(
    "for (const sample of ['plain-1', 'plain-2', 'plain-3', 'profile'] as const)",
    "for (const sample of ['plain-1', 'plain-2'] as const)",
  );
  replace("        profiled = sample === 'profile';", '        profiled = false;');
  replace(
    '      const f = await fixture(browser, baseURL!, info, mobile);',
    `      const sequenceIdentity = diagnosticSequence.begin(sample, info.retry, browser, info.workerIndex, process.pid);
      const f = await fixture(browser, baseURL!, info, mobile);`,
  );
  replace(
    '        attempt: info.retry,',
    '        attempt: info.retry,\n        sequenceIdentity,',
  );
  replace('          browserTrace: profiled,', '          browserTrace: true,');
  replace(
    `        if (profiled) {
          finishTrace = await startDiagnosticTrace(cdp, info.outputPath('spn135-trace.json'));
          evidence.traceClockStart = await f.page.evaluate(() => performance.mark('spn135-clock-start').startTime);
          await cdp.send('Profiler.enable');
          await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
          const beforeMs = await f.page.evaluate(() => performance.now());
          await cdp.send('Profiler.start');
          profiling = true;
          const afterMs = await f.page.evaluate(() => performance.now());
          profilerClock = { beforeMs, afterMs };
          evidence.profilerStartBracket = profilerClock;
        }`,
    `        finishTrace = await startDiagnosticTrace(cdp, info.outputPath('spn135-trace.json'));
        evidence.traceClockStart = await f.page.evaluate(() => performance.mark('spn135-clock-start').startTime);`,
  );
  replace(
    `        if (profiling) {
          const { profile } = await cdp.send('Profiler.stop');
          profiling = false;
          evidence.profileSha256 = await retainProfile(profile, profilerClock, info);
          evidence.compositionCpu = compositionCpu(profile, profilerClock!, input.longTasks);
        }`,
    '',
  );
  replace(
    `        if (profiling) {
          const result = await cdp.send('Profiler.stop').catch(() => null);
          if (result)
            evidence.profileSha256 = await retainProfile(result.profile, profilerClock, info);
        }`,
    '',
  );
  replace(
    '        evidence.completed = true;',
    '        evidence.completed = true;\n        diagnosticSequence.complete(sample);',
  );
  assert.ok(
    !source.includes("cdp.send('Profiler."),
    'Profiler command remains in unsampled harness',
  );
  return source;
}
