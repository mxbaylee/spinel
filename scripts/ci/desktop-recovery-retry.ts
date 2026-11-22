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
