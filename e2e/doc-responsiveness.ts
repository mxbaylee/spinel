import type { Page } from '@playwright/test';

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

interface InputObservation {
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

interface CpuProfile {
  nodes: Array<{ id: number; callFrame: { functionName: string }; children?: number[] }>;
  samples?: number[];
  timeDeltas?: number[];
  startTime: number;
  endTime: number;
}

/** Inclusive CPU samples identify both reducers without instrumenting SDK methods. */
export function compositionCpu(profile: CpuProfile) {
  const parents = new Map<number, number>();
  const names = new Map(profile.nodes.map((node) => [node.id, node.callFrame.functionName]));
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parents.set(child, node.id);
  const totals = { historyMs: 0, collaborationMs: 0, sampleIntervalUs: 1000 };
  for (const [index, sample] of (profile.samples ?? []).entries()) {
    let node: number | undefined = sample;
    let history = false,
      collaboration = false;
    while (node !== undefined) {
      history ||= names.get(node) === '_pushHistory';
      collaboration ||= names.get(node) === '_emitChangeState';
      node = parents.get(node);
    }
    const duration = (profile.timeDeltas?.[index] ?? 0) / 1000;
    if (history) totals.historyMs += duration;
    if (collaboration) totals.collaborationMs += duration;
  }
  return totals;
}
