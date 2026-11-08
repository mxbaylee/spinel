import type { CDPSession, Page } from '@playwright/test';

/**
 * SPN-146 attribution only (SPN146_GC_TRACE=1, never set in required CI). A Chromium trace with just the
 * V8 GC and user-timing categories, far lighter than the CPU profiler, so the unprofiled timing regime is
 * kept. Each flush window is matched to the GC events overlapping it on the page clock.
 */
export interface GcEvent {
  name: string;
  startMs: number;
  durMs: number;
}

export interface GcFlushOverlap {
  startedAt: number;
  durationMs: number;
  gcMs: number;
  events: GcEvent[];
}

const SYNC_MARK = 'spn146-gc-sync';

export async function startGcTrace(cdp: CDPSession, page: Page) {
  const done = new Promise<string>((resolve) => {
    cdp.once('Tracing.tracingComplete', (event: { stream?: string }) =>
      resolve(event.stream ?? ''),
    );
  });
  await cdp.send('Tracing.start', {
    transferMode: 'ReturnAsStream',
    streamFormat: 'json',
    traceConfig: {
      recordMode: 'recordUntilFull',
      traceBufferSizeInKb: 64 * 1024,
      includedCategories: ['v8.gc', 'disabled-by-default-v8.gc', 'blink.user_timing'],
    },
  });
  const syncPageMs = await page.evaluate((name) => performance.mark(name).startTime, SYNC_MARK);
  return {
    async finish(flushes: { startedAt: number; durationMs: number }[]) {
      await cdp.send('Tracing.end');
      const stream = await done;
      let text = '';
      for (let eof = false; stream && !eof;) {
        const chunk = await cdp.send('IO.read', { handle: stream });
        text += chunk.data;
        eof = chunk.eof;
      }
      if (stream) await cdp.send('IO.close', { handle: stream }).catch(() => {});
      return analyzeGcTrace(text, syncPageMs, flushes);
    },
  };
}

export function analyzeGcTrace(
  traceJson: string,
  syncPageMs: number,
  flushes: { startedAt: number; durationMs: number }[],
) {
  const parsed = JSON.parse(traceJson) as { traceEvents?: any[] } | any[];
  const events = Array.isArray(parsed) ? parsed : (parsed.traceEvents ?? []);
  const sync = events.find((event) => event.name === SYNC_MARK);
  if (!sync) return { aligned: false as const, reason: 'sync mark missing', events: events.length };
  const offsetMs = sync.ts / 1000 - syncPageMs;
  // Only the renderer main thread (the sync mark's pid and tid) blocks a flush; background GC threads do not.
  const gc: GcEvent[] = events
    .filter(
      (event) =>
        event.ph === 'X' &&
        event.pid === sync.pid &&
        event.tid === sync.tid &&
        typeof event.dur === 'number' &&
        /^V8\.GC_|^MajorGC$|^MinorGC$/.test(event.name) &&
        !/BACKGROUND/.test(event.name),
    )
    .map((event) => ({
      name: String(event.name),
      startMs: event.ts / 1000 - offsetMs,
      durMs: event.dur / 1000,
    }));
  // Phase events nest inside their parent, so each flush counts the union of the intervals, not their sum.
  const overlapMs = (from: number, to: number) => {
    const spans = gc
      .map((event) => [Math.max(from, event.startMs), Math.min(to, event.startMs + event.durMs)])
      .filter(([start, end]) => end! > start!)
      .sort((x, y) => x![0]! - y![0]!);
    let total = 0;
    let reach = -Infinity;
    for (const [start, end] of spans) {
      const begin = Math.max(start!, reach);
      if (end! > begin) total += end! - begin;
      reach = Math.max(reach, end!);
    }
    return total;
  };
  const overlaps: GcFlushOverlap[] = flushes.map((flush) => {
    const end = flush.startedAt + flush.durationMs;
    return {
      startedAt: flush.startedAt,
      durationMs: flush.durationMs,
      gcMs: overlapMs(flush.startedAt, end),
      events: gc.filter(
        (event) =>
          event.durMs >= 1 && event.startMs < end && event.startMs + event.durMs > flush.startedAt,
      ),
    };
  });
  return {
    aligned: true as const,
    eventNames: [...new Set(gc.map((event) => event.name))],
    gcEvents: gc.filter((event) => event.durMs >= 5),
    slowestFlushes: [...overlaps].sort((a, b) => b.durationMs - a.durationMs).slice(0, 8),
    totalFlushMs: overlaps.reduce((sum, o) => sum + o.durationMs, 0),
    totalGcInFlushMs: overlaps.reduce((sum, o) => sum + o.gcMs, 0),
    flushesWithGc: overlaps.filter((o) => o.gcMs > 0).length,
    flushes: overlaps.length,
  };
}
