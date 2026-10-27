import type { Page } from '@playwright/test';

export const DOC_RESPONSIVENESS_SCHEMA = 3;

// Candidate policy after the 64-state experiment missed the unchanged p95 budget.
// Keep this explicit in the independent harness, including the uncapped checkout.
export const DOC_RESPONSIVENESS_GROUP_LIMIT = 44;

// Preregistered before the production fix; all values are milliseconds.
export const DOC_RESPONSIVENESS_BUDGETS = {
  desktop: { inputP95Ms: 100, longTaskMaxMs: 200, flushP95Ms: 16, flushMaxMs: 50 },
  mobile: { inputP95Ms: 200, longTaskMaxMs: 500, flushP95Ms: 50, flushMaxMs: 100 },
} as const;

export interface DocResponsivenessEvidence {
  unitId: string;
  mobile: boolean;
  observedAt: number;
  pending: { history: number; collaboration: number };
  highWater: { history: number; collaboration: number };
  flushes: Array<{
    reason: string;
    startedAt: number;
    durationMs: number;
    history: number;
    collaboration: number;
  }>;
  history: { undos: number; redos: number };
  selection: { start: number; end: number; segmentId?: string } | null;
  text?: string;
}

export interface DocNativeIntegrity {
  unitId: string;
  observedAt: number;
  textLength: number;
  textSha256: string;
  selection: DocResponsivenessEvidence['selection'];
  history: DocResponsivenessEvidence['history'];
  pending: DocResponsivenessEvidence['pending'];
  highWater: DocResponsivenessEvidence['highWater'];
}

export interface DocSavedIntegrity {
  revision: number;
  textLength: number;
  textSha256: string;
}

/** observedAt and native observations use the sender's performance.now clock. */
export interface DocIntegritySnapshot {
  observedAt: number;
  sender: DocNativeIntegrity;
  peer: DocNativeIntegrity;
  saved: DocSavedIntegrity;
}

export interface DocReloadEvidence {
  surface: 'sender' | 'peer';
  unitId: string;
  reason: string;
  clean: boolean;
  /** Normalized to the sender's performance.now clock. */
  observedAt: number;
  sourceObservedAt: number;
  sourceTimeOrigin: number;
}

export interface DocReloadObserverStatus {
  surface: 'sender' | 'peer';
  /** Normalized to the sender's performance.now clock. */
  installedAt: number;
  sourceInstalledAt: number;
  sourceTimeOrigin: number;
  dropped: number;
  malformed: number;
}

export interface DocPreUndoIntegrity extends DocIntegritySnapshot {
  passed: true;
  reloads: DocReloadEvidence[];
}

export interface DocUndoRedoEvidence {
  outcome: 'passed' | 'baseline-capacity-refusal';
  requestedGroups: number;
  beforeUndoAt: number;
  afterUndoAt: number;
  beforeRedoAt: number;
  afterRedoAt: number;
  finalObservedAt: number;
  recoveredAt?: number;
  firstUndo: DocIntegritySnapshot;
  undo: DocIntegritySnapshot;
  final: DocIntegritySnapshot;
  /** Every reload since installation, including events before Undo/Redo. */
  reloads: DocReloadEvidence[];
}

/** Installed before typing; the callback runs only on the read-only reload event. */
export async function observeDocReloads(page: Page) {
  const handle = await page.evaluateHandle(() => {
    const events: Array<{
      unitId: string;
      reason: string;
      clean: boolean;
      observedAt: number;
    }> = [];
    const timeOrigin = performance.timeOrigin;
    const installedAt = performance.now();
    let dropped = 0;
    let malformed = 0;
    const observe = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (
        !detail ||
        typeof detail.unitId !== 'string' ||
        typeof detail.reason !== 'string' ||
        typeof detail.clean !== 'boolean' ||
        !Number.isFinite(detail.observedAt)
      ) {
        malformed++;
        return;
      }
      if (events.length >= 64) {
        dropped++;
        return;
      }
      events.push({
        unitId: detail.unitId,
        reason: detail.reason,
        clean: detail.clean,
        observedAt: detail.observedAt,
      });
    };
    window.addEventListener('spinel-doc-responsiveness-reload', observe);
    return {
      read: () => ({ timeOrigin, installedAt, events, dropped, malformed }),
      dispose: () => window.removeEventListener('spinel-doc-responsiveness-reload', observe),
    };
  });
  return {
    read: () => handle.evaluate((value) => value.read()),
    async dispose() {
      await handle.evaluate((value) => value.dispose()).catch(() => {});
      await handle.dispose();
    },
  };
}

