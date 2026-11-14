import { writeFile } from 'node:fs/promises';
import type { Browser, BrowserContext, Request, TestInfo } from '@playwright/test';

const traceLimits = { events: 16_384, bytes: 4 * 1024 * 1024 };
const requestLimit = 1024;
const phaseLimit = 64;
const collectionMs = 5000;
const persistenceMs = 2000;

/** No overwritten prefix or empty capture can be reported as complete evidence. */
export function upgradeTraceBuffer() {
  const events: Record<string, unknown>[] = [];
  let sourceEvents = 0;
  let bytes = 0;
  let dropped = 0;
  let malformed = 0;
  let workerEvents = 0;
  return {
    append(values: unknown) {
      if (!Array.isArray(values)) {
        malformed++;
        return;
      }
      for (const value of values) {
        sourceEvents++;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          malformed++;
          continue;
        }
        const metadata = value.ph === 'M';
        if (
          typeof value.name !== 'string' ||
          typeof value.ph !== 'string' ||
          value.ph.length !== 1 ||
          !(typeof value.cat === 'string' || (metadata && value.cat === undefined)) ||
          !(
            (typeof value.ts === 'number' && Number.isFinite(value.ts)) ||
            (metadata && value.ts === undefined)
          )
        ) {
          malformed++;
          continue;
        }
        const size = Buffer.byteLength(JSON.stringify(value));
        if (dropped || events.length === traceLimits.events || bytes + size > traceLimits.bytes) {
          dropped++;
          continue;
        }
        events.push(value);
        bytes += size;
        if (
          !metadata &&
          typeof value.cat === 'string' &&
          value.cat.split(',').includes('ServiceWorker')
        )
          workerEvents++;
      }
    },
    result(terminal: { dataLossOccurred: boolean } | undefined) {
      return {
        limits: traceLimits,
        sourceEvents,
        retainedEvents: events.length,
        retainedBytes: bytes,
        dropped,
        malformed,
        workerEvents,
        complete:
          Boolean(terminal) &&
          terminal?.dataLossOccurred === false &&
          dropped === 0 &&
          malformed === 0 &&
          workerEvents > 0,
        terminal: terminal ?? null,
        events,
      };
    },
  };
}

