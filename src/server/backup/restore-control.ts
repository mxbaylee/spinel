import type { RestoreJobRecord } from '../maintenance/restore-jobs.ts';
import type { RestoreAdmission } from '../maintenance/supervisor.ts';
import type { RestorePreview } from '../../shared/restore.ts';

export type ConfirmedRestoreAdmission = RestoreAdmission & {
  preview: RestorePreview;
  consequenceEnvelope: 1;
};

/** Trusted application-to-supervisor boundary, never HTTP request descriptors. */
export interface RestoreController {
  target(): { generationId: string; epoch: string };
  admit(request: ConfirmedRestoreAdmission): Promise<{
    record: RestoreJobRecord;
    custody: boolean;
    continuationToken?: string;
  }>;
  begin(request: { id: string; intentHash: string; continuationToken: string }): Promise<{
    record: RestoreJobRecord;
  }>;
}
