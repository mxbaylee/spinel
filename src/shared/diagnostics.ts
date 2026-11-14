export type DiagnosticLoss = 'invalid' | 'queue' | 'storage' | 'unavailable' | 'stale';

export interface DiagnosticsStatus {
  available: boolean;
  generation: string | null;
  recordCount: number;
  logicalBytes: number;
  /** Supplied by SPN-110 when automatic observation expiry is enabled. */
  retentionDays?: number;
  dropped: Record<DiagnosticLoss, number>;
  exporting: boolean;
}
