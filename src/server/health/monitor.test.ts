import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { HealthJobs, observeJob } from './jobs.ts';
import type { JobObservation } from './jobs.ts';
import { HealthMonitor, HOST_MEMORY_BUDGET, memoryFromProc, physicalDatabase } from './monitor.ts';

test('Linux available memory excludes reclaimable cache; fallback names its different measure', () => {
  expect(memoryFromProc('MemTotal:       2000000 kB\nMemFree: 1000 kB\nMemAvailable: 1000000 kB\n', { total: 10, free: 5 }))
    .toEqual({ systemTotalBytes: 2048000000, systemUsedBytes: 1024000000, systemMeasure: 'available' });
  expect(memoryFromProc('MemTotal: 10 kB\nMemAvailable: 20 kB\n', { total: 500, free: 200 }))
    .toEqual({ systemTotalBytes: 500, systemUsedBytes: 300, systemMeasure: 'free' });
});

test('physical bytes include the WAL once and resolve aliases, with unknown distinct from empty', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spinel-health-'));
  try {
    const path = join(directory, 'app.sqlite');
    await writeFile(path, Buffer.alloc(100));
    await writeFile(path + '-wal', Buffer.alloc(40));
    const alias = join(directory, 'alias.sqlite');
    await symlink(path, alias);
    const direct = await physicalDatabase(path);
    expect(direct).toMatchObject({ databaseBytes: 100, walBytes: 40 });
    expect(await physicalDatabase(alias)).toEqual(direct);
    expect(await physicalDatabase(join(directory, 'missing.sqlite'))).toBeNull();
    await rm(path + '-wal');
    expect(await physicalDatabase(path)).toMatchObject({ databaseBytes: 100, walBytes: 0 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('growth uses the first real measurement and preserves signed physical changes after truncation', async () => {
  let now = 10, applicationBytes = 100, walBytes = 50;
  const memory = async () => ({ processRssBytes: 40, systemTotalBytes: HOST_MEMORY_BUDGET, systemUsedBytes: 100, systemMeasure: 'available' as const, containerUsedBytes: 50, containerLimitBytes: 512 * 1024 ** 2 });
  const monitor = new HealthMonitor({
    applicationPath: '/private/app.sqlite', diagnosticsPath: '/private/diagnostics.sqlite',
    jobs: new HealthJobs(), editorConnections: () => 2, logicalDatabaseBytes: () => 1000,
    now: () => now, memory, freeBytes: async () => 9000,
    database: async (path) => ({ identity: path, databaseBytes: path.endsWith('/app.sqlite') ? applicationBytes : 200, walBytes }),
  });
  const first = await monitor.sample();
  expect(first.application).toEqual({ databaseBytes: 100, walBytes: 50, growthBytes: 0, measuredSince: 10 });
  expect(first.diagnostics).toMatchObject({ databaseBytes: 200, growthBytes: 0 });
  expect(first.storage).toEqual({ freeBytes: 9000, logicalDatabaseBytes: 1000, backupStagingBytes: 2100 + 256 * 1024 ** 2, backupUploadLimitBytes: 5 * 1024 ** 3 });
  expect(first.memory).toMatchObject({ processRssBytes: 40, containerUsedBytes: 50, containerLimitBytes: 512 * 1024 ** 2, systemUsedBytes: 100 });
  expect(first.editorConnections).toBe(2);
  now = 20; applicationBytes = 140;
  expect((await monitor.sample()).application).toMatchObject({ growthBytes: 40, measuredSince: 10 });
  now = 30; walBytes = 0;
  expect((await monitor.sample()).application).toMatchObject({ growthBytes: -10, measuredSince: 10 });
});

test('shared database aliases are not counted as separate diagnostics and failures stay unknown', async () => {
  const monitor = new HealthMonitor({
    applicationPath: 'app', diagnosticsPath: 'alias', jobs: new HealthJobs(),
    editorConnections: () => 0, logicalDatabaseBytes: () => { throw new Error('private error'); },
    freeBytes: async () => null,
    database: async () => ({ identity: '/same-file', databaseBytes: 100, walBytes: 20 }),
    memory: async () => ({ processRssBytes: 40, systemTotalBytes: HOST_MEMORY_BUDGET, systemUsedBytes: 100, systemMeasure: 'free', containerUsedBytes: null, containerLimitBytes: null }),
  });
  const result = await monitor.sample();
  expect(result.application).toMatchObject({ databaseBytes: 100, walBytes: 20 });
  expect(result.diagnostics).toBeNull();
  expect(result.storage).toMatchObject({ freeBytes: null, logicalDatabaseBytes: null, backupStagingBytes: null });
  expect(JSON.stringify(result)).not.toContain('private error');
  expect(JSON.stringify(result)).not.toContain('/same-file');
});

test('memory warning starts at its first observed breach and resets after recovery', async () => {
  let now = 10, used = HOST_MEMORY_BUDGET * 0.81;
  const monitor = new HealthMonitor({
    applicationPath: 'app', diagnosticsPath: 'diagnostics', jobs: new HealthJobs(),
    editorConnections: () => 0, logicalDatabaseBytes: () => 0, now: () => now,
    database: async () => null, freeBytes: async () => null,
    memory: async () => ({ processRssBytes: 10, systemTotalBytes: HOST_MEMORY_BUDGET, systemUsedBytes: used, systemMeasure: 'available', containerUsedBytes: null, containerLimitBytes: null }),
  });
  expect((await monitor.sample()).memory.aboveBudgetSince).toBe(10);
  now = 20;
  expect((await monitor.sample()).memory.aboveBudgetSince).toBe(10);
  used = HOST_MEMORY_BUDGET * 0.5;
  expect((await monitor.sample()).memory.aboveBudgetSince).toBeNull();
  now = 30; used = HOST_MEMORY_BUDGET * 0.9;
  expect((await monitor.sample()).memory.aboveBudgetSince).toBe(30);
});

test('concurrent health reads share a bounded sample', async () => {
  const gate = Promise.withResolvers<void>();
  const memory = vi.fn(async () => {
    await gate.promise;
    return { processRssBytes: 10, systemTotalBytes: HOST_MEMORY_BUDGET, systemUsedBytes: 10, systemMeasure: 'available' as const, containerUsedBytes: null, containerLimitBytes: null };
  });
  const monitor = new HealthMonitor({
    applicationPath: 'app', diagnosticsPath: 'diag', jobs: new HealthJobs(),
    editorConnections: () => 0, logicalDatabaseBytes: () => 0, memory,
    database: async () => null, freeBytes: async () => null,
  });
  const a = monitor.sample(), b = monitor.sample();
  expect(a).toBe(b);
  expect(memory).toHaveBeenCalledTimes(1);
  gate.resolve();
  await a;
  await monitor.sample();
  expect(memory).toHaveBeenCalledTimes(2);
});

test('job failures keep their first timestamp, success clears them, and observer failure is isolated', () => {
  let now = 10;
  const observe = vi.fn((_event: JobObservation) => { throw new Error('diagnostics unavailable'); });
  const jobs = new HealthJobs({ now: () => now, observe });
  expect(jobs.snapshot().every((job) => !job.configured && job.lastSuccess === null)).toBe(true);
  const first = jobs.begin('history-maintenance');
  now = 20;
  expect(() => first(false)).not.toThrow();
  first(true); // Duplicate completion cannot erase the failure.
  expect(jobs.snapshot().find((job) => job.name === 'history-maintenance')).toMatchObject({ configured: true, running: false, failedSince: 20, lastSuccess: null });
  const second = jobs.begin('history-maintenance');
  now = 30; second(false);
  expect(jobs.snapshot().find((job) => job.name === 'history-maintenance')?.failedSince).toBe(20);
  const third = jobs.begin('history-maintenance');
  now = 40; third(true);
  expect(jobs.snapshot().find((job) => job.name === 'history-maintenance')).toMatchObject({ lastAttempt: 30, lastSuccess: 40, failedSince: null });
  expect(jobs.snapshot().find((job) => job.name === 'space-trash-expiry')?.configured).toBe(false);
  expect(observe).toHaveBeenCalledTimes(3);
  expect(observe.mock.calls[0][0]).toMatchObject({ job: 'history-maintenance', success: false, durationMs: 10 });
  expect(() => observeJob(() => { throw new Error('adapter start failed'); })(false)).not.toThrow();
  expect(() => observeJob(() => () => { throw new Error('adapter finish failed'); })(true)).not.toThrow();
});