async function before<T>(promise: Promise<T>, deadline: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded its collection deadline.`)),
          Math.max(1, deadline - Date.now()),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Passive Chromium diagnostics, begun before the first old-worker operation.
 * The caller owns the browser and must close it even if collection fails.
 * Trace and Node phase clocks remain separate; no latency comparison is inferred.
 */
export async function startOfflineUpgradeObservation(
  browser: Browser,
  context: BrowserContext,
  info: Pick<TestInfo, 'outputPath' | 'project' | 'testId' | 'retry'>,
  identities: Readonly<Record<string, string>>,
) {
  const startedAt = new Date().toISOString();
  const began = performance.now();
  const elapsedMs = () => Math.round(performance.now() - began);
  const trace = upgradeTraceBuffer();
  const phases: { phase: string; elapsedMs: number }[] = [];
  const requests: Record<string, unknown>[] = [];
  const pending = new Map<Request, Record<string, unknown>>();
  let droppedRequests = 0;
  let droppedPhases = 0;
  let truncatedPaths = 0;
  let maximumBufferUse = 0;
  let started = false;
  let terminal: { dataLossOccurred: boolean } | undefined;
  const cdp = await browser.newBrowserCDPSession();
  const completed = Promise.withResolvers<void>();
  const collected = ({ value }: { value: unknown }) => trace.append(value);
  const bufferUsage = (event: { percentFull?: number; value?: number }) => {
    maximumBufferUse = Math.max(maximumBufferUse, event.percentFull ?? event.value ?? 0);
  };
  const complete = (event: { dataLossOccurred: boolean }) => {
    terminal = event;
    completed.resolve();
  };
  const safePath = (url: string) => {
    const value = new URL(url);
    const path = value.origin + value.pathname;
    if (path.length > 2048) truncatedPaths++;
    return path.slice(0, 2048);
  };
  const requested = (request: Request) => {
    const worker = request.serviceWorker();
    if (!worker) return;
    if (requests.length === requestLimit) {
      droppedRequests++;
      return;
    }
    const entry = {
      id: requests.length + 1,
      method: request.method(),
      path: safePath(request.url()),
      worker: safePath(worker.url()),
      startedMs: elapsedMs(),
      terminal: null,
    };
    requests.push(entry);
    pending.set(request, entry);
  };
  const finished = (request: Request) => {
    const entry = pending.get(request);
    if (entry) {
      entry.terminal = { outcome: 'finished', elapsedMs: elapsedMs() };
      pending.delete(request);
    }
  };
  const failed = (request: Request) => {
    const entry = pending.get(request);
    if (entry) {
      entry.terminal = {
        outcome: 'failed',
        elapsedMs: elapsedMs(),
        error: request.failure()?.errorText.slice(0, 512) ?? 'Unknown network failure',
      };
      pending.delete(request);
    }
  };
  cdp.on('Tracing.dataCollected', collected);
  cdp.on('Tracing.bufferUsage', bufferUsage);
  cdp.on('Tracing.tracingComplete', complete);
  context.on('request', requested);
  context.on('requestfinished', finished);
  context.on('requestfailed', failed);
  let finalizing: Promise<void> | undefined;
  function finish(firstFailure?: unknown) {
    return (finalizing ??= (async () => {
      const failures: unknown[] = firstFailure === undefined ? [] : [firstFailure];
      const deadline = Date.now() + collectionMs;
      context.off('request', requested);
      context.off('requestfinished', finished);
      context.off('requestfailed', failed);
      try {
        if (started)
          await before(
            Promise.all([cdp.send('Tracing.end'), completed.promise]),
            deadline,
            'Worker trace',
          );
      } catch (error) {
        failures.push(error);
      } finally {
        cdp.off('Tracing.dataCollected', collected);
        cdp.off('Tracing.bufferUsage', bufferUsage);
        cdp.off('Tracing.tracingComplete', complete);
        try {
          await before(cdp.detach(), deadline, 'Worker trace session cleanup');
        } catch (error) {
          failures.push(error);
        }
      }
      const captured = trace.result(terminal);
      const completeEvidence =
        started &&
        captured.complete &&
        maximumBufferUse < 1 &&
        !droppedRequests &&
        !droppedPhases &&
        !truncatedPaths;
      if (!completeEvidence)
        failures.push(new Error('Offline-upgrade worker diagnostics are incomplete.'));
      const receipt = {
        schema: 1,
        startedAt,
        finishedAt: new Date().toISOString(),
        browser: browser.version(),
        identities,
        test: { id: info.testId, project: info.project.name, retry: info.retry },
        complete: completeEvidence && failures.length === (firstFailure === undefined ? 0 : 1),
        firstFailure: firstFailure === undefined ? null : String(firstFailure),
        collectionFailures: failures.slice(firstFailure === undefined ? 0 : 1).map(String),
        limits: { requests: requestLimit, phases: phaseLimit, collectionMs, persistenceMs },
        trace: captured,
        maximumBufferUse,
        phases,
        requests,
        droppedRequests,
        droppedPhases,
        truncatedPaths,
        pendingRequestsAtStop: [...pending.values()].map((request) => request.id),
        limitation:
          'Worker HTTP requests and raw ServiceWorker trace events are separate observations. ' +
          'No JavaScript promise ledger or historical-cause attribution is inferred; clocks are not aligned. ' +
          'Passive request records omit headers, cookies, bodies and URL queries. ' +
          'Raw browser trace arguments may contain synthetic fixture URLs.',
      };
      try {
        await writeFile(
          info.outputPath('spn-055-worker-lifecycle.json'),
          JSON.stringify(receipt, null, 2) + '\n',
          {
            signal: AbortSignal.timeout(persistenceMs),
          },
        );
      } catch (error) {
        failures.push(error);
      }
      pending.clear();
      if (failures.length === 1) throw failures[0];
      if (failures.length)
        throw new AggregateError(failures, 'Offline-upgrade failed; original failure is first.');
    })());
  }
  try {
    const deadline = Date.now() + collectionMs;
    // GetCategories can change as new code paths run; it is not a capability
    // gate before the first worker operation. Start the requested category now;
    // finish still requires actual, nonempty, well-formed, lossless worker events.
    // Set before sending: a command timing out may still have started the trace.
    started = true;
    await before(
      cdp.send('Tracing.start', {
        transferMode: 'ReportEvents',
        bufferUsageReportingInterval: 1000,
        traceConfig: {
          recordMode: 'recordUntilFull',
          traceBufferSizeInKb: traceLimits.bytes / 1024,
          includedCategories: ['ServiceWorker'],
        },
      }),
      deadline,
      'Worker trace start',
    );
  } catch (error) {
    await finish(error);
    throw error;
  }
  return {
    mark(phase: string) {
      if (phases.length < phaseLimit)
        phases.push({ phase: phase.slice(0, 100), elapsedMs: elapsedMs() });
      else droppedPhases++;
    },
    finish,
  };
}
