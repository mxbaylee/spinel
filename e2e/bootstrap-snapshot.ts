import { bootstrapPhases, type BootstrapSnapshot } from '../src/shared/bootstrapEvidence.ts';

/** Missing/invalid witnesses are unavailable, never evidence that startup did not run. */
export function sanitizeBootstrapSnapshot(value: unknown): BootstrapSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as BootstrapSnapshot;
  if (
    !Array.isArray(row.events) ||
    row.events.length > 32 ||
    !Number.isSafeInteger(row.dropped) ||
    row.dropped < 0 ||
    typeof row.invalidClock !== 'boolean' ||
    typeof row.failed !== 'boolean' ||
    typeof row.sealed !== 'boolean'
  )
    return null;
  let previous = 0;
  const events: BootstrapSnapshot['events'] = [];
  for (const event of row.events) {
    if (
      !event ||
      !bootstrapPhases.includes(event.phase) ||
      !Number.isFinite(event.at) ||
      event.at < previous
    )
      return null;
    previous = event.at;
    events.push({ phase: event.phase, at: event.at });
  }
  return {
    events,
    dropped: row.dropped,
    invalidClock: row.invalidClock,
    failed: row.failed,
    sealed: row.sealed,
  };
}
