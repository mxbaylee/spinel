import { readFile, realpath, stat, statfs } from 'node:fs/promises';
import { freemem, totalmem } from 'node:os';
import { dirname } from 'node:path';
import type { DatabaseHealth, ServerHealth } from '../../shared/health.ts';
import type { HealthJobs } from './jobs.ts';

const GiB = 1024 ** 3;
export const HOST_MEMORY_BUDGET = 2 * GiB;
export const BACKUP_UPLOAD_LIMIT = 5 * GiB;

async function text(path: string) {
  try { return await readFile(path, 'utf8'); } catch { return null; }
}
function positive(value: string | null) {
  if (value === null || !/^\d+\s*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
export function memoryFromProc(contents: string | null, fallback: { total: number; free: number }) {
  const field = (name: string) => {
    const value = contents?.match(new RegExp(`^${name}:\\s+(\\d+) kB$`, 'm'))?.[1];
    return value === undefined ? null : Number(value) * 1024;
  };
  const total = field('MemTotal'), available = field('MemAvailable');
  if (total !== null && available !== null && total > 0 && available >= 0 && available <= total)
    return { systemTotalBytes: total, systemUsedBytes: total - available, systemMeasure: 'available' as const };
  return { systemTotalBytes: fallback.total, systemUsedBytes: Math.max(0, fallback.total - fallback.free), systemMeasure: 'free' as const };
}

export async function sampleMemory() {
  const [proc, current, limit] = await Promise.all([
    text('/proc/meminfo'), text('/sys/fs/cgroup/memory.current'), text('/sys/fs/cgroup/memory.max'),
  ]);
  return {
    ...memoryFromProc(proc, { total: totalmem(), free: freemem() }),
    processRssBytes: process.memoryUsage().rss,
    containerUsedBytes: positive(current), containerLimitBytes: positive(limit),
  };
}

export async function physicalDatabase(path: string): Promise<{ identity: string; databaseBytes: number; walBytes: number } | null> {
  try {
    const identity = await realpath(path);
    const database = await stat(identity);
    if (!database.isFile()) return null;
    let walBytes = 0;
    try { walBytes = (await stat(identity + '-wal')).size; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
    }
    return { identity, databaseBytes: database.size, walBytes };
  } catch { return null; }
}

export class HealthMonitor {
  private readonly options: {
    applicationPath: string;
    diagnosticsPath: string;
    jobs: HealthJobs;
    editorConnections: () => number;
    logicalDatabaseBytes: () => number;
    now?: () => number;
    memory?: typeof sampleMemory;
    database?: typeof physicalDatabase;
    freeBytes?: (directory: string) => Promise<number | null>;
  };
  private readonly startedAt: number;
  private readonly now: () => number;
  private readonly baselines = new Map<string, { bytes: number; at: number }>();
  private aboveBudgetSince: number | null = null;
  private pending: Promise<ServerHealth> | undefined;
  constructor(options: HealthMonitor['options']) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
  }
  sample() {
    // Concurrent admin requests share one filesystem sample, not unbounded work.
    this.pending ??= this.read().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async read(): Promise<ServerHealth> {
    const memorySample = this.options.memory ?? sampleMemory;
    const databaseSample = this.options.database ?? physicalDatabase;
    const freeSample = this.options.freeBytes ?? (async (directory: string) => {
      try { const volume = await statfs(directory); return volume.bavail * volume.bsize; } catch { return null; }
    });
    const [memory, application, diagnostics, freeBytes] = await Promise.all([
      memorySample(), databaseSample(this.options.applicationPath), databaseSample(this.options.diagnosticsPath),
      freeSample(dirname(this.options.applicationPath)),
    ]);
    const now = this.now();
    if (memory.systemUsedBytes > HOST_MEMORY_BUDGET * 0.8) this.aboveBudgetSince ??= now;
    else this.aboveBudgetSince = null;
    const measure = (sample: Awaited<ReturnType<typeof physicalDatabase>>): DatabaseHealth | null => {
      if (!sample) return null;
      const bytes = sample.databaseBytes + sample.walBytes;
      const baseline = this.baselines.get(sample.identity) ?? { bytes, at: now };
      this.baselines.set(sample.identity, baseline);
      return { databaseBytes: sample.databaseBytes, walBytes: sample.walBytes, growthBytes: bytes - baseline.bytes, measuredSince: baseline.at };
    };
    let logicalDatabaseBytes: number | null = null;
    try {
      const value = this.options.logicalDatabaseBytes();
      if (Number.isSafeInteger(value) && value >= 0) logicalDatabaseBytes = value;
    } catch { /* No invented size when SQLite is unavailable. */ }
    return {
      sampledAt: now, startedAt: this.startedAt,
      memory: { ...memory, hostBudgetBytes: HOST_MEMORY_BUDGET, aboveBudgetSince: this.aboveBudgetSince },
      editorConnections: this.options.editorConnections(),
      application: measure(application),
      // A misconfigured shared file must not count application bytes a second time.
      diagnostics: diagnostics?.identity === application?.identity ? null : measure(diagnostics),
      storage: {
        freeBytes, logicalDatabaseBytes,
        // Match makeArchive's real staging guard; archive compression is unknowable here.
        backupStagingBytes: logicalDatabaseBytes === null ? null : Math.ceil(logicalDatabaseBytes * 2.1 + 256 * 1024 ** 2),
        backupUploadLimitBytes: BACKUP_UPLOAD_LIMIT,
      },
      jobs: this.options.jobs.snapshot(),
    };
  }
}
