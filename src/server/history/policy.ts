export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export type Checkpoint = {
  id: string;
  capturedAt: number;
  revision: number;
  name: string | null;
  beforeRestore?: boolean | number;
  source?: 'native' | 'collaboration';
};

/** Owner-approved spacing (#39): recent detail, then half hours, hours and UTC days. */
export function expiredCheckpoints(checkpoints: readonly Checkpoint[], now: number): string[] {
  const ordered = [...checkpoints].sort(
    (a, b) =>
      b.capturedAt - a.capturedAt ||
      Number(b.source === 'collaboration') - Number(a.source === 'collaboration') ||
      b.revision - a.revision ||
      a.id.localeCompare(b.id),
  );
  const buckets = new Set<string>();
  const expired: string[] = [];
  for (const [index, point] of ordered.entries()) {
    if (point.name !== null || point.beforeRestore) continue; // Named versions never consume an unnamed retention slot.
    const age = now - point.capturedAt;
    if (age < HOUR) continue;
    const interval = age < 6 * HOUR ? 30 * MINUTE : age < DAY ? HOUR : DAY;
    const bucket = `${interval}:${Math.floor(point.capturedAt / interval)}`;
    if (buckets.has(bucket) && index !== 0) expired.push(point.id);
    else buckets.add(bucket);
  }
  return expired;
}