/** The evidence build reads public state; it cannot flush, edit or select anything. */
export function readDocResponsiveness(page: Page, includeText = false) {
  return page.evaluate((includeText) => {
    let evidence: DocResponsivenessEvidence | null = null;
    const read = (event: Event) => {
      evidence = (event as CustomEvent<DocResponsivenessEvidence>).detail;
    };
    window.addEventListener('spinel-doc-responsiveness-evidence', read);
    window.dispatchEvent(
      new CustomEvent('spinel-doc-responsiveness-read', { detail: { includeText } }),
    );
    window.removeEventListener('spinel-doc-responsiveness-evidence', read);
    return evidence as DocResponsivenessEvidence | null;
  }, includeText);
}

export function distribution(values: readonly number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  const percentile = (fraction: number) =>
    sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]! : 0;
  return {
    count: sorted.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted.at(-1) ?? 0,
    sum: sorted.reduce((sum, value) => sum + value, 0),
  };
}

export interface InputObservation {
  timeOrigin: number;
  startedAt: number;
  endedAt: number;
  keydownAt: number[];
  keyToFrameMs: number[];
  longTasks: Array<{ startedAt: number; durationMs: number }>;
}

/** No document content, key values, DOM snapshots, or per-event protocol round trips. */
export async function observeInput(page: Page) {
  const observation = await page.evaluateHandle(() => {
    const data: InputObservation = {
      timeOrigin: performance.timeOrigin,
      startedAt: performance.now(),
      endedAt: 0,
      keydownAt: [],
      keyToFrameMs: [],
      longTasks: [],
    };
    const append = (entries: PerformanceEntry[]) => {
      for (const entry of entries)
        if (entry.startTime >= data.startedAt)
          data.longTasks.push({ startedAt: entry.startTime, durationMs: entry.duration });
    };
    const observer = new PerformanceObserver((list) => append(list.getEntries()));
    if (!PerformanceObserver.supportedEntryTypes.includes('longtask'))
      throw new Error('The benchmark requires the browser long-task observer.');
    observer.observe({ type: 'longtask', buffered: false });
    const keydown = (event: KeyboardEvent) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.matches('[contenteditable="true"][data-u-comp="editor"]')) return;
      if (data.keydownAt.length >= 10_000) throw new Error('Unexpected benchmark input volume.');
      const at = performance.now();
      data.keydownAt.push(at);
      requestAnimationFrame(() => data.keyToFrameMs.push(performance.now() - at));
    };
    document.addEventListener('keydown', keydown, { capture: true, passive: true });
    performance.mark('spn108-input-start');
    return {
      async finish() {
        document.removeEventListener('keydown', keydown, true);
        // Let the final input frame and its queued long-task notification arrive.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        append(observer.takeRecords());
        observer.disconnect();
        data.endedAt = performance.now();
        performance.mark('spn108-input-end');
        return data;
      },
    };
  });
  return async () => {
    try {
      return await observation.evaluate((value) => value.finish());
    } finally {
      await observation.dispose();
    }
  };
}

export interface CpuProfile {
  nodes: Array<{ id: number; callFrame: { functionName: string }; children?: number[] }>;
  samples?: number[];
  timeDeltas?: number[];
  startTime: number;
  endTime: number;
}

export interface ProfilerClockBracket {
  beforeMs: number;
  afterMs: number;
}

/**
 * CPU timestamps are not browser performance.now timestamps. The actual start
 * lies between the two browser observations around Profiler.start. A reducer
 * sample counts as a certain task witness only when its complete accounting
 * interval, including that clock uncertainty, fits inside the observed task.
 * The task's whole duration is reported, never attributed entirely to the reducer.
 * sampledCpuMs is a sample-weighted estimate using preceding intervals, not an
 * exact measurement of reducer CPU time.
 * Chrome can return signed deltas with samples out of timestamp order. Follow
 * DevTools' cumulative timestamp / paired sample sorting, retaining the raw data:
 * https://chromium.googlesource.com/devtools/devtools-frontend/+/9a696c4e723caa3c7e1f78886da353f1f06a79b0/front_end/core/sdk/CPUProfileDataModel.ts
 */
