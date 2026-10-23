export type HealthJobName = 'history-maintenance' | 'trash-expiry' | 'collaboration-purge' | 'space-trash-expiry';

export interface HealthJob {
  name: HealthJobName;
  configured: boolean;
  running: boolean;
  lastAttempt: number | null;
  lastSuccess: number | null;
  failedSince: number | null;
}

export interface DatabaseHealth {
  databaseBytes: number;
  walBytes: number;
  growthBytes: number;
  measuredSince: number;
}

export interface ServerHealth {
  sampledAt: number;
  startedAt: number;
  memory: {
    processRssBytes: number;
    systemTotalBytes: number;
    systemUsedBytes: number;
    systemMeasure: 'available' | 'free';
    hostBudgetBytes: number;
    containerUsedBytes: number | null;
    containerLimitBytes: number | null;
    aboveBudgetSince: number | null;
  };
  editorConnections: number;
  application: DatabaseHealth | null;
  diagnostics: DatabaseHealth | null;
  storage: {
    freeBytes: number | null;
    logicalDatabaseBytes: number | null;
    backupStagingBytes: number | null;
    backupUploadLimitBytes: number;
  };
  jobs: HealthJob[];
}
