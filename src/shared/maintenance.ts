/** Maintenance control is deployment-owned; this public view never includes authority. */
export type MaintenancePhase =
  'running' | 'draining' | 'paused' | 'stopping' | 'stopped' | 'starting' | 'recovery-required';

export interface MaintenanceNotice {
  id: string;
  startsAt: number;
  timeZone: string;
  durationMinutes: number;
  state: 'scheduled' | 'started' | 'cancelled' | 'missed';
}

export interface MaintenancePublicStatus {
  available: boolean;
  phase: MaintenancePhase;
  epoch: string;
  notice: MaintenanceNotice | null;
}

export interface MaintenanceAdminStatus extends MaintenancePublicStatus {
  operationId: string | null;
  authorityExpiresAt: number | null;
  generationId: string;
  lastFailure: string | null;
  readyToResume: boolean;
}

/** Authenticated by the application before crossing its private parent IPC channel. */
export interface MaintenanceAuthority {
  actorId: string;
  sessionHash: string;
  expiresAt: number;
}

export type MaintenanceCommand =
  | { action: 'pause'; operationId: string; authority: MaintenanceAuthority }
  | { action: 'resume'; operationId: string; actorId: string; resumeToken: string }
  | {
      action: 'notice';
      operationId: string;
      authority: MaintenanceAuthority;
      notice: Pick<MaintenanceNotice, 'id' | 'startsAt' | 'timeZone' | 'durationMinutes'>;
    }
  | {
      action: 'cancel-notice';
      operationId: string;
      authority: MaintenanceAuthority;
      noticeId: string;
    };

export interface MaintenanceControlResult {
  status: MaintenanceAdminStatus;
  resumeToken?: string;
}

/** Private supervisor-to-child shutdown challenge, never public status. */
export interface RestoreStopRequest {
  jobId: string;
  challengeId: string;
  generationId: string;
  epoch: string;
  deadline: number;
}

export interface MaintenanceBridge {
  status(): MaintenancePublicStatus;
  adminStatus(): MaintenanceAdminStatus;
  subscribe(listener: (status: MaintenancePublicStatus) => void): () => void;
  control(command: MaintenanceCommand): Promise<MaintenanceControlResult>;
  /** Called after the application listener and every storage owner are initialized. */
  ready(): void;
  /** Called only after accepted request, sync and job work has drained. */
  drained(epoch: string): void;
  onRestoreStop?(listener: (request: RestoreStopRequest) => Promise<void>): void;
  acceptRestoreWitness?(request: RestoreStopRequest, fingerprint: string): Promise<void>;
  /** Fixed, non-sensitive failure; the parent keeps maintenance active. */
  fail(reason: 'drain-failed' | 'storage-failed'): void;
  close(): void;
}

export function publicMaintenance(status: MaintenancePublicStatus): MaintenancePublicStatus {
  return {
    available: status.available,
    phase: status.phase,
    epoch: status.epoch,
    notice: status.notice ? { ...status.notice } : null,
  };
}
