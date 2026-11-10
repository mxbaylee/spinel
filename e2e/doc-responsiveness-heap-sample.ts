import type { CDPSession } from '@playwright/test';

/**
 * SPN-146 attribution only (SPN146_HEAP_SAMPLE=all|live, never set in required CI). V8 allocation
 * sampling over the typing run. `all` includes objects already collected (allocation churn that drives
 * GC frequency); `live` reports only what is still reachable when sampling stops (what is retained).
 */
export type HeapSampleMode = 'all' | 'live';

interface SamplingNode {
  callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number };
  selfSize: number;
  children: SamplingNode[];
}

export const heapSampleMode = (value: string | undefined): HeapSampleMode | null =>
  value === 'all' || value === 'live' ? value : null;

export async function startHeapSample(cdp: CDPSession, mode: HeapSampleMode) {
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.startSampling', {
    samplingInterval: 16384,
    includeObjectsCollectedByMajorGC: mode === 'all',
    includeObjectsCollectedByMinorGC: mode === 'all',
  });
  return {
    async finish() {
      const { profile } = await cdp.send('HeapProfiler.getSamplingProfile');
      await cdp.send('HeapProfiler.stopSampling');
      return {
        mode,
        raw: profile as unknown as { head: SamplingNode },
        ...summarizeSamplingProfile(profile as unknown as { head: SamplingNode }),
      };
    },
  };
}

const label = (frame: SamplingNode['callFrame']) =>
  `${frame.functionName || '(anon)'} ${frame.url.split('/').pop() ?? ''}:${frame.lineNumber}`;

/** Total sampled bytes by allocation site and by script, each site with its heaviest caller chain. */
export function summarizeSamplingProfile(profile: { head: SamplingNode }, top = 30) {
  const sites = new Map<string, { bytes: number; chain: string; chainBytes: number }>();
  const scripts = new Map<string, number>();
  let total = 0;
  const walk = (node: SamplingNode, chain: string[]) => {
    const here = [label(node.callFrame), ...chain];
    if (node.selfSize > 0) {
      total += node.selfSize;
      const key = label(node.callFrame);
      const entry = sites.get(key) ?? { bytes: 0, chain: '', chainBytes: 0 };
      entry.bytes += node.selfSize;
      if (node.selfSize > entry.chainBytes) {
        entry.chainBytes = node.selfSize;
        entry.chain = here.slice(1, 5).join(' < ');
      }
      sites.set(key, entry);
      const script = node.callFrame.url.split('/').pop() || '(native)';
      scripts.set(script, (scripts.get(script) ?? 0) + node.selfSize);
    }
    for (const child of node.children) walk(child, here);
  };
  walk(profile.head, []);
  const byBytes = <T extends { bytes: number }>(a: T, b: T) => b.bytes - a.bytes;
  return {
    totalBytes: total,
    topSites: [...sites]
      .map(([site, v]) => ({ site, bytes: v.bytes, caller: v.chain }))
      .sort(byBytes)
      .slice(0, top),
    topScripts: [...scripts]
      .map(([script, bytes]) => ({ script, bytes }))
      .sort(byBytes)
      .slice(0, 10),
  };
}