export function compositionCpu(
  profile: CpuProfile,
  clock: ProfilerClockBracket,
  longTasks: InputObservation['longTasks'],
) {
  if (
    !Number.isFinite(clock.beforeMs) ||
    !Number.isFinite(clock.afterMs) ||
    clock.beforeMs < 0 ||
    clock.afterMs < clock.beforeMs ||
    !Number.isFinite(profile.startTime) ||
    !Number.isFinite(profile.endTime) ||
    !Number.isFinite(profile.endTime - profile.startTime) ||
    profile.endTime < profile.startTime ||
    !profile.samples?.length ||
    !profile.timeDeltas ||
    profile.samples.length !== profile.timeDeltas.length ||
    profile.timeDeltas.some((delta) => !Number.isFinite(delta))
  )
    throw new Error('Unavailable CPU attribution: invalid samples or clock bracket.');
  let timestampUs = profile.startTime;
  let negativeDeltaCount = 0;
  const timeline = profile.samples.map((sample, originalIndex) => {
    const delta = profile.timeDeltas![originalIndex]!;
    if (delta < 0) negativeDeltaCount++;
    timestampUs += delta;
    if (
      !Number.isFinite(timestampUs) ||
      timestampUs < profile.startTime ||
      timestampUs > profile.endTime
    )
      throw new Error(
        'Unavailable CPU attribution: sample timestamp outside the profile time range.',
      );
    return { sample, originalIndex, timestampUs };
  });
  timeline.sort((a, b) => a.timestampUs - b.timestampUs || a.originalIndex - b.originalIndex);
  const reorderedSampleCount = timeline.filter(
    (sample, index) => sample.originalIndex !== index,
  ).length;
  const parents = new Map<number, number>();
  const names = new Map(profile.nodes.map((node) => [node.id, node.callFrame.functionName]));
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parents.set(child, node.id);
  const families = {
    history: {
      name: '_pushHistory',
      sampleCount: 0,
      sampledCpuMs: 0,
      tasks: new Map<number, number>(),
    },
    collaboration: {
      name: '_emitChangeState',
      sampleCount: 0,
      sampledCpuMs: 0,
      tasks: new Map<number, number>(),
    },
  };
  let previousTimestampUs = profile.startTime;
  for (const { sample, timestampUs } of timeline) {
    const previousUs = previousTimestampUs - profile.startTime;
    const elapsedUs = timestampUs - profile.startTime;
    const durationUs = timestampUs - previousTimestampUs;
    previousTimestampUs = timestampUs;
    const earliestStartMs = clock.beforeMs + previousUs / 1000;
    const latestEndMs = clock.afterMs + elapsedUs / 1000;
    let node: number | undefined = sample;
    const stack = new Set<string>();
    const visited = new Set<number>();
    while (node !== undefined) {
      if (visited.has(node) || !names.has(node))
        throw new Error('Unavailable CPU attribution: invalid profile call tree.');
      visited.add(node);
      stack.add(names.get(node)!);
      node = parents.get(node);
    }
    for (const family of Object.values(families)) {
      if (!stack.has(family.name)) continue;
      family.sampleCount++;
      family.sampledCpuMs += durationUs / 1000;
      for (const [taskIndex, task] of longTasks.entries())
        if (earliestStartMs >= task.startedAt && latestEndMs <= task.startedAt + task.durationMs)
          family.tasks.set(taskIndex, (family.tasks.get(taskIndex) ?? 0) + 1);
    }
  }
  const describe = (family: (typeof families)['history']) => {
    const functionNodes = [...names.values()].filter((name) => name === family.name).length;
    const tasks = [...family.tasks].map(([index, sampleCount]) => ({
      index,
      ...longTasks[index]!,
      sampleCount,
    }));
    return {
      status: family.sampleCount ? ('sampled' as const) : ('unavailable' as const),
      reason: family.sampleCount
        ? null
        : functionNodes
          ? 'function-not-sampled'
          : 'function-not-found',
      functionNodes,
      sampleCount: family.sampleCount,
      sampledCpuMs: family.sampleCount ? family.sampledCpuMs : null,
      certainContainingTasks: tasks,
      maxContainingTaskMs: tasks.length ? Math.max(...tasks.map((task) => task.durationMs)) : null,
      taskAttribution: tasks.length ? 'certain-whole-containing-task' : 'unavailable',
    };
  };
  return {
    sampleIntervalUs: 1000,
    negativeDeltaCount,
    reorderedSampleCount,
    clock: {
      ...clock,
      uncertaintyMs: clock.afterMs - clock.beforeMs,
      profileStartTimeUs: profile.startTime,
      profileEndTimeUs: profile.endTime,
    },
    history: describe(families.history),
    collaboration: describe(families.collaboration),
  };
}
