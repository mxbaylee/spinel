import type { RestoreJobRecord } from '../maintenance/restore-jobs.ts';
import type { RestoreAdmission } from '../maintenance/supervisor.ts';
import type { RestoreResources, RestorePreview } from '../../shared/restore.ts';

export type ConfirmedRestoreAdmission = RestoreAdmission & {
  preview: RestorePreview;
};

/** Private parent evidence. Never serialize this record into an HTTP response. */
export interface RestoreObservation {
  target: { generationId: string; epoch: string };
  record: RestoreJobRecord | null;
  /** Complete bounded inventory, including queued/inflight admission and main refs. */
  pending: boolean;
}

export interface RestoreCapacityRequest {
  generationId: string;
  epoch: string;
  archiveBytes: number;
  databaseBytes: number;
  previewDatabaseBytes: number;
}
export interface RestoreCapacityResult {
  target: { generationId: string; epoch: string };
  resources: RestoreResources;
}

/** Trusted application-to-supervisor boundary, never HTTP request descriptors. */
export interface RestoreController {
  estimate(request: RestoreCapacityRequest): Promise<RestoreCapacityResult>;
  target(): { generationId: string; epoch: string };
  observe(request: { id?: string }): Promise<RestoreObservation>;
  admit(request: ConfirmedRestoreAdmission): Promise<{
    record: RestoreJobRecord;
    custody: boolean;
    continuationToken?: string;
  }>;
  begin(request: { id: string; intentHash: string; continuationToken: string }): Promise<{
    record: RestoreJobRecord;
  }>;
}
