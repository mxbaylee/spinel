import type { DesktopTransferEvidence } from './desktop-transfer-observation.ts';

/** Recognize only an observed admission refusal overlapping one ordinary bundle. */
export function desktopRecoveryRetry(evidence: DesktopTransferEvidence, afterOrdinal: number) {
  if (evidence.dropped || evidence.unreadable) return;
  const recoveries = evidence.requests.filter(
    (row) => row.ordinal > afterOrdinal && row.route === 'offline-recovery',
  );
  if (recoveries.length !== 1) return;
  const refusal = recoveries[0];
  if (refusal.status !== 429 || refusal.finishedMs === undefined) return;
  const bundles = evidence.requests.filter(
    (row) =>
      row.route === 'offline-bundle' &&
      row.startedMs <= refusal.finishedMs! &&
      (row.closedMs ?? Infinity) >= refusal.startedMs,
  );
  if (bundles.length !== 1) return;
  const bundle = bundles[0];
  if (bundle.status !== undefined && bundle.status !== 200) return;
  return {
    refusalOrdinal: refusal.ordinal,
    bundleOrdinal: bundle.ordinal,
    ready:
      bundle.status === 200 &&
      bundle.finishedMs !== undefined &&
      bundle.closedMs !== undefined &&
      evidence.admittedOrdinals.length === 0,
  };
}

/** SaveStatus shows the retry label in ready state too; only a message is failure. */
export function desktopRecoveryPublication(value: {
  href: string;
  retry: boolean;
  message: string;
}) {
  return {
    href: value.href,
    failed: value.retry && Boolean(value.message),
    reason:
      value.message === 'Another file transfer is running. Try again shortly.'
        ? 'transfer-busy'
        : 'other-recovery-error',
  };
}

/** Recheck after browser reads and immediately before an explicit retry click. */
export function desktopRecoveryRemaining(deadline: number, now = Date.now()) {
  if (now >= deadline) throw new Error('Recovery publication exceeded its original deadline');
  return deadline - now;
}
