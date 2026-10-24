export type DiagnosticLoss = 'invalid' | 'queue' | 'storage' | 'unavailable' | 'stale';

export interface DiagnosticsStatus {
  available: boolean;
  generation: string | null;
  recordCount: number;
  logicalBytes: number;
  dropped: Record<DiagnosticLoss, number>;
  exporting: boolean;
}
