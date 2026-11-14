/** Scalar API added to pinned OSS Docs by the hash-guarded dependency patch. */
export type NativeDocFlushOrigin =
  | 'policy-capacity'
  | 'policy-idle'
  | 'public-flush'
  | 'history-timer'
  | 'collaboration-timer'
  | 'segment-boundary'
  | 'immediate'
  | 'history-command'
  | 'unknown';
export type DocCacheCounts = { history: number; collaboration: number };
export interface NativeDocFlushObservation {
  sequence: number;
  unitId: string;
  phase: 'pair' | 'history' | 'collaboration';
  origin: NativeDocFlushOrigin;
  startedAt: number;
  endedAt: number;
  before: DocCacheCounts;
  after: DocCacheCounts;
  outcome: 'returned' | 'threw';
}
export interface NativeDocFlushManager {
  flushPendingChanges(unitId: string, reason?: 'capacity' | 'idle'): void;
  observeFlushes(
    unitId: string,
    observer: (value: NativeDocFlushObservation) => void,
  ): {
    dispose(): void;
    readStatus(): { active: boolean; observerErrors: number };
  };
}
