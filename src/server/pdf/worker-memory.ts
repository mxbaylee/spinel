import { readFileSync } from 'node:fs';

/** Peak of this worker's address space, including native rendering allocations. */
export function pdfWorkerPeakRss() {
  if (process.platform !== 'linux') return process.resourceUsage().maxRSS * 1024;
  // Linux getrusage retains the pre-exec process high-water mark. A child of
  // the development compiler can inherit a larger peak before loading any PDF
  // code. VmHWM belongs to the new address space and still catches brief peaks
  // between the parent's live RSS/cgroup samples. Missing accounting fails shut.
  const status = readFileSync('/proc/self/status', 'utf8');
  const peak = Number(/^VmHWM:\s+(\d+)\s+kB$/m.exec(status)?.[1]) * 1024;
  if (!Number.isSafeInteger(peak) || peak <= 0) throw new Error('Worker memory unavailable.');
  return Math.max(peak, process.memoryUsage().rss);
}
