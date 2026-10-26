import { readFileSync } from 'node:fs';
import { freemem } from 'node:os';
import { resolve } from 'node:path';
import { PDF_COMBINED_RSS_BYTES, PDF_WORKER_RSS_BYTES, PdfError } from './limits.ts';

const MiB = 1024 * 1024;
export const PDF_MIN_WORKER_RSS_BYTES = 192 * MiB;
export const PDF_CONTAINER_HEADROOM_BYTES = 32 * MiB;
const HOST_HEADROOM_BYTES = 128 * MiB;

export interface PdfMemory {
  parentRssBytes: number;
  availableBytes: number;
  containerLimitBytes: number | null;
  containerUsedBytes: number | null;
}

function text(path: string) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
function bytes(value: string | null) {
  if (!value || !/^\d+\s*$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/** Cgroup accounting includes other native work, threads and processes in the app container. */
export function pdfMemory(): PdfMemory {
  const available = text('/proc/meminfo')?.match(/^MemAvailable:\s+(\d+) kB$/m)?.[1];
  let containerLimitBytes: number | null = null;
  let containerUsedBytes: number | null = null;
  if (process.platform === 'linux') {
    const group = text('/proc/self/cgroup')?.match(/^0::(\/[^\r\n]*)$/m)?.[1];
    // Docker mounts the current cgroup at this root. On a non-namespaced host,
    // also inspect the process's explicit v2 path and its enforcing ancestors.
    const locations = ['/sys/fs/cgroup'];
    if (group && group !== '/' && group.split('/').length <= 64) {
      let path = resolve('/sys/fs/cgroup', `.${group}`);
      while (path.startsWith('/sys/fs/cgroup/')) {
        locations.push(path);
        path = resolve(path, '..');
      }
    }
    let remaining = Infinity;
    for (const location of locations) {
      const limit = bytes(text(`${location}/memory.max`));
      if (limit === null) continue;
      const current = bytes(text(`${location}/memory.current`));
      if (current === null) throw new PdfError('limit');
      const inactive = Number(
        text(`${location}/memory.stat`)?.match(/^inactive_file\s+(\d+)$/m)?.[1] ?? 0,
      );
      // Only inactive file cache is discounted. Active cache, socket buffers,
      // kernel memory and other live processes still consume the reservation.
      const used = Math.max(0, current - Math.min(current, inactive));
      if (limit - used < remaining) {
        remaining = limit - used;
        containerLimitBytes = limit;
        containerUsedBytes = used;
      }
    }
    if (containerLimitBytes === null) {
      // Older Docker hosts expose v1 accounting instead of memory.max.
      const limit = bytes(text('/sys/fs/cgroup/memory/memory.limit_in_bytes'));
      const current = bytes(text('/sys/fs/cgroup/memory/memory.usage_in_bytes'));
      if (limit !== null && current !== null) {
        const stat = text('/sys/fs/cgroup/memory/memory.stat');
        const inactive = Number(stat?.match(/^(?:total_)?inactive_file\s+(\d+)$/m)?.[1] ?? 0);
        containerLimitBytes = limit;
        containerUsedBytes = Math.max(0, current - Math.min(current, inactive));
      }
    }
  }
  return {
    parentRssBytes: process.memoryUsage().rss,
    availableBytes: available ? Number(available) * 1024 : freemem(),
    containerLimitBytes,
    containerUsedBytes,
  };
}

/** Pure calculation retained separately so the actual 512 MiB deployment is regression tested. */
export function pdfWorkerBudget(memory: PdfMemory) {
  const containerRemaining =
    memory.containerLimitBytes !== null && memory.containerUsedBytes !== null
      ? memory.containerLimitBytes - memory.containerUsedBytes - PDF_CONTAINER_HEADROOM_BYTES
      : Infinity;
  const available = Math.min(
    PDF_WORKER_RSS_BYTES,
    PDF_COMBINED_RSS_BYTES - memory.parentRssBytes,
    memory.availableBytes - HOST_HEADROOM_BYTES,
    containerRemaining,
  );
  if (!Number.isFinite(available) || available < PDF_MIN_WORKER_RSS_BYTES)
    throw new PdfError('limit');
  return Math.floor(available / MiB) * MiB;
}

/** Call before loading/cloning a snapshot as well as immediately before forking. */
export function checkPdfCapacity() {
  const memory = pdfMemory();
  try {
    return pdfWorkerBudget(memory);
  } catch (error) {
    // Operational evidence only: no file, account, credential or source data.
    console.warn('PDF memory admission refused', memory);
    throw error;
  }
}

export function pdfMemoryExceeded(memory: PdfMemory, workerRssBytes: number, workerBudget: number) {
  return (
    workerRssBytes > workerBudget ||
    workerRssBytes + memory.parentRssBytes > PDF_COMBINED_RSS_BYTES ||
    memory.availableBytes < HOST_HEADROOM_BYTES ||
    (memory.containerLimitBytes !== null &&
      memory.containerUsedBytes !== null &&
      memory.containerUsedBytes > memory.containerLimitBytes - PDF_CONTAINER_HEADROOM_BYTES)
  );
}
