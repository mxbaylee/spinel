import type { ServerHealth } from '../src/shared/health.ts';
import type { DiagnosticsStatus } from '../src/shared/diagnostics.ts';

export const healthStoryTime = Date.UTC(2026, 9, 23, 12);
const MiB = 1024 ** 2;
export const healthStory: ServerHealth = {
  sampledAt: healthStoryTime,
  startedAt: healthStoryTime - 86_400_000,
  memory: {
    processRssBytes: 380 * MiB,
    systemTotalBytes: 2 * 1024 * MiB,
    systemUsedBytes: 900 * MiB,
    systemMeasure: 'available',
    hostBudgetBytes: 2 * 1024 * MiB,
    containerUsedBytes: 420 * MiB,
    containerLimitBytes: null,
    aboveBudgetSince: null,
  },
  editorConnections: 2,
  application: {
    databaseBytes: 84 * MiB,
    walBytes: 4 * MiB,
    growthBytes: 3 * MiB,
    measuredSince: healthStoryTime - 3600_000,
  },
  diagnostics: {
    databaseBytes: 2 * MiB,
    walBytes: MiB,
    growthBytes: -MiB,
    measuredSince: healthStoryTime - 3600_000,
  },
  storage: {
    freeBytes: 12 * 1024 * MiB,
    logicalDatabaseBytes: 84 * MiB,
    backupStagingBytes: 432.4 * MiB,
    backupUploadLimitBytes: 5 * 1024 * MiB,
  },
  jobs: [
    {
      name: 'history-maintenance',
      configured: true,
      running: false,
      lastAttempt: healthStoryTime - 60_000,
      lastSuccess: healthStoryTime - 60_000,
      failedSince: null,
    },
    {
      name: 'trash-expiry',
      configured: true,
      running: false,
      lastAttempt: healthStoryTime - 3600_000,
      lastSuccess: healthStoryTime - 3600_000,
      failedSince: null,
    },
    {
      name: 'collaboration-purge',
      configured: true,
      running: true,
      lastAttempt: healthStoryTime,
      lastSuccess: healthStoryTime - 60_000,
      failedSince: null,
    },
    {
      name: 'space-trash-expiry',
      configured: true,
      running: false,
      lastAttempt: healthStoryTime - 3600_000,
      lastSuccess: healthStoryTime - 3600_000,
      failedSince: null,
    },
  ],
};
export const diagnosticsStory: DiagnosticsStatus = {
  available: true,
  generation: '11111111-1111-4111-8111-111111111111',
  recordCount: 124,
  logicalBytes: 34_500,
  dropped: { invalid: 0, queue: 0, storage: 0, unavailable: 0, stale: 2 },
  exporting: false,
};
